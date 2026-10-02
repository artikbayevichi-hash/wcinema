<?php
// ============================================================================
// api/hls.php - HLS oqim (Cloudflare edge-kesh)
// ============================================================================
// Bu endpoint HLS rejimining "plyaj avtobus pisti" — hamma narsa shu orqali
// keladi/ketadi:
//
//   ?key=<key>&seg=seg_00001.ts  -> SEGMENT fayl. URL deterministik (film
//      per-ga o'zgarmaydi) va Cache-Control: immutable — Cloudflare ularni
//      edge'da keshlaydi, VPS trafigi minimal. (video/mp2t)
//
//   ?id=<content>&episode=<n>    -> PLAYLIST (index.m3u8). Segmentlar ham
//      shu endpointdan, deterministik URL'lar bilan ko'rsatiladi.
//
//   ?url=<t.me post>             -> shu postning playlisti.
//
// Agar playlist hali tayyor bo'lmasa (worker Telegram'dan yuklab, ffmpeg
// bilan bo'lyapti) -> 503 + Retry-After. app.js "tayyorlanmoqda" deb qayta
// so'raydi; transkod davomida index.m3u8 o'sib boradi va player progressiv
// o'ynaydi (HLS live mode).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

set_time_limit(0);
ini_set('memory_limit', '-1');

function hlsErr($msg, $code = 502) {
    @http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $msg;
    exit;
}

// JSON rejim (udp-player data-hls-pending / data-hls-refresh poll):
//   ?json=1  tayyor    -> {"ok":true,"url":"<playlist URL>"}
//            tayyor emas -> {"ok":false}  (qayta-so'rov 15 s)
function hlsJson($ok, $url = null, $msg = null, $code = 200) {
    @http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => (bool) $ok, 'url' => $url, 'msg' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function hlsReadMeta($metaFile) {
    for ($i = 0; $i < 5; $i++) {
        $raw = @file_get_contents($metaFile);
        $d   = $raw ? json_decode($raw, true) : null;
        if (is_array($d)) {
            return $d;
        }
        usleep(60000);
    }
    return null;
}

// ---------------------------------------------------------------------------
// Eskirgan HLS keshini tozalash (har bir so'rov boshida)
// ---------------------------------------------------------------------------
function hlsSweep() {
    $now = time();
    $dir = HLS_CACHE_DIR;
    if (!is_dir($dir)) {
        return;
    }
    $items = @scandir($dir);
    if (!is_array($items)) {
        return;
    }
    $total = 0;
    $done  = [];
    foreach ($items as $it) {
        if ($it === '.' || $it === '..' || !is_dir($dir . '/' . $it)) {
            continue;
        }
        $sub   = $dir . '/' . $it;
        $metaF = $sub . '/meta.json';
        $meta  = hlsReadMeta($metaF);
        if (!is_array($meta)) {
            // meta yo'q — eskirgan (boshlanmagan) papka
            if ($now - (int) @filemtime($sub) > 3600) {
                @array_map('unlink', glob($sub . '/*'));
                @rmdir($sub);
            }
            continue;
        }
        $status = (string) ($meta['status'] ?? '');
        $metaAge = $now - (int) @filemtime($metaF);

        if (in_array($status, ['downloading', 'transcoding'], true) && $metaAge > 4 * 3600) {
            // osilib qolgan worker
            @array_map('unlink', glob($sub . '/*'));
            @rmdir($sub);
            continue;
        }
        if (in_array($status, ['done', 'error'], true) && $metaAge > HLS_TTL) {
            @array_map('unlink', glob($sub . '/*'));
            @rmdir($sub);
            continue;
        }
        $sz = 0;
        foreach (glob($sub . '/*') ?: [] as $f) {
            $sz += (int) @filesize($f);
        }
        $total += $sz;
        if ($status === 'done') {
            $done[$it] = ['age' => $metaAge, 'size' => $sz];
        }
    }

    // Disk kvotasi: HLS_MAX_MB dan oshsa eng qadimgi tayyor keshlarni o'chiramiz
    $maxBytes = HLS_MAX_MB * 1024 * 1024;
    if ($total > $maxBytes && $done) {
        uasort($done, function ($a, $b) { return $a['age'] <=> $b['age']; });
        foreach ($done as $k => $d) {
            if ($total <= $maxBytes) {
                break;
            }
            $sub = $dir . '/' . $k;
            @array_map('unlink', glob($sub . '/*'));
            @rmdir($sub);
            $total -= $d['size'];
            error_log('[hls] kvota: ' . $k . ' o\'chirildi (-' . round($d['size'] / 1048576, 1) . 'MB)');
        }
    }
}

/** Worker'ni ajratilgan jarayonda ishga tushiradi. */
function hlsSpawnWorker($key, $url) {
    $phpBin = PHP_CLI_BIN;
    $worker = escapeshellarg(dirname(__DIR__) . '/cli/hls-worker.php');
    if (stripos(PHP_OS_FAMILY, 'win') === 0) {
        $cmd = 'start /B "" ' . escapeshellarg($phpBin) . ' ' . $worker . ' '
            . escapeshellarg($url) . ' ' . escapeshellarg($key) . ' > NUL 2>&1';
        $fp = @popen($cmd, 'r');
        if ($fp === false) {
            return false;
        }
        @pclose($fp);
        return true;
    }
    $cmd = escapeshellarg($phpBin) . ' ' . $worker . ' '
        . escapeshellarg($url) . ' ' . escapeshellarg($key) . ' > /dev/null 2>&1 &';
    @exec($cmd);
    return true;
}

// ===========================================================================
// (0) SEGMENT xizmasi — deterministik URL, Cloudflare keshlaydi
// ===========================================================================
$key = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($_GET['key'] ?? ''));
$seg = (string) ($_GET['seg'] ?? '');
if ($key !== '' && $seg !== '') {
    $file = basename($seg);
    if (!preg_match('/^seg_\d+\.ts$/', $file)) {
        hlsErr('Segment nomi noto\'g\'ri', 404);
    }
    if (!is_file(HLS_CACHE_DIR . '/' . $key . '/' . $file)) {
        hlsErr('Segment topilmadi', 404);
    }
    header('Content-Type: video/mp2t');
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Content-Length: ' . (int) filesize(HLS_CACHE_DIR . '/' . $key . '/' . $file));
    readfile(HLS_CACHE_DIR . '/' . $key . '/' . $file);
    exit;
}

