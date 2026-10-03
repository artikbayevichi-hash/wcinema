<?php
// ============================================================================
// Telegram Bot - Ro'yxatdan o'tish dialogi
// ============================================================================
// Bu skript bot'ni polling orqali boshqaradi va foydalanuvchini ro'yxatdan
// o'tadi (ism, familiya, yosh, va h.k).
//
// Ishonchlilik uchun:
//  - har bir curl so'rovida aniq TIMEOUT bor (ulanish tursa bot qotib qolmaydi)
//  - getUpdates javobi null bo'lsa ham xato emas, davom etadi
//  - har bir update alohida try/catch bilan ishlanadi - bitta update bot'ni
//    o'ldira olmaydi
//  - confirm bosqichida tugma ishlamasa ham matnli "ha"/"yo'q" qabul qilinadi
// ============================================================================

require_once __DIR__ . '/includes/bootstrap.php';

$telegram = new TelegramBot();
$db = Database::getInstance();

// API so'rovlari
$botToken = TELEGRAM_BOT_TOKEN;
$apiUrl = "https://api.telegram.org/bot{$botToken}/";

// Offset - oxirgi update ID
$offsetFile = __DIR__ . '/bot_offset.txt';
$offset = file_exists($offsetFile) ? (int) file_get_contents($offsetFile) : 0;

// Foydalanuvchi ro'yxatdan o'tish jarayonini saqlash
$statesFile = __DIR__ . '/bot_states.json';
$states = file_exists($statesFile) ? (json_decode(file_get_contents($statesFile), true) ?: []) : [];

/**
 * Telegram API'ga umumiy so'rov (curl + timeout).
 * Muvaffaqiyatsiz bo'lsa null qaytaradi - chaqiruvchi o'zini himoyalaydi.
 */
function apiRequest($url, $data = [], $timeout = 20) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, 1);
    if ($data) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
    }
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);

    // Qo'shimcha o'lim-himoya: agar ulanish "jim" tursa (ma'lumot tezligi
    // past bo'lsa) ham curl'ni majburan uzamiz - bot bu hech qachon
    // abadiy qotib qolmaydi.
    curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
    curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, max(5, $timeout - 5));

    $response = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        error_log("bot: curl xato: " . $err);
        return null;
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        error_log("bot: json xato: " . substr($response, 0, 200));
        return null;
    }

    return $decoded;
}

/**
 * Bot'ga xabar yuborish
 */
function sendMessage($chatId, $text, $keyboard = null) {
    global $apiUrl;

    $data = [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'HTML',
    ];

    if ($keyboard) {
        $data['reply_markup'] = json_encode(['inline_keyboard' => $keyboard], JSON_UNESCAPED_UNICODE);
    }

    $res = apiRequest($apiUrl . 'sendMessage', $data);
    if (empty($res['ok'])) {
        error_log("bot: sendMessage xato chat={$chatId}: " . json_encode($res));

        // 1 marta qayta urinamiz - tarmoq vaqtinchalik uzilgan bo'lishi mumkin
        sleep(2);
        $res = apiRequest($apiUrl . 'sendMessage', $data);
        if (empty($res['ok'])) {
            error_log("bot: sendMessage qayta urinish ham muvaffaqiyatsiz chat={$chatId}: " . json_encode($res));
        }
    }
    return $res;
}

/**
 * Callback javob
 */
function answerCallback($callbackId, $text = '', $showAlert = false) {
    global $apiUrl;

    $data = [
        'callback_query_id' => $callbackId,
        'text' => $text,
        'show_alert' => $showAlert,
    ];

    apiRequest($apiUrl . 'answerCallbackQuery', $data, 10);
}

/**
 * States saqlash
 */
function saveStates($states) {
    global $statesFile;
    file_put_contents($statesFile, json_encode($states, JSON_UNESCAPED_UNICODE));
}

/**
 * Offset saqlash
 */
function saveOffset($offset) {
    global $offsetFile;
    file_put_contents($offsetFile, $offset);
}

