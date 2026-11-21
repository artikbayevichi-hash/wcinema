<?php
// CLI-only guard
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/preview-server.php — 19 MB intro klipilarni DB'siz serverda yaratish
// ----------------------------------------------------------------------------
// Lokal kompyuter (sekin internet):
//   php cli/preview-server.php --export-job=storage/cache/preview/job.json
//   # job.json ni serverga yuklaymiz (faqat kanal/post juftliklari, ~2 KB)
//
// Server (yaxshi internet, MySQL kerak emas):
//   php cli/preview-server.php --run --job=job.json --results=results.json --workers=4
//   # results.json ni lokal kompyuterga qaytaramiz (faqat metadata, ~30 KB)
//
// Lokal kompyuter:
//   php cli/preview-server.php --import=results.json
//
// Bu usulda video baytlari FAQAT server <-> Telegram orasida yuradi.
// Sayt origin'i va foydalanuvchining sekin interneti video baytlarini KO'RMAYDI.
// ============================================================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/Database.php';   // faqat export/import rejimida ulanadi
require_once __DIR__ . '/../includes/TgPull.php';
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
function pvFail($msg)
{
    fwrite(STDERR, $msg . "\n");
    exit(1);
}
function pvJsonWrite($path, array $doc)
{
    $dir = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    $json = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $tmp = $path . '.tmp.' . getmypid();
    if (file_put_contents($tmp, $json) === false) return false;
    return @rename($tmp, $path);
}
function pvJsonRead($path)
{
    if (!is_file($path)) return null;
    $raw = (string) @file_get_contents($path);
    $doc = $raw === '' ? null : json_decode($raw, true);
    return is_array($doc) ? $doc : null;
}
function pvPhpBin()
{
    $bin = defined('PHP_CLI_BIN') ? trim((string) PHP_CLI_BIN) : '';
    if ($bin !== '') {
        $ok = stripos(PHP_OS_FAMILY, 'win') === 0 ? is_file($bin) : is_executable($bin);
        if ($ok) return $bin;
    }
    return PHP_BINARY;   // serverda config.php dagi Windows yo'li ishlamasa
}
function pvPairsFromJob($path, $limit)
{
    $doc = pvJsonRead($path);
    if (!$doc || !isset($doc['pairs']) || !is_array($doc['pairs'])) {
        pvFail("Vazifa fayli o'qilmadi yoki noto'g'ri format: {$path}");
    }
    $pairs = [];
    foreach ($doc['pairs'] as $p) {
        if (!is_array($p)) continue;
        $ch = strtolower(trim((string) ($p['ch'] ?? '')));
        $post = (int) ($p['post'] ?? 0);
        if ($ch === '' || $post <= 0) continue;
        $pairs[$ch . '/' . $post] = ['ch' => $ch, 'post' => $post];
    }
    $pairs = array_values($pairs);
    return array_slice($pairs, 0, max(1, min(500, (int) $limit)));
}
function pvPrintSummary($path)
{
    $doc = pvJsonRead($path);
    $ok = $err = 0;
    $errors = [];
    if ($doc && isset($doc['results']) && is_array($doc['results'])) {
        foreach ($doc['results'] as $r) {
            if (!is_array($r)) continue;
            if (($r['status'] ?? '') === 'ok') {
                $ok++;
            } else {
                $err++;
                if (count($errors) < 5) {
                    $errors[] = ($r['channel'] ?? '?') . '/' . ($r['post'] ?? '?')
                        . ': ' . mb_substr((string) ($r['error'] ?? '?'), 0, 120);
                }
            }
        }
    }
    echo "NATIJA: ok={$ok}, error={$err}\n";
    foreach ($errors as $e) echo "  {$e}\n";
}

$mode = pvArg('export-job') !== null ? 'export'
      : (pvFlag('run') ? 'run'
      : (pvArg('import') !== null ? 'import'
      : ((pvArg('summary') !== null || pvArg('results') !== null && pvFlag('summary')) ? 'summary' : '')));
if ($mode === '' && pvArg('job') !== null) $mode = 'run';
if ($mode === '') {
    echo "Foydalanish:\n";
    echo "  --export-job=PATH [--ch=.. --post=..] [--limit=N]   (lokal DB'dan vazifa chiqarish)\n";
    echo "  --run --job=PATH --results=PATH [--workers=N]        (serverda generatsiya)\n";
    echo "  --import=PATH                                        (natijani lokal DB'ga yozish)\n";
    echo "  --summary=PATH                                       (natija faylini ko'rish)\n";
    exit(0);
}

