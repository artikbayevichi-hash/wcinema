<?php
// ============================================================================
// api/tg-thumb.php — Telegram video thumbnail'ini POSTER sifatida beradi
// ============================================================================
//
// GET ?ch=<kanal>&post=<raqam>  ->  image/jpeg baytlari
//
// • Baytlar faqat BIR MARTA bot MTProto orqali Telegram'dan olinadi va
//   `uploads/tg_thumbs/` ga diskka keshlaydi (24 soat Cache-Control).
// • Keyingi so'rovlar to'g'ridan-to'g'ri diskdan — Telegram'ga ham, bot
//   sessiyasiga ham murojaat YO'Q. Video baytlari bu yerdan O'TMAYDI.
// • Thumb ma'lumoti yo'q/eskirgan bo'lsa — bot sessiyasi bilan hujjatni
//   qayta yechib, yangi thumb'ni saqlaydi (o'z-o'zini tuzatadi).
// • Xato bo'lsa 404 qaytaradi — mijoz eski poster (tg-resolve) ga o'tadi.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgMeta.php';

ob_start();

$ch   = strtolower(trim((string) input('ch', '', 100)));
$post = inputInt('post', 0);

function thumbNotFound()
{
    while (ob_get_level() > 0) { @ob_end_clean(); }
    http_response_code(404);
    header('Cache-Control: no-store');
    header('Content-Type: image/gif');
    // 1x1 shaffof GIF — <video poster> uchun zararsiz, xato ko'rinmaydi.
    echo base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    exit;
}

/**
 * Thumb hujjatda yo'q/olinsa — Telegram postining og:image ga o'tamiz.
 * Bu `t.me` sahifasining o'zi yaratgan rasm; hech qanday fayl yuklanmaydi.
 */
function thumbFallback($ch, $post)
{
    require_once __DIR__ . '/../includes/TgResolve.php';
    $url = (strpos($ch, 'c') === 0 && ctype_digit(substr($ch, 1)))
        ? 'https://t.me/c/' . substr($ch, 1) . '/' . $post
        : 'https://t.me/' . $ch . '/' . $post;
    try {
        $img = (new TgResolve())->image($url);
        if ($img && preg_match('#^https?://#i', $img)) {
            while (ob_get_level() > 0) { @ob_end_clean(); }
            http_response_code(302);
            header('Location: ' . $img);
            header('Cache-Control: public, max-age=3600');
            exit;
        }
    } catch (\Throwable $e) {}
    thumbNotFound();
}

function thumbServe($path)
{
    $bytes = (string) @file_get_contents($path);
    if ($bytes === '' || substr($bytes, 0, 2) !== "\xFF\xD8") return false;
    while (ob_get_level() > 0) { @ob_end_clean(); }
    http_response_code(200);
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . strlen($bytes));
    header('Cache-Control: public, max-age=86400, immutable');
    header('X-Content-Type-Options: nosniff');
    echo $bytes;
    exit;
}

if ($ch === '' || $post <= 0) thumbNotFound();

$cache = TgMeta::thumbCachePath($ch, $post);
// Eskirgan keshni 7 kunda bir marta yangilaymiz (immutable 24 soat bilan mos).
if (is_file($cache) && (time() - (int) @filemtime($cache)) < 7 * 86400) {
    thumbServe($cache);
}

$row = TgMeta::getThumb($ch, $post);

// Thumb ma'lumoti yo'q yoki bayt olish muvaffaqiyatsiz bo'lsa — hujjatni
// qayta yechib, yangi thumb ma'lumotini saqlab qayta urinamiz.
$needRefresh = !$row || empty($row['fr']) || empty($row['type']);
$dlApi = null;
$serve = false;
try {
    require_once __DIR__ . '/../includes/TgPull.php';
    TgPull::sessionLockAcquire(15);
    $dlApi = TgPull::openBotSession();

    if ($needRefresh) {
        // Kanal nomi `c123...` (private) bo'lsa ham fetchDocInfo ishlaydi —
        // bot kanalga a'zo bo'lgani uchun xabar to'g'ridan-to'g'ri olinadi.
        $url = (strpos($ch, 'c') === 0 && ctype_digit(substr($ch, 1)))
            ? 'https://t.me/c/' . substr($ch, 1) . '/' . $post
            : 'https://t.me/' . $ch . '/' . $post;
        $info = TgPull::fetchDocInfo($dlApi, $url);
        $doc  = is_array($info['doc'] ?? null) ? $info['doc'] : null;
        // finally (sessiya qulfini bo'shatish) ishlashi uchun chiqmaymiz.
        if (!$doc) throw new \RuntimeException('thumb-doc-yoq');
        $t = TgMeta::extractThumb($doc);
        if (!$t) throw new \RuntimeException('thumb-kadr-yoq');
        TgMeta::saveThumb($ch, $post, $t);
        $row = TgMeta::getThumb($ch, $post);
    }

    if (TgMeta::cacheThumbBytes($dlApi, $ch, $post, $row) > 0 && is_file($cache)) {
        $serve = true;
    }
} catch (\Throwable $e) {
    // jim: mijoz eski poster ga o'tadi
} finally {
    if ($dlApi !== null) TgPull::sessionLockRelease();
}

if ($serve) thumbServe($cache);
thumbFallback($ch, $post);
