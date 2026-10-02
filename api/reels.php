<?php
// ============================================================================
// api/reels.php - reels oqimi
// ============================================================================
// GET  ?sort=new|top|mine&limit=10&offset=0
//      -> oqim ro'yxati
// POST ?id=N   -> yoqishni o'zgartirish (toggle)
// POST ?id=N&action=view -> ko'rishni hisobga olish
// POST ?id=N&action=delete -> o'chirish (muallif yoki admin)
//
// GET/POST farqi xuddi like.php kabi: GET faqat O'QISH, o'zgarish faqat
// POST. Aks holda brauzer "prefetch" qilib, foydalanuvchi hech narsa
// bosmagan holda yoqish bosib qo'yishi mumkin.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

$reels = new Reels();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ===========================================================================
// O'QISH (GET)
// ===========================================================================
if ($method === 'GET' || $method === 'HEAD') {
    $sort  = input('sort', 'new', 20);
    if (!in_array($sort, ['new', 'top', 'mine'], true)) {
        $sort = 'new';
    }
    if ($sort === 'mine' && !$userId) {
        fail('Telegram orqali kiring', 401);
    }

    $limit  = inputInt('limit', REEL_PAGE_SIZE);
    $offset = inputInt('offset', 0);

    $items = $reels->getFeed($userId, $limit, $offset, $sort);

    ok([
        'items'      => $items,
        'sort'       => $sort,
        'limit'      => $limit,
        'offset'     => $offset,
        'has_more'   => count($items) === $limit,
        'total'      => $reels->countFeed($sort),
        'my_stats'   => $userId ? $reels->authorStats($userId) : null,
    ]);
}

// ===========================================================================
// O'ZGARTIRISH (POST)
// ===========================================================================
if ($method !== 'POST') {
    fail('POST so‘raladi', 405);
}

requireUser();

$action = input('action', 'like', 20);
$id     = inputInt('id');

// ---------------------------------------------------------------------------
switch ($action) {

    // ---------------------------------------------------------------- like
    case 'like': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $r = $reels->toggleLike($id, $userId);
        if (!$r['success']) {
            fail($r['message'], 404);
        }
        ok($r);
    }

    // ---------------------------------------------------------------- view
    case 'view': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $r = $reels->addView($id, $userId);
        if (!$r['success']) {
            // 403: "tasdiqlanmagan" deganda — resurs mavjud emas, balki
            // hozircha ruxsat berilmagan. stream.php ham shu sabab 403 qaytaradi.
            fail($r['message'], 403);
        }
        ok($r);
    }

    // ---------------------------------------------------------------- delete
    case 'delete': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $r = $reels->delete($id, $userId, $auth->isAdmin());
        if (!$r['success']) {
            fail($r['message'], 403);
        }
        ok($r);
    }

    // ---------------------------------------------------------------- share
    // Ulashish sonini oshirish (Telegram'da "Ulashish" tugmasi bosilganda)
    case 'share': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $reel = $reels->getReel($id, $userId);
        if (!$reel) {
            fail('Reels topilmadi', 404);
        }
        $reels->addShare($id);
        ok([
            'message' => 'Ulashildi',
            'url'     => SITE_URL . '/reels.php?reel=' . (int) $id,
            'share_to' => 'https://t.me/share/url?url='
                . rawurlencode(SITE_URL . '/reels.php?reel=' . (int) $id)
                . '&text=' . rawurlencode($reel['title']),
        ]);
    }

    // ------------------------------------------------ kimlar yoqgan (ochiq)
    case 'liked_by': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        ok(['users' => $reels->likedBy($id)]);
    }

    default:
        fail('Noma’lum amal: ' . htmlspecialchars($action, ENT_QUOTES));
}
