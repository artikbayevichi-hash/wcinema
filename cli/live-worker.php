<?php
// ============================================================================
// cli/live-worker.php - Telegram'dan JONLI oqim uchun vaqtinchalik kesh
// ============================================================================
// api/live.php tomonidan ajratilgan jarayonda ishga tushiriladi:
//   php cli/live-worker.php "<t.me url>" "<cache key>"
//
// Bu ishchi:
//   1) Bot sessiyasi orqali postdagi video document haqida ma'lumot oladi
//      (hajmi, mime, davomiyligi) va uni meta faylga YOZADI. O'sha payt
//      api/live.php foydalanuvchilarga to'g'ri Content-Length bilan
//      Range/206 javob bera oladi.
//   2) Documentni storage/live_cache/<key>.mp4 ga yuklab boradi.
//      Holat <key>.meta.json da: status=starting|downloading|done|error,
//      progress, downloaded, total.
//   3) Tomoshabinlar yuklab borilayotgan faylni birga ko'radi (issiq kesh).
//      Yuklab bo'lgach va TTL o'tgach api/live.php keshni tozalaydi —
//      hech narsa serverda doimiy saqlanmaydi.
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

$cacheDir = __DIR__ . '/../storage/live_cache';
if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0777, true);
}
$cacheFile = $cacheDir . '/' . $key . '.mp4';
$metaFile  = $cacheDir . '/' . $key . '.meta.json';

// --- Duplikat-worker himoyasi --------------------------------------------
// Agar aynan shu manba uchun BOSHQA worker ALLAQACHON faol bo'lsa
// (status 'downloading' va started/worker_tick yaqin) yoki kesh allaqachon
// `done` bo'lsa — biz meta'ni "0%" qilib qayta yozib, faol worker'ga
// xalaqit bermaymiz: shunchaki chiqamiz. 'starting' esa live.php tomonidan
// aynan biz uchun yozilgan belgi — uni davom ettiramiz.
clearstatcache(true, $metaFile);
$prevRaw = is_file($metaFile) ? @file_get_contents($metaFile) : null;
$prev    = $prevRaw ? @json_decode($prevRaw, true) : null;
if (is_array($prev)) {
    $prevStatus = (string) ($prev['status'] ?? '');
    if ($prevStatus === 'done') {
        exit(0); // kesh tayyor — qayta yuklanish shart emas
    }
    if ($prevStatus === 'downloading') {
        $prevTick = max((int) ($prev['worker_tick'] ?? 0), (int) ($prev['started'] ?? 0));
        if ($prevTick > 0 && (time() - $prevTick) < 120) {
            exit(0); // boshqa worker hozir yuklab bormoqda
        }
    }
}

/**
 * Meta faylni xavfsiz yangilash: avval .tmp ga yozib, keyin almashtiramiz —
 * api/live.php hech qachon "chala" JSON o'qimaydi.
 */
