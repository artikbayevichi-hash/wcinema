<?php
// ============================================================================
// Notifications - Instagram uslubidagi bildirishnomalar
// ============================================================================
// Bu klass `notifications` jadvali ustida ishlaydi:
//   * hodisalarni yozadi (add + notify* yordamchilari);
//   * foydalanuvchi uchun ro'yxatni GURUHLAB qaytaradi (aggregatsiya);
//   * o'qilgan/o'qilmagan holatini boshqaradi.
//
// MUHIM: `notifications` jadvalining kengaytirilgan ustunlari (actor_id,
// reel_id, group_key, read_at) `migrate-notifications.sql` bilan qo'shiladi.
// Migration hali ishga tushirilmagan bo'lsa ham klass ishlashda davom etadi:
// hasExtended() ustunlarni aniqlaydi va kerak bo'lsa oddiy rejimga o'tadi.
// ============================================================================

class Notifications {
    /** @var Database */
    private $db;

    /** Kengaytirilgan ustunlar bormi (kesh). null = hali tekshirilmagan. */
    private $extended = null;

    /** Eski (asosiy) turlar. */
    const BASE_TYPES = ['system', 'like', 'comment', 'follow', 'video', 'login'];

    /** Kengaytirilgan turlar (migration bilan qo'shiladi). */
    const EXT_TYPES = ['reply', 'mention', 'repost', 'status'];

    /** Guruhlanadigan turlar: bir xil group_key bo'lsa bitta bo'lib chiqadi. */
    const GROUP_TYPES = ['like', 'follow', 'repost'];

    /** Takroriy (toggle) hodisalar: qisqa vaqt ichida dublikat yozilmaydi. */
    const DEDUP_TYPES = ['like', 'follow', 'repost', 'video'];

    public function __construct($db = null) {
        $this->db = $db ?: Database::getInstance();
    }

    // =====================================================================
    // Ichki yordamchilar
    // =====================================================================

    /**
     * Jadvalda kengaytirilgan ustunlar bor-yo'qligini aniqlaydi (bir marta).
     */
    private function hasExtended() {
        if ($this->extended !== null) {
            return $this->extended;
        }
        $this->extended = false;
        try {
            $rows = $this->db->fetchAll(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME   = 'notifications'
                   AND COLUMN_NAME IN ('actor_id','reel_id','group_key','read_at')"
            );
            $this->extended = count($rows) >= 4;
        } catch (Exception $e) {
            $this->extended = false;
        }
        return $this->extended;
    }

    private function clip($v, $max) {
        $v = trim(strip_tags((string) $v));
        if (function_exists('mb_substr')) {
            return mb_substr($v, 0, $max);
        }
        return substr($v, 0, $max);
    }

    /** Turni jadval ENUM'iga moslashtiradi. */
    private function normType($type) {
        $type = strtolower(trim((string) $type));
        if (in_array($type, self::BASE_TYPES, true)) {
            return $type;
        }
        if (in_array($type, self::EXT_TYPES, true)) {
            return $this->hasExtended() ? $type : 'comment';
        }
        return 'system';
    }

    private function reelInfo($reelId) {
        return $this->db->fetchOne(
            "SELECT id, title FROM reels WHERE id = ? LIMIT 1",
            [(int) $reelId]
        );
    }

    private function reelUrl($reelId) {
        $base = defined('SITE_URL') ? SITE_URL : '';
        return $base . '/reels.php?reel=' . (int) $reelId;
    }

    /** Takroriy hodisani filtrlash (faqat DEDUP_TYPES uchun). */
    private function isDuplicate($userId, $type, $actorId, $reelId) {
        if (!in_array($type, self::DEDUP_TYPES, true)) {
            return false;
        }
        $where  = "user_id = ? AND type = ? AND is_read = 0
                   AND created_at > (NOW() - INTERVAL 15 MINUTE)";
        $params = [$userId, $type];
        if ($this->hasExtended()) {
            // <=> NULL-safe taqqoslash (actor/reel null bo'lishi mumkin).
            $where .= " AND actor_id <=> ? AND reel_id <=> ?";
            $params[] = $actorId ?: null;
            $params[] = $reelId ?: null;
        }
        $row = $this->db->fetchOne("SELECT id FROM notifications WHERE $where LIMIT 1", $params);
        return (bool) $row;
    }

