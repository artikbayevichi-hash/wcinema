<?php
// Boshlang'ich ekran: mashhur, yangi, kategoriya bo'yicha, davom etish
require_once __DIR__ . '/../includes/bootstrap.php';

$home = $catalog->getHomeSections();
$continue = $userId ? $catalog->getContinueWatching($userId, 10) : [];

$map = static function ($rows) use ($catalog, $userId) {
    return array_map(
        static fn($c) => $catalog->toPublicArray($c, $userId),
        $rows
    );
};

Auth::ok([
    // Kategoriyalar va janrlar dinamik yuboriladi (JS da qattiq yozilmaydi).
    // Sababi: admin bazaga yangi kategoriya qo'shsa, interfeys ham o'zi
    // ko'rsatishi kerak - kino-bot uslubidagi moslashuvchan katalog.
    'categories' => $catalog->getCategories(),
    'genres'     => $catalog->getGenres(20),
    'stats'     => $catalog->getStats(),
    'trending'  => $map($home['trending']),
    'new'       => $map($home['new']),
    'continue'  => array_map(static fn($r) => [
        'content_id' => (int) $r['content_id'],
        'episode_id' => (int) $r['episode_id'],
        'title'      => $r['title'],
        'poster'     => Catalog::posterSrc($r['poster']),
        'slug'       => $r['slug'],
        'category'   => $r['category_name'],
        'position'   => (int) $r['position_seconds'],
        'duration'   => (int) $r['duration_seconds'],
        'percent'    => $r['duration_seconds'] > 0
            ? (int) round($r['position_seconds'] / $r['duration_seconds'] * 100)
            : 0,
    ], $continue),
    'by_category' => array_map(static fn($g) => [
        'category' => [
            'id'   => (int) $g['category']['id'],
            'name' => $g['category']['name'],
            'slug' => $g['category']['slug'],
        ],
        'items' => $map($g['items']),
    ], $home['by_category'] ?? []),
]);
