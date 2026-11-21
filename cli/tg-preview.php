<?php
// CLI-only guard
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/tg-preview.php — kichik faststart PREVIEW videolarni tayyorlash
// ----------------------------------------------------------------------------
// Har bir film uchun:
//   1) bot MTProto orqali video BOSHIDAN ~32 MB oladi (to'liq 1 GB emas);
//   2) FFmpeg 20 s, 480p, faststart MP4 yasaydi (2–5 MB);
//   3) preview OMMAVIY kanalga yuklanadi (TG_PREVIEW_CHANNEL);
//   4) natija `telegram_preview` jadvaliga yoziladi.
//
// ISHLATISH:
//   php cli/tg-preview.php --ch=wcinemauz --post=12
//   php cli/tg-preview.php --all --limit=10
//   php cli/tg-preview.php --all --force --limit=55 --workers=4   (PARALLEL)
//   php cli/tg-preview.php --queue                    (fon ishchisi)
//
// `--workers=N` ota jarayon N ta mustaqil ishchi ochadi. Har biri O'Z
// MadelineProto sessiyasida (storage/mtproto/p0..pN) ishlaydi, videolarni
// round-robin bo'lib oladi va logini storage/cache/preview/worker_N.log ga
// yozadi. Ota hammasi tugaguncha kutadi.
//
// `--queue` admin panelga yangi video qo'shilganda avtomatik ishga tushadi
// va faqat `telegram_preview_queue` dagi vazifalarni bajaradi.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';
require_once __DIR__ . '/../includes/TgMeta.php';
require_once __DIR__ . '/../includes/TgPreview.php';

$args = array_slice($argv, 1);
function pvArg($name, $default = null)
{
    global $args;
    foreach ($args as $a) {
        if (preg_match('/^--' . preg_quote($name, '/') . '=(.*)$/', $a, $m)) {
            return $m[1];
        }
    }
    return $default;
}
function pvFlag($name)
{
    global $args;
    return in_array('--' . $name, $args, true);
}

TgPreview::ensure();

if (!defined('TG_PREVIEW_ENABLED') || !TG_PREVIEW_ENABLED) {
    echo "TG_PREVIEW_CHANNEL sozlanmagan. .env ga ommaviy kanal nomini yozing.\n";
    echo "Masalan: TG_PREVIEW_CHANNEL=wcinema_previews\n";
    exit(1);
}
if (!TgPull::libraryReady() || !TgPull::credentialsReady()) {
    echo "Telegram sozlamalari yetarli emas: " . implode(', ', TgPull::missingConfig()) . "\n";
    exit(1);
}

$db = Database::getInstance();
$force = pvFlag('force');
$queueMode = pvFlag('queue');
$limit = max(1, min(500, (int) pvArg('limit', $queueMode ? '50' : '10')));
$ch    = trim((string) pvArg('ch', ''));
$post  = (int) pvArg('post', 0);
$workers = max(1, min(12, (int) pvArg('workers', '1')));
$slotRaw = pvArg('slot', null);
$slot    = ($slotRaw === null) ? -1 : max(0, (int) $slotRaw);

// --- PARALLEL: ota jarayon N ta mustaqil ishchi ishga tushiradi ------------
// Har bir ishchi O'Z MadelineProto sessiyasida (storage/mtproto/p0, p1, ...)
// ishlaydi -> umumiy qulf yo'q, yuklanishlar parallel ketadi.
if ($workers > 1 && $slot < 0 && !$queueMode) {
    $phpBin = defined('PHP_CLI_BIN') && trim((string) PHP_CLI_BIN) !== ''
        ? trim((string) PHP_CLI_BIN) : 'php';
    $logDir = dirname(__DIR__) . '/storage/cache/preview';
    if (!is_dir($logDir)) @mkdir($logDir, 0777, true);

    $childArgs = [];
    foreach ($args as $a) {
        if (preg_match('/^--workers=/', $a)) continue;
        $childArgs[] = $a;
    }
    $cmdBase = escapeshellarg($phpBin) . ' ' . escapeshellarg(__FILE__) . ' '
             . implode(' ', array_map('escapeshellarg', $childArgs))
             . ' --workers=' . $workers;

    echo "PARALLEL REJIM: {$workers} ta ishchi, jami limit={$limit}\n";
    $procs = [];
    for ($i = 0; $i < $workers; $i++) {
        // Bir vaqtda 4 ta botLogin Telegram DC'ni chalg'itadi — ishchilarni
        // 4 soniya oraliq bilan ishga tushiramiz (jami 12 s ketadi).
        if ($i > 0) sleep(4);
        $log = $logDir . '/worker_' . $i . '.log';
        $cmd = $cmdBase . ' --slot=' . $i;
        $desc = [0 => ['pipe', 'r'], 1 => ['file', $log, 'w'], 2 => ['file', $log, 'a']];
        $pipes = [];
        $p = @proc_open($cmd, $desc, $pipes);
        if (is_resource($p)) {
            @fclose($pipes[0]);
            $procs[] = $p;
            echo "  ishchi #{$i}: {$log}\n";
        } else {
            echo "  ishchi #{$i} ishga tushmadi!\n";
        }
    }
    echo "Barcha ishchilar tugashini kutamiz...\n";
    foreach ($procs as $p) @proc_close($p);   // barchasi tugaguncha kutadi
    echo "Barcha ishchilar tugadi. Jami tayyor preview: " . TgPreview::countReady() . "\n";
    exit(0);
}