    // =====================================================================
    // Yozish
    // =====================================================================

    /**
     * Bitta bildirishnoma yozadi.
     *
     * @param int    $userId Qabul qiluvchi (DB user id).
     * @param string $type   like|comment|reply|mention|follow|repost|status|system|video
     * @param array  $o      actor_id, reel_id, group_key, title, message, url
     * @return int Yangi yozuv id yoki 0 (o'zini xabardor qilish / dublikat / xato).
     */
    public function add($userId, $type, array $o = []) {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return 0;
        }

        $actorId = isset($o['actor_id']) ? (int) $o['actor_id'] : 0;
        // O'zini o'zi haqida xabardor qilmaymiz.
        if ($actorId > 0 && $actorId === $userId) {
            return 0;
        }

        $type   = $this->normType($type);
        $reelId = !empty($o['reel_id']) ? (int) $o['reel_id'] : 0;

        $row = [
            'user_id'    => $userId,
            'type'       => $type,
            'title'      => $this->clip($o['title'] ?? '', 255) ?: 'Bildirishnoma',
            'message'    => $this->clip($o['message'] ?? '', 1000),
            'target_url' => $this->clip($o['url'] ?? '', 500),
            'is_read'    => 0,
        ];

        $groupKey = $this->clip($o['group_key'] ?? '', 150);
        if ($this->hasExtended()) {
            $row['actor_id']  = $actorId ?: null;
            $row['reel_id']   = $reelId ?: null;
            $row['group_key'] = $groupKey !== '' ? $groupKey : null;
        }

        if ($this->isDuplicate($userId, $type, $actorId, $reelId)) {
            return 0;
        }

