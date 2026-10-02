<?php
// ============================================================================
// api/reel-authors.php - "Top Authors" reytingi
// ============================================================================
// GET ?sort=all|mine&limit=10
//   all  - barcha mualliflar (faqat tasdiqlangan reels bo'yicha)
//   mine - joriy foydalanuvchi + uning o'rni
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

$reels  = new Reels();
$sort   = input('sort', 'all', 20);
$limit  = inputInt('limit', 10);

if ($sort === 'mine') {
    if (!$userId) {
        fail('Telegram orqali kiring', 401);
    }
    $all  = $reels->topAuthors(50);
    $mine = null;
    $pos  = null;
    foreach ($all as $a) {
        if ((int) $a['user_id'] === (int) $userId) {
            $mine = $a;
            $pos  = $a['rank'];
            break;
        }
    }

    // Top 50 da yo'q bo'lsa, foydalanuvchining o'z statistikasini
    // ko'rsatamiz - "reytingda yo'q" degani demotivatsiyani pasaytiradi.
    if ($mine === null) {
        $st = $reels->authorStats($userId);
        $mine = [
            'rank' => 0, 'user_id' => (int) $userId,
            'username' => $user['username'] ?? null,
            'name' => $user['first_name'] ?? 'Siz',
            'avatar' => $user['avatar'] ?? null,
            'reels' => $st['approved'], 'views' => $st['views'], 'likes' => $st['likes'],
            'score' => $st['views'] + $st['likes'] * 5 + $st['approved'] * 20,
        ];
        $pos = 'top 50 dan tashqarida';
    }

    ok([
        'users' => [$mine],
        'position' => $pos,
        'total' => count($all),
    ]);
}

ok([
    'users' => $reels->topAuthors($limit),
    'stats' => $userId ? $reels->authorStats($userId) : null,
]);
