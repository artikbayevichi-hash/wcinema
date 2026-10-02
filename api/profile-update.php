<?php
// ============================================================================
// api/profile-update.php - profilni tahrirlash (faqat o'z profili, POST)
// ============================================================================
//   POST  first_name   -> ism (2-50 belgi)
//         bio          -> bio (0-300 belgi)
//         username     -> @username (lotin, raqam, _ ; UNIQUE)
//         avatar       -> avatar URL (ixtiyoriy, 500 belgigacha)
//
// Xavfsizlik: requireUser() - faqat login qilgan foydalanuvchi o'z
// profilini o'zgartira oladi. Host tekshiruvi + CSRF office boshqalar:
// bu API faqat POST qabul qiladi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST kerak', 405);
}

requireUser();

$fields = [];
$errors = [];

// --- Ism
$firstName = input('first_name', '', 50);
$firstName = trim(preg_replace('/\s+/', ' ', strip_tags($firstName)));
if ($firstName === '' || mb_strlen($firstName) < 2) {
    $errors[] = 'Ism kamida 2 ta belgidan iborat bo\'lishi kerak';
} else {
    $fields['first_name'] = mb_substr($firstName, 0, 50);
}

// --- Familiya (ixtiyoriy)
$lastName = input('last_name', '', 50);
$fields['last_name'] = mb_substr(trim(strip_tags($lastName)), 0, 50) ?: null;

// --- Bio (ixtiyoriy)
$bio = input('bio', '', 300);
$fields['bio'] = mb_substr(trim(strip_tags($bio)), 0, 300) ?: null;

// --- Username (UNIQUE). Bo'sh bo'lsa - o'zgartirilmaydi
$username = input('username', '', 50);
if ($username !== '') {
    $username = preg_replace('/[^A-Za-z0-9_]/', '', $username);
    $username = substr($username, 0, 40);
    if ($username === '') {
        $errors[] = 'Username faqat lotin harflar, raqam va _ dan iborat bo\'lishi kerak';
    } else {
        $dup = Database::getInstance()->fetchOne(
            "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
            [$username, (int) $userId]
        );
        if ($dup) {
            $errors[] = 'Bu username band';
        } else {
            $fields['username'] = $username;
        }
    }
}

// --- Avatar (URL, ixtiyoriy; faqat http(s))
$avatar = input('avatar', '', 500);
if ($avatar !== '') {
    if (preg_match('#^https?://#i', $avatar)) {
        $fields['avatar'] = $avatar;
    } else {
        $errors[] = 'Avatar faqat http(s) URL bo\'lishi kerak';
    }
}

if ($errors) {
    fail(implode('. ', $errors), 422);
}

if (!$fields) {
    ok(['updated' => false, 'message' => 'Hech narsa o\'zgarmadi']);
}

// "null" qiymatlar Database::update da ishlamasligi mumkin - ASOSIY o'zgarish:
// bo'sh avatar bitta "tozalash" tugmasi orqali boshqariladi (HTML da).
$ok = Database::getInstance()->update('users', $fields, 'id = ?', [(int) $userId]);
if ($ok === false) {
    fail('Profilni yangilab bo\'lmadi', 500);
}

ok([
    'updated' => true,
    'message' => '✅ Profil yangilandi',
    'user'    => array_merge($user, $fields),
]);