/**
 * Registratsiyani yakunlash (Ha / "ha" javobidan chaqiriladi).
 * Tugatilsa true, aks holda false qaytaradi.
 */
function completeRegistration(&$states, $userId) {
    if (!isset($states[$userId])) {
        return false;
    }

    $state = $states[$userId];
    $telegramId = (string) $state['telegram_id'];
    $chatId = $state['chat_id'];

    echo "Tasdiqlash: $telegramId\n";

    $db = Database::getInstance();

    $fields = [
        'first_name' => $state['first_name'],
        'last_name' => $state['last_name'],
        'telegram_user_id' => $telegramId,
        'telegram_chat_id' => $chatId,
        'is_registered' => 1,
        'last_login_at' => date('Y-m-d H:i:s'),
        'last_activity' => date('Y-m-d H:i:s'),
    ];

    $existing = $db->fetchOne(
        "SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1",
        [$telegramId]
    );

    if ($existing) {
        $ok = $db->update('users', $fields, 'id = ?', [$existing['id']]);
        if ($ok === false) {
            sendMessage($chatId, "❌ Ma'lumotlarni saqlashda xatolik yuz berdi. Iltimos, qaytadan /start yuboring.");
            sleep(1);
            return true;
        }
    } else {
        $fields['user_id'] = strtoupper(bin2hex(random_bytes(4)));
        $fields['email'] = 'tg' . $telegramId . '@miniapp.local';
        $fields['password'] = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
        $fields['username'] = 'tg_' . $telegramId;

        $newId = $db->insert('users', $fields);
        if (!$newId) {
            sendMessage($chatId, "❌ Ro'yxatga olishda xatolik yuz berdi. Iltimos, qaytadan /start yuboring.");
            sleep(1);
            return true;
        }
    }

    // State'ni o'chirish
    unset($states[$userId]);
    saveStates($states);

    sendMessage($chatId, "✅ Ro'yxatdan o'tdingiz!\n\nEndi saytga kirishingiz mumkin.", [
        [['text' => '🌐 Saytga kirish', 'url' => SITE_URL . '/login.php']],
    ]);
    return true;
}

/**
 * State yo'qolgan holatda tiklanish:
 *  - agar foydalanuvchi ro'yxatdan o'tgan bo'lsa - "allaqachon" xabari
 *  - aks holda dialogni boshidan boshlaymiz (dead-end bo'lmaydi)
 */
function recoverMissingState(&$states, $userId, $chatId) {
    $db = Database::getInstance();
    $user = $db->fetchOne(
        "SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1",
        [(string) $userId]
    );

    if ($user && !empty($user['is_registered'])) {
        sendMessage($chatId, "✅ Siz allaqachon ro'yxatdan o'tgansiz!\n\nSaytga kirishingiz mumkin.", [
            [['text' => '🌐 Saytga kirish', 'url' => SITE_URL . '/login.php']],
        ]);
        return;
    }

    // Dialogni tiklash
    $states[$userId] = [
        'step' => 'first_name',
        'chat_id' => $chatId,
        'telegram_id' => $userId,
        'first_name' => '',
        'last_name' => '',
        'username' => '',
    ];
    saveStates($states);
    sendMessage($chatId, "Ro'yxatdan o'tishni boshlaymiz.\n\nIsmingizni kiriting:");
}

// ============================================================================
// Ishga tushganda: Telegram Menu Button'ni joriy sayt URL'iga yangilash
// ----------------------------------------------------------------------------
// Cloudflare quick-tunnel URL'i har qayta ishga tushganda o'zgaradi, shuning
// uchun barcha foydalanuvchilar uchun default menu-tugma (web_app) joriy
// MINI_APP_URL ga o'rnatiladi.
// ============================================================================
error_log("bot: menu_button -> " . MINI_APP_URL);
$menuRes = apiRequest($apiUrl . 'setChatMenuButton', [
    'menu_button' => json_encode([
        'type' => 'web_app',
        'text' => '🌐 Saytga kirish',
        'web_app' => ['url' => MINI_APP_URL],
    ], JSON_UNESCAPED_UNICODE),
], 15);
if (!empty($menuRes['ok'])) {
    echo "Menu button yangilandi: " . MINI_APP_URL . "\n";
} else {
    echo "setChatMenuButton xato: " . json_encode($menuRes) . "\n";
}

