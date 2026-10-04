<?php
// ============================================================================
// api/reels.php - reels oqimi
// ============================================================================
// GET  ?sort=new|top|mine&limit=10&offset=0
//      -> oqim ro'yxati
// GET  ?comments=<reel_id>&limit=30&offset=0
//      -> reel izohlari
// POST ?id=N   -> yoqishni o'zgartirish (like)
// POST ?id=N&action=view -> ko'rishni hisobga olish
// POST ?id=N&action=comment&body=... -> izoh qo'shish
// POST ?id=N&action=comment_delete&comment_id=... -> izohni o'chirish
// POST ?id=N&action=delete -> o'chirish (muallif yoki admin)
//
// Foydalanuvchi PHP sessiyasidan YOKI `tg_me` (MTProto) dan aniqlanadi.
// GET/POST farqi xuddi like.php kabi: GET faqat O'QISH, o'zgarish faqat
// POST. Aks holda brauzer "prefetch" qilib, foydalanuvchi hech narsa
// bosmagan holda yoqish bosib qo'yishi mumkin.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

$reels = new Reels();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Joriy foydalanuvchi. Sayt brauzerdagi MTProto orqali ishlaganda PHP
// sessiyasi BO'LMAYDI — shu sabab `tg_me` (wc_tg_me_v1) dan ham
// aniqlaymiz (like/view/izoh uchun yetarli; admin huquqi bermaydi).
$userId = reelUserId();

// ===========================================================================
// O'QISH (GET)
// ===========================================================================
if ($method === 'GET' || $method === 'HEAD') {
    // Izohlar ro'yxati: api/reels.php?comments=<reel_id>
    $commentsFor = inputInt('comments');
    if ($commentsFor > 0) {
        $list = $reels->getComments($commentsFor, inputInt('limit', 30), inputInt('offset', 0));
        if ($list === null) {
            fail('Reels topilmadi', 404);
        }
        ok([
            'comments' => $list,
            'has_more' => count($list) === max(1, min(50, inputInt('limit', 30))),
        ]);
    }

    $sort  = input('sort', 'new', 20);
    if (!in_array($sort, ['new', 'top', 'mine', 'saved'], true)) {
        $sort = 'new';
    }
    if (($sort === 'mine' || $sort === 'saved') && !$userId) {
        fail('Telegram orqali kiring', 401);
    }

    $limit  = inputInt('limit', REEL_PAGE_SIZE);
    $offset = inputInt('offset', 0);

    // "saved" — foydalanuvchi saqlagan (bookmark) reelslar, Instagram'dagi
    // "Saqlanganlar" bo'limi uchun. Qolganlari odatdagi oqim.
    $items = $sort === 'saved'
        ? $reels->savedGrid($userId, $limit, $offset)
        : $reels->getFeed($userId, $limit, $offset, $sort);

    ok([
        'items'      => $items,
        'sort'       => $sort,
        'limit'      => $limit,
        'offset'     => $offset,
        'has_more'   => count($items) === $limit,
        'total'      => $sort === 'saved' ? null : $reels->countFeed($sort),
        // Ko'ruvchining haqiqiy (DB) id'si. Mijoz `tg_me` (Telegram id)
        // orqali keladi, lekin `author.id` — DB id. "O'chirish" tugmasini
        // to'g'ri ko'rsatish uchun shu ikkisini solishtirish kerak.
        'viewer_id'  => $userId ? (int) $userId : 0,
        'my_stats'   => $userId ? $reels->authorStats($userId) : null,
    ]);
}

// ===========================================================================
// O'ZGARTIRISH (POST)
// ===========================================================================
if ($method !== 'POST') {
    fail('POST so‘raladi', 405);
}

if ($userId <= 0) {
    fail('Telegram orqali kiring', 401);
}

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

    // ---------------------------------------------------------------- save
    // Saqlash (bookmark) toggle
    case 'save': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $r = $reels->toggleSave($id, $userId);
        if (!$r['success']) {
            fail($r['message'], 404);
        }
        ok($r);
    }

    // --------------------------------------------------------------- repost
    // Repost toggle
    case 'repost': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $r = $reels->toggleRepost($id, $userId);
        if (!$r['success']) {
            fail($r['message'], 404);
        }
        ok($r);
    }

    // --------------------------------------------------------------- follow
    // Muallifni kuzatish toggle (id = author.user_id)
    case 'follow': {
        if ($id <= 0) {
            fail('user id kerak');
        }
        $r = $reels->toggleFollow($id, $userId);
        if (!$r['success']) {
            fail($r['message'], 400);
        }
        ok($r);
    }

    // ---------------------------------------------------------------- view
    case 'view': {        if ($id <= 0) {
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

    // ------------------------------------------------------------- comment
    // Izoh qo'shish
    case 'comment': {
        if ($id <= 0) {
            fail('reel id kerak');
        }
        $r = $reels->addComment($id, $userId, input('body', '', 4000));
        if (!$r['success']) {
            fail($r['message'], 400);
        }
        ok($r);
    }

    // ------------------------------------------------------- comment_delete
    // Izohni o'chirish (muallif yoki admin)
    case 'comment_delete': {
        $cid = inputInt('comment_id');
        if ($cid <= 0) {
            fail('comment_id kerak');
        }
        $r = $reels->deleteComment($cid, $userId, $auth->isAdmin());
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
