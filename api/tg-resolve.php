<?php
// ============================================================================
// api/tg-resolve.php - Telegram post havolasini ochish
// ============================================================================
//   GET ?url=https://t.me/...           -> JSON {ok,image,video,title,cached}
//   GET ?url=https://t.me/...&mode=img  -> og:image CDN ga 302 (rasm ko'rsatadi)
//
// Xavfsizlik: faqat t.me / telegram.me manzillari (TgResolve ichida), rasm
// faqat Telegram CDN dan yuklanadi. Ommaviy endpoint — login talab qilmaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

// Sessiya fayli qulfi (<img> so'rovlarini ketma-ket qilib qo'ymasin):
// bitta sahifada 10+ poster bir vaqtda ochiladi. Bu endpoint sessiyaga
// bog'liq emas, shuning uchun qulfni darhol bo'shatamiz.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

$url = input('url', '', 2000);
if ($url === '') {
    fail('url kerak', 400);
}

$resolver = new TgResolve();
$fresh    = !empty($_GET['fresh']);

// Rasmlar uchun: to'g'ridan-to'g'ri 302 CDN ga (brauzer kuzatib boradi)
if (($_GET['mode'] ?? '') === 'img') {
    $img = $resolver->image($url, $fresh);
    if (!$img) {
        http_response_code(404);
        header('Cache-Control: no-store');
        exit('Telegram rasm topilmadi');
    }
    // Brauzer 30 daqiqa keshlaydi: har sahifa ochilishida PHP'ga urinmaydi.
    // `fresh=1` (onerror qayta urinishi) esa keshlanmaydi.
    header('Cache-Control: ' . ($fresh ? 'no-store' : 'public, max-age=1800'));
    header('Location: ' . $img, true, 302);
    exit;
}

$r = $resolver->resolve($url, $fresh);
ok([
    'ok'        => !empty($r['ok']),
    'image'     => $r['image'] ?? null,
    'video'     => $r['video'] ?? null,
    'title'     => $r['title'] ?? null,
    'has_video' => !empty($r['has_video']),
    'has_post'  => !empty($r['has_post']),
    'embed_ok'  => !empty($r['embed_ok']),
    'media_big' => !empty($r['media_big']),
    'reason'    => $r['reason'] ?? null,
    'cached'    => !empty($r['cached']),
]);