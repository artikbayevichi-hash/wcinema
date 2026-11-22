<?php
// Bosh sahifa feed: yangi (HOME_NEW_DAYS) birinchi, qolgani seed aralash.
// Cheksiz yuklash: app.js `?seed=&offset=&limit=` bilan sahifabop so'raydi;
// offset=0 da kategoriya/janr/statistika ham keladi.
//
// Kesh: FAQAT KONTENT qismi (kartochkalar, total, kategoriya, stat) 30 s
// keshda va hamma ulashadi. Ko'ruvchiga tegishli qismlar — bayroqlar,
// "ko'rilganlarni oxiriga surish" va "davom etish" — har so'rovda ustiga
// qo'yiladi. Shuning uchun login qilgan foydalanuvchilar ham tezlashadi,
// lekin keshda hech qanday shaxsiy ma'lumot saqlanmaydi.
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
$uid = (int) clientUserId();

$bucket    = HttpCache::seedBucket($seed);
$orderSeed = HttpCache::seedForBucket($bucket);

$computeBase = function () use ($catalog, $limit, $offset, $orderSeed) {
    // uid=0 bo'lsa "ko'rilgan" sharti hech qachon bajarilmaydi — natija
    // butunlay kontent-level bo'ladi va xavfsiz keshlanadi.
    $total = $catalog->countHomeFeed(0);
    $rows  = $catalog->getHomeFeed(0, $limit, $offset, $orderSeed);
    $items = array_map(
        static fn($c) => $catalog->toPublicArray($c, null),
        $rows
    );

    return [
        'categories' => $catalog->getCategories(),
        'genres'     => $catalog->getGenres(20),
        'stats'      => $catalog->getStats(),
        'feed'       => $items,
        'total'      => $total,
        'has_more'   => ($offset + count($items)) < $total,
        'seed'       => $orderSeed,
        'page_size'  => $limit,
        'continue'   => [],
    ];
};

$out = HttpCache::json(
    HttpCache::key('home', [$bucket, $offset, $limit]),
    30,
    30,
    $computeBase
);

if ($uid > 0) {
    // 1) Ko'rilgan kontent keshdagi tartibda ham oxiriga tushadi.
    $hidden = array_flip($catalog->homeHiddenIds($uid));
    if ($hidden) {
        $fresh = $seen = [];
        foreach ($out['feed'] as $it) {
            if (isset($hidden[(int) $it['id']])) {
                $seen[] = $it;
            } else {
                $fresh[] = $it;
            }
        }
        $out['feed'] = array_merge($fresh, $seen);
    }

    // 2) Faqat ko'ruvchiga tegishli bayroqlar.
    $out['feed'] = $catalog->viewerFlags($out['feed'], $uid);

    // 3) Davom etish ro'yxati butunlay shaxsiy — keshga kirmaydi.
    $continue = $catalog->getContinueWatching($uid, 10);
    $out['continue'] = array_map(static fn($r) => [
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
    ], $continue);

    HttpCache::privateNoStore();
}

Auth::ok($out);
