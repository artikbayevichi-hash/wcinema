<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/hls-watch.php - video havolalarini KUZATIB TURADI va oldindan tayyorlaydi
// ============================================================================
// Muammo: HLS rejimida film birinchi marta ochilganda Telegram'dan to'liq
// yuklanib, ffmpeg bilan bo'linishi kerak (435 MB film ~2 daqiqa). Tomoshabin
// shuncha kutmasligi uchun film SAYTGA QO'SHILISHI BILANOQ tayyorlab qo'yiladi.
//
// Bu skript doimiy ishlaydi:
//   * har N soniyada (standart 15) episodes jadvalini tekshiradi
//   * t.me havolasi bor, lekin HLS tayyor bo'lmagan epizodni topsa, uni
//     hls-worker.php orqali yuklab + bo'laklaydi
//   * yangi qo'shilgan epizodlar birinchi navbatda (id kamayish tartibida)
//   * xato bilan tugaganini 5 daqiqadan keyin qayta uradi
//   * allaqachon "done" bo'lganlarga tegmaydi
//
//   php cli/hls-watch.php                 -> doimiy kuzatuv
//   php cli/hls-watch.php --once          -> bir marta o'tib chiqadi va tugaydi
//   php cli/hls-watch.php --interval=30   -> tekshirish oralig'i (soniya)
//
// Faqat BIR nusxa ishlaydi (ikkinchisi darhol chiqib ketadi).
// Windows'da avtomatik ishga tushirish: start-hls-watch.bat (Startup papkasiga).
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
require __DIR__ . '/../includes/bootstrap.php';

$once     = in_array('--once', $argv, true);
$interval = 15;
foreach ($argv as $a) {
    if (preg_match('/^--interval=(\d+)$/', $a, $m)) {
        $interval = max(5, (int) $m[1]);
    }
}

if (!is_dir(HLS_CACHE_DIR)) {
    @mkdir(HLS_CACHE_DIR, 0777, true);
}

// Bitta nusxa kafolati
$lock = @fopen(HLS_CACHE_DIR . '/.watch.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo "hls-watch allaqachon ishlayapti.\n";
    exit(0);
}

function wlog($msg)
{
    echo '[' . date('H:i:s') . '] ' . $msg . "\n";
    flush();
}

function readMeta($dir)
{
    $f = $dir . '/meta.json';
    clearstatcache(true, $f);
    if (!is_file($f)) {
        return null;
    }
    $raw = @file_get_contents($f);
    $d   = $raw ? json_decode($raw, true) : null;
    return is_array($d) ? $d : null;
}

// Kesh papkasining hozirgi hajmi (bayt).
function hlsCacheBytes()
{
    $total = 0;
    foreach (glob(HLS_CACHE_DIR . '/*', GLOB_ONLYDIR) ?: [] as $sub) {
        foreach (glob($sub . '/*') ?: [] as $f) {
            $total += (int) @filesize($f);
        }
    }
    return $total;
}
$lastQuotaLog = 0;

/**
 * Tungi oyna tekshiruvi (.env: HLS_NIGHT_ONLY=1, HLS_NIGHT_FROM/TO).
 *
 * Nima uchun: prewarm — og'ir ish (Telegram'dan yuklab olish + ffmpeg).
 * Kunduzi u Apache/MySQL bilan protsessor va tarmoqni bo'lishadi. Tungi
 * rejim yoqilsa, prewarm faqat belgilangan soatlarda ishlaydi.
 */
function hlsNightNow()
{
    if (!defined('HLS_NIGHT_ONLY') || !HLS_NIGHT_ONLY) {
        return true;
    }
    $h    = (int) date('G');
    $from = (int) HLS_NIGHT_FROM;
    $to   = (int) HLS_NIGHT_TO;
    if ($from === $to) {
        return true;                       // noto'g'ri sozlama — bloklamaymiz
    }
    return $from < $to ? ($h >= $from && $h < $to) : ($h >= $from || $h < $to);
}
$lastNightLog = 0;

