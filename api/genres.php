<?php
// Janrlar ro'yxati (hamma uchun bir xil — uzoq kesh).
require_once __DIR__ . '/../includes/bootstrap.php';

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}
RateLimit::enforce('read');

$out = HttpCache::json(HttpCache::key('genres', [30]), 600, 300, function () use ($catalog) {
    return [
        'genres' => array_map(static fn($g) => [
            'id'    => (int) $g['id'],
            'name'  => $g['name'],
            'slug'  => $g['slug'],
            'count' => (int) $g['count'],
        ], $catalog->getGenres(30)),
    ];
});

Auth::ok($out);
