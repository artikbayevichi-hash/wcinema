<?php
// ============================================================================
// Telegram Bot - W CINEMA SUPPORT (qo'llab-quvvatlash boti)
// ============================================================================
// Bu skript bot'ni polling orqali boshqaradi. Vazifalari:
//   1. Foydalanuvchi savollariga FAQ (tayyor javoblar) menyusi ko'rsatish
//   2. "Savol berish" — savolni adminlarga (yoki support guruhga) uzatish
//      va adminning reply-javobini foydalanuvchiga qaytarish
//   3. Saytga kirishni tasdiqlash (/start auth_<token>)
//   4. Reels uchun video qabul qilish (/start reel_<token>) -> kanalga joylash
//
// Ishonchlilik uchun:
//  - har bir curl so'rovida aniq TIMEOUT bor (ulanish tursa bot qotib qolmaydi)
//  - getUpdates javobi null bo'lsa ham xato emas, davom etadi
//  - har bir update alohida try/catch bilan ishlanadi - bitta update bot'ni
//    o'ldira olmaydi
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

// Foydalanuvchi holati (reel_token kutish va h.k.)
$statesFile = __DIR__ . '/bot_states.json';
$states = file_exists($statesFile) ? (json_decode(file_get_contents($statesFile), true) ?: []) : [];

// Support "ticket" xaritasi: "<chat>:<message_id>" => foydalanuvchi chat_id.
// Admin qaysi xabarga reply qilsa, o'sha foydalanuvchiga javob qaytaramiz.
$ticketsFile = __DIR__ . '/bot_tickets.json';
$tickets = file_exists($ticketsFile) ? (json_decode(file_get_contents($ticketsFile), true) ?: []) : [];

// Support guruhining RAQAMLI chat id'si (TG_SUPPORT_CHAT @username bo'lsa,
// javob kaliti mos kelishi uchun ishga tushishda aniqlanadi).
$supportChatId = '';

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
    // past bo'lsa) ham curl'ni majburan uzamiz - bot hech qachon
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
        'disable_web_page_preview' => true,
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
 * Mavjud xabar matnini (va tugmalarini) tahrirlash.
 */
function editMessageText($chatId, $messageId, $text, $keyboard = null) {
    global $apiUrl;

    $data = [
        'chat_id'    => $chatId,
        'message_id' => (int) $messageId,
        'text'       => $text,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true,
    ];
    if ($keyboard) {
        $data['reply_markup'] = json_encode(['inline_keyboard' => $keyboard], JSON_UNESCAPED_UNICODE);
    }
    return apiRequest($apiUrl . 'editMessageText', $data);
}

/**
 * Callback javob
 */
