<?php
// ============================================================================
// cli/deliver-worker.php - shaxsiy nusxani Telegram'ga yuborish
// ============================================================================
// api/deliver.php tomonidan ajratilgan jarayonda ishga tushiriladi:
//   php cli/deliver-worker.php "<t.me url>" <content_id> <episode_id>
//                              <db_user_id> <telegram_chat_id> <job_key>
//
// Maqsad: t.me postidagi video document Telegram serverida ALLAQACHON bor.
// Faylni yuklab-upload qilish shart emas — MTProto `inputMediaDocument` bilan
// Telegram o'zi faylni kanaldan foydalanuvchi chat'iga "ichki nusxa" qilib
// beradi (soniyalarda, trafik bizning serverdan O'TMAYDI).
//
// Natija content_deliveries jadvalida saqlanadi — takror yuborilmaydi.
// Xato (masalan foydalanuvchi botga /start qilmagan) ham shu jadvalga
// record bo'lib, api frontendga tushunarli holat qaytaradi.
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
ini_set('memory_limit', '-1');

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

$url       = $argv[1] ?? '';
$contentId = (int) ($argv[2] ?? 0);
$episodeId = (int) ($argv[3] ?? 0);
$userId    = (int) ($argv[4] ?? 0);
$chatId    = trim((string) ($argv[5] ?? ''));
$jobKey    = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($argv[6] ?? ''));

if ($url === '' || $chatId === '' || $userId <= 0 || $contentId <= 0) {
    fwrite(STDERR, "argv yetarli emas\n");
    exit(1);
}

$jobFile = __DIR__ . '/../storage/mtproto/deliver_' . ($jobKey ?: md5($userId . '_' . $contentId . '_' . $episodeId)) . '.json';

function jobW($jobFile, $patch) {
    $cur = is_file($jobFile) ? json_decode((string) @file_get_contents($jobFile), true) : [];
    if (!is_array($cur)) {
        $cur = [];
    }
    @file_put_contents($jobFile, json_encode(array_merge($cur, $patch), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    @chmod($jobFile, 0666);
}

/** Yuborish natijasini content_deliveries jadvaliga (qayta-qayta emas) yozadi. */
function recordDelivery($userId, $contentId, $episodeId, $chatId, $statusText, $errorText = null, $messageId = null, $fileSize = null) {
    $db = \Database::getInstance();
    $row = $db->fetchOne(
        "SELECT id FROM content_deliveries WHERE user_id = ? AND content_id = ? AND episode_id = ?",
        [$userId, $contentId, $episodeId]
    );
    $data = [
        'telegram_chat_id' => $chatId,
        'status'           => $statusText,
        'error'            => $errorText,
    ];
    if ($messageId !== null) {
        $data['message_id'] = (int) $messageId;
    }
    if ($fileSize !== null) {
        $data['file_size'] = (int) $fileSize;
    }
    if ($row) {
        $db->update('content_deliveries', $data, 'id = ?', [(int) $row['id']]);
    } else {
        $db->insert('content_deliveries', array_merge([
            'user_id'    => $userId,
            'content_id' => $contentId,
            'episode_id' => $episodeId,
        ], $data));
    }
}

jobW($jobFile, ['status' => 'running', 'started' => time()]);

try {
    // Bot sessiyasini bir vaqtda faqat bitta jarayon ishlatadi — boshqa
    // worker ishlayotgan bo'lsa bo'shaguncha kutamiz (IPC konflikti yuz bermaydi).
    TgPull::sessionLockAcquire();

    $api  = TgPull::openBotSession();
    $info = TgPull::fetchDocInfo($api, $url);
    $doc  = $info['doc'];

    $caption = '🎬 ' . ($info['file_name'] ?: 'W CINEMA video');
    $media = [
        '_' => 'inputMediaDocument',
        'id' => [
            '_'            => 'inputDocument',
            'id'           => $doc['id'],
            'access_hash'  => $doc['access_hash'],
            // file_reference binary string — TL massivida shunday uzatiladi
            'file_reference' => $doc['file_reference'] ?? '',
        ],
        'attributes' => $doc['attributes'] ?? null,
    ];

    $res = $api->messages->sendMedia(peer: (int) $chatId, media: $media, message: $caption);

    $msgId = null;
    if (is_array($res)) {
        $msgId = isset($res['updates'])
            ? (($res['updates'][0]['message']['id'] ?? null) ?: null)
            : ($res['id'] ?? null);
    }

    recordDelivery($userId, $contentId, $episodeId, $chatId, 'sent', null, $msgId, $info['size']);
    jobW($jobFile, ['status' => 'done', 'message_id' => $msgId, 'ended' => time()]);
    fwrite(STDOUT, "OK sent\n");
    exit(0);
} catch (\Throwable $e) {
    $err = trim((string) $e->getMessage());
    $low = mb_strtolower($err);
    $needStart = strpos($low, 'initiate') !== false
        || strpos($low, 'cannot') !== false
        || strpos($low, 'write_forbidden') !== false
        || strpos($low, 'peer_id_invalid') !== false
        || strpos($low, 'kick') !== false
        || strpos($low, 'flood') !== false;

    $friendly = $err;
    if (strpos($low, 'initiate') !== false || strpos($low, 'cannot') !== false || strpos($low, 'write_forbidden') !== false) {
        $friendly = 'Foydalanuvchi @' . TELEGRAM_BOT_USERNAME . ' botiga hali /start yubormagan — bot unga xabar yoza olmaydi.';
    } elseif (strpos($low, 'flood') !== false) {
        $friendly = 'Telegram bir ozdan so\'ng qayta yuborishga ruxsat beradi (flood wait).';
    } elseif (strpos($low, 'madelineproto') !== false || strpos($low, 'session lock') !== false) {
        $friendly = 'Bot sessiyasi band edi — boshqa yuklash tugashini kutib, qayta urining: ' . $err;
    }

    recordDelivery($userId, $contentId, $episodeId, $chatId, 'failed', $err);
    jobW($jobFile, [
        'status'     => 'error',
        'error'      => $friendly,
        'need_start' => $needStart,
        'ended'      => time(),
    ]);
    fwrite(STDERR, $friendly . "\n");
    exit(1);
}