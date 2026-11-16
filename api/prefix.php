<?php
// ============================================================================
// api/prefix.php — MAHALLIY prefiks serveri (Range bilan)
// ----------------------------------------------------------------------------
// NIMA UCHUN:
//   Telegram'dagi MP4 fayllar "faststart" EMAS: indeks (`moov`) faylning
//   OXIRIDA turadi. Brauzer birinchi kadrni ko'rsatishi uchun avval shu
//   indeksni, keyin esa bosh bo'lakni o'qiydi. Ikkisi ham Telegram DC'dan
//   kelsa — birinchi kadr 10–40 s kutadi (ayniqsa begona DC'da).
//
//   Yechim (Telegram Web bilan bir xil g'oya): faylning BOSH qismi (4 MB) va
//   OXIRGI qismi (`moov`, ~6 MB) bir marta serverga yozib qo'yiladi
//   (`cli/prefix-build.php`). Service Worker ularni shu yerdan — bir zumda —
//   oladi, qolgan baytlar avvalgidek Telegram'dan oqadi. Fayl BAYT-BAYT
//   bir xil bo'lib qoladi: hech qanday qayta kodlash yo'q.
//
// SO'ROV:
//   GET api/prefix.php?doc=<id>&exp=<unix>&sig=<hmac>
//   Range: bytes=a-b | bytes=a- | bytes=-n     (206)
//   Range yo'q bo'lsa — bosh fayl to'liq (200)
//
// XAVFSIZLIK:
//   Imzo — `HMAC-SHA256(secret, "PREFIX\n<exp>")`. Imzo hujjatga BOG'LANMAGAN
//   (chunki SW bitta shablon URL oladi va `{doc}` ni o'zi qo'yadi), lekin
//   muddati bor (`PREFIX_TTL`, standart 12 soat). Bu maxfiy kontent emas —
//   videoning ochiq ko'rinadigan qismi; imzo faqat ommaviy skript/bot
//   yuklab olishini qiyinlashtiradi.
//
// MAXFIY QIYMATLAR BU YERDA CHIQARILMAYDI — faqat `sig` tekshiriladi.
// ============================================================================

// Sessiya kerak emas: parallel Range so'rovlari sessiya fayli lock'ida
// bir-birini kutib qolmasligi uchun uni umuman ochmaymiz.
define('WC_NO_SESSION', 1);

require_once __DIR__ . '/../config.php';

@set_time_limit(0);
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) {
    @ob_end_clean();
}

$dir = dirname(__DIR__) . '/storage/prefix';
$manifestFile = $dir . '/manifest.json';

function px_fail($status, $msg)
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    echo $msg;
    exit;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method !== 'GET' && $method !== 'HEAD') {
    px_fail(405, 'Faqat GET/HEAD');
}

// ------------------------------------------------------------------ imzo
$doc = preg_replace('/[^0-9]/', '', (string) ($_GET['doc'] ?? ''));
if ($doc === '' || strlen($doc) > 20) {
    px_fail(400, 'doc kerak');
}

$exp = (int) ($_GET['exp'] ?? 0);
$sig = (string) ($_GET['sig'] ?? '');

$secret = (string) env_value('PREFIX_SECRET', '');
if ($secret === '') {
    $secret = (string) env_value('R2_SIGN_SECRET', '');
}
if ($secret === '' && defined('ADMIN_PANEL_KEY')) {
    $secret = (string) ADMIN_PANEL_KEY;
}
if ($secret === '') {
    px_fail(503, 'prefiks imzosi sozlanmagan');
}
if ($exp <= 0 || $exp < time()) {
    px_fail(403, 'muddati tugagan');
}
if (!hash_equals(hash_hmac('sha256', "PREFIX\n" . $exp, $secret), $sig)) {
    px_fail(403, 'imzo xato');
}

// --------------------------------------------------------------- manifest
$raw = @file_get_contents($manifestFile);
$m = $raw !== false ? json_decode((string) $raw, true) : null;
if (!is_array($m)) {
    px_fail(404, 'prefiks yo\'q');
}
$docs = (isset($m['docs']) && is_array($m['docs'])) ? $m['docs'] : $m;
$e = $docs[$doc] ?? null;
if (!is_array($e)) {
    px_fail(404, 'bu hujjat uchun prefiks yo\'q');
}

