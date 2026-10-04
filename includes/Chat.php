<?php
// ============================================================================
// includes/Chat.php - chat yadrosi
// ============================================================================
// Xabarlar serverda saqlanmaydi. Bu klass faqat:
//   - 4 umumiy xona (Hammaga/Kino/Anime/Multfilm) uchun Telegram forum
//     MAVZULARINI ta'minlaydi (bo'lmasa bot orqali ochadi);
//   - "shaxsiy chat ro'yxati" (chat_contacts) ni boshqaradi.
//
// Izohlarning aynan shu guruh/mavzu infratuzilmasi ishlatiladi
// (Reels::ensureTopic kabi), shuning uchun sozlash shart emas.
// ============================================================================

class Chat {
    /** @var Database */
    private $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    // ---------------------------------------------------------------- xonalar
    /**
     * 4 ta umumiy xonani qaytaradi. `$ensure` true bo'lsa, mavzusi
     * bo'lmagan xonalar uchun Telegram topic ochiladi.
     */
    public function rooms($ensure = true) {
        $rows = $this->db->fetchAll(
            "SELECT id, room_key, title, tg_topic_id
               FROM chat_rooms
              ORDER BY sort_order ASC, id ASC"
        );
        $out = [];
        foreach ($rows as $r) {
            $topicId = !empty($r['tg_topic_id']) ? (int) $r['tg_topic_id'] : 0;
            if ($ensure && $topicId <= 0 && TG_COMMENTS_CHAT !== '') {
                $topicId = $this->ensureRoomTopic(
                    (int) $r['id'],
                    (string) $r['room_key'],
                    (string) $r['title']
                );
            }
            $out[] = [
                'id'       => (int) $r['id'],
                'key'      => (string) $r['room_key'],
                'title'    => (string) $r['title'],
                'topic_id' => $topicId > 0 ? $topicId : null,
                'chat'     => TG_COMMENTS_CHAT,
                'url'      => $topicId > 0 ? $this->topicUrl($topicId) : null,
            ];
        }
        return $out;
    }

    /** Bitta xona (room_key bo'yicha). */
    public function roomByKey($key) {
        $row = $this->db->fetchOne(
            "SELECT id, room_key, title, tg_topic_id FROM chat_rooms WHERE room_key = ? LIMIT 1",
            [(string) $key]
        );
        return $row ?: null;
    }

    /** Mavzu bo'lmasa bot orqali ochib, topic id ni qaytaradi (0 - xato). */
    private function ensureRoomTopic($roomId, $key, $title) {
        $name = $this->roomIcon($key) . ' ' . $title;
        try {
            $bot = new TelegramBot();
            $res = $bot->createForumTopic(TG_COMMENTS_CHAT, $name);
        } catch (Exception $e) {
            return 0;
        }
        if (!$res || empty($res['message_thread_id'])) {
            return 0;
        }
        $topicId = (int) $res['message_thread_id'];
        $this->db->update('chat_rooms', ['tg_topic_id' => $topicId], 'id = ?', [(int) $roomId]);
        return $topicId;
    }

    /** Xona nomi oldidagi kichik emoji (Telegram mavzu nomi uchun). */
    private function roomIcon($key) {
        $m = [
            'general'  => '💬',
            'kino'     => '🎬',
            'anime'    => '✨',
            'multfilm' => '🧸',
        ];
        return isset($m[$key]) ? $m[$key] : '💬';
    }

    /** Mavzuning Telegram web havolasi. */
    private function topicUrl($topicId) {
        $topicId = (int) $topicId;
        if ($topicId <= 0 || TG_COMMENTS_URL === '') {
            return null;
        }
        return rtrim(TG_COMMENTS_URL, '/') . '/' . $topicId;
    }

    // -------------------------------------------------------------- kontaktlar
    /**
     * Joriy foydalanuvchi ochgan shaxsiy chatlar ro'yxati.
     * Bloklanganlar (ikkala tomon bo'yicha ham) ro'yxatda ko'rinmaydi.
     */
    public function contacts($ownerId) {
        $ownerId = (int) $ownerId;
        if ($ownerId <= 0) {
            return [];
        }
        $rows = $this->db->fetchAll(
            "SELECT u.id, u.first_name, u.last_name, u.username, u.avatar,
                    u.is_premium, u.telegram_user_id, c.created_at AS added_at,
                    c.last_at
               FROM chat_contacts c
               JOIN users u ON u.id = c.peer_id
              WHERE c.owner_id = ?
              ORDER BY c.last_at DESC, c.id DESC",
            [$ownerId]
        );
        $blocks   = new Blocks($this->db);
        $hidden   = $blocks->hiddenIds($ownerId);
        $out = [];
        foreach ($rows as $u) {
            $pid = (int) $u['id'];
            if (isset($hidden[$pid])) continue;   // bloklangan -> yashiriladi
            $out[] = [
                'id'               => $pid,
                'first_name'       => $u['first_name'] ?: 'Foydalanuvchi',
                'last_name'        => $u['last_name'] ?: '',
                'username'         => $u['username'] ?: null,
                'avatar'           => $u['avatar'] ?: null,
                'premium'          => (int) ($u['is_premium'] ?? 0),
                'telegram_user_id' => $u['telegram_user_id'] ? (string) $u['telegram_user_id'] : null,
                'added_at'         => $u['added_at'] ?? null,
            ];
        }
        return $out;
    }

