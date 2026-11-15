<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/hls-publish.php — tayyor HLS segmentlarini Cloudflare R2 / Backblaze B2
// ga yuklaydi va `remote.json` yozadi.
// ============================================================================
// Nima uchun: HLS segmentlarini uy kompyuteridan tarqatish masshtablanmaydi
// (1000 tomoshabin × 2–4 Mbit/s = 2–4 Gbit/s upload). Segmentlar — o'zgarmas
// fayllar, shuning uchun ularni obyekt saqlashga (R2/B2) qo'yib, tomoshabinga
// o'sha yerdan berish to'g'ri yechim.
//
// `remote.json` paydo bo'lgach `api/hls.php` segmentlarni 302 bilan o'sha
// manzilga yo'naltiradi (config.php: HLS_REMOTE_REDIRECT=1).
//
// Ishlatish:
//   php cli/hls-publish.php --all              # barcha tayyor ("done") kinolar
//   php cli/hls-publish.php <key>              # faqat bitta kesh papkasi
//   php cli/hls-publish.php --all --dry-run    # faqat ko'rsatadi, yuklamaydi
//   php cli/hls-publish.php --all --force      # mavjud obyektlarni qayta yozadi
//   php cli/hls-publish.php --all --prune      # lokal o'chirilganlarni remote'dan ham o'chiradi
//
// .env (hech biri git'ga tushmaydi):
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
//   S3_BUCKET=wc-hls
//   S3_REGION=auto
//   S3_ACCESS_KEY=...
//   S3_SECRET_KEY=...
//   S3_PUBLIC_BASE=https://cdn.example.com   (R2 public domain / B2 custom domain)
//   S3_PREFIX=hls
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
ini_set('memory_limit', '-1');

require __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/S3Client.php';

$args     = array_slice($argv, 1);
$all      = in_array('--all', $args, true);
$dryRun   = in_array('--dry-run', $args, true);
$force    = in_array('--force', $args, true);
$prune    = in_array('--prune', $args, true);
$onlyKey  = '';
foreach ($args as $a) {
    if ($a === '' || $a[0] === '-') {
        continue;
    }
    $onlyKey = preg_replace('/[^a-zA-Z0-9_-]/', '', $a);
}

if (!$all && $onlyKey === '') {
    fwrite(STDERR, "Ishlatish: php cli/hls-publish.php --all [--dry-run] [--force] [--prune]\n"
        . "           php cli/hls-publish.php <key> [--dry-run] [--force]\n");
    exit(1);
}

$s3 = S3Client::fromEnv();
if (!$s3) {
    fwrite(STDERR, "S3 sozlamalari yo'q. .env ga S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY,\n"
        . "S3_SECRET_KEY, S3_PUBLIC_BASE yozing (docs/production-deploy.md).\n");
    exit(2);
}
if (trim((string) env_value('S3_PUBLIC_BASE', '')) === '') {
    fwrite(STDERR, "S3_PUBLIC_BASE bo'sh. R2 public domain yoki B2 custom domain kerak —\n"
        . "aks holda brauzer segmentni imzosiz o'qiy olmaydi.\n");
    exit(2);
}

$root     = HLS_CACHE_DIR;
$registry = $root . '/.published.json';

/** Registrni o'qish: key -> {files: [...], ts: int} */
function pubRegistry($file)
{
    $d = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
    return is_array($d) ? $d : [];
}

function pubSave($file, array $data)
{
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) === false) {
        return false;
    }
    return @rename($tmp, $file);
}

function pubHuman($bytes)
{
    return $bytes >= 1048576
        ? round($bytes / 1048576, 1) . ' MB'
        : round($bytes / 1024, 1) . ' KB';
}

$reg = pubRegistry($registry);
$ok = 0;
$failed = 0;

