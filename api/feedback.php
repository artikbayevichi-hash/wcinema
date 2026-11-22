<?php
// ============================================================================
// feedback.php — foydalanuvchining "Taklif / shikoyat" xabarlari
// ============================================================================
// GET  ?action=list[&limit=20&offset=0]  -> o'z xabarlari + admin javoblari
// POST action=send  type=suggestion|complaint  message=...  -> yangi xabar
// POST action=read  id=N                      -> javob o'qilgan deb belgilash
//
// Foydalanuvchi faqat O'Z xabarlarini ko'radi: user_id har doim clientUserId()
// dan olinadi, so'rovda berilgan user_id/qismsa hisobga olinmaydi.
// Yozish uchun session yoki imzolangan wc_cs cookie talab qilinadi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$userId = clientUserId();

if ($method === 'GET') {
    if ($userId <= 0) {
        ok(['items' => [], 'unread' => 0, 'total' => 0]);
    }
    $limit  = min(50, max(1, inputInt('limit', 20)));
    $offset = max(0, inputInt('offset', 0));

    $total = (int) $db->fetchOne(
        'SELECT COUNT(*) AS n FROM user_feedback WHERE user_id = ?', [$userId]
    )['n'];
    $rows = $db->fetchAll(
        'SELECT id, type, message, status, admin_reply, replied_at, read_at, created_at
           FROM user_feedback
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT ' . $limit . ' OFFSET ' . $offset,
        [$userId]
    );
    $unread = (int) $db->fetchOne(
        "SELECT COUNT(*) AS n FROM user_feedback
          WHERE user_id = ? AND admin_reply IS NOT NULL AND read_at IS NULL",
        [$userId]
    )['n'];

    ok(['items' => $rows, 'unread' => $unread, 'total' => $total]);
}

if ($method !== 'POST') {
    fail('POST so‘raladi', 405);
}
if ($userId <= 0) {
    Auth::fail('Avval tizimga kiring', 401);
}

$action = input('action', 'send', 20);

if ($action === 'read') {
    $id = inputInt('id', 0);
    if ($id <= 0) {
        fail('Xabar topilmadi', 404);
    }
    $db->query(
        'UPDATE user_feedback SET read_at = NOW()
          WHERE id = ? AND user_id = ? AND admin_reply IS NOT NULL AND read_at IS NULL',
        [$id, $userId]
    );
    $unread = (int) $db->fetchOne(
        "SELECT COUNT(*) AS n FROM user_feedback
          WHERE user_id = ? AND admin_reply IS NOT NULL AND read_at IS NULL",
        [$userId]
    )['n'];
    ok(['unread' => $unread]);
}

if ($action !== 'send') {
    fail('Noma’lum amal');
}

// IP bo'yicha qisqa oyna: bitta odam bir necha sekund ichida yuzlab xabar
// yubora olmaydi. `RateLimit` fayl asosli va MySQL'ga so'rov yubormaydi.
RateLimit::enforce('feedback_send', 6, 300);

$type = input('type', 'suggestion', 20);
if ($type !== 'complaint') {
    $type = 'suggestion';
}
$message = input('message', '', 1000);
$len = function_exists('mb_strlen') ? mb_strlen($message) : strlen($message);
if ($len < 5) {
    fail('Matn kamida 5 belgi bo‘lishi kerak');
}

// Bir xil matnni qayta-qayta yuborish (tasodifiy ikki bosish) ham oldi olinadi.
$last = $db->fetchOne(
    'SELECT id FROM user_feedback
      WHERE user_id = ? AND message = ? AND created_at > NOW() - INTERVAL 1 HOUR
      ORDER BY id DESC LIMIT 1',
    [$userId, $message]
);
if ($last) {
    fail('Bu xabarni allaqachon yuborgansiz');
}

$id = $db->insert('user_feedback', [
    'user_id' => $userId,
    'type'    => $type,
    'message' => $message,
    'status'  => 'open',
]);
if ($id <= 0) {
    fail('Xabar saqlanmadi, keyinroq qayta urinib ko‘ring');
}

ok(['id' => $id, 'status' => 'open']);
