<?php
// ============================================================================
// api/search.php - Instagram uslubidagi yagona qidiruv
// ============================================================================
//   GET ?q=matn[&limit=N]
//
// Uch turdagi natijani bir yo'la qaytaradi:
//   profiles - tizimga kirgan foydalanuvchilar (username / ism bo'yicha)
//   content  - kinolar / animelar / multfilmlar (nom va ID bo'yicha)
//   reels    - reelslar (sarlavha / tavsif / bog'langan kino nomi bo'yicha)
//
// ID bo'yicha qidirish: `Catalog::listContent` allaqachon `c.id = ?` ni
// tekshiradi, shuning uchun raqamli so'rov avtomatik ID izlaydi. Anime
// serial sifatida BITTA `content.id` ga ega - shu sababli bitta natija
// qaytadi (qismlar alohida chiqmaydi).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$q     = input('q', '', 100);
$limit = inputInt('limit', 0);
if ($limit <= 0) { $limit = 12; }
$limit = min(30, max(1, $limit));

$profiles = [];
$content  = [];
$reels    = [];
$total    = 0;

// Kamida 2 harf. Faqat raqam bo'lsa (ID), 1 xonali ham izlanadi.
if ($q !== '' && (mb_strlen($q) >= 2 || ctype_digit($q))) {
    $db = Database::getInstance();
    $like = '%' . $q . '%';

    // ------------------------------------------------------------- profillar
    // Username bo'yicha (aynan shu ustuvor), keyin ism bo'yicha.
    $rows = $db->fetchAll(
        "SELECT id, username, first_name, last_name, avatar, is_premium
           FROM users
          WHERE username IS NOT NULL AND username <> ''
            AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
          ORDER BY (username LIKE ?) DESC, (username = ?) DESC, id DESC
          LIMIT 8",
        [$like, $like, $like, ltrim($q, '@') . '%', ltrim($q, '@')]
    );
    foreach ($rows as $u) {
        $profiles[] = [
            'id'         => (int) $u['id'],
            'username'   => $u['username'],
            'first_name' => $u['first_name'] ?: 'Foydalanuvchi',
            'last_name'  => $u['last_name'] ?: '',
            'avatar'     => $u['avatar'] ?: null,
            'premium'    => (int) ($u['is_premium'] ?? 0),
        ];
    }

    // -------------------------------------------------------------- kontent
    $items = $catalog->listContent([
        'search' => $q,
        'limit'  => $limit,
        'offset' => 0,
        'sort'   => 'new',
    ]);
    foreach ($items as $c) {
        $content[] = $catalog->toPublicArray($c, $userId);
    }

    // --------------------------------------------------------------- reels
    $rrows = $db->fetchAll(
        "SELECT r.id, r.title, r.description, r.poster, r.kind,
                r.views_count, r.likes_count, r.user_id AS author_id,
                u.first_name AS author_name, u.username AS author_username,
                u.avatar AS author_avatar, c.title AS content_title
           FROM reels r
           LEFT JOIN users   u ON u.id = r.user_id
           LEFT JOIN content c ON c.id = r.content_id
          WHERE r.status = 1
            AND (r.title LIKE ? OR r.description LIKE ? OR c.title LIKE ?)
          ORDER BY r.id DESC
          LIMIT " . (int) $limit,
        [$like, $like, $like]
    );
    foreach ($rrows as $r) {
        $reels[] = [
            'id'              => (int) $r['id'],
            'title'           => $r['title'] ?: ($r['content_title'] ?? 'Reels'),
            'poster'          => $r['poster'] ?: null,
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

ok([
    'query'    => $q,
    'profiles' => $profiles,
    'content'  => $content,
    'reels'    => $reels,
    'total'    => $total,
]);
