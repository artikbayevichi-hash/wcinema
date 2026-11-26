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
// Yangi klientlar ANIQ holat yuboradi: in_watchlist=1 yoki 0 (action=add|
// remove ham qabul qilinadi). Bu qayta yuborishda tasodifan o'chib ketishning
// oldini oladi. Qiymat kelmasa - eski JS uchun toggle saqlanadi.
$want = null;
$in = (string) input('in_watchlist', '', 2);
if ($in === '1' || $in === '0') {
    $want = ($in === '1');
} else {
    $action = strtolower((string) input('action', '', 8));
    if ($action === 'add') $want = true;
    elseif ($action === 'remove') $want = false;
}
$result = $want === null
    ? $catalog->toggleWatchlist($contentId, $userId)
    : $catalog->setWatchlist($contentId, $userId, $want);
if (!$result['success']) {
    fail('Watchlistni yangilab bo\'lmadi');
}

Auth::ok([
    'added'        => $result['in_watchlist'],
    'in_watchlist' => $result['in_watchlist'],
]);
