<?php
// ============================================================================
// Davomiylikni AVTOMATIK to'ldirish.
// ----------------------------------------------------------------------------
// Serverda ffmpeg yo'q — davomiylikni brauzer <video> metadatasidan
// aniqlaydi va shu yerga yuboradi. Faqat bo'sh (NULL/0) qiymat to'ldiriladi;
// mavjud qiymat o'zgartirilmaydi (Catalog::saveDuration).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST so\'raladi', 405);
}

$contentId = contentIdInput();

$episodeId = inputInt('episode_id', 0);
if ($episodeId <= 0) {
    $episodeId = inputInt('episode', 0);
}

$duration = inputInt('duration', 0);
if ($duration <= 0) {
    $duration = inputInt('seconds', 0);
}

if ($contentId <= 0) {
    fail('content id kerak');
}
if ($duration <= 0) {
    fail('duration kerak');
}
if (!$catalog->getContent($contentId)) {
    fail('Kontent topilmadi', 404);
}

$catalog->saveDuration($contentId, $episodeId, $duration);

Auth::ok(['duration' => $duration]);