function liveMetaSet($metaFile, $patch) {
    $cur = is_file($metaFile) ? json_decode((string) @file_get_contents($metaFile), true) : [];
    if (!is_array($cur)) {
        $cur = [];
    }
    $data = array_merge($cur, $patch);
    @file_put_contents($metaFile . '.tmp', json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    @rename($metaFile . '.tmp', $metaFile);
    @chmod($metaFile, 0666);
}

liveMetaSet($metaFile, [
    'status'     => 'downloading',
    'started'    => time(),
    'progress'   => 0,
    'downloaded' => 0,
    'error'      => null,
]);

// Bot sessiyasini faqat BIZ ishlatishimiz uchun global qulf olinadi.
// Boshqa worker (deliver, boshqa filmlar uchun live) hali ishlayotgan bo'lsa
// — xato emas, bo'shaguncha kutamiz (MadelineProto IPC konflikti oldini olish).
try {
    TgPull::sessionLockAcquire();

    // --- Bir necha urinish: Windows/MTProto vaqtincha "cancelled" berishi mumkin.
    // Qisman yuklangan fayl saqlanadi — downloadToFile uni RESUME qiladi.
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

            liveMetaSet($metaFile, [
                'total'     => $total,
                'mime'      => $info['mime'] ?? 'video/mp4',
                'duration'  => $info['duration'],
                'file_name' => $info['file_name'],
                'status'    => 'downloading',
            ]);

            // Tasodifan boshqa jarayon allaqachon to'liq yuklab qo'ygan bo'lishi mumkin
            clearstatcache(true, $cacheFile);
            if (is_file($cacheFile) && (int) filesize($cacheFile) >= $total) {
                liveMetaSet($metaFile, [
                    'status'     => 'done',
                    'progress'   => 100,
                    'downloaded' => $total,
                    'ended'      => time(),
                    'error'      => null,
                ]);
                exit(0);
            }

            $cb = function ($progress, $speed, $time) use ($metaFile, $total) {
                $p = (int) round((float) $progress);
                liveMetaSet($metaFile, [
                    'progress'    => $p,
                    'downloaded'  => (int) round($total * $p / 100),
                    'speed'       => (float) ($speed ?? 0),
                    'worker_tick' => time(),
                ]);
            };

            $api->downloadToFile($info['doc'], $cacheFile, $cb);

            clearstatcache(true, $cacheFile);
            $final = is_file($cacheFile) ? (int) filesize($cacheFile) : 0;
            if ($final >= $total) {
                liveMetaSet($metaFile, [
                    'status'     => 'done',
                    'progress'   => 100,
                    'downloaded' => $final,
                    'ended'      => time(),
                    'error'      => null,
                ]);
                exit(0);
            }
            // Tugamagan bo'lsa — keyingi urinishda davom etamiz
            $lastErr = "Fayl to'liq emas ({$final} / {$total})";
            unset($api);
            usleep(700000);
        } catch (\Throwable $e) {
            $lastErr = trim((string) $e->getMessage());
            unset($api);
            usleep(700000); // keyingi urinishga kichik pauza
        }
    }

    // Barcha urinishlar tugadi — xato
    $msg = (string) ($lastErr ?: 'Noma\'lum xato');
    $low = mb_strtolower($msg);
    if (strpos($low, 'channel_private') !== false || strpos($low, 'access_denied') !== false
        || strpos($low, 'channel_invalid') !== false || strpos($low, 'chat_admin_required') !== false) {
        $msg = 'Bot kanalga ulana olmadi. Kanal → «Administrators» → botni ADMIN qilib qo\'shing va «Xabarlarni o\'qish» huquqini yoqing.';
    } elseif (strpos($low, 'flood') !== false) {
        $msg = 'Telegram so\'rovlarni chekladi (flood wait) — bir necha daqiqadan so\'ng qayta bosing.';
    } elseif (strpos($low, 'madelineproto') !== false || strpos($low, 'session lock') !== false) {
        $msg = 'Bot sessiyasi band edi — boshqa yuklash jarayoni bilan to\'qnashuv. Bir necha daqiqadan so\'ng qayta bosing: ' . $msg;
    } elseif (strpos($low, 'connection') !== false || strpos($low, 'cancel') !== false) {
        $msg = 'Telegram bilan aloqa tez-tez uzilmoqda (yuklab olish bir necha marta sinaldi). Internetni tekshiring yoki birozdan so\'ng qayta bosing: ' . $msg;
    }
    liveMetaSet($metaFile, [
        'status' => 'error',
        'error'  => $msg,
        'ended'  => time(),
    ]);
    fwrite(STDERR, $msg . "\n");
    exit(1);
} catch (\Throwable $e) {
    $msg = trim((string) $e->getMessage());
    $low = mb_strtolower($msg);
    if (strpos($low, 'channel_private') !== false || strpos($low, 'access_denied') !== false
        || strpos($low, 'channel_invalid') !== false || strpos($low, 'chat_admin_required') !== false) {
        $msg = 'Bot kanalga ulana olmadi. Kanal → «Administrators» → botni ADMIN qilib qo\'shing va «Xabarlarni o\'qish» huquqini yoqing.';
    } elseif (strpos($low, 'flood') !== false) {
        $msg = 'Telegram so\'rovlarni chekladi (flood wait) — bir necha daqiqadan so\'ng qayta bosing.';
    } elseif (strpos($low, 'madelineproto') !== false || strpos($low, 'session lock') !== false) {
        $msg = 'Bot sessiyasi band edi — boshqa yuklash jarayoni bilan to\'qnashuv. Bir necha daqiqadan so\'ng qayta bosing: ' . $msg;
    } elseif (strpos($low, 'connection') !== false) {
        $msg = 'Telegram bilan ulanish uzildi: ' . $msg;
    }
    liveMetaSet($metaFile, [
        'status' => 'error',
        'error'  => $msg,
        'ended'  => time(),
    ]);
    fwrite(STDERR, $msg . "\n");
    exit(1);
}