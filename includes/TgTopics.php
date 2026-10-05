<?php
// ============================================================================
// TgTopics - Telegram forum-mavzulari registri (ko'rish sahifasi izohlari)
// ============================================================================
// Izohlar serverda saqlanmaydi: har bir video (episode) uchun Telegram forum
// guruhida bitta mavzu ochiladi va izohlar o'sha mavzuda qoladi. Reels izohlari
// shu qoidaning bir xil nusxasi - faqat kalit boshqa (`reels.id` o'rniga
// `episodes.id`).
//
// Nima uchun `Reels::ensureTopic()` kengaytirilmadi, balki alohida klass?
//   1) Reels moduli ishlab turibdi va testlarga asoslangan. Uni tegmasak,
//      reels sahifasi hech qachon regressiyaga uchramaydi.
//   2) Reels moduli `reels` jadvaliga bog'langan, ko'rish sahifasi esa
//      `episodes` jadvaliga. Ikkalasi bir-birini bilmaydi.
//   3) `reels.tg_topic_id` ustuni allaqachon mavjud - yangi jadval o'shandan
//      ajratilgan, shuning uchun mavzu raqamlari to'qnashmaydi.
//
// Jadval `CREATE TABLE IF NOT EXISTS` bilan birinchi chaqiruvda o'z-o'zidan
// yaratiladi - alohida migratsiya skripti kerak emas.
// ============================================================================

class TgTopics
{
    /** Ko'rish sahifasi videolari (`episodes.id`). */
    const SCOPE_VIDEO = 'video';

    /** Ruxsat etilgan qamrovlar (SQL injection dan himoya). */
    private static $scopes = [self::SCOPE_VIDEO];

    private $db;
    private $ready = null;

    public function __construct($db = null)
    {
        $this->db = $db ?: Database::getInstance();
    }

    // =====================================================================
    // Ichki yordamchilar
    // =====================================================================

    /** Jadval mavjudligini bir marta tekshiradi va kerak bo'lsa yaratadi. */
    private function ready()
    {
        if ($this->ready !== null) {
            return $this->ready;
        }
        $this->ready = false;
        try {
            $this->db->query(
                "CREATE TABLE IF NOT EXISTS tg_topics (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    scope VARCHAR(24) NOT NULL,
                    item_id INT NOT NULL,
                    chat VARCHAR(120) NOT NULL DEFAULT '',
                    tg_topic_id INT NULL,
                    url VARCHAR(500) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_scope_item (scope, item_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $this->ready = true;
        } catch (Exception $e) {
            error_log('TgTopics: jadval yaratilmadi - ' . $e->getMessage());
            $this->ready = false;
        }
        return $this->ready;
    }

    /** `scope` ni tekshiradi - faqat ochiq ro'yxatdagilar qabul qilinadi. */
    private function normScope($scope)
    {
        $scope = strtolower(trim((string) $scope));
        return in_array($scope, self::$scopes, true) ? $scope : '';
    }

    /** Mavzu nomi Telegram'da 128 belgidan oshmasligi kerak. */
    private function cleanName($name)
    {
        $name = trim(preg_replace('/\s+/u', ' ', (string) $name));
        if (function_exists('mb_substr')) {
            return mb_substr($name, 0, 100);
        }
        return substr($name, 0, 100);
    }

    // =====================================================================
    // O'qish
    // =====================================================================

    /**
     * Mavzudagi Telegram topic id (yo'q bo'lsa null).
     * Hech narsa OCHMAYDI - xuddi `reel-topic.php` GET qismi kabi.
     */
    public function topicId($scope, $itemId)
    {
        $scope = $this->normScope($scope);
        $itemId = (int) $itemId;
        if ($scope === '' || $itemId <= 0 || !$this->ready()) {
            return null;
        }
        $row = $this->db->fetchOne(
            "SELECT tg_topic_id FROM tg_topics WHERE scope = ? AND item_id = ?",
            [$scope, $itemId]
        );
        if (!$row || empty($row['tg_topic_id'])) {
            return null;
        }
        return (int) $row['tg_topic_id'];
    }

    /** Mavzuning Telegram havolasi (web). */
    public function url($topicId)
    {
        $topicId = (int) $topicId;
        if ($topicId <= 0 || !defined('TG_COMMENTS_URL') || TG_COMMENTS_URL === '') {
            return null;
        }
        return rtrim(TG_COMMENTS_URL, '/') . '/' . $topicId;
    }

    // =====================================================================
    // Yozish
    // =====================================================================

    /**
     * Mavzuni ta'minlaydi: yo'q bo'lsa bot orqali ochadi va bazaga yozadi.
     *
     * @param string $scope Masalan self::SCOPE_VIDEO
     * @param int    $itemId episodes.id
     * @param string $name   Mavzu sarlavhasi (kino nomi + qism)
     *
     * @return array ['success'=>bool,'topic_id'=>int|null,'chat'=>string,
     *                'url'=>?string,'created'=>bool,'message'=>?string]
     */
    public function ensure($scope, $itemId, $name)
    {
        $scope = $this->normScope($scope);
        $itemId = (int) $itemId;
        if ($scope === '' || $itemId <= 0) {
            return ['success' => false, 'message' => 'Noto‘g‘ri kalit'];
        }
        if (!$this->ready()) {
            return ['success' => false, 'message' => 'Mavzular bazasi tayyor emas'];
        }
        if (!defined('TG_COMMENTS_CHAT') || TG_COMMENTS_CHAT === '') {
            return ['success' => false, 'message' => 'Izohlar sozlanmagan'];
        }

        // 1) Mavjud bo'lsa - hech narsa qilmaymiz.
        $existing = $this->topicId($scope, $itemId);
        if ($existing) {
            return [
                'success'  => true,
                'topic_id' => $existing,
                'chat'     => TG_COMMENTS_CHAT,
                'url'      => $this->url($existing),
                'created'  => false,
            ];
        }

        // 2) Bot orqali forum-mavzu ochamiz.
        $title = $this->cleanName($name);
        if ($title === '') {
            $title = 'Video #' . $itemId;
        }
        $bot = new TelegramBot();
        $res = $bot->createForumTopic(TG_COMMENTS_CHAT, $title);
        if (!$res || empty($res['message_thread_id'])) {
            return [
                'success' => false,
                'message' => 'Mavzu ochilmadi: ' . ($bot->getLastError() ?: 'noma’lum xato')
                    . ' (guruhda Topics yoqilganini va bot admin ekanini tekshiring)',
            ];
        }

        // 3) Bazaga yozamiz. Ikki karta parallel ochilmasligi uchun INSERT
        //    ni "upsert" qilib, `tg_topic_id` ni UPDATE qilamiz.
        $topicId = (int) $res['message_thread_id'];
        $url = $this->url($topicId);
        $this->db->query(
            "INSERT INTO tg_topics (scope, item_id, chat, tg_topic_id, url)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE tg_topic_id = VALUES(tg_topic_id),
                                     url         = VALUES(url),
                                     chat        = VALUES(chat)",
            [$scope, $itemId, TG_COMMENTS_CHAT, $topicId, $url]
        );

        return [
            'success'  => true,
            'topic_id' => $topicId,
            'chat'     => TG_COMMENTS_CHAT,
            'url'      => $url,
            'created'  => true,
        ];
    }
}