<?php
// ============================================================================
// api/reel-create.php - "virtual reel" (bo'lak) yaratish
// ============================================================================
// Player ichidagi "✂️ Reels yaratish" tugmasi shu yerga yuboradi.
//
// MUHIM: bu yerda FAYL SAQLANMAYDI. Faqat content_id/episode_id +
// start_time/end_time yoziladi. Shu sabab 1000 ta bo'lak yaratilsa ham
// disk egallamaydi va trafik sarflanmaydi.
//
// POST: content_id (yoki id), episode_id (yoki episode), start, end,
//       title?, description?
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

// PHP sessiya bo'lmasa (MTProto), foydalanuvchini brauzer yuborgan
// `tg_me` dan topamiz/yaratamiz — reels yaratish hammaga ochiq.
$userId = reelUserId();
if ($userId <= 0) {
    fail('Foydalanuvchi aniqlanmadi. Sahifani yangilab, qayta urinib ko‘ring.', 401);
}

$reels = new Reels();

$contentId = contentIdInput();

// DIQQAT: ikkala nom ham qabul qilinadi ("episode" va "episode_id").
// Sababi: butun API da "id" ikki ma'noda ishlatilgan (content uchun ham,
// episode uchun ham) - bu chalkashtiradi. Chaqiruvchi bitta nomni
// yuborsa, bo'lak "butun film"dan yaratilgan bo'lib chiqadi va
// keyin CTA boshqa joyni ochadi. Jimgina xato o'rniga ikkala nomni
// ham qabul qilamiz.
$episodeId = inputInt('episode_id', 0);
if ($episodeId <= 0) {
    $episodeId = inputInt('episode', 0);
}

$start     = inputInt('start');
$end       = inputInt('end');
$title     = input('title', '', 200);
$descr     = input('description', '', 500);

// --- id bor-yo'qligini aniq aytamiz (jimgina "bo'lak yaratib bo'lmaydi"
//     emas - foydalanuvchi qayerda xato qilganini bilishi kerak)
if ($contentId <= 0 && $episodeId <= 0) {
    fail('content_id yoki episode_id kerak', 400);
}

// --- hisobni tekshirish: end > start
if ($end <= $start) {
    fail('Tugash vaqti boshlanishdan keyin bo‘lishi kerak', 400);
}

$result = $reels->createClip($userId, $contentId, $episodeId, $start, $end, $title, $descr);

if (!$result['success']) {
    fail($result['message'], 400);
}

ok($result);