// Ishchi jarayon uchun alohida sessiya va qulf (faqat o'z slotiga tegishli).
$sessionDir = ($slot >= 0)
    ? dirname(__DIR__) . '/storage/mtproto/p' . $slot
    : null;
$lockName = ($slot >= 0) ? 'p' . $slot : 'worker';

// --- Avtomatik navbat rejimi (admin panel chaqiradi) -----------------------
if ($queueMode) {
    if (!TgPreview::workerLockAcquire()) {
        echo "Boshqa preview worker ishlayapti — chiqamiz.\n";
        exit(0);
    }
    register_shutdown_function(['TgPreview', 'workerLockRelease']);
    echo "Preview navbati ishchisi: telegram_preview_queue tekshiriladi...\n";
    echo "Bot sessiyasi ochiladi...\n";
    TgPull::sessionLockAcquire(1800, $lockName);
    $api = TgPull::openBotSession($sessionDir);

    $done = 0; $failed = 0; $processed = 0;
    while (true) {
        TgPreview::workerLockTouch();
        $items = TgPreview::pending(1);
        if (!$items) break;
        foreach ($items as $q) {
            $label = $q['channel'] . '/' . (int) $q['post'];
            echo "[" . ($processed + 1) . "] {$label} ... ";
            $t0 = microtime(true);
            $res = TgPreview::generate($api, $q['channel'], (int) $q['post'], !empty($q['regen']));
            if (!empty($res['already'])) {
                TgPreview::queueDone($q['channel'], (int) $q['post']);
                echo "allaqachon bor\n";
            } elseif ($res['ok']) {
                TgPreview::queueDone($q['channel'], (int) $q['post']);
                $pv = $res['preview'];
                echo "OK  {$pv['ch']}/{$pv['p']}  " . round(microtime(true) - $t0, 1) . "s\n";
                $done++;
            } else {
                $err = (string) ($res['error'] ?? '?');
                TgPreview::queueFail($q['channel'], (int) $q['post'], $err, (int) ($q['attempts'] ?? 0));
                echo "XATO: " . mb_substr($err, 0, 180) . "\n";
                $failed++;
            }
            $processed++;
            TgPreview::workerLockTouch();
            if ($processed >= 200) break;
        }
        if ($processed >= 200) break;
    }
    echo "Navbat bajarildi: {$done}, xato: {$failed}. Jami tayyor: "
        . TgPreview::countReady() . "\n";
    exit(0);
}

$need = [];
if ($ch !== '' && $post > 0) {
    $need[] = ['ch' => strtolower($ch), 'post' => $post];
} else {
    // Katalogdagi barcha t.me havolalari.
    $pairs = [];
    foreach (['episodes', 'reels'] as $tbl) {
        foreach ($db->fetchAll("SELECT video_url FROM `{$tbl}` WHERE video_url LIKE '%t.me%' LIMIT 5000") as $r) {
            $ref = TgMeta::parseUrl($r['video_url'] ?? '');
            if (!$ref) continue;
            $pairs[$ref['channel'] . '/' . $ref['post']] = [
                'ch' => $ref['channel'], 'post' => $ref['post'],
            ];
        }
    }
    foreach ($pairs as $p) {
        if (!$force && TgPreview::get($p['ch'], $p['post'])) continue;
        $need[] = $p;
    }
}

echo "Preview yaratish kerak: " . count($need) . " ta (limit={$limit})\n";
if (!$need) {
    echo "Hammasi tayyor.\n";
    exit(0);
}
$need = array_slice($need, 0, $limit);

echo "Bot sessiyasi ochiladi...\n";
TgPull::sessionLockAcquire(1800, $lockName);
$api = TgPull::openBotSession($sessionDir);

// Parallel ishchi faqat o'ziga tegishli qismlarni oladi (round-robin).
if ($slot >= 0 && $workers > 1) {
    $mine = [];
    foreach ($need as $idx => $p) {
        if (($idx % $workers) === $slot) $mine[] = $p;
    }
    $need = $mine;
    echo "Ishchi #{$slot}: " . count($need) . " ta video ({$workers} dan 1)\n";
}

$done = 0; $failed = 0;
foreach ($need as $i => $p) {
    $label = $p['ch'] . '/' . $p['post'];
    echo "[" . ($i + 1) . "/" . count($need) . "] {$label} ... ";
    $t0 = microtime(true);
    $res = TgPreview::generate($api, $p['ch'], $p['post'], $force);
    if (!empty($res['already'])) {
        echo "allaqachon bor\n";
        continue;
    }
    if ($res['ok']) {
        $pv = $res['preview'];
        $mb = round(((int) ($pv['size'] ?? 0)) / 1048576, 2);
        echo "OK  {$pv['ch']}/{$pv['p']}  {$mb} MB  " . round(microtime(true) - $t0, 1) . "s\n";
        $done++;
    } else {
        echo "XATO: " . mb_substr((string) ($res['error'] ?? '?'), 0, 200) . "\n";
        $failed++;
    }
}
echo "Tayyor: {$done}, xato: {$failed}\n";
echo "Jami tayyor preview: " . TgPreview::countReady() . "\n";
