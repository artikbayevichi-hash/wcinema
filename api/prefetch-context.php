<?php
// ============================================================================
// api/prefetch-context.php - karta hover'ida oldindan tayyorlash uchun manzil
// ============================================================================
// Faqat METAMA'LUMOT qaytaradi (Telegram'ga murojaat qilmaydi):
//   GET ?c=<content_id>[&e=<episode_id>]
//   -> { success, channel:"@kanal", post:123, url:"https://t.me/..." }
//
// Nima uchun: foydalanuvchi karta ustiga sichqoncha olib kelganda (yoki
// barmog'i bilan bosganda) `tg-stream.js` kanal/xabarni oldindan topib
// qo'yadi — haqiqiy bosishda video DARHOL ochiladi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$c = inputInt('c', 0);
$e = inputInt('e', 0);

if ($c <= 0 && $e <= 0) {
    fail('c yoki e kerak', 400);
}

$db = Database::getInstance();
$row = null;

if ($e > 0) {
    $row = $db->fetchOne(
        "SELECT content_id, video_url, video_url_720p, video_url_1080p
           FROM episodes WHERE id = ? LIMIT 1",
        [$e]
    );
} else {
    // Serial bo'lsa — birinchi qism; kino bo'lsa — yagona qism.
    $row = $db->fetchOne(
        "SELECT content_id, video_url, video_url_720p, video_url_1080p
           FROM episodes WHERE content_id = ?
          ORDER BY season ASC, episode_number ASC, id ASC LIMIT 1",
        [$c]
    );
}

if (!$row) {
    fail('Manba topilmadi', 404);
}

$url = trim((string) ($row['video_url_1080p'] ?: ($row['video_url_720p'] ?: $row['video_url'])));
if ($url === '' || !preg_match('#t\.me/(?:s/)?([A-Za-z0-9_]+)/(\d+)#', $url, $m)) {
    ok(['telegram' => false]);
}

ok([
    'telegram' => true,
    'channel'  => '@' . $m[1],
    'post'     => (int) $m[2],
    'url'      => $url,
    'content'  => (int) ($row['content_id'] ?? $c),
]);