$limit   = max(1, min(500, (int) pvArg('limit', $mode === 'export' ? '500' : '55')));
$workers = max(1, min(12, (int) pvArg('workers', '1')));
$slotRaw = pvArg('slot', null);
$slot    = ($slotRaw === null) ? -1 : max(0, (int) $slotRaw);
$force   = pvFlag('force');

// ------------------------------------------------------------------ EXPORT
if ($mode === 'export') {
    $path = (string) pvArg('export-job', '');
    if ($path === '') pvFail('--export-job=PATH berilishi shart.');

    $db = Database::getInstance();
    $ch = strtolower(trim((string) pvArg('ch', '')));
    $post = (int) pvArg('post', 0);
    if ($ch !== '' && $post > 0) {
        $pairs = [['ch' => $ch, 'post' => $post]];
    } else {
        $found = [];
        foreach (['episodes', 'reels'] as $tbl) {
            foreach ($db->fetchAll("SELECT video_url FROM `{$tbl}` WHERE video_url LIKE '%t.me%' LIMIT 5000") as $r) {
                $ref = TgPull::parseUrl($r['video_url'] ?? '');
                if (!$ref) continue;
                $key = $ref['label'] . '/' . (int) $ref['id'];
                $found[$key] = ['ch' => (string) $ref['label'], 'post' => (int) $ref['id']];
            }
        }
        $pairs = [];
        foreach ($found as $p) {
            if (!$force && TgPreview::get($p['ch'], $p['post'])) continue;
            $pairs[] = $p;
        }
    }
    $pairs = array_slice($pairs, 0, $limit);
    if (!pvJsonWrite($path, [
        'version' => 1,
        'created' => time(),
        'clip_mb' => (int) TG_PREVIEW_CLIP_MB,
        'preview_channel' => TG_PREVIEW_CHANNEL,
        'pairs' => $pairs,
    ])) {
        pvFail("Vazifa fayli yozilmadi: {$path}");
    }
    echo "Vazifa tayyor: " . count($pairs) . " ta -> {$path}\n";
    echo "Bu faylni serverga yuklang (ichida faqat kanal/post juftliklari bor).\n";
    exit(0);
}

