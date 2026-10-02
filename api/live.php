<?php
// ============================================================================
// api/live.php - Telegram'dan JONLI oqim (ishgacha doimiy saqlanmaydi)
// ============================================================================
// Bu endpoint t.me postidagi videoni bot (MTProto) orqali Telegram'dan
// serverga "jonli" uzatadi va minglab tomoshabinga Range/206 bilan beradi.
//
//   GET ?url=https://t.me/kanal/postid         (tashqi test / ishlatish)
//   GET ?id=<kontent>&episode=<qism>           (sayt playeri shu ko'rinishni
//                                               Catalog::playbackFromUrl dan oladi)
//
// Ishlash prinsipi:
//   1) Manba video havolasi aniqlanadi (episode jadvalidan yoki ?url).
//   2) Har bir manba uchun "issiq kesh" fayli storage/live_cache/<key>.mp4.
//   3) Birinchi so'rov worker ni (cli/live-worker.php) ishga tushiradi:
//      u Telegram'dan hajmni bilib meta faylga yozadi va faylni yuklab
//      boradi. Keyingi tomoshabin xuddi o'sha faylni ko'radi (bir marta
//      yuklab olinadi — 2+ tomoshabin uchun tez).
//   4) So'rov Range ba'zan downloaddan oldinroq bo'lsa, kerakli bayt
//      yozilguncha KUTADI (progressiv oqim). Xato bo'lsa aniq 502 bilan
//      yakunlanadi.
//   5) Kesh TTL (6 soat, .env LIVE_CACHE_TTL) ichida faol bo'lmasa tozalanadi;
//      disk kvotasi (LIVE_CACHE_MAX_MB) oshib ketsa eng qadimgi filmlar
//      avtomatik o'chiriladi — kontent serverda qolib ketmaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

const LIVE_CACHE_DIR  = __DIR__ . '/../storage/live_cache';
// Kesh umri: 6 soat (video TEZ ochilishi uchun — sovuq keshda Telegram'dan
// qayta yuklash kamayadi). LIVE_CACHE_TTL va LIVE_CACHE_MAX_MB .env orqali
// sozlanadi (define chunki konstanta ifodali).
define('LIVE_CACHE_TTL',    (int) (getenv('LIVE_CACHE_TTL') ?: 21600));     // soniya: 21600 = 6 soat
define('LIVE_CACHE_MAX_MB', (int) (getenv('LIVE_CACHE_MAX_MB') ?: 20000));  // disk kvotasi (MB)
const LIVE_START_DL   = 300;         // worker ishga tushishini kutish (sek)
const LIVE_READ_BYTES = 262144;      // har bir o'qish bloki (256 KB)

set_time_limit(0);
ini_set('memory_limit', '-1');

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------
function liveSendError($msg, $code = 502) {
    @http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo '⚠️ ' . $msg;
    exit;
}

