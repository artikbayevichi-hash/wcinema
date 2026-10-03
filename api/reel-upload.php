<?php
// ============================================================================
// api/reel-upload.php - qisqa video fayl YUKLASH
// ============================================================================
// POST multipart/form-data:
//   video       (fayl, majburiy)
//   title       (matn, ixtiyoriy)
//   description (matn, ixtiyoriy)
//
// Xavfsizlik:
//   1) Ruxsat etilgan format (mp4/webm/mov) + haqiqiy MIME tekshiruvi
//   2) Hajm limiti (REEL_MAX_UPLOAD_MB)
//   3) Fayl nomi TASHLANGAN, tasodifiy nom beriladi
//   4) status = 0 (kutilmoqda) - kontent moderatsiyadan o'tmaguncha
//      hech kimda ko'rinmaydi
//   5) $_FILES['video']['error'] to'g'ri tekshiriladi
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

// PHP sessiya bo'lmasa (MTProto), foydalanuvchini brauzer yuborgan
// `tg_me` dan topamiz/yaratamiz — yuklash barcha foydalanuvchilarga ochiq.
$userId = reelUserId();
if ($userId <= 0) {
    fail('Foydalanuvchi aniqlanmadi. Sahifani yangilab, qayta urinib ko‘ring.', 401);
}

$reels = new Reels();

// ---------------------------------------------------------------------------
// DIQQAT: hajm chegarasidan OSHIB KETGAN so'rovlarni oldindan ushlaymiz.
//
// Nima uchun bu alohida kerak: agar so'rov post_max_size dan katta bo'lsa,
// PHP butun tanani TIQIB tashlaydi - $_POST va $_FILES BO'SH bo'lib qoladi.
// Foydalanuvchi esa "Fayl tanlanmagan" degan xatoni ko'radi va nega
// tanlagan fayli yuklanmaganini tushunmaydi. Bundayda $_SERVER dagi
// CONTENT_LENGTH biror qancha bayt yuborilganini hali ham ko'rsatadi.
$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
$postMax = ini_bytes(ini_get('post_max_size'));
$upMax   = ini_bytes(ini_get('upload_max_filesize'));
$hardMax = min($postMax, $upMax, REEL_MAX_UPLOAD_MB * 1024 * 1024);

if ($contentLength > 0 && $contentLength > $hardMax) {
    fail('Fayl juda katta (' . round($contentLength / 1048576, 1) . ' MB). '
         . 'Server chegarasi: ' . round($hardMax / 1048576) . ' MB.', 413);
}

// ---------------------------------------------------------------------------
// $_FILES bo'sh bo'lsa, sababni aniqlaymiz
$file = $_FILES['video'] ?? null;
if (!$file) {
    if ($contentLength > 0 && $contentLength > $postMax) {
        fail('Fayl server chegarasidan katta (post_max_size = '
             . ini_get('post_max_size') . ')', 413);
    }
    fail('Fayl tanlanmagan', 400);
}

$title = input('title', '', 200);
$descr = input('description', '', 500);

$result = $reels->createUpload($userId, $file, $title, $descr);

if (!$result['success']) {
    fail($result['message'], 400);
}

ok($result);
