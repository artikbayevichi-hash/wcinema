<?php
// ============================================================================
// 4-QADAM: Kontentni foydalanuvchining Telegram chat'iga yuborish
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

requireUser();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST so\'raladi', 405);
}

$contentId = inputInt('id');
$episodeId = inputInt('episode');

if ($contentId <= 0) {
    fail('content_id kerak');
}

$delivery = new TelegramDelivery();
$result   = $delivery->deliver($userId, $contentId, $episodeId);

// 428 = foydalanuvchi botga /start yubormagan. Bu maxsus holat,
// brauzer "Telegram'da ochish" tugmasini ko'rsatadi.
$status = 200;
if (!$result['success'] && ($result['status'] ?? '') === 'need_start') {
    $status = 428;
}

Auth::json([
    'success' => !empty($result['success']),
    'status'  => $result['status'] ?? 'error',
    'message' => $result['message'] ?? '',
] + $result, $status);
