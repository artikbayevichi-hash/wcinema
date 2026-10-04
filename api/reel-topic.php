<?php
// ============================================================================
// api/reel-topic.php - reel uchun Telegram izohlar mavzusi (topic)
// ============================================================================
// Har bir reel uchun Telegram forum-guruhda alohida mavzu ochiladi. Izohlar
// o'sha mavzuda saqlanadi (serverda fayl saqlanmaydi).
//
// GET  ?id=N   -> mavjud topic id (bo'lmasa null). HECH NARSA OCHMAYDI.
// POST ?id=N   -> mavzuni ta'minlaydi (bo'lmasa bot orqali ochadi).
//
// Javob: { topic_id, chat, url, created }
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

$reelsObj = new Reels();
$id       = inputInt('id', 0);
$method   = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($id <= 0) {
    fail('id kerak');
}

if (TG_COMMENTS_CHAT === '') {
    // Telegram izohlari o'chirilgan - frontend eski (bazadagi) izohlarga
    // qaytishi uchun `disabled` qaytaramiz (xato emas).
    ok(['disabled' => true, 'topic_id' => null, 'chat' => '', 'url' => null]);
}

if ($method === 'POST') {
    $res = $reelsObj->ensureTopic($id);
    if (empty($res['success'])) {
        // Kutilgan holat (masalan guruhda Topics yoqilmagan / bot admin emas):
        // transport xatosi emas, shuning uchun HTTP 200 + `success:false`.
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
$topicId = $reelsObj->topicId($id);
ok([
    'disabled' => false,
    'topic_id' => $topicId,
    'chat'     => TG_COMMENTS_CHAT,
    'url'      => $topicId ? (rtrim(TG_COMMENTS_URL, '/') . '/' . $topicId) : null,
    'created'  => false,
]);