wlog('hls-watch ishga tushdi (oraliq ' . $interval . ' s). Kesh: ' . HLS_CACHE_DIR);

while (true) {
    // Tungi oyna: kunduzi og'ir ish qilmaymiz.
    if (!hlsNightNow()) {
        if (time() - $lastNightLog > 1800) {
            wlog('Tungi rejim: hozir prewarm qilinmaydi (' . HLS_NIGHT_FROM . ':00-' . HLS_NIGHT_TO . ':00).');
            $lastNightLog = time();
        }
        if ($once) {
            break;
        }
        sleep(max(60, $interval));
        continue;
    }
    try {
        $db   = Database::getInstance();   // yagona ulanish (konstruktor private)
        $rows = $db->fetchAll(
            "SELECT e.id AS eid, e.content_id, e.video_url, e.video_url_720p, e.video_url_1080p
               FROM episodes e
              WHERE e.video_type IS NULL OR e.video_type <> 'none'
              ORDER BY e.id DESC"
        );

        foreach ($rows as $r) {
            // hls.php / hls-warm.php bilan AYNAN bir xil havola tanlanadi (kalit mos tushsin)
            $url = trim((string) ($r['video_url_1080p'] ?: ($r['video_url_720p'] ?: $r['video_url'])));
            if ($url === '' || !TgPull::parseUrl($url)) {
                continue;
            }
            $key  = sha1('hls:' . $url);
            $dir  = HLS_CACHE_DIR . '/' . $key;
            $meta = readMeta($dir);
            $st   = is_array($meta) ? (string) ($meta['status'] ?? '') : '';

            if ($st === 'done') {
                continue;
            }
            // Boshqa jarayon (masalan tomoshabin so'rovi) hozir ishlayaptimi?
            if (in_array($st, ['starting', 'downloading', 'transcoding'], true)) {
                $tick = (int) ($meta['worker_tick'] ?? ($meta['started'] ?? 0));
                if ($tick > 0 && (time() - $tick) < 120) {
                    continue;                          // jonli - tegmaymiz
                }
            }
            // Xatodan keyin 5 daqiqa kutamiz (cheksiz qayta urinish bo'lmasin)
            if ($st === 'error' && (time() - (int) ($meta['ended'] ?? 0)) < 300) {
                continue;
            }

            // Disk kvotasi to'layotgan bo'lsa yangi video O'GIRMAYMIZ: aks holda hls.php
            // eng eskisini o'chiradi, kuzatuvchi esa uni yana o'giradi (cheksiz aylanish).
            if (hlsCacheBytes() >= HLS_MAX_MB * 1048576 * 0.9) {
                if (time() - $lastQuotaLog > 600) {
                    wlog('Kesh kvotaning 90% idan oshdi - yangi videolar o\'girilmaydi (HLS_MAX_MB ni oshiring yoki eskilarini o\'chiring).');
                    $lastQuotaLog = time();
                }
                break;
            }
            if (!is_dir($dir)) {
                @mkdir($dir, 0777, true);
            }
            wlog("tayyorlanmoqda: epizod #{$r['eid']} / kontent #{$r['content_id']}  key=" . substr($key, 0, 10));

            $cmd = escapeshellarg(PHP_CLI_BIN) . ' ' . escapeshellarg(__DIR__ . '/hls-worker.php')
                 . ' ' . escapeshellarg($url) . ' ' . escapeshellarg($key);
            $out  = [];
            $code = 0;
            $t0   = microtime(true);
            exec($cmd . ' 2>&1', $out, $code);      // bittadan: Telegram sessiya qulfi serial
            $sec = (int) round(microtime(true) - $t0);
            if ($code === 0) {
                wlog("   tayyor ({$sec} s)");
            } else {
                wlog("   XATO ({$sec} s): " . trim(implode(' | ', array_slice($out, -3))));
            }
        }
    } catch (Throwable $e) {
        wlog('Xato: ' . $e->getMessage());
    }

    if ($once) {
        break;
    }
    sleep($interval);
}
