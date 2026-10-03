<?php
// ============================================================================
// api/reel-upload.php - videoni qabul qilib Telegram kanalga joylash
// ============================================================================
// Saytdagi "Reels joylash" sahifasi shu yerga yuboradi.
//
// Oqim: brauzer -> sayt (vaqtinchalik fayl) -> Telegram kanal (REELS_CHANNEL).
// Fayl SERVERDA SAQLANMAYDI: Telegram'ga uzatilgach darhol o'chiriladi.
// Tomoshabinlar videoni Telegram'dan ko'radi — saytga og'irlik tushmaydi.
//
// POST (multipart): video (fayl), title?, description?, content_id?,
//                   tg_me? (brauzer MTProto identifikatori)
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

// PHP sessiyasi bo'lmasa (MTProto), foydalanuvchini brauzer yuborgan
// `tg_me` dan topamiz/yaratamiz — reels joylash hammaga ochiq.
$userId = reelUserId();
if ($userId <= 0) {
    fail('Foydalanuvchi aniqlanmadi. Sahifani yangilab, qayta urinib ko‘ring.', 401);
}

if (empty($_FILES['video']) || !is_array($_FILES['video'])) {
    fail('Video fayl tanlanmagan', 400);
}

$contentId = inputInt('content_id', 0);
$title     = input('title', '', 200);
$descr     = input('description', '', 500);

$reels  = new Reels();
$result = $reels->createUpload($userId, $_FILES['video'], $title, $descr, $contentId);

if (empty($result['success'])) {
    fail($result['message'] ?? 'Yuklab bo‘lmadi', 400);
}

ok($result);
