<?php
// ============================================================================
// api/video-topic.php - video (episode) uchun Telegram izohlar mavzusi
// ============================================================================
// `api/reel-topic.php` ning ko'rish sahifasi uchun muqobili. Farq faqat
// kalitda: reels o'rniga `episodes.id` va boshqa jadval (`tg_topics`).
//
// GET  ?id=N   -> mavjud topic id (bo'lmasa null). HECH NARSA OCHMAYDI.
// POST ?id=N   -> mavzuni ta'minlaydi (bo'lmasa bot orqali ochadi).
//
// `id` = episodes.id (video). Mavzu nomi kinoning nomi + qism raqamidan
// yig'iladi, shuning uchun Telegram'dagi mavzu ro'yxati o'qilishi oson.
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

// Video mavjudligini tekshiramiz - mavzu nomi uchun kino sarlavhasi kerak.
$catalog = new Catalog();
$episode = $catalog->getEpisode($id);
if (!$episode) {
    fail('Video topilmadi', 404);
}

if (!defined('TG_COMMENTS_CHAT') || TG_COMMENTS_CHAT === '') {
    // Telegram izohlari o'chirilgan - frontend bunda jim qoladi (xato emas).
    ok(['success' => false, 'disabled' => true, 'topic_id' => null, 'chat' => '', 'url' => null]);
}

$scope = TgTopics::SCOPE_VIDEO;

// Mavzu nomi: "🎬 Kino nomi" yoki "✨ Anime nomi" + " · 3-qism".
$name = trim((string) ($episode['content_title'] ?? ''));
if ($name === '') {
    $name = 'Video #' . $id;
}
$season   = (int) ($episode['season'] ?? 1);
$number   = (int) ($episode['episode_number'] ?? 0);
$epTitle  = trim((string) ($episode['title'] ?? ''));
if ($number > 0) {
    $name .= ' · ' . $season . '-fasl ' . $number . '-qism';
} elseif ($epTitle !== '') {
    $name .= ' · ' . $epTitle;
}

if ($method === 'POST') {
    $res = $topics->ensure($scope, $id, $name);
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
$topicId = $topics->topicId($scope, $id);
ok([
    'disabled' => false,
    'topic_id' => $topicId,
    'chat'     => TG_COMMENTS_CHAT,
    'url'      => $topicId ? $topics->url($topicId) : null,
    'created'  => false,
]);