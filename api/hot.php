<?php
// ============================================================================
// api/hot.php — eng ko'p ko'rilgan videolar ro'yxati (fon prefetch uchun)
// ----------------------------------------------------------------------------
// Nima uchun kerak: "issiq start" uchun eng ko'p ochiladigan videolarning
// metama'lumoti (kanal + post) oldindan tayyor turishi kerak. Ro'yxat
// `content.views` bo'yicha tartiblanadi — Zipf qonuni: 1-2% kontent
// ko'rishlarning ~80% ini oladi.
//
// Javob (faqat metama'lumot, Telegram'ga murojaat YO'Q):
//   { success:true, items:[{c,e,channel,post,duration,views,title}] }
//
// Keshlash: 5 daqiqa, `storage/cache/hot-<n>.json`. Har bir sahifa ochilishida
// DB ga bir xil so'rov yubormaslik uchun.
//
//   GET ?n=30          — nechta element (1..100, default 30)
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';

$n = inputInt('n', 30);
$n = max(1, min(100, $n));

$cacheDir  = dirname(__DIR__) . '/storage/cache';
$cacheFile = $cacheDir . '/hot-' . $n . '.json';
$ttl       = 300;

if (is_file($cacheFile) && (time() - (int) @filemtime($cacheFile)) < $ttl) {
    $raw = @file_get_contents($cacheFile);
    if ($raw !== false) {
        $data = json_decode($raw, true);
        if (is_array($data) && isset($data['items'])) {
            ok($data);
        }
    }
}

$db = Database::getInstance();

// Har bir kontent uchun BIRINCHI qism (serial bo'lsa 1-mavsum 1-qism).
// `video_url_1080p` / `_720p` bo'lsa — sifatlisi ustun.
$rows = $db->fetchAll(
    "SELECT c.id AS cid, c.title, c.views, c.duration,
            e.id AS eid, e.video_url, e.video_url_720p, e.video_url_1080p
       FROM content c
       JOIN episodes e ON e.content_id = c.id
      WHERE c.status = 'published'
        AND (c.is_premium = 0 OR c.is_premium IS NULL)
        AND (e.video_url LIKE '%t.me/%' OR e.video_url_720p LIKE '%t.me/%'
             OR e.video_url_1080p LIKE '%t.me/%')
        AND e.season = (SELECT MIN(e2.season) FROM episodes e2 WHERE e2.content_id = c.id)
        AND e.episode_number = (
              SELECT MIN(e3.episode_number) FROM episodes e3
               WHERE e3.content_id = c.id AND e3.season = e.season)
      ORDER BY c.views DESC, c.id DESC
      LIMIT " . (int) $n
);

$items = [];
foreach ($rows as $r) {
    $url = trim((string) ($r['video_url_1080p'] ?: ($r['video_url_720p'] ?: $r['video_url'])));
    if ($url === '') continue;

    $ref = Catalog::tgRef($url);
    if (empty($ref['channel']) || empty($ref['post'])) continue;

    $items[] = [
        'c'        => (int) $r['cid'],
        'e'        => (int) $r['eid'],
        'channel'  => '@' . ltrim((string) $ref['channel'], '@'),
        'post'     => (int) $ref['post'],
        'duration' => (int) $r['duration'],
        'views'    => (int) $r['views'],
        'title'    => (string) $r['title'],
    ];
}

$out = ['success' => true, 'items' => $items, 'ts' => time()];

if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
if (is_dir($cacheDir) && is_writable($cacheDir)) {
    @file_put_contents($cacheFile, json_encode($out, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

ok($out);
