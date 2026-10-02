<?php
// ============================================================================
// cli/hls-warm.php - barcha t.me manbali epizodlarni OLDINDAN HLS'ga tayyorlaydi
// ============================================================================
// Yirik trafikdan OLDIN ishga tushiring: tomoshabin "tayyorlanmoqda" holatini
// ko'rmasligi uchun har bir film HLS segmentlarga bo'linib, Cloudflare edge'da
// keshlanib qo'yadi.
//
//   php cli/hls-warm.php            -> barcha epizodlar (navbat, bittadan)
//   php cli/hls-warm.php 7          -> faqat content id=7
//   php cli/hls-warm.php --status   -> joriy HLS keshlar holati
//
// Har bir film to'liq tayyor bo'lguncha (yuklab olish + ffmpeg transkod) keyingisiga
// o'tilmaydi — bot sessiyasi qulfi bunda yaxshi ishlaydi. Ko'p film bo'lsa soatlab
// ishlashi mumkin; nohup / Task Scheduler orqali ishga tushiring.
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
require __DIR__ . '/../includes/bootstrap.php';

$arg = isset($argv[1]) ? $argv[1] : '';

// --- Holat ro'yxati ---------------------------------------------------------
if ($arg === '--status') {
    $dir = HLS_CACHE_DIR;
    if (!is_dir($dir)) {
        echo "(HLS kesh hali yo'q)\n";
        exit(0);
    }
    printf("%-40s %-13s %6s  %s\n", 'KEY', 'STATUS', 'PROG', 'IZOH');
    foreach (glob($dir . '/*/meta.json') ?: [] as $mf) {
        $raw = @file_get_contents($mf);
        $d   = $raw ? json_decode($raw, true) : null;
        if (!is_array($d)) {
            continue;
        }
        printf("%-40s %-13s %5d%%  %s\n",
            basename(dirname($mf)),
            (string) ($d['status'] ?? '?'),
            (int) ($d['progress'] ?? 0),
            trim((string) ($d['error'] ?? '')));
    }
    exit(0);
}

$onlyId = (int) $arg;

$db  = new Database();
$sql = "SELECT e.id AS eid, e.content_id, e.video_url, e.video_url_720p, e.video_url_1080p
        FROM episodes e
        WHERE e.video_type IS NULL OR e.video_type <> 'none'";
$par = [];
if ($onlyId > 0) {
    $sql .= " AND e.content_id = ?";
    $par[] = $onlyId;
}
$rows = $db->fetchAll($sql, $par);

$doneCnt = 0;
$skipCnt = 0;
$errCnt  = 0;

foreach ($rows as $r) {
    $url = trim((string) ($r['video_url_1080p'] ?: ($r['video_url_720p'] ?: $r['video_url'])));
    if ($url === '' || !TgPull::parseUrl($url)) {
        $skipCnt++;
        continue;
    }
    $key  = sha1('hls:' . $url);
    $dir  = HLS_CACHE_DIR . '/' . $key;
    $metaF = $dir . '/meta.json';

    clearstatcache(true, $metaF);
    $meta  = null;
    if (is_file($metaF)) {
        $raw = @file_get_contents($metaF);
        $meta = $raw ? json_decode($raw, true) : null;
    }
    if (is_array($meta) && (string) ($meta['status'] ?? '') === 'done') {
        $doneCnt++;
        continue;
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    $phpBin = PHP_CLI_BIN;
    $worker = escapeshellarg(__DIR__ . '/hls-worker.php');
    $cmd = escapeshellarg($phpBin) . ' ' . $worker . ' '
        . escapeshellarg($url) . ' ' . escapeshellarg($key);

    echo "-> epizod #{$r['eid']} / kontent #{$r['content_id']}  key={$key}\n";
    flush();
    $out  = [];
    $code = 0;
    exec($cmd . ' 2>&1', $out, $code); // bittadan — sessiya qulfi serial
    if ($code === 0) {
        $doneCnt++;
        echo "   OK: " . trim(implode(' ', array_slice($out, -2))) . "\n";
    } else {
        $errCnt++;
        echo "   XATO: " . trim(implode(' | ', array_slice($out, -4))) . "\n";
    }
}

echo "\nYakun: tayyor={$doneCnt}, o'tkazib yuborildi={$skipCnt}, xato={$errCnt}\n";
exit($errCnt > 0 ? 1 : 0);