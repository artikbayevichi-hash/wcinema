<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/prefix-publish.php — videoning BOSH QISMini (2-5 MB) Cloudflare R2 ga
// oldindan yuklaydi: `p/<doc>`.
// ============================================================================
// Nima uchun: Service Worker pleyer avval `https://<R2 domen>/p/<doc>` dan
// videoning birinchi bo'lagini oladi (tez boshlanish), qolganini Telegram'dan.
// Ilgari bu obyekt faqat BIRINCHI tomoshabin kelganda (cache-aside) yozilardi.
// Bu CLI esa uni oldindan tayyorlaydi — birinchi tomoshabin ham tez ochadi.
//
// Doc id — Telegram hujjat raqami (`api/tg-doc.php?url=<t.me/...>` javobidagi
// `id`). Uni bir marta olib, quyidagicha bering:
//
//   php cli/prefix-publish.php --doc=123456789 --file=uploads/videos/x.mp4
//   php cli/prefix-publish.php --manifest=storage/prefix-manifest.json
//   php cli/prefix-publish.php --manifest=... --verify
//   php cli/prefix-publish.php --manifest=... --dry-run
//   php cli/prefix-publish.php --manifest=... --prune
//
// Manifest (JSON):
//   [ {"doc": 123456789, "file": "uploads/videos/x.mp4"}, ... ]
//   yoki {"123456789": "uploads/videos/x.mp4", ...}
//
// .env: S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY
//       R2_PUBLIC_BASE (yoki S3_PUBLIC_BASE) — tekshirish uchun
//       R2_PREFIX_BYTES (standart 5242880)
//
// Reestr: storage/cache/r2-prefix-published.json (qayta yuklashning oldini oladi).
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
ini_set('memory_limit', '256M');

require __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/S3Client.php';

$args = array_slice($argv, 1);
$opt = [
    'doc' => '',
    'file' => '',
    'manifest' => '',
    'prefix' => (int) env_value('R2_PREFIX_BYTES', '5242880'),
    'dry' => false,
    'force' => false,
    'verify' => false,
    'prune' => false,
    'json' => false,
    'quiet' => false,
];

foreach ($args as $arg) {
    if ($arg === '--dry-run') {
        $opt['dry'] = true;
    } elseif ($arg === '--force') {
        $opt['force'] = true;
    } elseif ($arg === '--verify') {
        $opt['verify'] = true;
    } elseif ($arg === '--prune') {
        $opt['prune'] = true;
    } elseif ($arg === '--json') {
        $opt['json'] = true;
    } elseif ($arg === '--quiet' || $arg === '-q') {
        $opt['quiet'] = true;
    } elseif (strpos($arg, '--doc=') === 0) {
        $opt['doc'] = trim(substr($arg, 6));
    } elseif (strpos($arg, '--file=') === 0) {
        $opt['file'] = substr($arg, 7);
    } elseif (strpos($arg, '--manifest=') === 0) {
        $opt['manifest'] = substr($arg, 11);
    } elseif (strpos($arg, '--prefix=') === 0) {
        $opt['prefix'] = (int) substr($arg, 9);
    } elseif ($arg === '--help' || $arg === '-h') {
        fwrite(STDOUT, "Ishlatish: php cli/prefix-publish.php --doc=ID --file=FAYL [--verify]\n"
            . "           php cli/prefix-publish.php --manifest=JSON [--dry-run] [--force] [--verify] [--prune]\n");
        exit(0);
    }
}

// 1 MB .. 8 MB, Telegram blok tekisligi (4096) ga karrali.
$prefixBytes = max(1024 * 1024, min(8 * 1024 * 1024, (int) $opt['prefix']));
$prefixBytes -= $prefixBytes % 4096;

$root = dirname(__DIR__);
$registryFile = $root . '/storage/cache/r2-prefix-published.json';
$publicBase = rtrim((string) env_value('R2_PUBLIC_BASE', env_value('S3_PUBLIC_BASE', '')), '/');

$s3 = S3Client::fromEnv();
if (!$s3) {
    fwrite(STDERR, "S3 sozlamalari yo'q. .env ga S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY,\n"
        . "S3_SECRET_KEY yozing (docs/production-deploy.md, docs/video-prep.md).\n");
    exit(2);
}
$s3Root = $s3->withPrefix('');   // `p/<doc>` bucket ildizida

// ---------------------------------------------------------------- Reestr
function ppRegistryRead(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    $j = json_decode((string) @file_get_contents($file), true);
    return is_array($j) ? $j : [];
}

function ppRegistryWrite(string $file, array $data): bool
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $tmp = $file . '.' . getmypid() . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (@file_put_contents($tmp, $json) === false) {
        return false;
    }
    return @rename($tmp, $file);
}