    /**
     * Bitta kontakt haqida ma'lumot (profil "Xabar" tugmasi uchun).
     * `$viewerId` berilsa, `blocked` va `can_message` maydonlari qo'shiladi.
     */
    public function peer($peerId, $viewerId = 0) {
        $u = $this->db->fetchOne(
            "SELECT id, first_name, last_name, username, avatar, is_premium, telegram_user_id
               FROM users WHERE id = ? LIMIT 1",
            [(int) $peerId]
        );
        if (!$u) {
            return null;
        }
        $out = [
            'id'               => (int) $u['id'],
            'first_name'       => $u['first_name'] ?: 'Foydalanuvchi',
            'last_name'        => $u['last_name'] ?: '',
            'username'         => $u['username'] ?: null,
            'avatar'           => $u['avatar'] ?: null,
            'premium'          => (int) ($u['is_premium'] ?? 0),
            'telegram_user_id' => $u['telegram_user_id'] ? (string) $u['telegram_user_id'] : null,
        ];
        $viewerId = (int) $viewerId;
        if ($viewerId > 0) {
            $blocks = new Blocks($this->db);
            $out['blocked']      = $blocks->isBlockedBetween($viewerId, $out['id']);
            $out['i_blocked']    = $blocks->blocksViewing($viewerId, $out['id']);
            $out['blocked_me']   = $blocks->blocksViewing($out['id'], $viewerId);
            $out['can_message']  = $out['blocked'] ? false : true;
        }
        return $out;
    }

    /**
     * Xabar yuborish mumkinmi? (blok + o'z-o'zidan bloklash tekshiruvi)
     * @return array{ok:bool, blocked:bool, i_blocked:bool, blocked_me:bool}
     */
    public function messagePermission($fromId, $toId) {
        $fromId = (int) $fromId; $toId = (int) $toId;
        if ($fromId <= 0 || $toId <= 0 || $fromId === $toId) {
            return ['ok' => false, 'blocked' => false, 'i_blocked' => false, 'blocked_me' => false];
        }
        $blocks = new Blocks($this->db);
        return [
            'ok'          => $blocks->canMessage($fromId, $toId),
            'blocked'     => $blocks->isBlockedBetween($fromId, $toId),
            'i_blocked'   => $blocks->blocksViewing($fromId, $toId),
            'blocked_me'  => $blocks->blocksViewing($toId, $fromId),
        ];
    }

    /** Ro'yxatga qo'shish (follow bosilganda yoki "Xabar" tugmasida). */
    public function addContact($ownerId, $peerId) {
        $ownerId = (int) $ownerId;
        $peerId  = (int) $peerId;
        if ($ownerId <= 0 || $peerId <= 0 || $ownerId === $peerId) {
            return false;
        }
        // Blok mavjud bo'lsa ro'yxatga qo'shib bo'lmaydi.
        $blocks = new Blocks($this->db);
        if ($blocks->isBlockedBetween($ownerId, $peerId)) {
            return false;
        }
        $exists = $this->db->fetchOne("SELECT id FROM users WHERE id = ? LIMIT 1", [$peerId]);
        if (!$exists) {
            return false;
        }
        $has = $this->db->fetchOne(
            "SELECT id FROM chat_contacts WHERE owner_id = ? AND peer_id = ? LIMIT 1",
            [$ownerId, $peerId]
        );
        if (!$has) {
            $this->db->insert('chat_contacts', [
                'owner_id' => $ownerId,
                'peer_id'  => $peerId,
            ]);
        } else {
            // Ro'yxat tepasiga chiqishi uchun vaqtni yangilaymiz.
            $this->db->update('chat_contacts', ['last_at' => date('Y-m-d H:i:s')], 'id = ?', [(int) $has['id']]);
        }
        return true;
    }

    /** Ro'yxatdan olib tashlash (faqat o'z ro'yxatidan). */
    public function removeContact($ownerId, $peerId) {
        $ownerId = (int) $ownerId;
        $peerId  = (int) $peerId;
        if ($ownerId <= 0 || $peerId <= 0) {
            return false;
        }
        $this->db->delete('chat_contacts', 'owner_id = ? AND peer_id = ?', [$ownerId, $peerId]);
        return true;
    }
}
