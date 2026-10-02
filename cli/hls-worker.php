<?php
// ============================================================================
// cli/hls-worker.php - Telegram film -> HLS segmentlar (Cloudflare edge-kesh)
// ============================================================================
// api/hls.php tomonidan ajratilgan jarayonda ishga tushiriladi:
//   php cli/hls-worker.php "<t.me url>" "<key>"
//
// Qadamlar:
//   1) Postdagi video haqida ma'lumot oladi (hajmi, mime, davomiylik) va
//      uni meta faylga yozadi (status=downloading).
//   2) Documentni storage/hls_cache/<key>/source.mp4 ga yuklab oladi
//      (resume/retry bilan — live-worker bilan bir xil mexanizm).
//   3) ffmpeg bilan -c copy rejimida HLS segmentlarga bo'ladi:
//      index.m3u8 + seg_00001.ts, seg_00002.ts, ... (status=transcoding).
//   4) Tayyor: status=done, source.mp4 o'chiriladi (disk tejash).
//
// NIMA UCHUN: har bir segment deterministik URL'da chiqadi va Cloudflare
// (domen + CF DNS orqali) ularni edge'da KESHLAB qo'yadi — tomoshabinlar
// videoni CF edge/CDN'dan oladi, VPS egress trafigi minimal.
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
ini_set('memory_limit', '-1');

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

$url = $argv[1] ?? '';
$key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($argv[2] ?? ''));
if ($url === '' || $key === '') {
    fwrite(STDERR, "URL va KEY kerak\n");
    exit(1);
}

if (!is_dir(HLS_CACHE_DIR)) {
    @mkdir(HLS_CACHE_DIR, 0777, true);
}
$hlsDir = HLS_CACHE_DIR . '/' . $key;
if (!is_dir($hlsDir)) {
    @mkdir($hlsDir, 0777, true);
}
$source = $hlsDir . '/source.mp4';
$metaF  = $hlsDir . '/meta.json';

// --- Duplikat-worker himoyasi (live-worker bilan bir xil mantiq) ----------
clearstatcache(true, $metaF);
$prevRaw = is_file($metaF) ? @file_get_contents($metaF) : null;
$prev    = $prevRaw ? @json_decode($prevRaw, true) : null;
if (is_array($prev)) {
    $prevStatus = (string) ($prev['status'] ?? '');
    if ($prevStatus === 'done') {
        exit(0); // HLS tayyor
    }
    if (in_array($prevStatus, ['downloading', 'transcoding'], true)) {
        $prevTick = max((int) ($prev['worker_tick'] ?? 0), (int) ($prev['started'] ?? 0));
        if ($prevTick > 0 && (time() - $prevTick) < 120) {
            exit(0); // boshqa worker hozir ishlab bormoqda
        }
    }
}

