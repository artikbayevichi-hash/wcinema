<?php
// ============================================================================
// api/prefix-save.php — birinchi tomoshabin topgan prefiksni saqlash
// ----------------------------------------------------------------------------
// Bu MAHALLIY prefiks yozuvchisi (R2 bo'lmaganda ishlaydi). SW bosh va dum
// oynalarini bir marta Telegram'dan o'qiydi, so'ngra ularni shu yerga yozadi.
// Keyingi tomoshabinlar ularni `api/prefix.php` dan oladi — 1–2 MB lik
// "moov/qidiruv" so'rovi endi Telegram DC'ga BORMaydi.
//
// SO'ROV: PUT/POST ?doc=<id>&size=<bayt>&part=head|tail&exp=<unix>&sig=<hmac>
//   imzo: HMAC-SHA256(secret, "PUTPX\n<doc>\n<size>\n<part>\n<exp>")
//   imzoni faqat `api/r2-sign.php?doc=...` beradi (15 daqiqa amal qiladi).
//
// SAQLANADI: faqat kontent darajasidagi baytlar + doc_id/size/uzunlik.
// YO'Q: file_reference, sessiya, cookie, IP, foydalanuvchi identifikatori.
// ============================================================================

define('WC_NO_SESSION', 1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/PrefixStore.php';
require_once __DIR__ . '/../includes/PrefixSecret.php';

@set_time_limit(0);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function pxsv_out($code, array $data)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function pxsv_fail($code, $msg)
{
    pxsv_out($code, ['success' => false, 'ok' => false, 'error' => $msg]);
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method !== 'PUT' && $method !== 'POST') {
    pxsv_fail(405, 'Faqat PUT/POST');
}

$doc  = preg_replace('/[^0-9]/', '', (string) ($_GET['doc'] ?? ''));
$size = (int) ($_GET['size'] ?? 0);
$part = (string) ($_GET['part'] ?? '');
$exp  = (int) ($_GET['exp'] ?? 0);
$sig  = (string) ($_GET['sig'] ?? '');

if ($doc === '' || strlen($doc) > 20 || $size < 1024 * 1024
    || $size > 4 * 1024 * 1024 * 1024 || ($part !== 'head' && $part !== 'tail')) {
    pxsv_fail(400, 'Noto\'g\'ri doc/size/part');
}

$secret = PrefixSecret::get();
if ($secret === '') {
    pxsv_fail(503, 'prefiks imzosi sozlanmagan');
}
if ($exp <= 0 || $exp < time() - 30 || $exp > time() + 86400) {
    pxsv_fail(403, 'muddati tugagan');
}
$plain = "PUTPX\n" . $doc . "\n" . $size . "\n" . $part . "\n" . $exp;
if (!hash_equals(hash_hmac('sha256', $plain, $secret), $sig)) {
    pxsv_fail(403, 'imzo xato');
}

$dir = dirname(__DIR__) . '/storage/prefix';
$manifestFile = $dir . '/manifest.json';
if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
    pxsv_fail(503, 'prefiks papkasi yozilmaydi');
}

$maxBytes = $part === 'head' ? 64 * 1024 * 1024 : 16 * 1024 * 1024;
$minBytes = 4096;

$tmp = $dir . '/' . $doc . '.' . $part . '.' . bin2hex(random_bytes(6)) . '.tmp';
$out = @fopen($tmp, 'wb');
$in  = @fopen('php://input', 'rb');
if (!$out || !$in) {
    if ($out) fclose($out);
    if ($in) fclose($in);
    @unlink($tmp);
    pxsv_fail(500, 'yozib bo\'lmadi');
}

$total = 0;
while ($total < $maxBytes && !feof($in)) {
    $buf = fread($in, 65536);
    if ($buf === false || $buf === '') break;
    $take = min(strlen($buf), $maxBytes - $total);
    if ($take <= 0) break;
    fwrite($out, $take === strlen($buf) ? $buf : substr($buf, 0, $take));
    $total += $take;
}
fclose($in);
fclose($out);

if ($total < $minBytes) {
    @unlink($tmp);
    pxsv_fail(400, 'prefiks juda kichik');
}
$usable = $total - ($total % 4096);       // Telegram blok tekisligi
if ($usable <= 0) {
    @unlink($tmp);
    pxsv_fail(400, 'prefiks juda kichik');
}
if ($usable < $total) {
    $fp = @fopen($tmp, 'r+b');
    if ($fp) { ftruncate($fp, $usable); fclose($fp); }
}

$target = $dir . '/' . $doc . '.' . $part;
if (!@rename($tmp, $target)) {
    @unlink($tmp);
    pxsv_fail(500, 'prefiks fayli almashtirilmadi');
}

// Manifestni qulflab yangilaymiz. Eski hajm boshqa bo'lsa — film almashtirilgan,
// eski head/tail hisoblanmaydi: u o'chirilib yangisi bilan almashtiriladi.
$lock = @fopen($manifestFile . '.lock', 'c+');
if ($lock) {
    @flock($lock, LOCK_EX);
}
$m = PrefixStore::read();
$old = $m['docs'][$doc] ?? null;
$same = is_array($old) && (int) ($old['size'] ?? 0) === $size;
if (!$same && is_array($old)) {
    // Hajm o'zgargan = kontent almashtirilgan. Eski fayllar ishlamaydi.
    PrefixStore::unlinkDoc($doc);
}
$prevHead = $same ? max(0, (int) ($old['head'] ?? 0)) : 0;
$prevTail = $same ? max(0, (int) ($old['tail'] ?? 0)) : 0;
// Kattaroq/oldindan tayyorlangan prefiksni kichigi bilan yozib yubormaymiz.
$finalHead = $part === 'head' ? max($prevHead, $usable) : $prevHead;
$finalTail = $part === 'tail' ? max($prevTail, $usable) : $prevTail;

// Va muddati tugaganlarni o'chiramiz; limit to'lsa eng eskisini evakuatsiya
// qilamiz — yangi prefiks hech qachon "429 joy yo'q" deb rad etilmaydi.
PrefixStore::prune($m);

$m['docs'][$doc] = [
    'size' => $size,
    'head' => $finalHead,
    'tail' => $finalTail,
    'at'   => time(),
];
$written = PrefixStore::write($m);
if ($lock) {
    @flock($lock, LOCK_UN);
    fclose($lock);
}
if (!$written) pxsv_fail(500, 'manifest yozilmadi');

pxsv_out(200, [
    'success' => true,
    'ok'      => true,
    'doc'     => $doc,
    'size'    => $size,
    'part'    => $part,
    'bytes'   => $usable,
    'head'    => $finalHead,
    'tail'    => $finalTail,
]);
