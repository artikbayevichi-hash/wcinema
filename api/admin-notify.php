<?php
// ============================================================================
// api/admin-notify.php - bildirishnoma yuborish (admin, JSON)
// ============================================================================
//   GET  -> { counts:{all,premium,tg} }
//   POST -> audience=all|premium|one & title & message & url & to_telegram
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Notifications.php';
require_once __DIR__ . '/../includes/AdminLog.php';

requireAdmin();

$db  = Database::getInstance();
$MAX = 500;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $one = function ($sql) use ($db) {
        try {
            $r = $db->fetchOne($sql);
            return $r ? (int) array_values($r)[0] : 0;
        } catch (Throwable $e) {
            return 0;
        }
    };
    ok([
        'counts' => [
            'all'     => $one("SELECT COUNT(*) FROM users WHERE is_banned = 0"),
            'premium' => $one("SELECT COUNT(*) FROM users WHERE is_premium = 1 AND is_banned = 0"),
            'tg'      => $one("SELECT COUNT(*) FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''"),
        ],
    ]);
}

@set_time_limit(180);

$audience = (string) input('audience', 'all', 20);
$title    = trim((string) ($_POST['title'] ?? ''));
$message  = trim((string) ($_POST['message'] ?? ''));
$url      = trim((string) ($_POST['url'] ?? ''));
$toTg     = !empty($_POST['to_telegram']);

if ($title === '' || $message === '') {
    fail('Sarlavha va matn kerak', 400);
}

if ($audience === 'premium') {
    $rows = $db->fetchAll(
        "SELECT id, telegram_chat_id FROM users
          WHERE is_premium = 1 AND is_banned = 0 ORDER BY id DESC LIMIT $MAX"
    );
} elseif ($audience === 'one') {
    $key = ltrim((string) input('who', '', 120), '@');
    $rows = $db->fetchAll(
        "SELECT id, telegram_chat_id FROM users
          WHERE (telegram_user_id = ? OR username = ? OR id = ?) LIMIT 1",
        [$key, $key, (int) $key]
    );
} else {
    $rows = $db->fetchAll(
        "SELECT id, telegram_chat_id FROM users
          WHERE is_banned = 0 ORDER BY id DESC LIMIT $MAX"
    );
}

$notif = new Notifications($db);
$inApp = 0;
$tgOk  = 0;
$tgErr = 0;

if ($toTg) {
    $bot = new TelegramBot();
    $bot->setTimeout(10);
}

foreach ($rows as $r) {
    $uid = (int) $r['id'];
    if ($notif->add($uid, 'system', [
        'title'   => $title,
        'message' => $message,
        'url'     => $url,
    ])) {
        $inApp++;
    }

    if ($toTg) {
        $chat = trim((string) ($r['telegram_chat_id'] ?? ''));
        if ($chat === '') {
            $u = $db->fetchOne("SELECT telegram_user_id FROM users WHERE id = ?", [$uid]);
            $chat = trim((string) ($u['telegram_user_id'] ?? ''));
        }
        if ($chat !== '') {
            $text = '<b>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . "</b>\n\n"
                . htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
            $res = $bot->sendMessage($chat, $text);
            if (!empty($res['ok'])) {
                $tgOk++;
            } else {
                $tgErr++;
            }
            usleep(45000);
        }
    }
}

AdminLog::add('notify.send', [
    'audience' => $audience,
    'title'    => $title,
    'total'    => count($rows),
    'inapp'    => $inApp,
    'tg'       => $toTg,
]);

ok([
    'total'   => count($rows),
    'inapp'   => $inApp,
    'tg_ok'   => $tgOk,
    'tg_err'  => $tgErr,
]);