echo "Bot polling boshlandi...\n";

// Reels kanalini tekshirish (bot u yerda admin bo'lishi shart).
if (REELS_CHANNEL !== '') {
    $chk = apiRequest($apiUrl . 'getChat', ['chat_id' => REELS_CHANNEL], 15);
    echo !empty($chk['ok'])
        ? "Reels kanali: " . REELS_CHANNEL . "\n"
        : "Reels kanali XATO (" . REELS_CHANNEL . "): " . json_encode($chk) . "\n";
}

while (true) {
    // Yangi xabarlarni olish (30 soniya long-poll, curl 70 soniyada uziladi)
    $result = apiRequest($apiUrl . 'getUpdates', ['offset' => $offset, 'timeout' => 30], 70);

    if (!is_array($result) || empty($result['ok'])) {
        echo "Xato: " . ($result === null ? 'curl/json xato' : json_encode($result)) . "\n";
        sleep(5);
        continue;
    }

    if (empty($result['result'])) {
        continue; // yangi xabar yo'q
    }

    foreach ((array) $result['result'] as $update) {
        try {
            $offset = (int) $update['update_id'] + 1;
            saveOffset($offset);

            echo "Update qabul qilindi: " . $update['update_id'] . "\n";

            // Callback query (tugma bosildi)
            if (isset($update['callback_query'])) {
                $callback = $update['callback_query'];
                $chatId = $callback['message']['chat']['id'] ?? 0;
                $userId = $callback['from']['id'] ?? 0;
                $data = $callback['data'] ?? '';

                echo "Callback: $data from user $userId\n";

                if ($data === 'start_registration') {
                    $states[$userId] = [
                        'step' => 'first_name',
                        'chat_id' => $chatId,
                        'telegram_id' => $userId,
                        'first_name' => $callback['from']['first_name'] ?? '',
                        'last_name' => $callback['from']['last_name'] ?? '',
                        'username' => $callback['from']['username'] ?? '',
                    ];
                    saveStates($states);

                    sendMessage($chatId, "👋 Assalomu alaykum!\n\nRo'yxatdan o'tish uchun ismingizni kiriting:");
                    answerCallback($callback['id']);
                } elseif ($data === 'go_to_site') {
                    $user = $db->fetchOne(
                        "SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1",
                        [(string) $userId]
                    );

                    if ($user && !empty($user['is_registered'])) {
                        sendMessage($chatId, "✅ Ro'yxatdan o'tgansiz!\n\nSaytga kirish uchun quyidagi tugmani bosing:", [
                            [['text' => '🌐 Saytga kirish', 'url' => SITE_URL . '/login.php']],
                        ]);
                    } else {
                        sendMessage($chatId, "❌ Avval ro'yxatdan o'tishingiz kerak!");
                    }
                    answerCallback($callback['id']);
                } elseif ($data === 'confirm_yes') {
                    if (!completeRegistration($states, $userId)) {
                        recoverMissingState($states, $userId, $chatId);
                    }
                    answerCallback($callback['id']);
                } elseif ($data === 'confirm_no') {
                    if (isset($states[$userId])) {
                        $states[$userId]['step'] = 'first_name';
                        $states[$userId]['first_name'] = '';
                        saveStates($states);
                        sendMessage($chatId, "Ismingizni qayta kiriting:");
                    } else {
                        recoverMissingState($states, $userId, $chatId);
                    }
                    answerCallback($callback['id']);
                }
                continue;
            }

            // Oddiy xabar
            if (isset($update['message'])) {
                $message = $update['message'];
                $chatId = $message['chat']['id'] ?? 0;
                $userId = $message['from']['id'] ?? 0;
                $text = trim($message['text'] ?? '');

                echo "Xabar: " . ($text !== '' ? $text : '(media)') . " from user $userId\n";

                // /start buyrug'i yoki sayt-login tasdiqlash: /start auth_<token>
                // (t.me/bot?start=auth_TOKEN tugmasi orqali brauzerdan kirish)
                if (preg_match('#^/start auth_([a-f0-9]{32,64})$#', $text, $m)
                    || preg_match('#^auth_([a-f0-9]{32,64})$#', $text, $m)) {
                    $token = $m[1];
                    $row = $db->fetchOne(
                        "SELECT * FROM telegram_login_tokens WHERE token = ? AND consumed = 0 LIMIT 1",
                        [$token]
                    );

                    if ($row && strtotime($row['expires_at']) >= time()) {
                        $db->update('telegram_login_tokens', [
                            'telegram_id'      => (string) $userId,
                            'telegram_chat_id' => (string) $chatId,
                            'first_name'       => $message['from']['first_name'] ?? '',
                            'last_name'        => $message['from']['last_name'] ?? '',
                            'username'         => $message['from']['username'] ?? '',
                        ], 'token = ?', [$token]);

                        $name = trim(($message['from']['first_name'] ?? '') . ' ' . ($message['from']['last_name'] ?? ''));
                        echo "Auth token tasdiqlandi: $token\n";
                        sendMessage($chatId, "✅ Kirish tasdiqlandi" . ($name !== '' ? ", $name" : '') . "!\n\nSayt sahifasi avtomatik kiritadi. Agar chiqmasa, saytga qaytib sahifani yangilang.", [
                            [['text' => '🌐 Saytga qaytish', 'url' => SITE_URL . '/login.php']],
                        ]);
                    } else {
                        echo "Auth token topilmadi/eskirgan: {$m[1]}\n";
                        sendMessage($chatId, "❌ Tasdiqlash-token topilmadi yoki eskirgan.\n\nSaytda kirish sahifasini qayta ochib, yangi tugmani bosing.");
                    }
                    continue;
                }

                // /start buyrug'i
                if ($text === '/start') {
                    // Foydalanuvchi allaqachon ro'yxatdan o'tganmi?
                    $user = $db->fetchOne(
                        "SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1",
                        [(string) $userId]
                    );

                    if ($user && !empty($user['is_registered'])) {
                        sendMessage($chatId, "👋 Xush kelibsiz, {$user['first_name']}!\n\nSiz allaqachon ro'yxatdan o'tgansiz.", [
                            [['text' => '🌐 Saytga kirish', 'url' => SITE_URL . '/login.php']],
                        ]);
                    } else {
                        sendMessage($chatId, "👋 Assalomu alaykum!\n\nW CINEMA platformasiga xush kelibsiz.\n\nRo'yxatdan o'tish uchun quyidagi tugmani bosing:", [
                            [['text' => '📝 Ro\'yxatdan o\'tish', 'callback_data' => 'start_registration']],
                        ]);
                    }
                    continue;
                }

                // ------------------------------------------------------------
                // REELS: saytdan "yuborish" -> botga o'tish
                // ------------------------------------------------------------
                // Sayt api/reel-intent.php orqali token yaratadi va
                // foydalanuvchini shu yerga yo'naltiradi. Biz tokenni
                // eslab qolamiz, keyin kelgan videoni REELS_CHANNEL
                // kanaliga joylaymiz (serverga fayl yozmasdan).
                if (preg_match('#^(?:/start )?reel_([a-f0-9]{32})$#', $text, $rm)) {
                    $token = $rm[1];
                    $row = $db->fetchOne(
                        "SELECT id FROM reels WHERE ingest_token = ? AND video_url IS NULL LIMIT 1",
                        [$token]
                    );
                    if ($row) {
                        if (!isset($states[$userId]) || !is_array($states[$userId])) {
                            $states[$userId] = [];
                        }
                        $states[$userId]['reel_token'] = $token;
                        $states[$userId]['chat_id'] = $chatId;
                        saveStates($states);

                        sendMessage($chatId,
                            "🎬 Reel uchun video tayyor.\n\n"
                            . "Endi <b>videoni yuboring</b> (yoki forward qiling). "
                            . "Qabul qilingach reel avtomatik kanalga joylanadi.");
                    } else {
                        sendMessage($chatId,
                            "❌ Reel havolasi topilmadi yoki eskirgan.\n\n"
                            . "Saytga qaytib, Reels sahifasidan qaytadan yuboring.");
                    }
                    continue;
                }

                // Kelgan video (reel kutilyapti) -> kanalga forward
                if (!empty($states[$userId]['reel_token'])
                    && (isset($message['video']) || isset($message['document']) || isset($message['animation']))) {

                    if (REELS_CHANNEL === '') {
                        sendMessage($chatId, "❌ Reels kanali sozlanmagan. Administratorga murojaat qiling.");
                        continue;
                    }

                    $token = (string) $states[$userId]['reel_token'];
                    $row = $db->fetchOne(
                        "SELECT id FROM reels WHERE ingest_token = ? AND video_url IS NULL LIMIT 1",
                        [$token]
                    );

                    if (!$row) {
                        unset($states[$userId]['reel_token']);
                        saveStates($states);
                        sendMessage($chatId, "❌ Reel topilmadi yoki allaqachon joylangan. Saytdan qaytadan yuboring.");
                        continue;
                    }

                    // Videoni kanalga ko'chiramiz. Fayl qayta yuklanmaydi:
                    // Telegram ichida nusxa ko'chadi, sayt trafigi sarflanmaydi.
                    // Avval copyMessage (foydalanuvchi ismi kanalda ko'rinmaydi),
                    // ishlamasa forwardMessage.
                    $fwd = apiRequest($apiUrl . 'copyMessage', [
                        'chat_id'      => REELS_CHANNEL,
                        'from_chat_id' => $chatId,
                        'message_id'   => (int) $message['message_id'],
                    ], 30);
                    if (empty($fwd['ok'])) {
                        $fwd = apiRequest($apiUrl . 'forwardMessage', [
                            'chat_id'      => REELS_CHANNEL,
                            'from_chat_id' => $chatId,
                            'message_id'   => (int) $message['message_id'],
                        ], 30);
                    }

                    if (empty($fwd['ok']) || empty($fwd['result']['message_id'])) {
                        error_log("bot: reel forward xato: " . json_encode($fwd));
                        sendMessage($chatId,
                            "❌ Videoni kanalga joylab bo'lmadi.\n\n"
                            . "Sabab: bot kanalda admin emas yoki post huquqi yo'q. "
                            . "Administrator botni <b>" . htmlspecialchars(REELS_CHANNEL, ENT_QUOTES) . "</b> "
                            . "kanaliga admin qilib qo'shishi kerak.");
                        continue;
                    }

                    $post     = (int) $fwd['result']['message_id'];
                    $chanUser = (REELS_CHANNEL[0] === '@') ? substr(REELS_CHANNEL, 1) : null;
                    $link     = $chanUser ? 'https://t.me/' . $chanUser . '/' . $post : null;

                    $db->update('reels', [
                        'video_url'    => $link,
                        'channel_post' => $post,
                        'ingest_token' => null,
                        'status'       => REELS_REQUIRE_APPROVAL ? 0 : 1,
                    ], 'id = ?', [(int) $row['id']]);

                    unset($states[$userId]['reel_token']);
                    saveStates($states);

                    sendMessage($chatId,
                        "✅ Reel kanalga joylandi!" . ($link ? "\n\n" . $link : '')
                        . "\n\nSaytda ko'rish uchun Reels bo'limiga qayting.", [
                            [['text' => '🎬 Reelsni ochish', 'url' => SITE_URL . '/reels.php']],
                        ]);
                    continue;
                }

                // Ro'yxatdan o'tish jarayoni
                if (isset($states[$userId]['step'])) {
                    $state = $states[$userId];

                    // Ism
                    if ($state['step'] === 'first_name') {
                        if ($text === '') {
                            sendMessage($chatId, "Iltimos, ismingizni kiriting:");
                            continue;
                        }
                        $states[$userId]['first_name'] = $text;
                        $states[$userId]['step'] = 'last_name';
                        saveStates($states);
                        sendMessage($chatId, "Familiyangizni kiriting:");
                    }
                    // Familiya
                    elseif ($state['step'] === 'last_name') {
                        if ($text === '') {
                            sendMessage($chatId, "Iltimos, familiyangizni kiriting:");
                            continue;
                        }
                        $states[$userId]['last_name'] = $text;
                        $states[$userId]['step'] = 'age';
                        saveStates($states);
                        sendMessage($chatId, "Yoshingizni kiriting (raqamda):");
                    }
                    // Yosh
                    elseif ($state['step'] === 'age') {
                        if (!preg_match('/^\d{1,3}$/', $text)) {
                            sendMessage($chatId, "❌ Noto'g'ri yosh! Iltimos, 5-120 orasidagi raqamni kiriting:");
                            continue;
                        }
                        $age = (int) $text;
                        if ($age < 5 || $age > 120) {
                            sendMessage($chatId, "❌ Noto'g'ri yosh! Iltimos, 5-120 orasidagi raqamni kiriting:");
                            continue;
                        }

                        $states[$userId]['age'] = $age;
                        $states[$userId]['step'] = 'confirm';
                        saveStates($states);

                        sendMessage($chatId, "Ma'lumotlaringiz:\n\n" .
                            "👤 Ism: {$states[$userId]['first_name']}\n" .
                            "👤 Familiya: {$states[$userId]['last_name']}\n" .
                            "🎂 Yosh: {$age}\n\n" .
                            "Bu ma'lumotlar to'g'rimi?\n\n" .
                            "<i>(Tugmalar ishlamasa, \"ha\" yoki \"yo'q\" deb yozing)</i>", [
                                [['text' => '✅ Ha', 'callback_data' => 'confirm_yes'], ['text' => '❌ Yo\'q', 'callback_data' => 'confirm_no']],
                            ]);
                    }
                    // Tasdiqlash - matnli javob (tugma ishlamasa)
                    elseif ($state['step'] === 'confirm') {
                        $t = mb_strtolower($text);
                        if (in_array($t, ['ha', 'yes', 'y', '1', 'haa', 'xo\'p', "xo'p", 'tog\'ri', "to'g'ri"], true)) {
                            if (!completeRegistration($states, $userId)) {
                                recoverMissingState($states, $userId, $chatId);
                            }
                        } elseif (in_array($t, ['yo\'q', 'no', 'n', '0', 'noto\'g\'ri', "noto'g'ri"], true)) {
                            $states[$userId]['step'] = 'first_name';
                            $states[$userId]['first_name'] = '';
                            saveStates($states);
                            sendMessage($chatId, "Ismingizni qayta kiriting:");
                        } else {
                            // Boshqa xabar - taklifni qayta ko'rsatamiz
                            sendMessage($chatId, "Iltimos, <b>ha</b> yoki <b>yo'q</b> deb javob bering yoki tugmalardan birini bosing.");
                        }
                    }
                    continue;
                }

                // Hech qanday state yo'q - ma'lum xabar
                if ($text !== '') {
                    sendMessage($chatId, "Iltimos, /start buyrug'ini yuboring.");
                }
            }
        } catch (Throwable $e) {
            echo "Update ishlovida xato: " . $e->getMessage() . "\n";
            error_log("bot: update xato: " . $e->getMessage() . " @ " . $e->getFile() . ":" . $e->getLine());
        }
    }

    sleep(1);
}