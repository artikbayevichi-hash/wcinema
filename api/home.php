<?php
// Bosh sahifa feed: yangi (HOME_NEW_DAYS) birinchi, qolgani seed aralash.
// Cheksiz yuklash: app.js `?seed=&offset=&limit=` bilan sahifabop so'raydi;
// offset=0 da kategoriya/janr/statistika ham keladi.
require_once __DIR__ . '/../includes/bootstrap.php';

// Feed faqat o'qish — sessiya qulfini bo'shatamiz.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

RateLimit::enforce('read');

$seed   = inputInt('seed');
$offset = max(0, inputInt('offset'));
$limit  = inputInt('limit', HOME_PAGE_SIZE);
if ($limit <= 0 || $limit > 60) {
    $limit = HOME_PAGE_SIZE;
}

// MTProto (brauzer) foydalanuvchilari ham yashirishdan foydalanadi:
// PHP sessiyasi bo'lmasa, brauzerdagi akkaunt (tg_me) orqali aniqlanadi.
$uid = clientUserId();

$compute = function () use ($catalog, $uid, $limit, $offset, $seed) {
    $total = $catalog->countHomeFeed($uid);
    $rows  = $catalog->getHomeFeed($uid, $limit, $offset, $seed);
    $items = array_map(
        static fn($c) => $catalog->toPublicArray($c, $uid),
        $rows
    );

    $continue = $uid ? $catalog->getContinueWatching($uid, 10) : [];

    return [
        'categories' => $catalog->getCategories(),
        'genres'     => $catalog->getGenres(20),
        'stats'      => $catalog->getStats(),
        'feed'       => $items,
        'total'      => $total,
        'has_more'   => ($offset + count($items)) < $total,
        'seed'       => $seed,
        'page_size'  => $limit,
        'continue'   => array_map(static fn($r) => [
            'id'         => (int) $r['content_id'],
            'content_id' => (int) $r['content_id'],
            'episode_id' => (int) $r['episode_id'],
            'title'      => $r['title'],
            'poster'     => Catalog::autoPoster(
                $r['poster'] ?? null,
                $r['title'] ?? '',
                $r['category_slug'] ?? '',
                $r['category_name'] ?? ''
            ),
            'category'   => $r['category_name'] ?? 'film',
            'position'   => (int) $r['position_seconds'],
            'duration'   => (int) $r['duration_seconds'],
            'percent'    => $r['duration_seconds'] > 0
                ? (int) round($r['position_seconds'] / $r['duration_seconds'] * 100)
                : 0,
        ], $continue),
    ];
};

// Anonim tashrifchilar uchun 30 soniyalik kesh (minglab tashrif = bitta so'rov).
if ($uid === 0) {
    $out = HttpCache::json(
        HttpCache::key('home', [$seed, $offset, $limit]),
        30,
        30,
        $compute
    );
} else {
    HttpCache::privateNoStore();
    $out = $compute();
}

Auth::ok($out);