function liveReadMeta($metaFile) {
    // Worker .tmp -> rename bilan yozadi; shuning uchun chala o'qish bo'lsa
    // qayta urinamiz (Windows'da fayl qisqa vaqt bo'sh ko'rinishi mumkin).
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

/**
 * Fayl o'lchamini YANGI (keshsiz) hisoblaydi.
 * Muhim: PHP filesize() natijani stat-keshda saqlaydi — boshqa jarayon
 * (worker) faylni o'sirayotganda eski "0" qiymat qaytadi. Har safar
 * clearstatcache(true, $path) chaqirish majburiy.
 */
function liveFileSize($path) {
    clearstatcache(true, $path);
    $s = @filesize($path);
    return $s === false ? 0 : (int) $s;
}

/** Eskirgan keshlarni tozalaydi — har bir so'rov boshida chaqiriladi. */
function liveSweep() {
    $now  = time();
    $ttl  = LIVE_CACHE_TTL;
    $dir  = LIVE_CACHE_DIR;
    $files = @scandir($dir);
    if (!is_array($files)) {
        return;
    }
    $seen = [];
    foreach ($files as $f) {
        if (substr($f, -10) !== '.meta.json') {
            continue;
        }
        $key       = substr($f, 0, -10);
        $seen[$key] = true;
        $metaFile  = $dir . '/' . $f;
        $cacheFile = $dir . '/' . $key . '.mp4';
        $meta = liveReadMeta($metaFile);
        if (!is_array($meta)) {
            @unlink($metaFile);
            @unlink($cacheFile);
            continue;
        }
        $status   = (string) ($meta['status'] ?? '');
        $metaAge  = $now - (int) @filemtime($metaFile);
        $cacheAge = is_file($cacheFile) ? $now - (int) @filemtime($cacheFile) : PHP_INT_MAX;

        if ($status === 'starting' && $metaAge > 120) {
            // worker umuman boshlamagan (spawn xatosiz ham bo'lishi mumkin)
            @unlink($metaFile);
            @unlink($cacheFile);
            continue;
        }
        if ($status === 'downloading' && $metaAge > 4 * 3600) {
            // osilib qolgan worker
            @unlink($metaFile);
            @unlink($cacheFile);
            continue;
        }
        if (($status === 'done' || $status === 'error') && $metaAge > $ttl && $cacheAge > $ttl) {
            @unlink($metaFile);
            @unlink($cacheFile);
        }
    }
    // Meta'siz qolgan .mp4 larni ham tozalaymiz
    foreach ($files as $f) {
        if (substr($f, -4) !== '.mp4') {
            continue;
        }
        $key = substr($f, 0, -4);
        if (!isset($seen[$key]) && @filemtime($dir . '/' . $f) < $now - $ttl) {
            @unlink($dir . '/' . $f);
        }
    }

    // Disk kvotasi: LIVE_CACHE_MAX_MB dan oshsa eng qadimgi TAYYOR keshlarni
    // o'chiramiz (TTL 6 soat bo'lsa ham disk to'lib ketmaydi).
    $maxBytes = LIVE_CACHE_MAX_MB * 1024 * 1024;
    $total = 0;
    foreach ($files as $f) {
        if (substr($f, -4) === '.mp4' && is_file($dir . '/' . $f)) {
            $total += (int) @filesize($dir . '/' . $f);
        }
    }
    if ($total > $maxBytes) {
        $done = [];
        foreach ($files as $f) {
            if (substr($f, -10) !== '.meta.json') {
                continue;
            }
            $key = substr($f, 0, -10);
            $meta = liveReadMeta($dir . '/' . $f);
            if (is_array($meta) && ($meta['status'] ?? '') === 'done' && is_file($dir . '/' . $key . '.mp4')) {
                $done[$key] = (int) @filemtime($dir . '/' . $key . '.mp4');
            }
        }
        asort($done); // eng qadimgi birinchi o'chadi
        foreach ($done as $key => $_mt) {
            if ($total <= $maxBytes) {
                break;
            }
            $sz = (int) @filesize($dir . '/' . $key . '.mp4');
            @unlink($dir . '/' . $key . '.mp4');
            @unlink($dir . '/' . $key . '.meta.json');
            $total -= $sz;
            error_log('[live] kvota: ' . $key . ' o\'chirildi (-' . round($sz / 1048576, 1) . 'MB)');
        }
    }
}

/** Worker'ni ajratilgan jarayonda ishga tushiradi. */
function liveSpawnWorker($key, $url) {
    $phpBin = PHP_CLI_BIN;
    $worker = escapeshellarg(dirname(__DIR__) . '/cli/live-worker.php');
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

// ---------------------------------------------------------------------------
// KIRISH KONTROLLI: bu relay FAQAT ADMIN uchun.
//
// Nima uchun: har bir ko'ruvchi uchun butun film SERVER orqali oqadi.
// Minglab kishi bir vaqtda ko'rsa — kuniga terabayt trafik, protsessor va
// disk. Bundan tashqari ommaviy endpoint kimgadir qo'lda chaqirilib
// serverdagi "giganlik" ishlatilishi (diskni film bilan to'ldirish) mumkin.
//
// Ommaviy tomoshabin uchun video Telegram'da ochiladi
// (Catalog::playbackTelegram), ya'ni ushbu endpoint umuman ishlatilmaydi.
// Faqat admin "preview=1" bilan filmni sayt ichida tekshiradi.
// ---------------------------------------------------------------------------
if (!$auth->isAdmin()) {
    liveSendError('Bu oqim faqat admin uchun. Oddiy tomoshabin filmni Telegram\'da ko\'radi.', 403);
}

// ---------------------------------------------------------------------------
// Manba havolasini aniqlash
// ---------------------------------------------------------------------------
$id     = inputInt('id');
$ep     = inputInt('episode');
$rawUrl = trim((string) input('url', '', 2000));

$src = null; // [content_id, episode_id, url]
if ($rawUrl !== '') {
    if (!TgPull::parseUrl($rawUrl)) {
        liveSendError('Havola t.me/telegram.me ko\'rinishida emas', 400);
    }
    $src = ['content_id' => 0, 'episode_id' => 0, 'url' => $rawUrl];
} elseif ($ep > 0) {
    $row = $catalog->getEpisode($ep);
    if (!$row || ($id > 0 && (int) $row['content_id'] !== $id)) {
        liveSendError('Qism topilmadi', 404);
    }
    $url = $row['video_url_1080p'] ?: ($row['video_url_720p'] ?: $row['video_url']);
    $url = trim((string) $url);
    if ($url === '' || !TgPull::parseUrl($url)) {
        liveSendError('Bu qism Telegram havolasi emas — jonli uzatish uchun t.me/kanal/postid kerak', 400);
    }
    $src = ['content_id' => (int) $row['content_id'], 'episode_id' => $ep, 'url' => $url];
} elseif ($id > 0) {
    $row = $catalog->getContent($id);
    if (!$row) {
        liveSendError('Kontent topilmadi', 404);
    }
    $url = $row['video_url_1080p'] ?? ($row['video_url_720p'] ?? ($row['video_url'] ?? ''));
    $url = trim((string) $url);
    if ($url === '' || !TgPull::parseUrl($url)) {
        liveSendError('Bu kontent Telegram havolasi emas', 400);
    }
    $src = ['content_id' => $id, 'episode_id' => 0, 'url' => $url];
} else {
    liveSendError('id/episode yoki url ko\'rsating', 400);
}

if (!is_dir(LIVE_CACHE_DIR)) {
    @mkdir(LIVE_CACHE_DIR, 0777, true);
}
liveSweep();

$key       = sha1('live:' . $src['url']);
$cacheFile = LIVE_CACHE_DIR . '/' . $key . '.mp4';
$metaFile  = LIVE_CACHE_DIR . '/' . $key . '.meta.json';

// ---------------------------------------------------------------------------
// Keshnani kafolatlash: flock bilan faqat BIR so'rov worker ishga tushiradi
// ---------------------------------------------------------------------------
$ensureStarted = function () use ($cacheFile, $metaFile, $src, $key) {
    $fh = @fopen($metaFile, 'c+');
    if (!$fh) {
        return ['status' => 'error', 'error' => 'Kesh faylini ochib bo\'lmadi'];
    }
    @flock($fh, LOCK_EX);
    // Meta faylni XUDDI SHU qo'ldan o'qiymiz.
    // Nega liveReadMeta emas: Windows'da flock(LOCK_EX) bilan ushlangan
    // faylni boshqa handle orqali o'qish "sharing violation" berishi mumkin —
    // meta "yo'q" ko'rinib, KERAKSIZ worker chaqirilardi va oqim "tayyor"
    // holatda kutib qolar edi. Shu qo'ldan o'qish buni bartaraf etadi.
    rewind($fh);
    $rawMeta = stream_get_contents($fh);
    $meta = $rawMeta ? json_decode($rawMeta, true) : null;
    if (!is_array($meta)) {
        $meta = null;
    }
    $needStart = true;
    if (is_array($meta)) {
        $status = (string) ($meta['status'] ?? '');
        $stale  = (time() - (int) ($meta['started'] ?? 0)) > 90;
        if ($status === 'downloading' || $status === 'done') {
            $needStart = false;
        }
        if ($status === 'starting' && !$stale) {
            $needStart = false;
        }
        // status=error: keyingi so'rov alohida yuklanadigan narsa
        // (status=error bo'lib kesh fayli yo'q bo'lsa qayta urinamiz)
    }
    if ($needStart) {
        $base = [
            'url' => $src['url'], 'content_id' => $src['content_id'],
            'episode_id' => $src['episode_id'], 'status' => 'starting',
            'total' => 0, 'downloaded' => 0, 'progress' => 0,
            'started' => time(), 'error' => null,
        ];
        // worker ishga tushirishdan oldin holatni saqlaymiz, keyin respawn
        $json = json_encode($base, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        @file_put_contents($metaFile . '.tmp', $json);
        if (!@rename($metaFile . '.tmp', $metaFile)) {
            // Windows'da boshqa jarayon ochiq ushlab turgan bo'lsa rename
            // bajarilmaydi (`.tmp` qoladi). Bunday holda to'g'ridan-to'g'ri
            // yozamiz — meta hech qachon eskirib qolmaydi.
            @file_put_contents($metaFile, $json);
        }
        @chmod($metaFile, 0666);
        if (!liveSpawnWorker($key, $src['url'])) {
            $base['status'] = 'error';
            $base['error']  = 'Ishchi jarayon ishga tushmadi';
            @file_put_contents($metaFile, json_encode($base, JSON_UNESCAPED_UNICODE));
        }
        $meta = $base;
    }
    @flock($fh, LOCK_UN);
    @fclose($fh);
    return is_array($meta) ? $meta : [];
};
$meta = $ensureStarted();

// ---------------------------------------------------------------------------
// Worker ishga tushishini kutamiz (total hajm ma'lum bo'lishi uchun)
// ---------------------------------------------------------------------------
$status = (string) ($meta['status'] ?? '');
$total  = (int) ($meta['total'] ?? 0);
$deadline = time() + LIVE_START_DL;
while ($status === 'starting' || ($status === 'downloading' && $total <= 0)) {
    if (time() > $deadline) {
        liveSendError('Video manbai uzoq vaqt ochilmadi — qayta urinib ko\'ring.');
    }
    usleep(250000);
    $mt     = liveReadMeta($metaFile) ?: [];
    $meta   = $mt;
    $status = (string) ($mt['status'] ?? 'starting');
    $total  = (int) ($mt['total'] ?? 0);
    if ($status === 'starting' && (time() - (int) ($mt['started'] ?? 0)) > 90) {
        // worker boshlamagan — yana urinamiz
        $mt     = $ensureStarted();
        $meta   = $mt;
        $status = (string) ($mt['status'] ?? 'starting');
        $total  = (int) ($mt['total'] ?? 0);
    }
}
if ($status === 'error') {
    liveSendError((string) ($meta['error'] ?? 'Manba ochilmadi'));
}
if ($total <= 0) {
    liveSendError('Video hajmi noma\'lum');
}

// ---------------------------------------------------------------------------
// Range / 206 javob
// ---------------------------------------------------------------------------
$size = $total;
$range  = isset($_SERVER['HTTP_RANGE']) ? trim((string) $_SERVER['HTTP_RANGE']) : '';
$isHead = (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD');

$start = 0;
$end   = $size - 1;
$partial = false;
if ($range !== '' && preg_match('/bytes=(\d*)-(\d*)/', $range, $m)) {
    $startRaw = $m[1];
    $endRaw   = $m[2];
    if ($startRaw === '' && $endRaw === '') {
        // "bytes=-" — to'liq fayl
    } elseif ($startRaw === '') {
        $len  = (int) $endRaw;
        $start = max(0, $size - $len);
        $end   = $size - 1;
        $partial = true;
    } else {
        $start = (int) $startRaw;
        $end   = $endRaw === '' ? $size - 1 : (int) $endRaw;
        $partial = true;
    }
    if ($start > $end || $start >= $size) {
        http_response_code(416);
        header('Content-Range: bytes */' . $size);
        exit;
    }
    if ($end >= $size) {
        $end = $size - 1;
    }
}
$len = $end - $start + 1;

$mimeHdr = trim((string) ($meta['mime'] ?? ''));
if ($mimeHdr === '') {
    $mimeHdr = 'video/mp4';
}
header('Accept-Ranges: bytes');
header('Content-Type: ' . $mimeHdr);
header('Cache-Control: no-store');

if ($partial) {
    http_response_code(206);
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
} else {
    http_response_code(200);
}
header('Content-Length: ' . $len);

if ($isHead) {
    exit;
}

// ---------------------------------------------------------------------------
// Progressiv oqim: fayl o'sib borayotganda kerakli baytlar yozilguncha kutamiz
// ---------------------------------------------------------------------------
// Worker faylni hali yaratmagan bo'lishi mumkin (bog'lanish uchun bir necha
// soniya ketadi) — paydo bo'lishini kutamiz.
$fbDeadline = time() + 120;
while (!is_file($cacheFile)) {
    if (connection_aborted()) {
        exit;
    }
    $mt = liveReadMeta($metaFile) ?: [];
    if (($mt['status'] ?? '') === 'error') {
        liveSendError((string) ($mt['error'] ?? 'Ko\'chirishda xato'));
    }
    if (time() > $fbDeadline) {
        liveSendError('Video fayli ochilmadi — qayta urinib ko\'ring.');
    }
    clearstatcache(true, $cacheFile);
    usleep(250000);
}

$fp = @fopen($cacheFile, 'rb');
if (!$fp) {
    liveSendError('Kesh fayli ochilmadi');
}
if ($start > 0 && fseek($fp, $start) !== 0) {
    liveSendError('Faylda orqaga o\'tishning imkoni bo\'lmadi');
}

if (!empty($_GET['dbg'])) {
    error_log('[live] dbg len=' . $len . ' start=' . $start . ' end=' . $end . ' size=' . $size
        . ' status=' . $status . ' total=' . $total . ' cache=' . $cacheFile
        . ' file_exists=' . (is_file($cacheFile) ? 'Y' : 'N')
        . ' filesize=' . liveFileSize($cacheFile));
}

@ob_end_clean();
$sent     = 0;
$lastTouch = time();

while ($sent < $len) {
    if (connection_aborted()) {
        break;
    }

    $avail = liveFileSize($cacheFile);
    $pos   = (int) ftell($fp);

    // So'ralgan joy hali yozilmagan — workerdan kutamiz.
    while ($pos >= $avail && $sent < $len) {
        $mt  = liveReadMeta($metaFile) ?: [];
        $st  = (string) ($mt['status'] ?? '');
        if ($st === 'error') {
            @fclose($fp);
            liveSendError((string) ($mt['error'] ?? 'Ko\'chirishda xato'));
        }
        if ($st === 'done' && $pos >= liveFileSize($cacheFile)) {
            break; // yuklab bo'lingan, lekin fayldan ortiqcha so'ralgan
        }
        if (connection_aborted()) {
            @fclose($fp);
            exit;
        }
        usleep(200000);
        $avail = liveFileSize($cacheFile);
        $pos   = (int) ftell($fp);
        if (time() - $lastTouch > 30) {
            @touch($cacheFile); // faollik belgisi — tozalash kechiktiriladi
            $lastTouch = time();
        }
    }

    if ($pos >= $avail) {
        break; // hamma bor narsa uzatildi
    }
    $want = min(LIVE_READ_BYTES, $len - $sent, $avail - $pos);
    if ($want <= 0) {
        break;
    }
    $chunk = fread($fp, $want);
    if ($chunk === false || $chunk === '') {
        break;
    }
    echo $chunk;
    @ob_flush();
    @flush();
    $sent += strlen($chunk);
    if (time() - $lastTouch > 30) {
        @touch($cacheFile);
        $lastTouch = time();
    }
}
if (!empty($_GET['dbg'])) {
    error_log('[live] dbg final sent=' . $sent . ' len=' . $len . ' avail=' . liveFileSize($cacheFile)
        . ' aborted=' . (connection_aborted() ? 1 : 0));
}
@fclose($fp);
exit;