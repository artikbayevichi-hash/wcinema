<?php
// ============================================================================
// library-sync.php — "Saqlanganlar / Yoqqanlar / Tarix" ni server bilan
// sinxronlashtirish.
//
// Maqsad: brauzer keshini tozalash yoki boshqa qurilmaga o'tishda kutubxona
// yo'qolib qolmasin. Mahalliy WCLib (localStorage) tezlik uchun qoladi, lekin
// har o'zgarish kichik navbat bilan shu endpointga yuboriladi va serverdagi
// kanonik holat qaytarib o'rnatiladi.
//
//   GET  -> serverdagi holat (liked / saved / history)
//   POST -> mahalliy o'zgarishlarni QO'SHIB yozish + kanonik holatni qaytarish
//
// Muhim: bu endpoint toggleVote()/toggleWatchlist() ni chaqirmaydi — ular
// eski keshdagi JS uchun saqlangan. Bu yerda faqat idempotent union yozuvlar
// bor (qayta yuborish holatni teskarisiga o'zgartirmaydi).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

// PHP sessiyasi YOKI `wc_cs` cookie (MTProto orqali kirganlar uchun
// wc-session.js chiqargan) orqali aniqlanadi. `APP.userId` ishlatilmaydi —
// u faqat PHP sessiyasini ko'radi.
$uid = clientUserId();
if ($uid <= 0) {
    Auth::fail('Avval tizimga kiring', 401);
}

$db = Database::getInstance();

/** ms -> TIMESTAMP uchun xavfsiz soniya. Haddan tashqari qiymatlar "hozir". */
function wcSyncSec($ms) {
    $sec = (int) round((float) $ms / 1000);
    if ($sec < 946684800 || $sec > time() + 86400) {
        $sec = time();
    }
    return $sec;
}

/** `[{id, at}, …]` yoki `[id, …]` -> `[id => soniya]`. */
function wcSyncPairs($list, $cap) {
    $out = [];
    if (!is_array($list)) {
        return $out;
    }
    $n = 0;
    foreach ($list as $v) {
        if ($n >= $cap) {
            break;
        }
        if (is_array($v)) {
            $id = isset($v['id']) ? (int) $v['id'] : 0;
            $at = isset($v['at']) ? $v['at'] : 0;
        } else {
            $id = (int) $v;
            $at = 0;
        }
        if ($id <= 0) {
            continue;
        }
        $out[$id] = wcSyncSec($at);
        $n++;
    }
    return $out;
}

/** WCLib.normalize() bilan bir xil shakldagi karta. */
function wcSyncItem($c) {
    return [
        'id'       => (int) $c['id'],
        'title'    => (string) ($c['title'] ?? ''),
        'poster'   => Catalog::autoPoster(
            $c['poster'] ?? null,
            $c['title'] ?? '',
            $c['category_slug'] ?? '',
            $c['category_name'] ?? ''
        ),
        'category' => (string) ($c['category_name'] ?? ''),
        'year'     => ($c['release_year'] !== null && $c['release_year'] !== '')
            ? (int) $c['release_year'] : '',
        'at'       => (int) ($c['at'] ?? 0),
    ];
}

/** Serverdagi kanonik holat (har bucket eng ko'p 200 ta). */
function wcSyncState($db, $uid) {
    $cap = 200;

    $liked = $db->fetchAll(
        "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug,
                UNIX_TIMESTAMP(l.created_at) * 1000 AS at
         FROM likes l
         JOIN content c ON c.id = l.content_id
         JOIN categories cat ON cat.id = c.category_id
         WHERE l.user_id = ? AND l.type = 'like' AND c.status = 'published'
         ORDER BY l.created_at DESC LIMIT " . $cap,
        [$uid]
    );

    $saved = $db->fetchAll(
        "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug,
                UNIX_TIMESTAMP(w.created_at) * 1000 AS at
         FROM watchlist w
         JOIN content c ON c.id = w.content_id
         JOIN categories cat ON cat.id = c.category_id
         WHERE w.user_id = ? AND c.status = 'published'
         ORDER BY w.created_at DESC LIMIT " . $cap,
        [$uid]
    );

    // watch_history da UNIQUE(user_id, content_id, episode_id) bor, WCLib
    // esa kontent bo'yicha bitta yozuv saqlaydi -> content_id bo'yicha
    // oxirgi ko'rish vaqtini olamiz.
    $history = $db->fetchAll(
        "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug, h.at
         FROM (
             SELECT content_id, MAX(UNIX_TIMESTAMP(watched_at)) * 1000 AS at
             FROM watch_history WHERE user_id = ?
             GROUP BY content_id ORDER BY at DESC LIMIT " . $cap . "
         ) h
         JOIN content c ON c.id = h.content_id
         JOIN categories cat ON cat.id = c.category_id
         WHERE c.status = 'published'
         ORDER BY h.at DESC",
        [$uid]
    );

    $map = function ($rows) {
        $out = [];
        foreach ($rows as $c) {
            $out[] = wcSyncItem($c);
        }
        return $out;
    };

    return [
        'liked'   => $map($liked),
        'saved'   => $map($saved),
        'history' => $map($history),
    ];
}

