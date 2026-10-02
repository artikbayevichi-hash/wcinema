<?php
// ============================================================================
// Telegram Delivery - 4-QADAM
// ============================================================================
// Kontentni (film yoki qism) foydalanuvchining shaxsiy Telegram chat'iga
// yuborish. "uzdub" bazasidagi content/episodes ga bog'langan.
//
// Manba tanlash tartibi (eng tezidan):
//   1) telegram_file_cache dagi file_id  -> BIR ZUMDA (Telegram'da allaqachon)
//   2) serverdagi fayl (uploads/)        -> yuklash (50 MB gacha)
//   3) to'g'ridan-to'g'ri .mp4 URL        -> Telegram o'zi yuklab oladi
//   4) embed manba (vk/rutube/mover)     -> FAQAT havola yuboriladi,
//                                             faylni yuborib bo'lmaydi
//
// Natija content_deliveries jadvaliga yoziladi - takror yuborishni oldini oladi.
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/TelegramBot.php';
require_once __DIR__ . '/Catalog.php';

class TelegramDelivery {
    private $db;
    private $telegram;
    private $catalog;

    public function __construct() {
        $this->db       = Database::getInstance();
        $this->telegram = new TelegramBot();
        $this->catalog  = new Catalog();
    }

    // -------------------------------------------------------------------------
    // Holatni tekshirish (tugma holati uchun)
    // -------------------------------------------------------------------------
    public function findDelivery($userId, $contentId, $episodeId = 0) {
        return $this->db->fetchOne(
            "SELECT * FROM content_deliveries
             WHERE user_id = ? AND content_id = ? AND episode_id = ?",
            [(int) $userId, (int) $contentId, (int) $episodeId]
        );
    }

    public function getUserDeliveries($userId, $limit = 50) {
        return $this->db->fetchAll(
            "SELECT d.*, c.title, c.poster, cat.name AS category_name
             FROM content_deliveries d
             JOIN content c ON c.id = d.content_id
             JOIN categories cat ON cat.id = c.category_id
             WHERE d.user_id = ? AND d.status = 'sent'
             ORDER BY d.created_at DESC
             LIMIT " . (int) $limit,
            [(int) $userId]
        );
    }

