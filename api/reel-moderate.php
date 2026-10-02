<?php
// ============================================================================
// api/reel-moderate.php - moderatsiya (faqat admin)
// ============================================================================
// GET  ?status=0|1|2&limit=50  -> reels ro'yxati (ko'rish uchun)
// POST id=N&status=1|2&reason=... -> tasdiqlash yoki rad etish
//
// status: 0 = kutilmoqda, 1 = tasdiqlandi, 2 = rad etildi
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Reels.php';

$reels  = new Reels();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// DIQQAT: auth tekshiruvi har ikkala yo'l uchun ham eng oldinda.
// Aks holda "GET ommaviy, POST himoyalangan" deb oylab, tasdiqlash
// amali himoyasiz qolishi mumkin.
requireAdmin();

if ($method === 'GET' || $method === 'HEAD') {
    $status = inputInt('status', 0);
    $limit  = inputInt('limit', 50);

    ok([
        'items'   => $reels->getPending($limit, $status),
        'counts'  => [
            'pending'  => $reels->countPending(0),
            'approved' => $reels->countPending(1),
            'rejected' => $reels->countPending(2),
        ],
    ]);
}

if ($method !== 'POST') {
    fail('POST so‘raladi', 405);
}

$action = input('action', 'moderate', 20);
$id     = inputInt('id');

if ($id <= 0) {
    fail('reel id kerak');
}

// --- butunlay o'chirish (admin panelidagi 🗑 tugmasi)
if ($action === 'delete') {
    $r = $reels->delete($id, $userId, true);
    if (!$r['success']) {
        fail($r['message'], 404);
    }
    ok($r + ['counts' => [
        'pending'  => $reels->countPending(0),
        'approved' => $reels->countPending(1),
        'rejected' => $reels->countPending(2),
    ]]);
}

$status = inputInt('status');
$reason = input('reason', '', 255);

$result = $reels->moderate($id, $status, $reason, $userId);

if (!$result['success']) {
    fail($result['message'], 400);
}

ok($result + ['counts' => [
    'pending'  => $reels->countPending(0),
    'approved' => $reels->countPending(1),
    'rejected' => $reels->countPending(2),
]]);
