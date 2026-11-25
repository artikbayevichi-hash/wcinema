<?php
// ============================================================================
// api/search.php - Instagram uslubidagi yagona qidiruv
// ============================================================================
//   GET ?q=matn[&limit=N]
//
// Uch turdagi natijani bir yo'la qaytaradi:
//   profiles - foydalanuvchilar (ism, familiya, to'liq ism, @username; har xil
//              registrda va ikki tartibda yozilganda ham topiladi)
//   content  - kinolar / animelar / multfilmlar (nom va ID bo'yicha)
//   reels    - reelslar (sarlavha / tavsif / bog'langan kino nomi bo'yicha)
//
// ID bo'yicha qidirish: `Catalog::listContent` allaqachon `c.id = ?` ni
// tekshiradi, shuning uchun raqamli so'rov avtomatik ID izlaydi. Anime
// serial sifatida BITTA `content.id` ga ega - shu sababli bitta natija
// qaytadi (qismlar alohida chiqmaydi).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

// Faqat o'qish — sessiya qulfini bo'shatamiz.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

RateLimit::enforce('read');

$q     = input('q', '', 100);
$limit = inputInt('limit', 0);
if ($limit <= 0) { $limit = 12; }
$limit = min(30, max(1, $limit));

// Ko'ruvchi: PHP sessiyasi yoki imzolangan client cookie (MTProto brauzer).
// `reelUserId()` — `clientUserId()` ning tarixiy aliasesi.
$viewerId = $userId !== null ? (int) $userId : (int) clientUserId();
if ($viewerId <= 0) { $viewerId = (int) reelUserId(); }