// ===========================================================================
// (1) PLAYLIST
// ===========================================================================
$json = (string) input('json', '', 8) === '1';

if (!HLS_ENABLED) {
    if ($json) {
        hlsJson(false, null, 'HLS o\'chirilgan', 503);
    }
    hlsErr('HLS oqim o\'chirilgan (.env: HLS_ENABLED=1 + serverda ffmpeg)', 503);
}

$id     = inputInt('id');
$ep     = inputInt('episode');
$rawUrl = trim((string) input('url', '', 2000));

// Playlist URLi — json rejimda "url" sifatida qaytariladi (tayyor bo'lganda)
$playUrl = '';
if ($rawUrl !== '') {
    $playUrl = dirname($_SERVER['SCRIPT_NAME'] ?? '/') . '/hls.php?url=' . rawurlencode($rawUrl);
} elseif ($ep > 0) {
    $playUrl = dirname($_SERVER['SCRIPT_NAME'] ?? '/') . '/hls.php?id=' . $id . '&episode=' . $ep;
} else {
    $playUrl = dirname($_SERVER['SCRIPT_NAME'] ?? '/') . '/hls.php?id=' . $id;
}

$src = null; // [content_id, episode_id, url]
if ($rawUrl !== '') {
    if (!TgPull::parseUrl($rawUrl)) {
        hlsErr('Havola t.me/telegram.me ko\'rinishida emas', 400);
    }
    $src = ['content_id' => 0, 'episode_id' => 0, 'url' => $rawUrl];
} elseif ($ep > 0) {
    $row = $catalog->getEpisode($ep);
    if (!$row || ($id > 0 && (int) $row['content_id'] !== $id)) {
        hlsErr('Qism topilmadi', 404);
    }
    $url = $row['video_url_1080p'] ?: ($row['video_url_720p'] ?: $row['video_url']);
    $url = trim((string) $url);
    if ($url === '' || !TgPull::parseUrl($url)) {
        hlsErr('Bu qism Telegram havolasi emas', 400);
    }
    $src = ['content_id' => (int) $row['content_id'], 'episode_id' => $ep, 'url' => $url];
} elseif ($id > 0) {
    $row = $catalog->getContent($id);
    if (!$row) {
        hlsErr('Kontent topilmadi', 404);
    }
    $url = $row['video_url_1080p'] ?? ($row['video_url_720p'] ?? ($row['video_url'] ?? ''));
    $url = trim((string) $url);
    if ($url === '' || !TgPull::parseUrl($url)) {
        hlsErr('Bu kontent Telegram havolasi emas', 400);
    }
    $src = ['content_id' => $id, 'episode_id' => 0, 'url' => $url];
} else {
    hlsErr('id/episode yoki url ko\'rsating', 400);
}

