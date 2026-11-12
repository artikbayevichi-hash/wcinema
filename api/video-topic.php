<?php
// ============================================================================
// api/video-topic.php - video uchun Telegram izohlar mavzusi
// ============================================================================
// `api/reel-topic.php` ning ko'rish sahifasi uchun muqobili.
//
// KALIT: `content.id` (kino/serial), `episodes.id` EMAS.
//   Ilgari har bir qism uchun alohida mavzu ochilardi: anime'ning 12 qismi =
//   12 topic. Endi 1, 2, 3... qismlar BITTA mavzuni bo'lishadi - izohlar bir
//   joyda yig'iladi va Telegram'dagi mavzu ro'yxati qisqa bo'ladi.
//
//   `scope = content` ATAYIN ajratilgan: `scope = video` (eski kalit) da
//   `item_id` = `episodes.id`, ya'ni 41 degan qiymat ham content 41, ham
//   episode 41 bo'lishi mumkin edi. Alohida scope to'qnashuvni yo'q qiladi.
//
// GET  ?id=N   -> mavjud topic id (bo'lmasa null). HECH NARSA OCHMAYDI.
// POST ?id=N   -> mavzuni ta'minlaydi (bo'lmasa bot orqali ochadi).
//
// `id` = episodes.id (frontend shu id'ni yuboradi) - shu orqali kontent
// aniqlanadi.
//
// Javob: { success, disabled, topic_id, chat, url, created, message? }
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$topics = new TgTopics();
$id     = inputInt('id', 0);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($id <= 0) {
    fail('id kerak');
}

// Qism mavjudligini tekshiramiz - u orqali kontent (mavzu kaliti) topiladi.
$catalog = new Catalog();
$episode = $catalog->getEpisode($id);
if (!$episode) {
    fail('Video topilmadi', 404);
}

$contentId = (int) ($episode['content_id'] ?? 0);
if ($contentId <= 0) {
    fail('Video topilmadi', 404);
}

if (!defined('TG_COMMENTS_CHAT') || TG_COMMENTS_CHAT === '') {
    // Telegram izohlari o'chirilgan - frontend bunda jim qoladi (xato emas).
    ok(['success' => false, 'disabled' => true, 'topic_id' => null, 'chat' => '', 'url' => null]);
}

// Mavzu yaratish Telegram API resursidan foydalanadi. O'qish (GET) anonim
// qolishi mumkin, ammo yangi topic ochish faqat server tanigan sessiya yoki
// imzolangan client-session egasiga ruxsat etiladi.
if ($method === 'POST' && clientUserId() <= 0) {
    fail('Kommentariya mavzusini yaratish uchun tizimga kiring', 401);
}

$scope = TgTopics::SCOPE_CONTENT;

// Mavzu nomi: FAQAT kontent nomi. Qism raqami qo'shilmaydi - chunki mavzu
// barcha qismlar uchun umumiy.
$name = trim((string) ($episode['content_title'] ?? ''));
if ($name === '') {
    $name = 'Kontent #' . $contentId;
}

// Eski qism-mavzulari (scope=video) dan meros. Bu DUBLIKAT topic ochilishini
// to'xtatadi: ilgari 1-qism uchun topic bor bo'lsa, endi o'sha ishlatiladi.
$episodeIds = [];
foreach ($catalog->getEpisodes($contentId) as $e) {
    $episodeIds[] = (int) ($e['id'] ?? 0);
}
$topicId = $topics->adopt($scope, $contentId, TgTopics::SCOPE_VIDEO, $episodeIds);

if ($method === 'POST') {
    $res = $topics->ensure($scope, $contentId, $name);
    if (empty($res['success'])) {
        // Kutilgan holat (Topics yoqilmagan / bot admin emas) - transport
        // xatosi emas, shuning uchun HTTP 200 + `success:false`.
        ok([
            'success'  => false,
            'disabled' => false,
            'topic_id' => null,
            'message'  => $res['message'] ?? 'Mavzu ochilmadi',
        ]);
    }
    ok([
        'success'  => true,
        'disabled' => false,
        'topic_id' => (int) $res['topic_id'],
        'chat'     => $res['chat'],
        'url'      => $res['url'],
        'created'  => !empty($res['created']),
    ]);
}

// GET - faqat mavjudini o'qish.
if (!$topicId) {
    $topicId = $topics->topicId($scope, $contentId);
}
ok([
    'disabled' => false,
    'topic_id' => $topicId,
    'chat'     => TG_COMMENTS_CHAT,
    'url'      => $topicId ? $topics->url($topicId) : null,
    'created'  => false,
]);
