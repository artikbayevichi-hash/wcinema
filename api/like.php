<?php
// ============================================================================
// like.php - kontentga yoqish / yoqishni bekor qilish
//
// DIQQAT: GET va POST turli vazifani bajaradi:
//   GET  ?id=N  -> hozirgi holatni O'QISH (hech narsa o'zgartirmaydi)
//   POST id=N   -> YOQISH / BEKOR QILISH (holatni o'zgartiradi)
//
// Bu farq muhim: agar GET ham o'zgartirsa, foydalanuvchi linkni oldindan
// ochsa ("prefetch") yoki saytga begona sayt ishlatib CSRF hujjum qilsa,
// tasodifiy ravishda yoqish bosiladi. O'zgarish faqat POST bilan.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

requireUser();

$contentId = contentIdInput();
if ($contentId <= 0) {
    fail('content id kerak');
}
if (!$catalog->getContent($contentId)) {
    fail('Kontent topilmadi', 404);
}

// --- O'qish (GET): hech narsani o'zgartirmaydi
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $count = $catalog->getLikeCount($contentId);
    Auth::ok([
        // DIQQAT: hasLiked() argument tartibi (userId, contentId)
        'liked'       => $catalog->hasLiked($userId, $contentId),
        'likes'       => $count,
        'likes_count' => $count,
    ]);
}

// --- O'zgartirish (POST)
$result = $catalog->toggleLike($contentId, $userId);
if (!$result['success']) {
    fail($result['message'] ?? 'Like muvaffaqiyatsiz');
}

$count = $catalog->getLikeCount($contentId);

Auth::ok([
    'liked'       => $result['liked'],
    'likes'       => $count,
    'likes_count' => $count,
]);