    // -------------------------------------------------------------------------
    // Yuborish
    // -------------------------------------------------------------------------
    /**
     * @param int $userId    bazadagi users.id
     * @param int $contentId content.id
     * @param int $episodeId episodes.id (0 = butun film)
     *
     * @return array ['success'=>bool,'status'=>'sent|already_sent|need_start|error',
     *                 'message'=>string,'message_id'=>int]
     */
    public function deliver($userId, $contentId, $episodeId = 0) {
        if (!TELEGRAM_DELIVERY_ENABLED) {
            return $this->error('Telegram yetkazib berish o\'chirilgan (config.php)');
        }

        $user    = $this->db->fetchOne("SELECT * FROM users WHERE id = ?", [(int) $userId]);
        $episodeId = (int) $episodeId;

        // Qismni yoki butun kontentni olamiz
        $item = null;
        $parent = null;
        if ($episodeId > 0) {
            $item   = $this->catalog->getEpisode($episodeId);
            $parent = $item ? $this->catalog->getContent($item['content_id']) : null;
            if ($item && (int) $item['content_id'] !== (int) $contentId) {
                return $this->error('Bu qism tanlangan filmga tegishli emas');
            }
        } else {
            $item = $this->catalog->getContent($contentId);
        }

        if (!$user) {
            return $this->error('Foydalanuvchi topilmadi');
        }
        if (!$item) {
            return $this->error($episodeId > 0 ? 'Qism topilmadi' : 'Kontent topilmadi');
        }
        if (!empty($item['is_premium']) && empty($user['is_premium'])) {
            return $this->error('Bu kontent premium. Premium bilan ochish mumkin.');
        }

        $telegramId = $user['telegram_chat_id'] ?: $user['telegram_user_id'];
        if (!$telegramId) {
            return $this->error('Foydalanuvchining Telegram ID\'si saqlanmagan');
        }

        // 1) Allaqachon yuborilganmi?
        $existing = $this->findDelivery($userId, $contentId, $episodeId);
        if ($existing && $existing['status'] === 'sent') {
            return [
                'success'    => true,
                'status'     => 'already_sent',
                'message'    => $episodeId > 0 ? 'Bu qism allaqachon yuborilgan' : 'Bu film allaqachon yuborilgan',
                'message_id' => (int) $existing['message_id'],
            ];
        }

        // 2) Bot yozishi mumkinmi? (/start bosilmagan bo'lishi mumkin)
        $access = $this->telegram->checkChatAccess($telegramId);

        if ($access === 'need_start') {
            $this->recordAttempt($userId, $contentId, $episodeId, $telegramId, 'failed',
                'Foydalanuvchi botga /start bosmagan');
            return $this->needStart();
        }

        if ($access === 'error') {
            $err = $this->telegram->getLastError() ?? 'Telegram bilan aloqa yo\'q';
            $this->recordAttempt($userId, $contentId, $episodeId, $telegramId, 'failed', $err);
            return $this->error('Telegram bilan aloqa xatosi: ' . $err);
        }

        // 3) Oqim turini aniqlaymiz
        $playback = $this->catalog->getPlayback($item);
        $type     = $playback['type'];
        $url      = $playback['url'];

        // Embed manba: faylni yuborib bo'lmaydi, faqat havola
        if ($type === 'embed' || $type === 'none') {
            return $this->sendLink($userId, $contentId, $episodeId, $telegramId, $item, $parent, $playback);
        }

        // 4) Manbani tanlash: file_id > lokal fayl > to'g'ridan-to'g'ri URL
        $source     = null;
        $usedFileId = false;
        $newFileId  = null;

        $cached = $this->db->fetchOne(
            "SELECT * FROM telegram_file_cache WHERE content_id = ? AND episode_id = ?",
            [(int) $contentId, $episodeId]
        );

        if ($cached && !empty($cached['file_id'])) {
            $source     = $cached['file_id'];
            $usedFileId = true;
        } else {
            $localPath = $this->resolveLocalFile($item);
            if ($localPath) {
                $size = (int) @filesize($localPath);
                if ($size > TELEGRAM_MAX_UPLOAD) {
                    return $this->error(sprintf(
                        'Video %.1f MB. Telegram\'ga birinchi yuklash limiti 50 MB. ' .
                        'Kichikroq sifat yoki fayl tanlang.',
                        $size / 1048576
                    ));
                }
                $source = $localPath;
            } elseif ($type === 'direct' || $type === 'hls') {
                $source = $url;   // Telegram o'zi URL dan yuklab oladi
            }
        }

        if (!$source) {
            return $this->error('Video manbasi topilmadi');
        }

        // 5) Yuborish
        $caption = $this->buildCaption($item, $parent);
        $result  = $this->telegram->sendVideo($telegramId, $source, [
            'caption'            => $caption,
            'parse_mode'         => 'HTML',
            'supports_streaming' => true,
            'protect_content'    => true,
        ]);

        if (!$result) {
            $errorMsg = $this->telegram->getLastError() ?? 'Noma\'lum xato';
            $this->recordAttempt($userId, $contentId, $episodeId, $telegramId, 'failed', $errorMsg);

            if (stripos($errorMsg, 'chat not found') !== false
                || stripos($errorMsg, "can't initiate conversation") !== false
                || stripos($errorMsg, 'bot is blocked') !== false) {
                return $this->needStart();
            }
            return $this->error('Yuborilmadi: ' . $errorMsg);
        }

        $messageId = (int) ($result['result']['message_id'] ?? 0);
        $newFileId = $result['result']['video']['file_id'] ?? null;
        $fileSize  = $result['result']['video']['file_size'] ?? null;

        // 6) Birinchi marta yuklangan bo'lsa, file_id ni saqlaymiz -
        //    keyingi foydalanuvchilar uchun yuborish bir zumda bo'ladi.
        if ($newFileId && !$usedFileId) {
            $this->db->query(
                "INSERT INTO telegram_file_cache (content_id, episode_id, file_id, file_size)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE file_id = VALUES(file_id), file_size = VALUES(file_size)",
                [(int) $contentId, $episodeId, $newFileId, $fileSize]
            );
        }

        $this->recordSuccess($userId, $contentId, $episodeId, $telegramId,
                             $messageId, $newFileId, $fileSize);

        return [
            'success'    => true,
            'status'     => 'sent',
            'message'    => ($episodeId > 0 ? 'Qism' : 'Film') . ' Telegram\'ga yuborildi',
            'message_id' => $messageId,
        ];
    }

