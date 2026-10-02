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

$auth = new Auth();

// Agar allaqachon login bo'lgan bo'lsa - shunchaki "done" qaytaramiz
if ($auth->isLoggedIn()) {
    echo json_encode(['done' => true, 'pending' => false, 'message' => 'ok']);
    exit;
}

$token = $_GET['token'] ?? '';
if ($token === '') {
    echo json_encode(['done' => false, 'pending' => false, 'message' => 'token berilmagan']);
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
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);