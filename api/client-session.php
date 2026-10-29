<?php
// ============================================================================
// api/client-session.php - brauzer uchun IMZOLANGAN sessiya (cookie)
// ============================================================================
// Sayt brauzerdagi MTProto (GramJS) orqali ishlagani uchun serverda PHP
// sessiyasi yo'q. Shu sabab joriy foydalanuvchi `tg_me` JSON'i bilan
// aniqlanardi — bu har kimga boshqa odam nomidan ish qilish imkonini
// berardi. Endi server o'z sessiyasini beradi va uni HttpOnly cookie'da
// saqlaydi; `clientUserId()` esa faqat shu cookie'ni tekshiradi.
//
//   GET                         -> joriy sessiya holati
//   POST action=issue          -> sessiya berish (isbot talab qilinadi)
//   POST action=logout         -> sessiyani bekor qilish
//
// ISBOT TARTIBI (birinchi ishlaydigan variant olinadi):
//   1) `initData` — Telegram Mini App imzosi (HMAC). Eng ishonchli.
//   2) `login_token` — bot tomonidan TASDIQLANGAN bir martalik token
//      (`/start auth_<token>`). Brauzer uchun mo'ljallangan.
//   3) `tg_me` — vaqtinchalik moslik rejimi, faqat TG_TRUST_CLIENT_ID=1
//      bo'lganda. Ishlab chiqish/tunnel davrida saytni buzmaslik uchun;
//      production'da 0 qilinishi kerak (u holda 1-2-band ishlaydi).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/ClientSessions.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = input('action', 'issue', 20);

// --------------------------------------------------------------------- GET
if ($method === 'GET') {
    $uid = ClientSessions::currentUserId();
    if ($uid <= 0) {
        ok(['authenticated' => false, 'user_id' => 0]);
    }
    $u = $auth->getUserById($uid);
    ok([
        'authenticated' => true,
        'user_id'       => $uid,
        'user'          => $u ? [
            'id'         => (int) $u['id'],
            'first_name' => (string) ($u['first_name'] ?? ''),
            'last_name'  => (string) ($u['last_name'] ?? ''),
            'username'   => (string) ($u['username'] ?? ''),
            'avatar'     => (string) ($u['avatar'] ?? ''),
        ] : null,
        'trust_mode'    => TG_TRUST_CLIENT_ID,
    ]);
}

if ($method !== 'POST') {
    fail('GET yoki POST kerak', 405);
}

// ------------------------------------------------------------------ LOGOUT
if ($action === 'logout') {
    ClientSessions::revokeCurrent();
    // PHP sessiyasi ham bo'lsa — uni ham yopamiz.
    $auth->logout();
    ok(['logged_out' => true]);
}

if ($action !== 'issue') {
    fail('Noma\'lum amal', 400);
}

// ------------------------------------------------------------------- ISSUE
$uid = 0;
$how = '';

// 1) Telegram Mini App initData (imzolangan) -------------------------------
$initData = (string) ($_POST['initData'] ?? $_GET['initData'] ?? '');
if ($initData !== '' && strlen($initData) <= 8192) {
    $tg = new TelegramBot();
    if ($tg->validateInitData($initData) === true) {
        $parsed = $tg->parseInitData($initData);
        $tgUser = $parsed['user'] ?? null;
        if (is_array($tgUser) && !empty($tgUser['id'])) {
            $uid = (int) $auth->ensureUserFromClient($tgUser);
            $how = 'initData';
        }
    }
}

// 2) Bot tasdiqlagan bir martalik token ------------------------------------
if ($uid <= 0) {
    $loginToken = preg_replace('/[^a-f0-9]/', '', strtolower((string) input('login_token', '', 128)));
    if (strlen($loginToken) >= 32) {
        $db  = Database::getInstance();
        $row = $db->fetchOne(
            "SELECT * FROM telegram_login_tokens
              WHERE token = ? AND consumed = 0 AND expires_at > NOW() LIMIT 1",
            [$loginToken]
        );
        if ($row && !empty($row['telegram_id'])) {
            $db->update('telegram_login_tokens', ['consumed' => 1], 'token = ?', [$loginToken]);
            $uid = (int) $auth->ensureUserFromClient([
                'id'         => (string) $row['telegram_id'],
                'first_name' => $row['first_name'] ?? 'User',
                'last_name'  => $row['last_name'] ?? '',
                'username'   => $row['username'] ?? '',
            ]);
            $how = 'bot_token';
        }
    }
}

// 3) Vaqtinchalik moslik rejimi (faqat TG_TRUST_CLIENT_ID=1) ---------------
if ($uid <= 0 && TG_TRUST_CLIENT_ID) {
    $raw = (string) ($_POST['tg_me'] ?? $_GET['tg_me'] ?? '');
    if ($raw !== '' && $raw[0] === '{') {
        $tg = json_decode($raw, true);
        if (is_array($tg) && !empty($tg['id']) && ctype_digit((string) $tg['id'])) {
            $uid = (int) $auth->ensureUserFromClient($tg);
            $how = 'trust_mode';
        }
    }
}

if ($uid <= 0) {
    fail('Sessiya yaratish uchun tasdiq topilmadi (initData yoki bot tokeni kerak)', 401);
}

// Cookie allaqachon shu foydalanuvchiga tegishli bo'lsa — yangisini yaratmaymiz
// (har sahifa ochilishida ortiqcha DB yozuvi bo'lmasligi uchun).
if (ClientSessions::currentUserId() === $uid) {
    ok(['user_id' => $uid, 'reused' => true, 'method' => $how]);
}

$token = ClientSessions::issue($uid);
if ($token === '') {
    fail('Sessiya yaratilmadi', 500);
}

ok([
    'user_id'      => $uid,
    'reused'       => false,
    'method'       => $how,
    'expires_days' => ClientSessions::TTL_DAYS,
]);