// ----------------------------------------------------------- Vazifalar
$jobs = [];       // [ [doc, file], ... ]
$errors = [];

if ($opt['manifest'] !== '') {
    $path = $opt['manifest'];
    if (!preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $path)) {
        $path = getcwd() . '/' . $path;
    }
    if (!is_file($path)) {
        fwrite(STDERR, "Manifest topilmadi: {$path}\n");
        exit(2);
    }
    $data = json_decode((string) @file_get_contents($path), true);
    if (!is_array($data)) {
        fwrite(STDERR, "Manifest JSON emas: {$path}\n");
        exit(2);
    }
    foreach ($data as $key => $item) {
        if (is_array($item)) {
            $doc = (string) ($item['doc'] ?? $item['id'] ?? '');
            $file = (string) ($item['file'] ?? $item['path'] ?? '');
        } else {
            $doc = (string) $key;
            $file = is_string($item) ? $item : '';
        }
        $jobs[] = [$doc, $file];
    }
} elseif ($opt['doc'] !== '' || $opt['file'] !== '') {
    $jobs[] = [$opt['doc'], $opt['file']];
} elseif (!$opt['prune']) {
    fwrite(STDERR, "Ishlatish: php cli/prefix-publish.php --doc=ID --file=FAYL\n"
        . "           php cli/prefix-publish.php --manifest=JSON [--dry-run] [--force] [--verify] [--prune]\n"
        . "           php cli/prefix-publish.php --prune   (faqat reestrni tozalash)\n");
    exit(2);
}

$summary = ['total' => 0, 'uploaded' => 0, 'skipped' => 0, 'verified' => 0, 'failed' => 0, 'pruned' => 0];

/** Faylning bosh qismini vaqtinchalik faylga yozadi; [path, bytes, sha256]. */
function ppHead(string $file, int $bytes): array
{
    $in = @fopen($file, 'rb');
    if (!$in) {
        return ['', 0, ''];
    }
    $tmp = @tempnam(sys_get_temp_dir(), 'r2head_');
    if ($tmp === false) {
        fclose($in);
        return ['', 0, ''];
    }
    $out = @fopen($tmp, 'wb');
    if (!$out) {
        fclose($in);
        @unlink($tmp);
        return ['', 0, ''];
    }
    $copied = (int) @stream_copy_to_stream($in, $out, $bytes);
    fclose($in);
    fclose($out);
    $hash = hash_file('sha256', $tmp);
    return [$tmp, $copied, (string) $hash];
}

/** Ochiq URL'dan bosh qismni o'qib, mahalliy faylning bosh qismi bilan solishtiradi. */
function ppVerify(string $url, int $bytes, string $localFile): bool
{
    if (!function_exists('curl_init')) {
        return false;
    }
    $probe = max(1, min($bytes, 65536));
    $fp = @fopen($localFile, 'rb');
    if (!$fp) {
        return false;
    }
    $local = (string) fread($fp, $probe);
    fclose($fp);
    if ($local === '') {
        return false;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_RANGE => '0-' . ($probe - 1),
        CURLOPT_HTTPHEADER => ['Cache-Control: no-cache'],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!is_string($body) || $code < 200 || $code >= 300 || strlen($body) < $probe) {
        return false;
    }
    return hash_equals(hash('sha256', $local), hash('sha256', substr($body, 0, $probe)));
}

$registry = ppRegistryRead($registryFile);

/** Reestrdagi yo'lni to'liq yo'lga aylantiradi (nisbiy — ildizga nisbatan). */
function ppResolve(string $root, string $file): string
{
    $file = trim($file);
    if ($file === '') {
        return '';
    }
    if (preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $file)) {
        return $file;
    }
    return $root . '/' . ltrim($file, '/');
}

if ($opt['prune']) {
    foreach ($registry as $doc => $entry) {
        $file = (string) ($entry['file'] ?? '');
        $full = ppResolve($root, $file);
        if ($full !== '' && is_file($full)) {
            continue;
        }
        $doc = (string) $doc;
        if ($opt['dry']) {
            if (!$opt['quiet']) {
                echo "  [dry] prune p/{$doc}\n";
            }
            continue;
        }
        if ($s3Root->delete('p/' . $doc)) {
            unset($registry[$doc]);
            $summary['pruned']++;
        } else {
            fwrite(STDERR, "  [xato] prune p/{$doc}: " . $s3Root->lastError() . "\n");
            $summary['failed']++;
        }
    }
    if (!$opt['dry']) {
        ppRegistryWrite($registryFile, $registry);
    }
}

