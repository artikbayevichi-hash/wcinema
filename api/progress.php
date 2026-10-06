<?php
// Ko'rish progressini saqlash (davomiylik - qayerda to'xtaganingiz)
require_once __DIR__ . '/../includes/bootstrap.php';

// Foydalanuvchi PHP sessiyasidan YOKI brauzerdagi MTProto (`tg_me`) dan
// aniqlanadi - davomiylik ("qayerda to'xtagansiz") MTProto foydalanuvchisi
// uchun ham saqlanishi kerak.
$userId = clientUserId();
if ($userId <= 0) {
    Auth::fail('Avval tizimga kiring', 401);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST so\'raladi', 405);
}

$contentId = inputInt('content_id');
if ($contentId <= 0) {
    $contentId = inputInt('id', 0);
}

$episodeId = inputInt('episode_id');
if ($episodeId <= 0) {
    $episodeId = inputInt('episode', 0);
}

// "position" va "seconds" - bir xil narsa (video oqimida necha sekund
// ko'rilgan). Ikkalasini ham qabul qilamiz: chaqiruvchilar turli nomlarni
// ishlatadi, nom mos kelmasa esa progress jimgina 0 saqlanadi - ya'ni
// "davom etish" ishi butunlay buziladi, xato esa ko'rinmaydi.
$position = inputInt('position', -1);
if ($position < 0) {
    $position = inputInt('seconds', -1);
}
if ($position < 0) {
    $position = 0;
}

$duration = inputInt('duration');

if ($contentId <= 0) {
    fail('content_id kerak');
}
if (!$catalog->getContent($contentId)) {
    fail('Kontent topilmadi', 404);
}

$result = $catalog->saveProgress($userId, $contentId, $episodeId, $position, $duration);
if (!$result['success']) {
    fail($result['message'] ?? 'Progress saqlanmadi');
}

Auth::ok([
    'position'     => $position,
    'duration'     => $duration,
    'is_completed' => (bool) $result['is_completed'],
]);
