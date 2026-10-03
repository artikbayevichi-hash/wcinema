<?php
// ============================================================================
// api/reel-intent.php - Telegram kanal orqali reel yuklashni boshlash
// ============================================================================
// Saytdagi "Reels yuklash" sahifasi shu yerga murojaat qiladi.
//
// MUHIM: bu yerda FAYL YO'Q. Serverga video YOZILMAYDI. Faqat "kutilayotgan"
// reel yozuvi va bir martalik token yaratiladi. Foydalanuvchi botga
// start=reel_<token> bilan o'tib videoni yuboradi; bot uni REELS_CHANNEL
// kanaliga joylaydi va shu yozuvni to'ldiradi (video_url = t.me havola).
//
// POST: title?, description?, content_id? (ixtiyoriy - qaysi filmdan olingan)
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

// PHP sessiyasi bo'lmasa (MTProto), foydalanuvchini brauzer yuborgan
// `tg_me` dan topamiz/yaratamiz - reels yuklash hammaga ochiq.
$userId = reelUserId();
if ($userId <= 0) {
    fail('Foydalanuvchi aniqlanmadi. Sahifani yangilab, qayta urinib ko‘ring.', 401);
}

$contentId = inputInt('content_id', 0);
$title     = input('title', '', 200);
$descr     = input('description', '', 500);

$reels  = new Reels();
$result = $reels->createIntent($userId, $contentId, $title, $descr);

if (empty($result['success'])) {
    fail($result['message'] ?? 'Yuklashni boshlab bo‘lmadi', 400);
}

ok($result);
