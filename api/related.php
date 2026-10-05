<?php
// ============================================================================
// related.php - Yon paneldagi tavsiyalar (YouTube uslubidagi lazy load)
// ============================================================================
// YouTube'da o'ng panel bitta marta to'lib qolmaydi: foydalanuvchi pastga
// tushgan sayin keyingi qismlar yuklanadi. Shu sababli `watch.php` dastlab
// faqat BIR sahifa (RELATED_PAGE_SIZE ta) tavsiya yuboradi, qolgani shu
// endpoint orqali keladi. Bu sahifa tez ochilishini ham, "pastga tushsa
// shuncha yuklanadi" taassurotini ham beradi.
//
//   GET ?id=CONTENT_ID[&offset=5][&limit=5]
//       -> { items: [...], offset, limit, has_more }
//
// `has_more` qanday aniqlanadi: so'rov `limit + 1` qator bilan yuboriladi
// (bitta qorteksiya). Qo'shimcha qator bo'lsa - yana sahifa bor. Shu usul
// `COUNT(*)` qo'shimcha so'rovsiz ishlaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

// Bu endpoint OCHIQ (login shart emas): tavsiyalar hamma uchun bir xil.
$contentId = contentIdInput();
if ($contentId <= 0) {
    Auth::fail('Kontent topilmadi', 404);
}

$item = $catalog->getContent($contentId);
if (!$item) {
    Auth::fail('Kontent topilmadi', 404);
}

$limit = inputInt('limit', 0);
if ($limit <= 0) {
    $limit = RELATED_PAGE_SIZE;
}
$limit  = max(1, min(24, $limit));
$offset = max(0, inputInt('offset', 0));

$rows = $catalog->getRelated($item, $limit + 1, $offset);
$hasMore = count($rows) > $limit;
if ($hasMore) {
    array_pop($rows);
}

Auth::ok([
    'items'    => array_map(static fn($c) => $catalog->toPublicArray($c, $userId), $rows),
    'offset'   => $offset,
    'limit'    => $limit,
    'has_more' => $hasMore,
]);
