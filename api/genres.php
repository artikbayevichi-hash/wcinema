<?php
// Janrlar ro'yxati
require_once __DIR__ . '/../includes/bootstrap.php';

Auth::ok([
    'genres' => array_map(static fn($g) => [
        'id'    => (int) $g['id'],
        'name'  => $g['name'],
        'slug'  => $g['slug'],
        'count' => (int) $g['count'],
    ], $catalog->getGenres(30)),
]);