$size    = (int) ($e['size'] ?? 0);
$headLen = max(0, (int) ($e['head'] ?? 0));
$tailLen = max(0, (int) ($e['tail'] ?? 0));
if ($size <= 0 || $headLen <= 0) {
    px_fail(404, 'prefiks tayyor emas');
}

$headFile = $dir . '/' . $doc . '.head';
$tailFile = $dir . '/' . $doc . '.tail';

$headHave = @filesize($headFile);
if ($headHave === false || $headHave <= 0) {
    px_fail(404, 'prefiks fayli topilmadi');
}
$tailHave = $tailLen > 0 ? @filesize($tailFile) : false;
if ($tailHave === false) {
    $tailHave = 0;
    $tailLen = 0;
}

// ------------------------------------------------------------------ Range
$start = 0;
$end   = $headLen - 1;
$status = 200;

$range = (string) ($_SERVER['HTTP_RANGE'] ?? '');
if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)\s*$/', trim($range), $mm)) {
    $a = $mm[1];
    $b = $mm[2];
    if ($a === '' && $b === '') {
        header('Content-Range: bytes */' . $size);
        px_fail(416, 'noto\'g\'ri Range');
    }
    if ($a === '') {
        // `bytes=-N` — oxirgi N bayt.
        $n = (int) $b;
        if ($n <= 0) {
            header('Content-Range: bytes */' . $size);
            px_fail(416, 'noto\'g\'ri Range');
        }
        $start = max(0, $size - $n);
        $end = $size - 1;
    } else {
        $start = (int) $a;
        $end = ($b === '') ? $size - 1 : (int) $b;
    }
    if ($end >= $size) {
        $end = $size - 1;
    }
    if ($start < 0 || $start > $end || $start >= $size) {
        header('Content-Range: bytes */' . $size);
        px_fail(416, 'oraliq fayldan tashqarida');
    }
    $status = 206;
}

// Qaysi fayldan o'qiymiz: BOSH yoki DUM (`moov`).
$file = '';
$fileOff = 0;
$limit = 0;

if ($start < $headLen) {
    $file = $headFile;
    $fileOff = $start;
    $limit = min($end, $headLen - 1) - $start + 1;
} else {
    $tailStart = $size - $tailLen;
    if ($tailLen > 0 && $start >= $tailStart) {
        $file = $tailFile;
        $fileOff = $start - $tailStart;
        $limit = $end - $start + 1;
    }
}

if ($file === '' || $limit <= 0) {
    // Prefiks bu oraliqni qoplamaydi — Service Worker Telegram'ga o'tadi.
    header('Content-Range: bytes */' . $size);
    px_fail(416, 'prefiksda yo\'q');
}

$fh = @fopen($file, 'rb');
if (!$fh) {
    px_fail(404, 'faylni ochib bo\'lmadi');
}
$avail = @filesize($file);
if ($avail !== false) {
    if ($fileOff >= $avail) {
        fclose($fh);
        header('Content-Range: bytes */' . $size);
        px_fail(416, 'prefiks qisqaroq');
    }
    if ($limit > $avail - $fileOff) {
        $limit = $avail - $fileOff;
    }
}
if ($limit <= 0) {
    fclose($fh);
    px_fail(416, 'bo\'sh');
}

@header_remove('X-Powered-By');
header('Content-Type: video/mp4');
header('Accept-Ranges: bytes');
header('Content-Length: ' . $limit);
// Qayta ochishda brauzer keshidan oladi (SW o'z bo'lak keshini ham ishlatadi).
header('Cache-Control: private, max-age=600');
header('X-Content-Type-Options: nosniff');
if ($status === 206) {
    header('Content-Range: bytes ' . $start . '-' . ($start + $limit - 1) . '/' . $size);
}
http_response_code($status);

if ($method === 'HEAD') {
    fclose($fh);
    exit;
}

@fseek($fh, $fileOff);
while ($limit > 0 && !feof($fh)) {
    if (connection_aborted()) {
        break;
    }
    $buf = @fread($fh, $limit > 65536 ? 65536 : $limit);
    if ($buf === false || $buf === '') {
        break;
    }
    echo $buf;
    $limit -= strlen($buf);
    @flush();
}
fclose($fh);
