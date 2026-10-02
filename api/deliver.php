<?php
// ============================================================================
// api/deliver.php - bosilgan kontentni foydalanuvchi Telegram'iga yuborish
// ============================================================================
// Player saytda ochilganda (poster bosilganda) app.js buni bir marta chaqiradi.
//   POST ?id=<content_id>&episode=<episode_id>
//
// - Agar bu (foydalanuvchi, kontent) juftligi allaqachon yuborilgan bo'lsa —
//   jimgina qaytadi (takror yuborish YO'Q).
// - Aks holda cli/deliver-worker.php ni fonga yuboradi. Worker Telegram
//   documentini serverda nusxalab (upload'siz, tez) foydalanuvchiga beradi.
// - Stream O'ZI-buni kutmaydi: api/live.php mustaqil ishlaydi. Yuborish
//   parallel/foniy, oqimni sekinlashtirmaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so\'raladi', 405);
}

$user = requireUser();
if (!TELEGRAM_DELIVERY_ENABLED) {
    ok(['status' => 'disabled', 'message' => 'Telegram\'ga yuborish o\'chirilgan']);
}

$contentId = contentIdInput();
$episodeId = inputInt('episode');
if ($contentId <= 0) {
    fail('content_id kerak');
}
if (!TgPull::libraryReady() || !TgPull::credentialsReady()) {
    ok(['status' => 'skipped', 'message' => 'Telegram ulanishi sozlanmagan']);
}

// --- Manba havolasi (t.me bo'lishi shart; boshqa ma'lumot shart emas) ---
if ($episodeId > 0) {
    $row = $catalog->getEpisode($episodeId);
    if (!$row || (int) $row['content_id'] !== $contentId) {
        fail('Qism topilmadi', 404);
    }
    $url = $row['video_url_1080p'] ?: ($row['video_url_720p'] ?: $row['video_url']);
} else {
    $row = $catalog->getContent($contentId);
    $url = $row['video_url_1080p'] ?? ($row['video_url_720p'] ?? ($row['video_url'] ?? ''));
}
$url = trim((string) $url);
if ($url === '' || !TgPull::parseUrl($url)) {
    ok(['status' => 'skipped', 'message' => 'Bu manba Telegram\'dan yuborilmaydi']);
}

$chatId = (string) ($user['telegram_chat_id'] ?? '');
if ($chatId === '') {
    $chatId = (string) ($user['telegram_user_id'] ?? '');
}
if ($chatId === '') {
    ok(['status' => 'skipped', 'message' => 'Telegram ID topilmadi']);
}

$db = \Database::getInstance();
$existing = $db->fetchOne(
    "SELECT * FROM content_deliveries WHERE user_id = ? AND content_id = ? AND episode_id = ?",
    [(int) $user['id'], $contentId, $episodeId]
);
if ($existing) {
    if ($existing['status'] === 'sent') {
        ok(['status' => 'sent', 'already' => true]);
    }
    $err = (string) ($existing['error'] ?? '');
    $low = mb_strtolower($err);
    if ($existing['status'] === 'failed' && (strpos($low, 'initiate') !== false || strpos($low, 'cannot') !== false
        || strpos($low, 'write_forbidden') !== false || strpos($low, 'peer_id_invalid') !== false)) {
        ok(['status' => 'need_start', 'message' => 'Avval @' . TELEGRAM_BOT_USERNAME . ' botiga /start yuboring']);
    }
    $created = strtotime((string) ($existing['created_at'] ?? ''));
    if ($created && time() - $created < 300) {
        // Ya'inda muvaffaqiyatsiz bo'lgan — darhol qayta urinmaymiz
        ok(['status' => 'failed', 'already' => true, 'message' => $err ?: 'Yuborilmadi']);
    }
    // Eski failed — qayta urinishga ruxsat
}

// --- Ishchi jarayon allaqachon yuguryaptimi? ---
$jobKey  = md5((int) $user['id'] . '_' . $contentId . '_' . $episodeId);
$jobFile = dirname(__DIR__) . '/storage/mtproto/deliver_' . $jobKey . '.json';
if (is_file($jobFile)) {
    $j = json_decode((string) @file_get_contents($jobFile), true);
    if (is_array($j) && ($j['status'] ?? '') === 'running') {
        ok(['status' => 'sending', 'already' => true]);
    }
}

// --- Foniy worker yuboramiz ---
file_put_contents($jobFile, json_encode(['status' => 'starting', 'started' => time()], JSON_UNESCAPED_UNICODE));
@chmod($jobFile, 0666);

$phpBin = PHP_CLI_BIN;
$worker = escapeshellarg(dirname(__DIR__) . '/cli/deliver-worker.php');
$args = escapeshellarg($url) . ' '
    . escapeshellarg((string) $contentId) . ' '
    . escapeshellarg((string) $episodeId) . ' '
    . escapeshellarg((string) $user['id']) . ' '
    . escapeshellarg($chatId) . ' '
    . escapeshellarg($jobKey);

if (stripos(PHP_OS_FAMILY, 'win') === 0) {
    $cmd = 'start /B "" ' . escapeshellarg($phpBin) . ' ' . $worker . ' ' . $args . ' > NUL 2>&1';
    @pclose(@popen($cmd, 'r'));
} else {
    $cmd = escapeshellarg($phpBin) . ' ' . $worker . ' ' . $args . ' > /dev/null 2>&1 &';
    @exec($cmd);
}

ok(['status' => 'sending']);