// --- POST: mahalliy navbatni qo'shamiz (butun bucket bilan almashtirmaymiz)
$payload = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $payload = $decoded;
        }
    }
    if (!$payload && !empty($_POST)) {
        $payload = $_POST;
    }
}

if ($payload) {
    $positive = [
        'liked'   => wcSyncPairs($payload['liked'] ?? [], 200),
        'saved'   => wcSyncPairs($payload['saved'] ?? [], 200),
        'history' => wcSyncPairs($payload['history'] ?? [], 200),
    ];
    $removedRaw = (isset($payload['removed']) && is_array($payload['removed']))
        ? $payload['removed'] : [];
    $removed = [
        'liked' => wcSyncPairs($removedRaw['liked'] ?? [], 200),
        'saved' => wcSyncPairs($removedRaw['saved'] ?? [], 200),
    ];

    // Notanish content_id lar FK xatosi berib butun so'rovni buzmasligi
    // uchun ularni oldindan filtrlaymiz.
    $allIds = [];
    foreach ([$positive, $removed] as $group) {
        foreach ($group as $pairs) {
            foreach ($pairs as $id => $_sec) {
                $allIds[(int) $id] = 1;
            }
        }
    }
    $valid = [];
    if ($allIds) {
        $ids = array_keys($allIds);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        foreach ($db->fetchAll("SELECT id FROM content WHERE id IN ($ph)", $ids) as $row) {
            $valid[(int) $row['id']] = 1;
        }
    }

    $applied = [
        'liked' => 0, 'saved' => 0, 'history' => 0,
        'removed_liked' => 0, 'removed_saved' => 0,
    ];

    foreach ($positive['liked'] as $id => $sec) {
        if (!isset($valid[$id])) {
            continue;
        }
        // Aniq "like" saqlangan "dislike" ustidan g'alaba qozonadi, lekin
        // vaqtni orqaga surmaymiz (boshqa qurilmaning yangi yozuvi saqlanadi).
        $st = $db->query(
            "INSERT INTO likes (user_id, content_id, type, created_at)
             VALUES (?, ?, 'like', FROM_UNIXTIME(?))
             ON DUPLICATE KEY UPDATE
               type = 'like',
               created_at = FROM_UNIXTIME(GREATEST(UNIX_TIMESTAMP(created_at), ?))",
            [$uid, $id, $sec, $sec]
        );
        if ($st) {
            $applied['liked']++;
        }
    }

    foreach ($positive['saved'] as $id => $sec) {
        if (!isset($valid[$id])) {
            continue;
        }
        $st = $db->query(
            "INSERT IGNORE INTO watchlist (user_id, content_id, created_at)
             VALUES (?, ?, FROM_UNIXTIME(?))",
            [$uid, $id, $sec]
        );
        if ($st) {
            $applied['saved']++;
        }
    }

    foreach ($positive['history'] as $id => $sec) {
        if (!isset($valid[$id])) {
            continue;
        }
        $st = $db->query(
            "INSERT INTO watch_history (user_id, content_id, episode_id, watched_at, progress_seconds)
             VALUES (?, ?, 0, FROM_UNIXTIME(?), 0)
             ON DUPLICATE KEY UPDATE watched_at = GREATEST(watched_at, FROM_UNIXTIME(?))",
            [$uid, $id, $sec, $sec]
        );
        if ($st) {
            $applied['history']++;
        }
    }

    // O'chirish faqat aniq ro'yxatdagi va eski bo'lmagan yozuvlarga ta'sir
    // qiladi — boshqa qurilmadan keyinroq qo'shilgan kontent o'chmaydi.
    foreach ($removed['liked'] as $id => $sec) {
        $st = $db->query(
            "DELETE FROM likes
             WHERE user_id = ? AND content_id = ? AND type = 'like'
               AND created_at <= FROM_UNIXTIME(?)",
            [$uid, $id, $sec]
        );
        if ($st && $st->rowCount() > 0) {
            $applied['removed_liked']++;
        }
    }
    foreach ($removed['saved'] as $id => $sec) {
        $st = $db->query(
            "DELETE FROM watchlist
             WHERE user_id = ? AND content_id = ? AND created_at <= FROM_UNIXTIME(?)",
            [$uid, $id, $sec]
        );
        if ($st && $st->rowCount() > 0) {
            $applied['removed_saved']++;
        }
    }

    Auth::ok(array_merge(wcSyncState($db, $uid), ['applied' => $applied]));
}

Auth::ok(wcSyncState($db, $uid));
