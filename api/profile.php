<?php
// ============================================================================
// api/profile.php - profil ma'lumotlari va Instagram-uslubidagi grid
// ============================================================================
//   GET ?user_id=N                       -> profil: user, stats, highlights, is_me
//   GET ?user_id=N&tab=reels&offset=0    -> reels grid
//   GET ?user_id=N&tab=liked&offset=0    -> ko'ruvchi yoqqanlar (faqat o'zi)
//   GET ?tab=saved&offset=0              -> saqlanganlar (watchlist, faqat o'zi)
//
// O'z profilining "liked"/"saved" yorliqlari boshqa foydalanuvchi ko'riyotganda
// yashiriladi (Instagram prinsipi: boshqalarning yoqqanlari ko'rinmaydi).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$requestedId = inputInt('user_id', 0);

// Profil egasi: ko'rsatilmagan bo'lsa - joriy foydalanuvchi (login shart)
$dbAccess = Database::getInstance();
if ($requestedId > 0) {
    $profile = $dbAccess->fetchOne("SELECT * FROM users WHERE id = ? LIMIT 1", [$requestedId]);
} else {
    if (!$userId) {
        fail('Telegram orqali kiring', 401);
    }
    $profile = $user;
}

if (!$profile) {
    fail('Profil topilmadi', 404);
}

$profileId = (int) $profile['id'];
$isMe      = $userId && $profileId === $userId;

// ===========================================================================
// Grid yorliqlari
// ===========================================================================
$tab = input('tab', '', 20);
if ($tab !== '') {
    $limit  = inputInt('limit', 30);
    $offset = inputInt('offset', 0);

    // DIQQAT: Auth::ok() / fail() chiqishni TUGATADI (exit). Shuning uchun
    // har bir yorliq o'z blokida mustaqil yakunlanadi - fall-through yo'q.
    if ($tab === 'reels') {
        $items = $reels->profileGrid($profileId, $userId, $isMe, $limit, $offset);
        Auth::ok([
            'items'    => $items,
            'tab'      => 'reels',
            'has_more' => count($items) === $limit,
            'offset'   => $offset,
        ]);
    }

    if ($tab === 'liked') {
        if (!$userId) {
            fail('Telegram orqali kiring', 401);
        }
        if (!$isMe) {
            fail('Boshqa foydalanuvchining yoqqanlari ko\'rinmaydi', 403);
        }
        $items = $reels->likedGrid($userId, $limit, $offset);
        Auth::ok([
            'items'    => $items,
            'tab'      => 'liked',
            'has_more' => count($items) === $limit,
            'offset'   => $offset,
        ]);
    }

    if ($tab === 'saved') {
        if (!$userId) {
            fail('Telegram orqali kiring', 401);
        }
        if (!$isMe) {
            fail('Bu yorliq faqat o\'z profilingizda ko\'rinadi', 403);
        }
        $rows  = $catalog->getWatchlist($userId, $limit + 1);
        $items = array_slice($rows, $offset, $limit);
        $out   = [];
        foreach ($items as $c) {
            $out[] = [
                'id'       => (int) $c['id'],
                'title'    => $c['title'] ?? '',
                'poster'   => Catalog::posterSrc($c['poster'] ?? ''),
                'category' => $c['category_name'] ?? '',
                'added_at' => $c['added_at'] ?? '',
            ];
        }
        Auth::ok([
            'items'    => $out,
            'tab'      => 'saved',
            'has_more' => count($rows) > ($offset + count($out)),
            'offset'   => $offset,
        ]);
    }

    fail('Noma\'lum yorliq', 400);
}

// ===========================================================================
// Profil sarlavhasi (user + stats + highlights)
// ===========================================================================
$stats     = $reels->profileStats($profileId);
$highlights = $isMe ? $reels->highlights($profileId) : [];

Auth::ok([
    'user' => [
        'id'         => $profileId,
        'user_id'    => $profile['user_id'] ?? null,
        'first_name' => $profile['first_name'] ?? 'Foydalanuvchi',
        'last_name'  => $profile['last_name'] ?? '',
        'username'   => $profile['username'] ?? null,
        'avatar'     => $profile['avatar'] ?? null,
        'bio'        => $profile['bio'] ?? '',
        'premium'    => (int) ($profile['is_premium'] ?? 0),
        'created_at' => $profile['created_at'] ?? null,
    ],
    'stats'      => $stats,
    'highlights' => $highlights,
    'is_me'      => $isMe,
    'is_admin'   => $userId ? $auth->isAdmin() : false,
    'viewer_id'  => $userId,
]);