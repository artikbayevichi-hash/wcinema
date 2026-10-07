<?php
// Katalog ro'yxati: kategoriya / janr / qidiruv / saralash / sahifa
require_once __DIR__ . '/../includes/bootstrap.php';

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

$opt = [
    'category_slug' => $category !== '' ? $category : null,
    'genre_id'      => $genreId > 0 ? $genreId : null,
    'search'        => $search !== '' ? $search : null,
    'sort'          => in_array($sort, ['new', 'popular', 'rating', 'az'], true) ? $sort : 'new',
    'limit'         => $perPage,
    'offset'        => ($page - 1) * $perPage,
    // Har yuklanishda tartib yangilanadi (RAND(seed)). Faqat "new" tartibda
    // qo'llanadi; aniq saralashlar (popular/rating/az) o'z ma'nosini saqlaydi.
    'seed'          => max(0, inputInt('seed', 0)),
];

$items = $catalog->listContent($opt);
$total = $catalog->countContent($opt);

Auth::ok([
    'items' => array_map(
        static fn($c) => $catalog->toPublicArray($c, $userId),
        $items
    ),
    'page'   => $page,
    'per_page' => $perPage,
    'total'  => $total,
    'has_more' => ($page * $perPage) < $total,
    'query'  => [
        'category' => $opt['category_slug'],
        'genre'    => $opt['genre_id'],
        'q'        => $opt['search'],
        'sort'     => $opt['sort'],
    ],
]);