foreach ($jobs as [$doc, $file]) {
    $summary['total']++;
    $doc = trim((string) $doc);
    $file = trim((string) $file);

    if (!preg_match('/^[0-9]{1,25}$/', $doc)) {
        $errors[] = ['doc' => $doc, 'file' => $file, 'error' => 'doc raqam emas'];
        $summary['failed']++;
        continue;
    }
    if (!preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $file)) {
        $file = $root . '/' . ltrim($file, '/');
    }
    if (!is_file($file) || !is_readable($file)) {
        $errors[] = ['doc' => $doc, 'file' => $file, 'error' => 'fayl topilmadi'];
        $summary['failed']++;
        continue;
    }

    $size = (int) @filesize($file);
    $bytes = min($prefixBytes, $size);
    $bytes -= $bytes % 4096;
    if ($bytes < 4096) {
        $errors[] = ['doc' => $doc, 'file' => $file, 'error' => 'fayl juda kichik'];
        $summary['failed']++;
        continue;
    }

    [$tmp, $copied, $sha] = ppHead($file, $bytes);
    if ($tmp === '' || $copied !== $bytes || $sha === '') {
        $errors[] = ['doc' => $doc, 'file' => $file, 'error' => 'bosh qism o\'qilmadi'];
        $summary['failed']++;
        if ($tmp !== '') {
            @unlink($tmp);
        }
        continue;
    }

    $rel = $file;
    $norm = str_replace('\\', '/', $file);
    $rootNorm = str_replace('\\', '/', rtrim($root, '/\\'));
    if (strpos($norm, $rootNorm . '/') === 0) {
        $rel = ltrim(substr($norm, strlen($rootNorm) + 1), '/');
    }
    $known = $registry[$doc] ?? null;
    $unchanged = is_array($known)
        && (string) ($known['sha256'] ?? '') === $sha
        && (int) ($known['bytes'] ?? 0) === $bytes
        && (int) ($known['size'] ?? 0) === $size;

    if (!$opt['force'] && $unchanged && !$opt['verify']) {
        $summary['skipped']++;
        if (!$opt['json'] && !$opt['quiet']) {
            echo "  [skip] p/{$doc} — allaqachon yuklangan (" . round($bytes / 1048576, 1) . " MB)\n";
        }
        @unlink($tmp);
        continue;
    }

    $url = $publicBase !== '' ? $publicBase . '/p/' . rawurlencode($doc) : '';

    if ($opt['dry']) {
        $summary['uploaded']++;
        if (!$opt['json'] && !$opt['quiet']) {
            echo "  [dry] p/{$doc}  " . round($bytes / 1048576, 1) . " MB  <- {$rel}\n";
        }
        @unlink($tmp);
        continue;
    }

    $ok = $s3Root->putFile(
        'p/' . $doc,
        $tmp,
        'video/mp4',
        'public, max-age=31536000, immutable'
    );
    @unlink($tmp);

    if (!$ok) {
        $errors[] = ['doc' => $doc, 'file' => $file, 'error' => $s3Root->lastError()];
        $summary['failed']++;
        continue;
    }

    $summary['uploaded']++;
    $verified = null;
    if ($opt['verify']) {
        if ($url === '') {
            $errors[] = ['doc' => $doc, 'file' => $file, 'error' => 'R2_PUBLIC_BASE yo\'q — tekshirib bo\'lmadi'];
            $summary['failed']++;
            continue;
        }
        $verified = ppVerify($url, $bytes, $file);
        if ($verified) {
            $summary['verified']++;
        } else {
            $errors[] = ['doc' => $doc, 'file' => $file, 'error' => 'tekshiruv muvaffaqiyatsiz: ' . $url];
            $summary['failed']++;
            continue;
        }
    }

    $registry[$doc] = [
        'file' => $rel,
        'size' => $size,
        'bytes' => $bytes,
        'sha256' => $sha,
        'url' => $url,
        'at' => gmdate('c'),
    ];
    ppRegistryWrite($registryFile, $registry);

    if (!$opt['json'] && !$opt['quiet']) {
        echo "  [ok] p/{$doc}  " . round($bytes / 1048576, 1) . " MB"
            . ($verified === true ? '  (tekshirildi)' : '') . "\n";
    }
}

if ($opt['json']) {
    fwrite(STDOUT, json_encode([
        'prefix_bytes' => $prefixBytes,
        'public_base' => $publicBase,
        'summary' => $summary,
        'errors' => $errors,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
} elseif (!$opt['quiet']) {
    printf(
        "\nJami: %d | yuklandi: %d | o'tkazildi: %d | tekshirildi: %d | tozalandi: %d | xato: %d\n",
        $summary['total'],
        $summary['uploaded'],
        $summary['skipped'],
        $summary['verified'],
        $summary['pruned'],
        $summary['failed']
    );
    foreach ($errors as $e) {
        fwrite(STDERR, "  [xato] p/{$e['doc']} ({$e['file']}): {$e['error']}\n");
    }
}

exit($summary['failed'] === 0 ? 0 : 1);
