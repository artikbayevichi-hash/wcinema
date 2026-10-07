<?php
// ============================================================================
// api/avatar.php - profil rasmini yuklash / o'chirish (POST)
// ----------------------------------------------------------------------------
//   POST (multipart):
//     avatar   -> rasm fayli (jpg/png/webp/gif, <= 5 MB)
//     tg_me    -> brauzer MTProto identifikatori (PHP sessiyasi bo'lmasa)
//
//   POST (oddiy):
//     remove=1 -> joriy avatarni o'chirish
//
// Javob: { success: true, avatar: "uploads/avatars/..." } yoki avatar: null
//
// Xavfsizlik: `clientUserId()` - ya'ni PHP sessiyasi YOKI brauzerdagi MTProto
// akkaunti. Har kim faqat O'Z rasmini o'zgartiradi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Avatars.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST kerak', 405);
}

$userId = clientUserId();
if ($userId <= 0) {
    fail('Avval tizimga kiring', 401);
}

$db  = Database::getInstance();
$row = $db->fetchOne("SELECT id, avatar FROM users WHERE id = ? LIMIT 1", [$userId]);
if (!$row) {
    fail('Foydalanuvchi topilmadi', 404);
}

// --- O'chirish
if (inputInt('remove', 0) === 1) {
    Avatars::remove($row['avatar'] ?? null);
    $db->update('users', ['avatar' => null], 'id = ?', [$userId]);
    ok(['success' => true, 'avatar' => null, 'message' => 'Profil rasmi o\'chirildi']);
}

// --- Yuklash
if (empty($_FILES['avatar']) || !is_array($_FILES['avatar'])) {
    fail('Rasm tanlanmagan', 422);
}

$res = Avatars::save((int) $userId, $_FILES['avatar']);
if (empty($res['ok'])) {
    fail($res['error'] ?? 'Rasmni saqlab bo\'lmadi', 422);
}

// Eski (o'zimiz yuklagan) rasmni tozalaymiz - albatta yangisidan boshqa bo'lsa.
if (!empty($row['avatar']) && $row['avatar'] !== $res['url']) {
    Avatars::remove($row['avatar']);
}

$db->update('users', ['avatar' => $res['url']], 'id = ?', [$userId]);

ok([
    'success' => true,
    'avatar'  => $res['url'],
    'message' => 'Profil rasmi yangilandi',
]);