function answerCallback($callbackId, $text = '', $showAlert = false) {
    global $apiUrl;

    apiRequest($apiUrl . 'answerCallbackQuery', [
        'callback_query_id' => $callbackId,
        'text' => $text,
        'show_alert' => $showAlert,
    ], 10);
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
 * Ticket xaritasini saqlash (eski yozuvlarni tozalab).
 */
function saveTickets($tickets) {
    global $ticketsFile;
    $now = time();
    foreach ($tickets as $k => $v) {
        if (!is_array($v) || ($now - (int) ($v['ts'] ?? 0)) > 30 * 86400) {
            unset($tickets[$k]);
        }
    }
    if (count($tickets) > 2000) {
        $tickets = array_slice($tickets, -2000, null, true);
    }
    file_put_contents($ticketsFile, json_encode($tickets, JSON_UNESCAPED_UNICODE));
}

/** HTML uchun xavfsiz matn. */
function h($s) {
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

/** Foydalanuvchi ismini chiqarish. */
function displayName($from) {
    $name = trim((string) ($from['first_name'] ?? '') . ' ' . (string) ($from['last_name'] ?? ''));
    return $name !== '' ? $name : 'Do\'stim';
}

// ============================================================================
// Support bot matnlari
// ============================================================================

/** FAQ bo'limlari: kalit => tugma yozuvi. */
function faqTopics() {
    return [
        'login'   => "🔐 Kirish va ro'yxatdan o'tish",
        'reels'   => '📤 Reels yuklash',
        'video'   => '🎬 Video ochilmayapti',
        'account' => '👤 Profil va hisob',
    ];
}

/** FAQ tayyor javobi. */
function faqAnswer($key) {
    switch ($key) {
        case 'login':
            return "🔐 <b>Saytga kirish</b>\n\n"
                . "W CINEMA'ga Telegram orqali kirasiz — alohida parol yo'q.\n\n"
                . "1. Saytni ochib <b>«🤖 Kirish»</b> tugmasini bosing;\n"
                . "2. Telegram'da ochilgan botda <b>[Boshlash]</b> ni bosing;\n"
                . "3. Saytga qaytsangiz — avtomatik kiritadi.\n\n"
                . "Agar kirmasa: sahifani yangilab, tugmani yana bir marta bosing.";
        case 'reels':
            return "📤 <b>Reels yuklash</b>\n\n"
                . "Saytdagi <b>Reels</b> bo'limida <b>«+»</b> tugmasini bosing va video yoki rasm(lar)ni tanlang.\n\n"
                . "• <b>Video</b> uchun botga o'tib videoni yuborasiz — u avtomatik kanalga joylanadi.\n"
                . "• <b>Rasm</b>larni (bir nechta) to'g'ridan-to'g'ri saytda yuklaysiz — galereya bo'lib chiqadi.";
        case 'video':
            return "🎬 <b>Video ochilmayapti</b>\n\n"
                . "• Internet aloqasini tekshiring;\n"
                . "• Sahifani yangilang (F5) yoki ilovani qayta oching;\n"
                . "• Boshqa brauzerda sinab ko'ring;\n"
                . "• Video hali moderatsiyada bo'lishi mumkin.\n\n"
                . "Baribir ochilmasa — savolingizni shu chatga yozing, operatorimiz yordam beradi.";
        case 'account':
            return "👤 <b>Profil va hisob</b>\n\n"
                . "Profil sahifasida ismingiz, @username, rasmlar va statistikangiz ko'rinadi.\n\n"
                . "Hisob Telegram akkauntingizga bog'langan — shu sabab qo'shimcha parol kerak emas.";
        default:
            return "❓ Ma'lumot topilmadi. Savolingizni shu chatga yozib yuboring — operatorimiz javob beradi.";
    }
}

/** Asosiy menyu tugmalari. */
function mainMenu() {
    $rows = [];
    foreach (faqTopics() as $key => $title) {
        $rows[] = [['text' => $title, 'callback_data' => 'faq_' . $key]];
    }
    $rows[] = [['text' => '✍️ Savol berish (operator)', 'callback_data' => 'support_ask']];
    if (SITE_URL !== '') {
        $rows[] = [['text' => '🌐 Saytni ochish', 'url' => SITE_URL . '/login.php']];
    }
    return $rows;
}

/** Asosiy xabar matni. */
function mainText($from) {
    $name = displayName($from);
    $hi   = ($name !== '') ? ', <b>' . h($name) . '</b>' : '';
    return "🎬 <b>W CINEMA — Qo'llab-quvvatlash</b>\n\n"
        . "Assalomu alaykum{$hi}! 👋\n\n"
        . "Rasmiy qo'llab-quvvatlash botiga xush kelibsiz.\n"
        . "Quyidagi bo'limlardan birini tanlang yoki savolingizni shu chatga "
        . "yozib yuboring — operatorlarimiz imkon qadar tez javob beradi.";
}

/** Savol qabul qilinganini bildiruvchi qisqa matn. */
function supportAck() {
    return "✅ Savolingiz qabul qilindi. Operatorlarimiz tez orada javob beradi.\n\n"
        . "Yana savolingiz bo'lsa, shu chatga yozishingiz mumkin.";
}

/**
 * Savol yuboriladigan manzillar:
 *  - TG_SUPPORT_CHAT (guruh) bo'lsa — o'shanga;
 *  - aks holda har bir ADMIN_TELEGRAM_IDS adminining shaxsiy chatiga.
 *
 * @return array<string>
 */
function supportTargets() {
    global $supportChatId;

    if (TG_SUPPORT_CHAT !== '') {
        // Guruh @username bo'lsa ham reply-kaliti uchun raqamli id ishlatiladi.
        return [ $supportChatId !== '' ? $supportChatId : TG_SUPPORT_CHAT ];
    }

    $targets = [];
    foreach (ADMIN_TELEGRAM_IDS as $id) {
        $id = trim((string) $id);
        if ($id !== '') $targets[] = $id;
    }
    return $targets;
}

/**
 * Savolni support manziliga yuborish.
 *
 * @return bool Yuborildimi?
 */
function sendToSupport($message, $from, $chatId, &$tickets) {
    global $apiUrl;

    $targets = supportTargets();
    if (!$targets) return false;

    $uid   = (string) ($from['id'] ?? $chatId);
    $name  = displayName($from);
    $uname = (isset($from['username']) && $from['username'] !== '')
        ? '@' . $from['username'] : '';

    $head = "🆘 <b>Yangi savol</b>\n"
        . "👤 " . h($name) . ($uname !== '' ? ' ' . h($uname) : '') . "\n"
        . "🆔 <code>" . h($uid) . "</code>\n"
        . "↩️ Javob berish uchun shu xabarga <b>reply</b> qiling.\n"
        . "────────────";

    $msgId  = (int) ($message['message_id'] ?? 0);
    $isText = isset($message['text']) && trim((string) $message['text']) !== '';

    $ok = false;
    foreach ($targets as $target) {
        // 1) Sarlavha (kim, qaysi id) — javobni kuzatish uchun shu xabar id'si
        $headRes = sendMessage($target, $head);
        $headId  = $headRes['result']['message_id'] ?? null;

        // 2) Foydalanuvchi xabarining o'zi (matn yoki media)
        $bodyData = [
            'chat_id'      => $target,
            'from_chat_id' => $chatId,
            'message_id'   => $msgId,
        ];
        $bodyRes = apiRequest($apiUrl . 'copyMessage', $bodyData, $isText ? 20 : 30);
        $bodyId  = $bodyRes['result']['message_id'] ?? null;

        if ($headId) {
            $tickets[$target . ':' . $headId] = ['user' => $chatId, 'ts' => time()];
            $ok = true;
        }
        if ($bodyId) {
            $tickets[$target . ':' . $bodyId] = ['user' => $chatId, 'ts' => time()];
            $ok = true;
        }
    }
    return $ok;
}

// ============================================================================
// Ishga tushganda: bot profilini va menyusini sozlash
// ============================================================================
error_log("bot: support bot ishga tushdi");

// Bot nomi va tavsifi (BotFather'dagi sozlamalar bilan mos bo'lsin).
apiRequest($apiUrl . 'setMyName', ['name' => 'W CINEMA SUPPORT'], 15);
apiRequest($apiUrl . 'setMyShortDescription', [
    'short_description' => "W CINEMA rasmiy qo'llab-quvvatlash xizmati",
], 15);
apiRequest($apiUrl . 'setMyDescription', [
    'description' => "W CINEMA rasmiy qo'llab-quvvatlash boti.\n\n"
        . "Savollaringizga javob beramiz: saytga kirish, reels yuklash, "
        . "video bilan bog'liq muammolar va boshqa masalalar.\n\n"
        . "Savolingizni shu chatga yozib yuboring — operatorimiz javob beradi.",
], 15);

// Command'lar ro'yxati.
apiRequest($apiUrl . 'setMyCommands', [
    'commands' => json_encode([
        ['command' => 'start',   'description' => "Botni boshlash / menyu"],
        ['command' => 'help',    'description' => "Yordam va savollar"],
        ['command' => 'support', 'description' => "Savol berish"],
    ], JSON_UNESCAPED_UNICODE),
], 15);

// Menu button - joriy sayt URL'i (tunnel har restartda o'zgaradi).
error_log("bot: menu_button -> " . MINI_APP_URL);
$menuRes = apiRequest($apiUrl . 'setChatMenuButton', [
    'menu_button' => json_encode([
        'type' => 'web_app',
        'text' => '🌐 W CINEMA',
        'web_app' => ['url' => MINI_APP_URL],
    ], JSON_UNESCAPED_UNICODE),
], 15);
echo !empty($menuRes['ok'])
    ? "Menu button yangilandi: " . MINI_APP_URL . "\n"
    : "setChatMenuButton xato: " . json_encode($menuRes) . "\n";

echo "Bot polling boshlandi (W CINEMA SUPPORT)...\n";

// Reels kanalini tekshirish (bot u yerda admin bo'lishi shart).
if (REELS_CHANNEL !== '') {
    $chk = apiRequest($apiUrl . 'getChat', ['chat_id' => REELS_CHANNEL], 15);
    echo !empty($chk['ok'])
        ? "Reels kanali: " . REELS_CHANNEL . "\n"
        : "Reels kanali XATO (" . REELS_CHANNEL . "): " . json_encode($chk) . "\n";
}

// Support manzili (guruh) bo'lsa tekshiramiz va raqamli id'sini olamiz.
if (TG_SUPPORT_CHAT !== '') {
    $chk = apiRequest($apiUrl . 'getChat', ['chat_id' => TG_SUPPORT_CHAT], 15);
    if (!empty($chk['ok']) && isset($chk['result']['id'])) {
        $supportChatId = (string) $chk['result']['id'];
        echo "Support guruhi: " . TG_SUPPORT_CHAT . " (id: {$supportChatId})\n";
    } else {
        echo "Support guruhi XATO (" . TG_SUPPORT_CHAT . "): " . json_encode($chk) . "\n";
    }
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

            // -----------------------------------------------------------------
            // Inline tugmalar
            // -----------------------------------------------------------------
            if (isset($update['callback_query'])) {
                $callback = $update['callback_query'];
                $chatId   = $callback['message']['chat']['id'] ?? 0;
                $msgId    = $callback['message']['message_id'] ?? 0;
                $userId   = $callback['from']['id'] ?? 0;
                $data     = $callback['data'] ?? '';

                echo "Callback: $data from user $userId\n";

                // Guruh/kanaldagi tugmalar (support guruhi bundan mustasno)
                // e'tiborsiz qoldiriladi.
                $cbType = $callback['message']['chat']['type'] ?? 'private';
                $cbFromSupport = (TG_SUPPORT_CHAT !== '')
                    && ((string) $chatId === (string) TG_SUPPORT_CHAT
                        || ($supportChatId !== '' && (string) $chatId === $supportChatId));
                if ($cbType !== 'private' && !$cbFromSupport) {
                    answerCallback($callback['id']);
                    continue;
                }

                if (strpos($data, 'faq_') === 0) {
                    $key    = substr($data, 4);
                    $answer = faqAnswer($key);
                    $kb = [
                        [['text' => '⬅️ Orqaga', 'callback_data' => 'menu']],
                        [['text' => '✍️ Savol berish', 'callback_data' => 'support_ask']],
                    ];
                    $res = editMessageText($chatId, $msgId, $answer, $kb);
                    if (empty($res['ok'])) {
                        sendMessage($chatId, $answer, $kb);
                    }
                    answerCallback($callback['id']);
                } elseif ($data === 'menu') {
                    $from = $callback['from'] ?? [];
                    $res  = editMessageText($chatId, $msgId, mainText($from), mainMenu());
                    if (empty($res['ok'])) {
                        sendMessage($chatId, mainText($from), mainMenu());
                    }
                    answerCallback($callback['id']);
                } elseif ($data === 'support_ask') {
                    sendMessage($chatId,
                        "✍️ Savolingizni yoki murojaatingizni <b>shu chatga yozib yuboring</b> — "
                        . "operatorimiz tez orada javob beradi.\n\n"
                        . "<i>Matn, rasm yoki videoni yuborishingiz mumkin.</i>");
                    answerCallback($callback['id']);
                } else {
                    answerCallback($callback['id']);
                }
                continue;
            }

            // -----------------------------------------------------------------
            // Oddiy xabar
            // -----------------------------------------------------------------
            if (!isset($update['message'])) {
                continue;
            }

            $message = $update['message'];
            $chatId  = $message['chat']['id'] ?? 0;
            $userId  = $message['from']['id'] ?? 0;
            $from    = $message['from'] ?? [];
            $text    = trim($message['text'] ?? '');

            $isAdmin          = in_array((string) $userId, ADMIN_TELEGRAM_IDS, true);
            $fromSupportGroup = (TG_SUPPORT_CHAT !== '')
                && ((string) $chatId === (string) TG_SUPPORT_CHAT
                    || ($supportChatId !== '' && (string) $chatId === $supportChatId));

            echo "Xabar: " . ($text !== '' ? $text : '(media)') . " from user $userId\n";

            // Bot biror GURUHDA ham a'zo bo'lsa, u yerdagi oddiy xabarlar
            // "savol" deb adminlarga uzatilib ketmasligi kerak. Faqat shaxsiy
            // chat va support guruhi bilan ishlaymiz (support guruhining o'zi
            // pastda alohida ishlanadi).
            $chatType = $message['chat']['type'] ?? 'private';
            if ($chatType !== 'private' && !$fromSupportGroup) {
                continue;
            }

            // --- 1) Admin/support-guruh javobi (reply) -> foydalanuvchiga qaytarish
            if (($isAdmin || $fromSupportGroup) && isset($message['reply_to_message'])) {
                $rid = (int) $message['reply_to_message']['message_id'];
                $key = $chatId . ':' . $rid;
                if (isset($tickets[$key]['user'])) {
                    $toUser    = $tickets[$key]['user'];
                    $replyText = trim((string) ($message['text'] ?? ''));

                    if ($replyText !== '') {
                        sendMessage($toUser,
                            "💬 <b>Qo'llab-quvvatlash javobi:</b>\n\n" . h($replyText));
                    } else {
                        // Media ko'rinishidagi javob
                        apiRequest($apiUrl . 'copyMessage', [
                            'chat_id'      => $toUser,
                            'from_chat_id' => $chatId,
                            'message_id'   => (int) $message['message_id'],
                        ], 30);
                        sendMessage($toUser, "💬 <b>Qo'llab-quvvatlash javobi.</b>");
                    }
                    echo "Ticket #$key -> user $toUser ga javob yuborildi\n";
                    continue;
                }
            }

            // Support guruhdagi boshqa xabarlar (reply bo'lmagan) e'tiborsiz.
            if ($fromSupportGroup) {
                continue;
            }

            // --- 2) Sayt-login tasdiqlash: /start auth_<token>
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
                        'first_name'       => $from['first_name'] ?? '',
                        'last_name'        => $from['last_name'] ?? '',
                        'username'         => $from['username'] ?? '',
                    ], 'token = ?', [$token]);

                    $name = displayName($from);
                    echo "Auth token tasdiqlandi: $token\n";
                    sendMessage($chatId,
                        "✅ Kirish tasdiqlandi, <b>" . h($name) . "</b>!\n\n"
                        . "Sayt sahifasi avtomatik kiritadi. Agar chiqmasa, saytga qaytib "
                        . "sahifani yangilang.", mainMenu());
                } else {
                    echo "Auth token topilmadi/eskirgan: {$m[1]}\n";
                    sendMessage($chatId,
                        "❌ Tasdiqlash-token topilmadi yoki eskirgan.\n\n"
                        . "Saytda kirish sahifasini qayta ochib, yangi tugmani bosing.");
                }
                continue;
            }

            // --- 3) REELS: /start reel_<token> -> video kutish
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

            // --- 4) Reel kutilayotgan video -> kanalga joylash
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
                        . "Administrator botni <b>" . h(REELS_CHANNEL) . "</b> "
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

            // --- 5) Command'lar
            $cmd = $text;
            if ($cmd !== '' && $cmd[0] === '/') {
                // /start@bot_name -> /start
                $cmd = preg_replace('#^(\/\w+)@\w+$#', '$1', $cmd);
            }

            if ($cmd === '/start' || $cmd === '/help' || $cmd === '/menu') {
                sendMessage($chatId, mainText($from), mainMenu());
                continue;
            }

            if ($cmd === '/support' || $cmd === '/savol') {
                sendMessage($chatId,
                    "✍️ Savolingizni <b>shu chatga yozib yuboring</b> — operatorimiz tez orada javob beradi.");
                continue;
            }

            // --- 6) Adminning o'z xabarlari support'ga uzatilmaydi
            if ($isAdmin) {
                // Adminlar botni oddiy foydalanuvchi sifatida ishlatishi mumkin;
                // ammo ularning matni support'ga yuborilmaydi.
                if ($text !== '') {
                    sendMessage($chatId, "ℹ️ Menyu uchun /start buyrug'ini yuboring.");
                }
                continue;
            }

            // --- 7) Qolgan har qanday xabar = foydalanuvchi savoli -> support'ga
            $sent = sendToSupport($message, $from, $chatId, $tickets);
            saveTickets($tickets);

            if ($sent) {
                sendMessage($chatId, supportAck(), [
                    [['text' => '📋 Bo\'limlar', 'callback_data' => 'menu']],
                ]);
            } else {
                sendMessage($chatId,
                    "⚠️ Savolni yuborib bo'lmadi — support manzili sozlanmagan yoki vaqtincha xatolik.\n\n"
                    . "Iltimos, keyinroq qayta urinib ko'ring."
                    . (SITE_URL !== '' ? "\n\n🌐 " . SITE_URL : ''));
            }
        } catch (Throwable $e) {
            echo "Update ishlovida xato: " . $e->getMessage() . "\n";
            error_log("bot: update xato: " . $e->getMessage() . " @ " . $e->getFile() . ":" . $e->getLine());
        }
    }

    sleep(1);
}
