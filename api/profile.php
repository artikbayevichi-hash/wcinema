<?php
// ============================================================================
// api/profile.php - profil ma'lumotlari va Instagram-uslubidagi grid
// ============================================================================
//   GET ?user_id=N                            -> profil: user, stats, is_me
//   GET ?user_id=N&tab=reels&offset=0         -> qisqa vertikal videolar
//   GET ?user_id=N&tab=posts&offset=0         -> rasm postlar (galereya)
//   GET ?user_id=N&tab=videos&offset=0        -> uzun (16:9) videolar
//   GET ?user_id=N&tab=liked&offset=0         -> ko'ruvchi yoqqanlar (faqat o'zi)
//   GET ?tab=saved&offset=0                   -> saqlanganlar (faqat o'zi)
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

// Ko'ruvchi: sayt brauzerdagi MTProto orqali ishlaganda PHP sessiyasi
// bo'lmaydi, shuning uchun `tg_me` orqali aniqlaymiz (follow holati uchun).
if (!$userId) {
    $maybeViewer = (int) reelUserId();
    if ($maybeViewer > 0) {
        $userId = $maybeViewer;
    }
}
$isMe      = $userId && $profileId === (int) $userId;
$blocks    = new Blocks();

// Blok: bir tomon bo'lsa ham, profil ko'rinmaydi.
if ($userId && !$isMe && $blocks->isBlockedBetween($userId, $profileId)) {
    fail('Bu profil mavjud emas', 404);
}

// Maxfiylik: `is_private` profil — faqat kuzatuvchilar ko'radi.
$canView = true;
if (!$isMe) {
    $canView = $blocks->canViewProfileSafe($profileId, $userId ?: null);
}

// ===========================================================================
// Grid yorliqlari
// ===========================================================================
$tab = input('tab', '', 20);
if ($tab !== '') {
    $limit  = inputInt('limit', 30);
    $offset = inputInt('offset', 0);

    // Profil format yorliqlari — hammasi `reels` jadvalidan o'qiydi,
    // `format` maydoni orqali ajratiladi.
    if (in_array($tab, ['reels', 'posts', 'videos'], true)) {
        if (!$canView) {
            fail('Bu profil maxfiy', 403);
        }
        $format = ['posts' => 'post', 'videos' => 'video'][$tab] ?? 'reel';
        $items  = $reels->profileGrid($profileId, $userId, $isMe, $limit, $offset, $format);
        Auth::ok([
            'items'    => $items,
            'tab'      => $tab,
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

        // 1) Saqlangan REELS (bookmark) — Instagram'dagi "Saqlanganlar"
        //    bo'limining video qismi. Faqat birinchi sahifada (offset=0)
        //    qo'shamiz; keyingi sahifalar kontent (watchlist) davomi.
        $reelItems = [];
        if ($offset === 0) {
            foreach ($reels->savedGrid($userId, $limit) as $rr) {
                $rr['type'] = 'reel';
                $reelItems[] = $rr;
            }
        }

        // 2) Saqlangan KONTENT (watchlist).
        $rows  = $catalog->getWatchlist($userId, $limit + 1);
        $items = array_slice($rows, $offset, $limit);
        $out   = [];
        foreach ($items as $c) {
            $out[] = [
                'type'     => 'content',
                'id'       => (int) $c['id'],
                'title'    => $c['title'] ?? '',
                'poster'   => Catalog::posterSrc($c['poster'] ?? ''),
                'category' => $c['category_name'] ?? '',
                'added_at' => $c['added_at'] ?? '',
            ];
        }

        Auth::ok([
            'items'    => array_merge($reelItems, $out),
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

// Ko'ruvchi bu profilni kuzatayaptimi? (profil "Kuzatish" tugmasi uchun)
$isFollowing = false;
if ($userId && !$isMe) {
    $f = $dbAccess->fetchOne(
        "SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
        [$userId, $profileId]
    );
    $isFollowing = (bool) $f;
}

// Maxfiylik: kontent ko'rinmasa — statistikani ham ko'rsatmaymiz
// (aks holda "0 ta reels, 0 ko'rish" ma'lumoti profilni oshkor qiladi).
if (!$canView) {
    $stats = ['total' => 0, 'approved' => 0, 'views' => 0, 'likes' => 0, 'saved' => 0];
    $highlights = [];
}

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
        'is_private' => (int) ($profile['is_private'] ?? 0) === 1,
    ],
    'stats'      => $stats,
    'highlights' => $highlights,
    'is_me'      => $isMe,
    'following'  => $isFollowing,
    'is_admin'   => $userId ? $auth->isAdmin() : false,
    'viewer_id'  => $userId,
    'can_view'   => $canView,
    'is_private' => !$canView,
    'blocked'    => $userId && !$isMe ? $blocks->isBlockedBetween($userId, $profileId) : false,
]);