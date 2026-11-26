<?php
// ============================================================================
// BOT-orqali-login tasdiqlashni tekshirish (login.php polling qiladigan endpoint)
// ============================================================================
// login.php brauzerda avtomatik ravishda har 2.5 soniyada shu faylni chaqiradi.
// Bot "/start auth_TOKEN" bilan tasdiqlagan bo'lsa - token iste'mol qilinib,
// sessiya ochiladi va {done:true} qaytadi (JS index.php ga o'tkazadi).
//
// Javob: JSON {done:bool, pending:bool, message:string}
// ============================================================================

require_once __DIR__ . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// Autentifikatsiyasiz polling cheksiz ko'payib ketmasligi uchun cheklov.
// login.php har 2.5 s so'raydi (~24/min), 60/min limit oddiy oqimga xalaqit
// bermaydi, lekin soxtalashtirilgan oqimni to'xtatadi.
if (class_exists('RateLimit')) {
    RateLimit::enforce('login_poll', 60, 60);
}

$auth = new Auth();

// Agar allaqachon login bo'lgan bo'lsa - shunchaki "done" qaytaramiz
if ($auth->isLoggedIn()) {
    echo json_encode(['done' => true, 'pending' => false, 'message' => 'ok']);
    exit;
}

$token = $_GET['token'] ?? $_POST['token'] ?? '';
if (!is_string($token) || !preg_match('/^[a-f0-9]{32,128}$/', $token)) {
    echo json_encode(['done' => false, 'pending' => false, 'message' => 'token berilmagan']);
    exit;
}

// Faqat shu brauzerdagi login.php yaratgan token qabul qilinadi. Aks holda
// boshqa brauzer/ origin'dan olingan tasdiqlangan token bilan kirish mumkin.
$expected = (string) ($_SESSION['login_token'] ?? '');
if ($expected !== '' && !hash_equals($expected, $token)) {
    echo json_encode(['done' => false, 'pending' => false, 'message' => 'token noto\'g\'ri', 'reason' => 'mismatch']);
    exit;
}

$result = $auth->loginWithBotToken($token);

$out = [
    'done'    => !empty($result['success']),
    'pending' => !empty($result['pending']),
    'message' => $result['message'] ?? '',
];
if (!empty($result['success'])) {
    $out['redirect'] = 'index.php';
} elseif (empty($result['pending']) && isset($_SESSION['login_token'])
    && hash_equals((string) $_SESSION['login_token'], $token)) {
    // Token ishlatilgan yoki muddati o'tgan: eski tokenni o'chiramizki,
    // sahifa qayta ochilganda login.php yangisini yaratadi ("Qayta boshlash").
    unset($_SESSION['login_token']);
    $out['reason'] = 'stale';
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);