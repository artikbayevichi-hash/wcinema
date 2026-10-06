<?php
// ============================================================================
// like.php - kontentga yoqish / YOQMASLIK va bularni bekor qilish
//
// DIQQAT: GET va POST turli vazifani bajaradi:
//   GET  ?id=N             -> hozirgi holatni O'QISH (hech narsa o'zgartirmaydi)
//   POST id=N [&type=...]  -> BAHOLASH / BEKOR QILISH (holatni o'zgartiradi)
//
// `type` = `like` (yoqdi) | `dislike` (yoqmadi). Berilmasa `like`.
//
// YouTube qoidasi (Catalog::toggleVote ham shunday):
//   · xuddi shu tugma yana bosilsa  -> bekor qilinadi (qator o'chadi);
//   · qarama-qarshi tugma bosilsa -> almashtiriladi (bitta qator qoladi).
// Demak bitta odam bitta videoni ham yoqib ham yoqmay qolmaydi.
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

$type = (string) (input('type', '', 10));
if ($type !== 'dislike') {
    $type = 'like';
}

// --- O'qish (GET): hech narsani o'zgartirmaydi
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $likes = $catalog->getLikeCount($contentId);
    Auth::ok([
        // DIQQAT: hasLiked()/hasDisliked() argument tartibi (userId, contentId)
        'liked'       => $catalog->hasLiked($userId, $contentId),
        'disliked'    => $catalog->hasDisliked($userId, $contentId),
        'likes'       => $likes,
        'likes_count' => $likes,
        'dislikes'    => $catalog->getDislikeCount($contentId),
    ]);
}

// --- O'zgartirish (POST)
$result = $catalog->toggleVote($contentId, $userId, $type);
if (!$result['success']) {
    fail($result['message'] ?? 'Baho muvaffaqiyatsiz');
}

Auth::ok([
    'liked'       => (bool) $result['liked'],
    'disliked'    => (bool) $result['disliked'],
    'likes'       => (int) $result['likes'],
    'likes_count' => (int) $result['likes'],
    'dislikes'    => (int) $result['dislikes'],
]);
