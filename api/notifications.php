<?php
// ============================================================================
// api/notifications.php - Instagram uslubidagi bildirishnomalar API
// ============================================================================
// GET  ?action=list&limit=30&offset=0  -> guruhlangan ro'yxat + unread
// GET  ?action=count                   -> { unread }
// POST action=hello                    -> Telegram orqali kirish xabarnomasi
// POST action=read_all                 -> hammasini o'qilgan qilish
// POST action=read&id=N                -> bittasini o'qilgan qilish
// POST action=report                   -> Telegram izohini serverga xabar qilish
//                                        (izoh/reply/mention bildirishnomalari
//                                         uchun; matn serverda SAQLANMAYDI)
//
// Foydalanuvchi `reelUserId()` orqali aniqlanadi: PHP sessiyasi YOKI
// brauzerdagi MTProto `tg_me` (wc_tg_me_v1). Bu reels.php bilan bir xil.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Notifications.php';
require_once __DIR__ . '/../includes/Alerts.php';

$ntf    = new Notifications();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$userId = reelUserId();

// ===========================================================================
// O'QISH (GET)
// ===========================================================================
if ($method === 'GET' || $method === 'HEAD') {
    $action = input('action', 'list', 20);

    if ($action === 'count') {
        ok(['unread' => $userId ? $ntf->unreadCount($userId) : 0]);
    }

    $data = $userId
        ? $ntf->listFor($userId, inputInt('limit', 30), inputInt('offset', 0))
        : ['items' => [], 'unread' => 0, 'has_more' => false];

    ok($data);
}

if ($method !== 'POST') {
    fail('POST so‘raladi', 405);
}

$action = input('action', '', 20);

// ---------------------------------------------------------------------------
// Kirish xabarnomasi ("login alert").
//
// Brauzer MTProto orqali kirgandan keyin BIR MARTA shu so'rovni yuboradi.
// Server: (1) `notifications` ga yozadi, (2) Telegram Bot orqali shaxsiy
// chat'iga xabar yuboradi. Deduplik `Alerts::login()` ichida — 5 daqiqa
// ichida ikkinchi marta yuborilmaydi.
// ---------------------------------------------------------------------------
if ($action === 'hello') {
    if ($userId <= 0) {
        fail('Avval tizimga kiring', 401);
    }
    $alerts = new Alerts();
    $r = $alerts->login($userId, [
        'ip'   => $_SERVER['REMOTE_ADDR'] ?? '',
        'ua'   => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'city' => '',
    ]);
    ok([
        'success' => true,
        'created' => $r['created'],
        'pushed'  => $r['pushed'],
    ]);
}

// ---------------------------------------------------------------------------
// Telegram izohini xabar qilish.
//
// Nima uchun kerak: izohlar Telegram forum-mavzularida saqlanadi (serverda
// Telegram sessiyasi yo'q). Shu sabab izoh yozgan brauzer o'zi "qaysi reelga,
// kim uchun" ekanini shu yerga xabar qiladi. Matn bu yerda saqlanmaydi -
// faqat qisqa ko'rinish (preview) va qabul qiluvchilar aniqlanadi.
// ---------------------------------------------------------------------------
if ($action === 'report') {
    if ($userId <= 0) {
        fail('Avval tizimga kiring', 401);
    }

    $reelId = inputInt('reel_id');
    if ($reelId <= 0) {
        fail('reel_id kerak');
    }

    $db   = Database::getInstance();
    $reel = $db->fetchOne("SELECT id, user_id, title FROM reels WHERE id = ? LIMIT 1", [$reelId]);
    if (!$reel) {
        fail('Reels topilmadi', 404);
    }

    $kind    = input('kind', 'comment', 20);          // comment | reply | media
    $text    = trim((string) input('text', '', 280));
    $replyTg = trim((string) input('reply_to', '', 40));
    $mentRaw = (string) input('mentions', '', 500);

    $ownerId = (int) $reel['user_id'];
    $preview = $text !== '' ? (function_exists('mb_substr') ? mb_substr($text, 0, 120) : substr($text, 0, 120)) : '';

    // Javob berilayotgan foydalanuvchini topamiz (tg id -> DB user).
    $replyUserId = 0;
    if ($replyTg !== '' && ctype_digit($replyTg)) {
        $u = $db->fetchOne(
            "SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1",
            [$replyTg]
        );
        if ($u) {
            $replyUserId = (int) $u['id'];
        }
    }

    $isReply = ($kind === 'reply' || $replyUserId > 0);

    // ---- Egasi (reel muallifi)
    if ($ownerId > 0 && $ownerId !== (int) $userId) {
        $ntf->notifyComment($reelId, $userId, $ownerId, $preview, $isReply);
    }

    // ---- Javob berilgan foydalanuvchi (egasi bo'lmasa)
    if ($replyUserId > 0 && $replyUserId !== $ownerId && $replyUserId !== (int) $userId) {
        $ntf->notifyComment($reelId, $userId, $replyUserId, $preview, true);
    }

    // ---- Mention qilinganlar (@username -> tg_names -> users)
    $mentionUserIds = [];
    if ($mentRaw !== '') {
        $names = array_filter(array_map('trim', explode(',', strtolower($mentRaw))));
        $names = array_slice(array_unique($names), 0, 20);
        foreach ($names as $nm) {
            if (!preg_match('/^[a-z][a-z0-9_]{3,31}$/', $nm)) {
                continue;
            }
            $row = $db->fetchOne("SELECT tg_id FROM tg_names WHERE username = ? LIMIT 1", [$nm]);
            if (!$row) {
                continue;
            }
            $u = $db->fetchOne(
                "SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1",
                [(string) $row['tg_id']]
            );
            if ($u) {
                $mentionUserIds[] = (int) $u['id'];
            }
        }
    }
    foreach (array_unique($mentionUserIds) as $mid) {
        if ($mid === $ownerId || $mid === $replyUserId || $mid === (int) $userId) {
            continue;
        }
        $ntf->notifyMention($mid, $reelId, $userId, $preview);
    }

    ok(['success' => true, 'sent' => $ownerId !== (int) $userId]);
}

// ---------------------------------------------------------------------------
// Qolgan amallar foydalanuvchi talab qiladi.
// ---------------------------------------------------------------------------
if ($userId <= 0) {
    fail('Avval tizimga kiring', 401);
}

switch ($action) {
    case 'read': {
        $id = inputInt('id');
        if ($id <= 0) {
            fail('id kerak');
        }
        $ntf->markRead($userId, $id);
        ok(['success' => true, 'unread' => $ntf->unreadCount($userId)]);
    }

    case 'read_all': {
        $ntf->markAllRead($userId);
        ok(['success' => true, 'unread' => 0]);
    }

    default:
        fail('Noma’lum amal');
}