    // -------------------------------------------------------------------------
    // Embed manbalar uchun: faqat havola
    // -------------------------------------------------------------------------
    private function sendLink($userId, $contentId, $episodeId, $telegramId, $item, $parent, $playback) {
        $link = SITE_URL . '/index.php?c=' . (int) $contentId
              . ($episodeId > 0 ? '&e=' . (int) $episodeId : '');

        $text  = $this->buildCaption($item, $parent) . "\n\n";
        $text .= "🎥 <b>Ko\'rish:</b> " . $link;

        if (!empty($playback['warning'])) {
            $text .= "\n\nℹ️ " . $this->escape($playback['warning']);
        }

        $buttons = [[
            'text' => '🎬 Ko\'rish', 'url' => $link,
        ]];

        $result = $this->telegram->sendMessage($telegramId, $text, 'HTML', [
            'inline_keyboard' => $buttons,
        ]);

        if (!$result) {
            $errorMsg = $this->telegram->getLastError() ?? 'Noma\'lum xato';
            $this->recordAttempt($userId, $contentId, $episodeId, $telegramId, 'failed', $errorMsg);
            return $this->error('Yuborilmadi: ' . $errorMsg);
        }

        $messageId = (int) ($result['result']['message_id'] ?? 0);
        $this->recordSuccess($userId, $contentId, $episodeId, $telegramId, $messageId, null, null);

        return [
            'success'    => true,
            'status'     => 'sent',
            'message'    => 'Manbada fayl yo\'q, shuning uchun havola yuborildi',
            'message_id' => $messageId,
            'as_link'    => true,
        ];
    }

    // -------------------------------------------------------------------------
    // Yordamchilar
    // -------------------------------------------------------------------------
    /** uploads/ ichida mahalliy fayl bormi? */
    private function resolveLocalFile($item) {
        foreach (['local_path', 'file_path'] as $key) {
            if (!empty($item[$key]) && @is_file($item[$key])) {
                return $item[$key];
            }
        }
        return null;
    }

    private function buildCaption($item, $parent) {
        $title = $item['title'] ?? ($parent['title'] ?? 'Video');

        $caption = "🎬 <b>" . $this->escape($title) . "</b>\n";

        if ($parent && !empty($item['episode_number'])) {
            $caption .= "🔢 " . $this->escape($parent['title'])
                      . " — " . (int) $item['season'] . "-fasl, "
                      . (int) $item['episode_number'] . "-qism\n";
        }

        if (!empty($item['category_name'])) {
            $caption .= "🏷 " . $this->escape($item['category_name']) . "\n";
        }
        if (!empty($item['release_year'])) {
            $caption .= "📅 " . (int) $item['release_year'] . "\n";
        }
        if (!empty($item['rating'])) {
            $caption .= "⭐ " . number_format((float) $item['rating'], 1) . "\n";
        }

        $contentId = (int) ($parent['id'] ?? $item['id']);

        return $caption;
    }

    private function escape($text) {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    private function needStart() {
        return [
            'success'      => false,
            'status'       => 'need_start',
            'message'      => 'Avval @' . TELEGRAM_BOT_USERNAME . ' botiga /start yuboring, keyin qayta urinib ko\'ring',
            'bot_username' => TELEGRAM_BOT_USERNAME,
            'bot_url'      => 'https://t.me/' . TELEGRAM_BOT_USERNAME,
        ];
    }

    private function recordSuccess($userId, $contentId, $episodeId, $telegramId, $messageId, $fileId, $fileSize) {
        $fields = [
            'telegram_chat_id'   => (string) $telegramId,
            'message_id'         => $messageId,
            'telegram_file_id'   => $fileId,
            'file_size'          => $fileSize,
            'status'             => 'sent',
            'error'              => null,
        ];

        $existing = $this->findDelivery($userId, $contentId, $episodeId);
        if ($existing) {
            $this->db->update('content_deliveries', $fields, 'id = ?', [$existing['id']]);
        } else {
            $this->db->insert('content_deliveries', array_merge($fields, [
                'user_id'    => (int) $userId,
                'content_id' => (int) $contentId,
                'episode_id' => (int) $episodeId,
            ]));
        }
    }

    private function recordAttempt($userId, $contentId, $episodeId, $telegramId, $status, $error) {
        $fields = [
            'telegram_chat_id' => (string) $telegramId,
            'status'           => $status,
            'error'            => $error,
        ];

        $existing = $this->findDelivery($userId, $contentId, $episodeId);
        if ($existing) {
            $this->db->update('content_deliveries', $fields, 'id = ?', [$existing['id']]);
        } else {
            $this->db->insert('content_deliveries', array_merge($fields, [
                'user_id'    => (int) $userId,
                'content_id' => (int) $contentId,
                'episode_id' => (int) $episodeId,
            ]));
        }
    }

    private function error($message) {
        return ['success' => false, 'status' => 'error', 'message' => $message];
    }
}