        return (int) $this->db->insert('notifications', $row);
    }

    // -------------------------------------------------------- hodisa yordamchilari

    public function notifyLike($reelId, $actorId, $ownerId) {
        if (!$ownerId) {
            return 0;
        }
        $reel = $this->reelInfo($reelId);
        return $this->add($ownerId, 'like', [
            'actor_id'  => $actorId,
            'reel_id'   => $reelId,
            'group_key' => 'like:' . (int) $reelId,
            'title'     => 'Yangi yoqtirish',
            'message'   => $reel ? (string) ($reel['title'] ?? '') : '',
            'url'       => $this->reelUrl($reelId),
        ]);
    }

    public function notifyFollow($targetId, $actorId) {
        if (!$targetId) {
            return 0;
        }
        return $this->add($targetId, 'follow', [
            'actor_id'  => $actorId,
            'group_key' => 'follow',
            'title'     => 'Yangi kuzatuvchi',
            'url'       => (defined('SITE_URL') ? SITE_URL : '') . '/profile.php?user_id=' . (int) $actorId,
        ]);
    }

    public function notifyRepost($reelId, $actorId, $ownerId) {
        if (!$ownerId) {
            return 0;
        }
        $reel = $this->reelInfo($reelId);
        return $this->add($ownerId, 'repost', [
            'actor_id'  => $actorId,
            'reel_id'   => $reelId,
            'group_key' => 'repost:' . (int) $reelId,
            'title'     => 'Repost',
            'message'   => $reel ? (string) ($reel['title'] ?? '') : '',
            'url'       => $this->reelUrl($reelId),
        ]);
    }

    public function notifyComment($reelId, $actorId, $ownerId, $preview = '', $isReply = false) {
        if (!$ownerId) {
            return 0;
        }
        return $this->add($ownerId, $isReply ? 'reply' : 'comment', [
            'actor_id' => $actorId,
            'reel_id'  => $reelId,
            'title'    => $isReply ? 'Yangi javob' : 'Yangi izoh',
            'message'  => $preview,
            'url'      => $this->reelUrl($reelId),
        ]);
    }

    public function notifyMention($userId, $reelId, $actorId, $preview = '') {
        if (!$userId) {
            return 0;
        }
        return $this->add($userId, 'mention', [
            'actor_id' => $actorId,
            'reel_id'  => $reelId,
            'title'    => 'Sizni eslatishdi',
            'message'  => $preview,
            'url'      => $this->reelUrl($reelId),
        ]);
    }

    public function notifyStatus($reelId, $ownerId, $status, $reason = '') {
        if (!$ownerId) {
            return 0;
        }
        $approved = ((int) $status === 1);
        return $this->add($ownerId, 'status', [
            'reel_id' => $reelId,
            'title'   => $approved ? 'Reelsingiz tasdiqlandi' : 'Reelsingiz rad etildi',
            'message' => $approved ? '' : $reason,
            'url'     => $this->reelUrl($reelId),
        ]);
    }

    // =====================================================================
    // O'qish
    // =====================================================================

    /**
     * Foydalanuvchi bildirishnomalari (guruhlangan, eng yangisi birinchi).
     *
     * @return array ['items'=>[], 'unread'=>int, 'has_more'=>bool]
     */
    public function listFor($userId, $limit = 30, $offset = 0) {
        $userId = (int) $userId;
        $limit  = max(1, min(60, (int) $limit));
        $offset = max(0, (int) $offset);

        if ($userId <= 0) {
            return ['items' => [], 'unread' => 0, 'has_more' => false];
        }

        // Guruhlash uchun ko'proq xom qator olamiz (bir guruh bir necha qator).
        $fetch = $limit * 3;

        if ($this->hasExtended()) {
            $rows = $this->db->fetchAll(
                "SELECT n.*,
                        u.first_name AS actor_name,
                        u.username   AS actor_username,
                        u.avatar     AS actor_avatar,
                        r.title      AS reel_title,
                        r.poster     AS reel_poster
                 FROM notifications n
                 LEFT JOIN users u ON u.id = n.actor_id
                 LEFT JOIN reels r ON r.id = n.reel_id
                 WHERE n.user_id = ?
                 ORDER BY n.id DESC
                 LIMIT $fetch OFFSET $offset",
                [$userId]
            );
        } else {
            $rows = $this->db->fetchAll(
                "SELECT n.*,
                        NULL AS actor_name, NULL AS actor_username, NULL AS actor_avatar,
                        NULL AS reel_title,  NULL AS reel_poster
                 FROM notifications n
                 WHERE n.user_id = ?
                 ORDER BY n.id DESC
                 LIMIT $fetch OFFSET $offset",
                [$userId]
            );
        }

        $items   = [];
        $lastKey = '__none__';

        foreach ($rows as $r) {
            $key = isset($r['group_key']) ? (string) $r['group_key'] : '';
            $groupable = ($key !== '' && in_array($r['type'], self::GROUP_TYPES, true));

            $actor = [
                'id'       => isset($r['actor_id']) ? (int) $r['actor_id'] : 0,
                'name'     => (string) ($r['actor_name'] ?? ''),
                'username' => (string) ($r['actor_username'] ?? ''),
                'avatar'   => (string) ($r['actor_avatar'] ?? ''),
            ];

            if ($groupable && $items && $lastKey === $key) {
                $idx = count($items) - 1;
                $items[$idx]['count']++;
                if ($actor['id'] > 0 || $actor['name'] !== '') {
                    $ids = array_column($items[$idx]['actors'], 'id');
                    if (!in_array($actor['id'], $ids, true) && count($items[$idx]['actors']) < 6) {
                        $items[$idx]['actors'][] = $actor;
                    }
                }
                if (empty($r['is_read'])) {
                    $items[$idx]['is_read'] = false;
                }
                continue;
            }

            $it = [
                'id'          => (int) $r['id'],
                'type'        => $r['type'],
                'actors'      => ($actor['id'] > 0 || $actor['name'] !== '') ? [$actor] : [],
                'count'       => 1,
                'title'       => (string) $r['title'],
                'message'     => (string) ($r['message'] ?? ''),
                'url'         => (string) ($r['target_url'] ?? ''),
                'reel_id'     => isset($r['reel_id']) ? (int) $r['reel_id'] : 0,
                'reel_title'  => (string) ($r['reel_title'] ?? ''),
                'reel_poster' => (string) ($r['reel_poster'] ?? ''),
                'is_read'     => !empty($r['is_read']),
                'at'          => $r['created_at'] ?? '',
            ];
            $items[] = $it;
            $lastKey = $key;
        }

        $hasMore = count($items) > $limit;
        if ($hasMore) {
            $items = array_slice($items, 0, $limit);
        }

        foreach ($items as &$it) {
            $it['text'] = $this->formatText($it);
        }
        unset($it);

        return [
            'items'   => $items,
            'unread'  => $this->unreadCount($userId),
            'has_more'=> $hasMore,
        ];
    }

    /** Bitta element uchun odam o'qiydigan matn. */
    private function formatText(array $it) {
        // Eski (kontentga oid) yozuvlarda actor bo'lmaydi - shunchaki title.
        if (empty($it['actors']) && !in_array($it['type'], ['status', 'system', 'video', 'login'], true)) {
            $t = $it['title'] ?: 'Bildirishnoma';
            return $it['message'] !== '' ? ($t . ': ' . $it['message']) : $t;
        }

        $names = [];
        foreach ($it['actors'] as $a) {
            if ($a['name'] !== '') {
                $names[] = $a['name'];
            } elseif ($a['username'] !== '') {
                $names[] = '@' . $a['username'];
            }
        }
        $first  = $names ? $names[0] : 'Kimdir';
        $more   = ((int) $it['count']) - 1;
        $suffix = $more > 0 ? (' va yana ' . $more . ' kishi') : '';

        switch ($it['type']) {
            case 'like':    return $first . $suffix . ' reelingizni yoqtirdi';
            case 'follow':  return $first . $suffix . ' sizni kuzata boshladi';
            case 'repost':  return $first . $suffix . ' reelingizni repost qildi';
            case 'comment': return $first . ' izoh qoldirdi';
            case 'reply':   return $first . ' javob qaytardi';
            case 'mention': return $first . ' sizni eslatib o‘tdi';
            case 'status':  return $it['title'] ?: 'Reels holati o‘zgardi';
            case 'video':   return $it['title'] ?: 'Yangi video';
            case 'login':   return $it['title'] ?: 'Hisobga kirdingiz';
            case 'system':
            default:        return $it['title'] ?: 'Bildirishnoma';
        }
    }

    public function unreadCount($userId) {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return 0;
        }
        $row = $this->db->fetchOne(
            "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0",
            [$userId]
        );
        return (int) ($row['c'] ?? 0);
    }

    // =====================================================================
    // Holat
    // =====================================================================

    public function markRead($userId, $id) {
        $userId = (int) $userId;
        $id     = (int) $id;
        if ($userId <= 0 || $id <= 0) {
            return false;
        }
        $data = ['is_read' => 1];
        if ($this->hasExtended()) {
            $data['read_at'] = date('Y-m-d H:i:s');
        }
        return (bool) $this->db->update('notifications', $data, 'id = ? AND user_id = ?', [$id, $userId]);
    }

    public function markAllRead($userId) {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return false;
        }
        $data = ['is_read' => 1];
        if ($this->hasExtended()) {
            $data['read_at'] = date('Y-m-d H:i:s');
        }
        return (bool) $this->db->update('notifications', $data, 'user_id = ? AND is_read = 0', [$userId]);
    }
}