// -------------------------------------------------------------------- RUN
if ($mode === 'run') {
    if (!defined('TG_PREVIEW_ENABLED') || !TG_PREVIEW_ENABLED) {
        pvFail('TG_PREVIEW_CHANNEL sozlanmagan. Server .env ga TG_PREVIEW_CHANNEL=wcinemaflash yozing.');
    }
    if (!TgPull::libraryReady() || !TgPull::credentialsReady()) {
        pvFail('Telegram sozlamalari yetarli emas: ' . implode(', ', TgPull::missingConfig()));
    }
    $job = (string) pvArg('job', '');
    if ($job !== '' && !is_file($job)) {
        // serverga nisbiy yo'l bilan yuklangan bo'lishi mumkin
        $job = dirname(__DIR__) . '/' . ltrim($job, '/');
    }
    $results = (string) pvArg('results', '');
    if ($results === '') pvFail('--results=PATH berilishi shart.');
    if (!is_dir(dirname($results))) {
        $alt = dirname(__DIR__) . '/' . ltrim($results, '/');
        if (is_dir(dirname($alt))) $results = $alt;
    }
    if (!is_dir(dirname($results))) @mkdir(dirname($results), 0777, true);
    if (!is_file($results)) {
        pvJsonWrite($results, ['version' => 1, 'results' => []]);
    }
    TgPreview::setOfflineResults($results);

    $ch = strtolower(trim((string) pvArg('ch', '')));
    $post = (int) pvArg('post', 0);
    if ($ch !== '' && $post > 0) {
        $pairs = [['ch' => $ch, 'post' => $post]];
    } else {
        if ($job === '' || !is_file($job)) pvFail('--job=PATH berilishi shart.');
        $pairs = pvPairsFromJob($job, $limit);
    }

    // PARALLEL: ota mustaqil ishchilarni ochadi (har biri o'z sessiyasida).
    if ($workers > 1 && $slot < 0) {
        $logDir = dirname(__DIR__) . '/storage/cache/preview';
        if (!is_dir($logDir)) @mkdir($logDir, 0777, true);
        $childArgs = [];
        foreach ($args as $a) {
            if (preg_match('/^--workers=/', $a)) continue;
            if (preg_match('/^--slot=/', $a)) continue;
            $childArgs[] = $a;
        }
        $cmdBase = escapeshellarg(pvPhpBin()) . ' ' . escapeshellarg(__FILE__) . ' '
                 . implode(' ', array_map('escapeshellarg', $childArgs))
                 . ' --workers=' . $workers;
        echo "SERVER PARALLEL REJIM: {$workers} ishchi, jami " . count($pairs) . " video\n";
        $procs = [];
        for ($i = 0; $i < $workers; $i++) {
            if ($i > 0) sleep(3);
            $log = $logDir . '/server_worker_' . $i . '.log';
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
        foreach ($procs as $p) @proc_close($p);
        echo "Barcha ishchilar tugadi.\n";
        pvPrintSummary($results);
        exit(0);
    }

    $sessionDir = ($slot >= 0)
        ? dirname(__DIR__) . '/storage/mtproto/p' . $slot : null;
    $lockName = ($slot >= 0) ? 'srv' . $slot : 'srv';

    if ($slot >= 0 && $workers > 1) {
        $mine = [];
        foreach ($pairs as $idx => $p) {
            if (($idx % $workers) === $slot) $mine[] = $p;
        }
        $pairs = $mine;
        echo "Ishchi #{$slot}: " . count($pairs) . " video\n";
    }

    echo "Bot sessiyasi ochiladi (DB kerak emas)...\n";
    TgPull::sessionLockAcquire(1800, $lockName);
    $api = TgPull::openBotSession($sessionDir);

    $done = 0; $failed = 0; $already = 0;
    foreach ($pairs as $i => $p) {
        $label = $p['ch'] . '/' . $p['post'];
        echo "[" . ($i + 1) . '/' . count($pairs) . "] {$label} ... ";
        flush();
        $t0 = microtime(true);
        $res = TgPreview::generate($api, $p['ch'], $p['post'], $force);
        if (!empty($res['already'])) {
            $already++;
            echo "allaqachon bor\n";
        } elseif (!empty($res['ok'])) {
            $done++;
            $inst = !empty($res['preview']['instant'])
                ? ' + instant ' . round(((int) ($res['preview']['instant']['size'] ?? 0)) / 1024) . ' KB'
                : ' + instant YO\'Q';
            echo "OK " . round(((int) ($res['preview']['size'] ?? 0)) / 1048576, 2)
                . " MB" . $inst . "  " . round(microtime(true) - $t0, 1) . "s\n";
        } else {
            $failed++;
            echo "XATO: " . mb_substr((string) ($res['error'] ?? '?'), 0, 180) . "\n";
        }
        flush();
    }
    echo "Ishchi tugadi: ok={$done}, xato={$failed}, oldin bor={$already}\n";
    exit(0);
}

// ----------------------------------------------------------------- IMPORT
if ($mode === 'import') {
    $path = (string) pvArg('import', '');
    if ($path === '') pvFail('--import=PATH berilishi shart.');
    $doc = pvJsonRead($path);
    if (!$doc || !isset($doc['results']) || !is_array($doc['results'])) {
        pvFail("Natija fayli o'qilmadi: {$path}");
    }
    TgPreview::ensure();
    $ok = $skip = $bad = 0;
    foreach ($doc['results'] as $r) {
        if (!is_array($r)) continue;
        $ch = strtolower(trim((string) ($r['channel'] ?? '')));
        $post = (int) ($r['post'] ?? 0);
        if ($ch === '' || $post <= 0) { $bad++; continue; }
        // Kamida bitta klip bo'lsa imported qilamiz: 19 MB intro yo'q, lekin
        // instant bor bo'lsa ham foydalanuvchi tez birinchi kadrni ko'radi.
        $hasIntro   = !empty($r['preview_channel']) && (int) ($r['preview_post'] ?? 0) > 0;
        $hasInstant = !empty($r['instant_channel']) && (int) ($r['instant_post'] ?? 0) > 0;
        if (($r['status'] ?? '') !== 'ok' || (!$hasIntro && !$hasInstant)) {
            $skip++;
            continue;
        }
        if (TgPreview::importRow($ch, $post, $r)) $ok++; else $bad++;
    }
    echo "IMPORT: yozildi={$ok}, xatolikli/o'tkazib yuborilgan={$skip}, buzuq={$bad}\n";
    echo "Jami tayyor preview: " . TgPreview::countReady() . "\n";
    exit(0);
}

// ---------------------------------------------------------------- SUMMARY
if ($mode === 'summary') {
    $path = (string) pvArg('summary', (string) pvArg('results', ''));
    if ($path === '') pvFail('--summary=PATH berilishi shart.');
    pvPrintSummary($path);
    exit(0);
}
