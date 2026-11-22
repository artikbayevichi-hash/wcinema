<?php
// Katalog ro'yxati: kategoriya / janr / qidiruv / saralash / sahifa
require_once __DIR__ . '/../includes/bootstrap.php';

// Faqat o'qish — sessiya qulfini bo'shatamiz (parallel so'rovlar uchun).
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

RateLimit::enforce('read');

$category  = input('category', '', 50);
$genreId   = inputInt('genre');
$sort      = input('sort', 'new', 20);
$page      = max(1, inputInt('page', 1));

// DIQQAT: qidiruv va sahifa hajmi har doim IKKI nom bilan qabul qilinadi
// ("q"/"search", "per_page"/"limit"). Sababi - API chaqiruvchisi (JS yoki
// boshqa dastur) qaysi nomdan foydalanishini oldindan bilmaydi. Nomlar
// mos kelmaganda parametr butunlay jim qoladi va foydalanuvchi "qidiruv
// ishlamayapti" deb o'ylaydi - bu xato, ayniqsa sezgi bo'yicha.
$search  = input('q', '', 100);
if ($search === '') {
    $search = input('search', '', 100);
}

$perPage = inputInt('per_page', 0);
if ($perPage <= 0) {
    $perPage = inputInt('limit', 0);
}
$perPage = min(60, max(1, $perPage > 0 ? $perPage : CATALOG_PAGE_SIZE));

$sort = in_array($sort, ['new', 'popular', 'rating', 'az'], true) ? $sort : 'new';
$rawSeed = max(0, inputInt('seed', 0));
$bucket  = HttpCache::seedBucket($rawSeed);

$opt = [
    'category_slug' => $category !== '' ? $category : null,
    'genre_id'      => $genreId > 0 ? $genreId : null,
    'search'        => $search !== '' ? $search : null,
    'sort'          => $sort,
    'limit'         => $perPage,
    'offset'        => ($page - 1) * $perPage,
    // Har yuklanishda tartib yangilanadi (RAND(seed)). Faqat "new" tartibda
    // qo'llanadi. Bucket ichida seed barqaror — aks holda kesh ishlamaydi.
    'seed'          => HttpCache::seedForBucket($bucket),
];

// FAQAT KONTENT qismi keshlanadi: kartochkalar, total, sahifa ma'lumoti.
// Ko'ruvchiga tegishli bayroqlar keyin `viewerFlags()` bilan qo'yiladi.
$compute = function () use ($catalog, $opt, $perPage, $page) {
    $items = $catalog->listContent($opt);
    $total = $catalog->countContent($opt);

    return [
        'items' => array_map(
            static fn($c) => $catalog->toPublicArray($c, null),
            $items
        ),
        'page'     => $page,
        'per_page' => $perPage,
        'total'    => $total,
        'has_more' => ($page * $perPage) < $total,
        'query'    => [
            'category' => $opt['category_slug'],
            'genre'    => $opt['genre_id'],
            'q'        => $opt['search'],
            'sort'     => $opt['sort'],
        ],
    ];
};

// Kontent qismi hamma uchun bitta keshda (foydalanuvchiga bog'liq emas).
$out = HttpCache::json(
    HttpCache::key('catalog', [
        $opt['category_slug'], $opt['genre_id'], $opt['search'],
        $opt['sort'], $opt['limit'], $opt['offset'], $bucket,
    ]),
    60,
    60,
    $compute
);

// Kinolar / animelar / multfilmlar — bitta katalog API'si. Barcha
// tashrifchilar (login qilganlar ham) bir xil kontent keshidan foydalanadi;
// faqat ustiga shaxsiy bayroqlar qo'yiladi.
$viewerId = (int) ($userId ?: clientUserId());
if ($viewerId > 0) {
    $out['items'] = $catalog->viewerFlags($out['items'], $viewerId);
    HttpCache::privateNoStore();
}

Auth::ok($out);
