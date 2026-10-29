<?php
// ============================================================================
// api/tg-connect.php - bot bilan chat ulanganmi? (Telegram DM uchun)
// ============================================================================
//   GET -> { success, connected:bool, link:"https://t.me/bot?start=notify" }
//
// Agar `users.telegram_chat_id` bo'sh bo'lsa, server Bot API orqali
// tekshiradi (getChat) — foydalanuvchi botga bir marta yozgan bo'lsa,
// chat_id avtomatik to'ldiriladi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$uid = clientUserId();
if ($uid <= 0) {
    fail('Avval tizimga kiring', 401);
}

$u = $auth->getUserById($uid);
if (!$u) {
    fail('Foydalanuvchi topilmadi', 404);
}

$chat = trim((string) ($u['telegram_chat_id'] ?? ''));
$link = 'https://t.me/' . TELEGRAM_BOT_USERNAME . '?start=notify';

// Chat ID yo'q — Bot API dan tekshiramiz (u yerda bo'lsa darhol saqlaymiz).
if ($chat === '') {
    $tgId = trim((string) ($u['telegram_user_id'] ?? ''));
    if ($tgId !== '') {
        try {
            $tg = new TelegramBot();
            $tg->setTimeout(5);
            $c = $tg->getChat($tgId);
            if (!empty($c['ok']) && !empty($c['result']['id'])) {
                $chat = (string) $c['result']['id'];
                Database::getInstance()->update(
                    'users',
                    ['telegram_chat_id' => $chat],
                    'id = ?',
                    [(int) $uid]
                );
            }
        } catch (Throwable $e) {
            error_log('[tg-connect] ' . $e->getMessage());
        }
    }
}

ok([
    'connected' => $chat !== '',
    'link'      => $link,
    'bot'       => '@' . TELEGRAM_BOT_USERNAME,
]);
