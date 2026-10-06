<?php
// ============================================================================
// watchlist.php - kutubxona (saqlanganlar)
//
//   GET           -> RO'YXAT (foydalanuvchining barcha saqlaganlari)
//   GET  ?id=N    -> shu kontent saqlanganmi? (o'qish, o'zgartirmaydi)
//   POST id=N     -> qo'shish / olib tashlash
//
// like.php kabi: o'zgarish faqat POST bilan. Aks holda "prefetch" yoki
// CSRF orqali foydalanuvchining kutubxonasi tasodifan o'zgarib ketadi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

// Foydalanuvchi PHP sessiyasidan YOKI brauzerdagi MTProto (`tg_me`) dan
// aniqlanadi (like.php bilan bir xil) - MTProto foydalanuvchisi ham
// kutubxonaga qo'sha olishi kerak.
$userId = clientUserId();
if ($userId <= 0) {
    Auth::fail('Avval tizimga kiring', 401);
}

$contentId = contentIdInput();

// --- Ro'yxatni olish (id berilmagan)
if ($contentId <= 0) {
    $items = array_map(
        static fn($c) => $catalog->toPublicArray($c, $userId),
        $catalog->getWatchlist($userId, 100)
    );
    Auth::ok(['items' => $items, 'total' => count($items)]);
}

if (!$catalog->getContent($contentId)) {
    fail('Kontent topilmadi', 404);
}

// --- Bitta kontentning holati (GET, o'qish)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Auth::ok([
        'in_watchlist' => $catalog->inWatchlist($userId, $contentId),
    ]);
}

// --- O'zgartirish (POST)
$result = $catalog->toggleWatchlist($contentId, $userId);
if (!$result['success']) {
    fail('Watchlistni yangilab bo\'lmadi');
}

Auth::ok([
    'added'        => $result['in_watchlist'],
    'in_watchlist' => $result['in_watchlist'],
]);