if (!is_dir(HLS_CACHE_DIR)) {
    @mkdir(HLS_CACHE_DIR, 0777, true);
}
hlsSweep();

$key      = sha1('hls:' . $src['url']);
$hlsDir   = HLS_CACHE_DIR . '/' . $key;
$metaFile = $hlsDir . '/meta.json';
$playlist = $hlsDir . '/index.m3u8';

// Worker'ni faqat BIR so'rov ishga tushiradi (flock, live.php bilan bir xil)
$ensureStarted = function () use ($metaFile, $src, $key) {
    if (!is_dir(dirname($metaFile))) {
        @mkdir(dirname($metaFile), 0777, true);
    }
    $fh = @fopen($metaFile, 'c+');
    if (!$fh) {
        return false;
    }
    @flock($fh, LOCK_EX);
    rewind($fh);
    $raw = stream_get_contents($fh);
    $meta = $raw ? json_decode($raw, true) : null;
    $needStart = !is_array($meta);
    if (is_array($meta)) {
        $status = (string) ($meta['status'] ?? '');
        if (in_array($status, ['done', 'downloading', 'transcoding'], true)) {
            $needStart = false;
        }
    }
    if ($needStart) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode([
            'status'  => 'starting',
            'started' => time(),
            'error'   => null,
        ], JSON_UNESCAPED_UNICODE));
        fflush($fh);
        hlsSpawnWorker($key, $src['url']);
    }
    @flock($fh, LOCK_UN);
    @fclose($fh);
    return true;
};

$ensureStarted();

$meta = hlsReadMeta($metaFile);
$status = is_array($meta) ? (string) ($meta['status'] ?? '') : '';

// Playlist tayyor bo'lsa — darhol beramiz (hatto transkod davomida,
// index.m3u8 o'sib boradi — HLS live rejim, progressiv o'ynaydi).
if (is_file($playlist)) {
    if ($json) {
        hlsJson(true, $playUrl);
    }
    $raw = @file_get_contents($playlist);
    if ($raw === false || $raw === '') {
        hlsErr('Playlist o\'qilmadi', 502);
    }
    // Segment qatorlarini shu endpointning deterministik URL'lariga aylantiramiz
    $base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');
    $lines = explode("\n", $raw);
    $out = [];
    foreach ($lines as $ln) {
        $t = trim($ln);
        if (preg_match('/^seg_\d+\.ts$/', $t)) {
            $out[] = $base . '/hls.php?key=' . rawurlencode($key) . '&seg=' . $t;
        } else {
            $out[] = $ln;
        }
    }
    header('Content-Type: application/vnd.apple.mpegurl');
    header('Cache-Control: public, max-age=60'); // qisqa — lekin segmentlar immutable
    echo implode("\n", $out);
    exit;
}

// Xato holati aniq bo'lsa
if ($status === 'error') {
    $err = is_array($meta) ? trim((string) ($meta['error'] ?? 'Noma\'lum xato')) : 'Noma\'lum xato';
    if ($json) {
        hlsJson(false, null, '🎬 Video tayyorlashda xato: ' . $err, 502);
    }
    hlsErr('🎬 Video tayyorlashda xato: ' . $err, 502);
}

// Hali yuklab bormoqda — qisqa javob, app.js qayta so'raydi
if ($json) {
    hlsJson(false, null, null, 503);
}
@http_response_code(503);
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('Retry-After: 20');
echo '🎬 Video tayyorlanmoqda (birinchi ko\'rishda Telegram\'dan yuklanadi). Birazdan qayta uriniladi...';