// ---------------------------------------------------------------------------
// 1) Yuklash
// ---------------------------------------------------------------------------
$keys = [];
if ($onlyKey !== '') {
    $keys = [$onlyKey];
} else {
    foreach (glob($root . '/*', GLOB_ONLYDIR) ?: [] as $dir) {
        $keys[] = basename($dir);
    }
    sort($keys);
}

foreach ($keys as $key) {
    $dir = $root . '/' . $key;
    if (!is_dir($dir)) {
        fwrite(STDERR, "[skip] $key — papka yo'q\n");
        continue;
    }
    $playlist = $dir . '/index.m3u8';
    if (!is_file($playlist)) {
        fwrite(STDERR, "[skip] $key — index.m3u8 yo'q (hali transkod qilinmagan)\n");
        continue;
    }
    $meta = json_decode((string) @file_get_contents($dir . '/meta.json'), true);
    $st   = is_array($meta) ? (string) ($meta['status'] ?? '') : '';
    if ($st !== 'done' && !$force) {
        fwrite(STDERR, "[skip] $key — status='" . ($st ?: '?') . "' (--force bilan majburlash mumkin)\n");
        continue;
    }

    $files = glob($dir . '/seg_*.ts') ?: [];
    sort($files);
    $files[] = $playlist;

    $base = $s3->publicUrl($key);
    $names = [];
    $bytes = 0;
    $done  = 0;
    $bad   = 0;

    foreach ($files as $path) {
        $name = basename($path);
        $names[] = $name;
        $size = (int) @filesize($path);
        $bytes += $size;
        $isPlaylist = substr($name, -5) === '.m3u8';
        $ct  = $isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        $cc  = $isPlaylist ? 'public, max-age=60' : 'public, max-age=31536000, immutable';

        if ($dryRun) {
            echo "  [dry] $key/$name  " . pubHuman($size) . "\n";
            continue;
        }
        if (!$force && $s3->head($key . '/' . $name)) {
            $done++;
            continue;
        }
        if ($s3->putFile($key . '/' . $name, $path, $ct, $cc)) {
            $done++;
        } else {
            $bad++;
            fwrite(STDERR, "  [xato] $key/$name: " . $s3->lastError() . "\n");
        }
    }

    if ($dryRun) {
        $ok++;
        continue;
    }
    if ($bad > 0) {
        $failed++;
        fwrite(STDERR, "[xato] $key — $bad fayl yuklanmadi (remote.json YOZILMADI)\n");
        continue;
    }

    // Playlist eng oxirida yuklandi — endi 302 xavfsiz.
    $remoteFile = $dir . '/remote.json';
    @file_put_contents($remoteFile, json_encode([
        'base'  => $base,
        'ts'    => time(),
        'files' => count($names),
    ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);

    $reg[$key] = ['files' => $names, 'ts' => time()];
    pubSave($registry, $reg);
    $ok++;
    echo "[ok] $key — " . count($names) . " fayl, " . pubHuman($bytes) . " (yuborildi: $done)\n";
}

// ---------------------------------------------------------------------------
// 2) Prune: lokaldan o'chirilgan kinolarning nusxasini remote'dan ham o'chirish
// ---------------------------------------------------------------------------
if ($prune && !$dryRun) {
    $removed = 0;
    foreach ($reg as $key => $info) {
        if (is_dir($root . '/' . $key)) {
            continue;
        }
        $files = isset($info['files']) && is_array($info['files']) ? $info['files'] : [];
        foreach ($files as $name) {
            if ($s3->delete($key . '/' . $name)) {
                $removed++;
            }
        }
        unset($reg[$key]);
        echo "[prune] $key — " . count($files) . " obyekt o'chirildi\n";
    }
    pubSave($registry, $reg);
    echo "Prune: $removed obyekt.\n";
}

echo "\nNatija: ok=$ok, xato=$failed"
    . ($dryRun ? ' (dry-run — hech narsa yozilmadi)' : '') . "\n";
exit($failed > 0 ? 1 : 0);
