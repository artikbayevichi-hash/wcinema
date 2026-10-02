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

$url = input('url', '', 2000);
if ($url === '') {
    fail('url kerak', 400);
}

$resolver = new TgResolve();

// Rasmlar uchun: to'g'ridan-to'g'ri 302 CDN ga (brauzer kuzatib boradi)
if (($_GET['mode'] ?? '') === 'img') {
    $img = $resolver->image($url);
    if (!$img) {
        http_response_code(404);
        exit('Telegram rasm topilmadi');
    }
    header('Location: ' . $img, true, 302);
    exit;
}

$r = $resolver->resolve($url);
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