/** Meta faylni xavfsiz yangilash: .tmp -> rename (chala JSON o'qilmaydi). */
function hlsMetaSet($metaF, $patch) {
    $cur = is_file($metaF) ? json_decode((string) @file_get_contents($metaF), true) : [];
    if (!is_array($cur)) {
        $cur = [];
    }
    $data = array_merge($cur, $patch);
    @file_put_contents($metaF . '.tmp', json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    @rename($metaF . '.tmp', $metaF);
    @chmod($metaF, 0666);
}

hlsMetaSet($metaF, [
    'status'     => 'downloading',
    'started'    => time(),
    'progress'   => 0,
    'downloaded' => 0,
    'error'      => null,
]);

// --- ffmpeg bazaviy tekshiruv (yuklab olishdan OLDIN — xato bo'lsa tez chiqamiz)
// DIQQAT: paket topilmasa shell "ffmpeg: command not found"-ni stderr'ga yozadi
// va 2>&1 uni stdout'ga ulaydi — shuning uchun "ffmpeg version" qatorini
// qat'iy tekshiramiz (mavjud emasligi ham non-empty bo'lishi mumkin).
$ff     = FFMPEG_BIN;
$probe  = @shell_exec(escapeshellarg($ff) . ' -version 2>&1');
$ffOk   = (bool) preg_match('/^ffmpeg version\s/i', (string) $probe);
if (!$ffOk) {
    fwrite(STDERR, 'ffmpeg topilmadi (' . FFMPEG_BIN . '). Linux VPS: apt install ffmpeg (yoki .env da FFMPEG_BIN to\'g\'rilang).' . "\n");
    hlsMetaSet($metaF, [
        'status' => 'error',
        'error'  => 'ffmpeg topilmadi (' . FFMPEG_BIN . '). VPS: apt install ffmpeg.',
        'ended'  => time(),
    ]);
    exit(1);
}

try {
    // Bot sessiyasini faqat BIZ ishlatishimiz uchun global qulf.
    TgPull::sessionLockAcquire();

    // --- Yuklab olish (resume/retry, 3 urinish) -----------------------------
    $attempts = 3;
    $lastErr  = null;
    $total    = 0;

    for ($i = 0; $i < $attempts; $i++) {
        $api = TgPull::openBotSession();
        try {
            $info = TgPull::fetchDocInfo($api, $url);
            $total = (int) ($info['size'] ?? 0);
            if ($total <= 0) {
                throw new \RuntimeException('Document hajmi noma\'lum.');
            }

            hlsMetaSet($metaF, [
                'total'       => $total,
                'mime'        => $info['mime'] ?? 'video/mp4',
                'duration'    => $info['duration'],
                'file_name'   => $info['file_name'],
                'status'      => 'downloading',
            ]);

            // Boshqa jarayon allaqachon yuklab qo'ygan bo'lishi mumkin
            clearstatcache(true, $source);
            if (is_file($source) && (int) @filesize($source) >= $total) {
                break;
            }

            $cb = function ($progress, $speed, $time) use ($metaF, $total) {
                hlsMetaSet($metaF, [
                    'progress'    => (int) round((float) $progress),
                    'downloaded'  => (int) round($total * (float) $progress / 100),
                    'speed'       => (float) ($speed ?? 0),
                    'worker_tick' => time(),
                ]);
            };

            $api->downloadToFile($info['doc'], $source, $cb);

            clearstatcache(true, $source);
            if ((int) @filesize($source) >= $total) {
                break;
            }
            $lastErr = "Fayl to'liq emas (" . (int) @filesize($source) . " / {$total})";
            unset($api);
            usleep(700000);
        } catch (\Throwable $e) {
            $lastErr = trim((string) $e->getMessage());
            unset($api);
            usleep(700000);
        }
    }

    clearstatcache(true, $source);
    if (!is_file($source) || (int) @filesize($source) < $total) {
        throw new \RuntimeException((string) ($lastErr ?: 'Yuklab olish tugamadi'));
    }

    hlsMetaSet($metaF, [
        'status'     => 'transcoding',
        'progress'   => 100,
        'downloaded' => (int) @filesize($source),
        'worker_tick'=> time(),
    ]);

    // --- ffmpeg: HLS transkod (copy — tez, sifat o'zgarmaydi) --------------
    $cmd = [
        escapeshellarg($ff),
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', escapeshellarg($source),
        '-c', 'copy',                    // qayta kodlashsiz — tez, sifat saqlanadi
        '-f', 'hls',
        '-hls_time', (string) HLS_SEG_SEC,
        '-hls_list_size', '0',           // barcha segmentlar shartli ro'yxatda
        '-hls_segment_filename', escapeshellarg($hlsDir . '/seg_%05d.ts'),
        escapeshellarg($hlsDir . '/index.m3u8'),
    ];
    $out = [];
    $code = 0;
    exec(implode(' ', $cmd) . ' 2>&1', $out, $code);

    if ($code !== 0 || !is_file($hlsDir . '/index.m3u8')) {
        throw new \RuntimeException('ffmpeg xato: ' . implode(' | ', array_slice($out, -6)));
    }

    $segs = glob($hlsDir . '/seg_*.ts');
    $segCount = $segs ? count($segs) : 0;
    $sizeB    = 0;
    foreach ($segs ?: [] as $s) {
        $sizeB += (int) @filesize($s);
    }
    // Disk tejash: endi HLS segmentlar yetarli
    @unlink($source);

    hlsMetaSet($metaF, [
        'status'   => 'done',
        'segments' => $segCount,
        'size'     => $sizeB,
        'ended'    => time(),
        'error'    => null,
    ]);
    fwrite(STDOUT, "HLS tayyor: {$key} ({$segCount} segment, " . round($sizeB / 1048576, 1) . "MB)\n");
    exit(0);
} catch (\Throwable $e) {
    $msg = trim((string) $e->getMessage());
    hlsMetaSet($metaF, [
        'status' => 'error',
        'error'  => $msg,
        'ended'  => time(),
    ]);
    fwrite(STDERR, $msg . "\n");
    exit(1);
}