$compute = function () use ($q, $limit, $catalog, $userId, $viewerId) {
    $profiles = [];
    $content  = [];
    $reels    = [];
    $total    = 0;

    // Kamida 2 harf. Faqat raqam bo'lsa (ID), 1 xonali ham izlanadi.
    if ($q !== '' && (mb_strlen($q) >= 2 || ctype_digit($q))) {
        $db = Database::getInstance();

        // ------------------------------------------------------------- bloklar
        // Ikkala yo'nalish ham yashiriladi: siz bloklaganlar VA sizni
        // bloklaganlar. `Blocks::hiddenIds()` aynan shu ikki tomonni qaytaradi.
        // Jadval mavjud bo'lmasa / xatolik bo'lsa — qidiruv ishlayveradi
        // (xavfsiz fallback), xato faqat logga yoziladi.
        $hiddenIds = [];
        if ($viewerId > 0) {
            try {
                $rows = (new Blocks($db))->hiddenIds($viewerId);
                $hiddenIds = array_keys((array) $rows);
            } catch (\Throwable $e) {
                error_log('[search] bloklanganlar ro\'yxati o\'qilmadi: ' . $e->getMessage());
            }
        }
        $hiddenIds = array_values(array_filter(
            array_map('intval', $hiddenIds),
            function ($x) { return $x > 0; }
        ));
        $hiddenIn = $hiddenIds ? implode(',', array_fill(0, count($hiddenIds), '?')) : '';

        // Registr farqi va "@" old qismi qidiruvga ta'sir qilmasin.
        $bare = ltrim(trim($q), '@');
        $lc   = function_exists('mb_strtolower') ? mb_strtolower($bare, 'UTF-8') : strtolower($bare);
        $esc  = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $lc);
        $like = '%' . $esc . '%';

        // ------------------------------------------------------------- profillar
        // Ism bir xil bo'lavergan holda ham hamma foydalanuvchilar topiladi;
        // username istisnosiz noyob (users + tg_names). "Ali Vali" va
        // "Vali Ali", "ALI", "@ali" kabi yozuvlar bir xil natija beradi.
        if ($bare !== '') {
            $profileSql = "SELECT u.id, u.username, u.first_name, u.last_name, u.avatar,
                        u.is_premium, tn.username AS tg_username
                   FROM users u
                   LEFT JOIN tg_names tn
                     ON tn.tg_id = CAST(u.telegram_user_id AS UNSIGNED)
                  WHERE (LOWER(u.username) LIKE ?
                     OR LOWER(tn.username) LIKE ?
                     OR LOWER(u.first_name) LIKE ?
                     OR LOWER(u.last_name) LIKE ?
                     OR LOWER(CONCAT(u.first_name, ' ', u.last_name)) LIKE ?
                     OR LOWER(CONCAT(u.last_name, ' ', u.first_name)) LIKE ?)";
            $profileParams = [$like, $like, $like, $like, $like, $like];
            if ($hiddenIn !== '') {
                $profileSql .= ' AND u.id NOT IN (' . $hiddenIn . ')';
                $profileParams = array_merge($profileParams, $hiddenIds);
            }
            $profileSql .= "
                  ORDER BY
                     (LOWER(u.username) = ?) DESC,
                     (LOWER(tn.username) = ?) DESC,
                     (LOWER(u.username) LIKE ?) DESC,
                     (LOWER(CONCAT(u.first_name, ' ', u.last_name)) = ?) DESC,
                     u.id DESC
                  LIMIT 8";
            $profileParams = array_merge($profileParams, [$lc, $lc, $esc . '%', $lc]);
            $rows = $db->fetchAll($profileSql, $profileParams);
            foreach ($rows as $u) {
                $profiles[] = [
                    'id'         => (int) $u['id'],
                    'username'   => $u['username'] ?: ($u['tg_username'] ?: ''),
                    'first_name' => $u['first_name'] ?: 'Foydalanuvchi',
                    'last_name'  => $u['last_name'] ?: '',
                    'avatar'     => $u['avatar'] ?: null,
                    'premium'    => (int) ($u['is_premium'] ?? 0),
                    // `verified` — klient uchun premium bilan bir xil belgi.
                    // Bazada alohida verified ustuni yo'q, shuning uchun
                    // SQL o'zgartirilmasdan faqat JSON javobida alias qilinadi.
                    'verified'   => (int) ($u['is_premium'] ?? 0),
                    'following'  => false, // quyida bitta so'rovda to'ldiriladi
                ];
            }

            // "Kuzatilmoqda" yorlig'i: api/profile.php dagi `following` bilan
            // bir xil ma'no. Bitta so'rov; jadval/xato bo'lsa xavfsiz fallback.
            if ($viewerId > 0 && $profiles) {
                $pids = array_map(function ($p) { return (int) $p['id']; }, $profiles);
                $followIn = implode(',', array_fill(0, count($pids), '?'));
                try {
                    $frows = $db->fetchAll(
                        'SELECT following_id FROM user_follows
                          WHERE follower_id = ? AND following_id IN (' . $followIn . ')',
                        array_merge([$viewerId], $pids)
                    );
                    $followingIds = [];
                    foreach ((array) $frows as $f) {
                        $followingIds[(int) $f['following_id']] = true;
                    }
                    foreach ($profiles as &$p) {
                        $p['following'] = isset($followingIds[$p['id']]);
                    }
                    unset($p);
                } catch (\Throwable $e) {
                    error_log('[search] kuzatuv holati o\'qilmadi: ' . $e->getMessage());
                }
            }
        }

        // -------------------------------------------------------------- kontent
        $items = $catalog->listContent([
            'search' => $q,
            'limit'  => $limit,
            'offset' => 0,
            'sort'   => 'new',
        ]);
        foreach ($items as $c) {
            // Olib tashlangan bo'limlar (Serial / Dokumental) qidiruvda ham chiqmasin.
            if (in_array((string) ($c['category_slug'] ?? ''), ['serial', 'dokumental', 'dokument', 'dok'], true)) {
                continue;
            }
            $content[] = $catalog->toPublicArray($c, $userId);
        }

        // --------------------------------------------------------------- reels
        $reelSql = "SELECT r.id, r.title, r.description, r.poster, r.kind,
                           r.views_count, r.likes_count, r.user_id AS author_id,
                           u.first_name AS author_name, u.username AS author_username,
                           u.avatar AS author_avatar, c.title AS content_title
                      FROM reels r
                      LEFT JOIN users   u ON u.id = r.user_id
                      LEFT JOIN content c ON c.id = r.content_id
                     WHERE r.status = 1
                       AND (r.title LIKE ? OR r.description LIKE ? OR c.title LIKE ?)";
        $reelParams = [$like, $like, $like];
        // Bloklangan mualliflarning reelslari ham chiqmasin.
        if ($hiddenIn !== '') {
            $reelSql .= ' AND (r.user_id IS NULL OR r.user_id NOT IN (' . $hiddenIn . '))';
            $reelParams = array_merge($reelParams, $hiddenIds);
        }
        $reelSql .= ' ORDER BY r.id DESC LIMIT ' . (int) $limit;
        $rrows = $db->fetchAll($reelSql, $reelParams);
        foreach ($rrows as $r) {
            $reels[] = [
                'id'              => (int) $r['id'],
                'title'           => $r['title'] ?: ($r['content_title'] ?? 'Reels'),
                'poster'          => Catalog::resolvePoster(
                    $r['poster'] ?: null,
                    $r['title'] ?: ($r['content_title'] ?? 'Reels'),
                    'reels',
                    'Reels'
                ),
                'views'           => (int) $r['views_count'],
                'likes'           => (int) $r['likes_count'],
                'author_id'       => $r['author_id'] ? (int) $r['author_id'] : null,
                'author_name'     => $r['author_name'] ?: '',
                'author_username' => $r['author_username'] ?: '',
                'author_avatar'   => $r['author_avatar'] ?: null,
            ];
        }

        $total = count($profiles) + count($content) + count($reels);
    }

    return [
        'query'    => $q,
        'profiles' => $profiles,
        'content'  => $content,
        'reels'    => $reels,
        'total'    => $total,
    ];
};

// Bir xil qidiruvni minglab odam takrorlashi mumkin — 60 s kesh.
$isAnon = $viewerId <= 0;
if ($isAnon) {
    $out = HttpCache::json(HttpCache::key('search', [$q, $limit]), 60, 30, $compute);
} else {
    HttpCache::privateNoStore();
    $out = $compute();
}

ok($out);
