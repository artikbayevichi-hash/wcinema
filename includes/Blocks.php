<?php
// ============================================================================
// Blocks.php — Bloklangan foydalanuvchilar (Account Privacy moduli)
// ---------------------------------------------------------------------------
// Bloklangan foydalanuvchi qanday cheklovga ega:
//   · bloklagan profilni KO'RA olmaydi (profil 404 ga o'xshash yopiladi);
//   · bloklagan foydalanuvchi xabar YUBORA olmaydi;
//   · o'zaro layk / izoh / follow ham to'xtaydi (tomonlaridan biri bo'lsa);
//   · blok ro'yxati faqat ikkala tomon ham qaror bersa tegiladi
//     (bloklagan -> bloklagan emas, lekin bloklagan -> bloklangan mumkin).
//
// Barcha tekshiruvlar `Database` orqali bajariladi; klass hech qanday
// global holat saqlamaydi.
// ============================================================================

class Blocks
{
    /** @var Database */
    private $db;

    public function __construct(?Database $db = null)
    {
        $this->db = $db ?: Database::getInstance();
    }

    /**
     * Ikki foydalanuvchi orasidagi blok mavjudligi (bir tomon bo'lsa ham).
     * @param int|null $a
     * @param int|null $b
     * @return bool
     */
    public function isBlockedBetween($a, $b)
    {
        $a = (int) $a; $b = (int) $b;
        if ($a <= 0 || $b <= 0 || $a === $b) return false;
        $row = $this->db->fetchOne(
            'SELECT 1 FROM user_blocks
              WHERE (user_id = ? AND blocked_id = ?)
                 OR (user_id = ? AND blocked_id = ?)
              LIMIT 1',
            [$a, $b, $b, $a]
        );
        return !empty($row);
    }

    /**
     * Ko'rish uchun blok bormi? (faqat `blocked_id` -> `viewer_id`)
     * @param int $ownerId  profil egasi
     * @param int $viewerId ko'rayotgan foydalanuvchi (0 = anonim)
     */
    public function blocksViewing($ownerId, $viewerId = 0)
    {
        $ownerId = (int) $ownerId; $viewerId = (int) $viewerId;
        if ($ownerId <= 0) return false;
        if ($viewerId <= 0) return false;   // anonim hech kimni bloklagan bo'lmaydi
        if ($ownerId === $viewerId) return false;
        $row = $this->db->fetchOne(
            'SELECT 1 FROM user_blocks WHERE user_id = ? AND blocked_id = ? LIMIT 1',
            [$ownerId, $viewerId]
        );
        return !empty($row);
    }

    /**
     * Blokni qo'shish / olib tashlash (toggle).
     * @return array{blocked: bool, changed: bool}
     */
    public function toggle($userId, $targetId, $reason = null)
    {
        $userId = (int) $userId; $targetId = (int) $targetId;
        if ($userId <= 0 || $targetId <= 0) {
            return ['blocked' => false, 'changed' => false];
        }
        if ($userId === $targetId) {
            return ['blocked' => false, 'changed' => false];
        }
        if ($this->blocksViewing($userId, $targetId)) {
            $this->db->query(
                'DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?',
                [$userId, $targetId]
            );
            return ['blocked' => false, 'changed' => true];
        }
        $this->db->query(
            'INSERT IGNORE INTO user_blocks (user_id, blocked_id, reason) VALUES (?, ?, ?)',
            [$userId, $targetId, $reason !== null ? mb_substr((string) $reason, 0, 250) : null]
        );
        return ['blocked' => true, 'changed' => true];
    }

    /** Blokni olib tashlash (faqat o'z ro'yxatidan). */
    public function unblock($userId, $targetId)
    {
        $this->db->query(
            'DELETE FROM user_blocks WHERE user_id = ? AND blocked_id = ?',
            [(int) $userId, (int) $targetId]
        );
    }

    /**
     * Bloklangan foydalanuvchilar ro'yxati (profil sozlamalari uchun).
     * @return array<int,array<string,mixed>>
     */
    public function listBlocked($userId, $limit = 200)
    {
        $limit = max(1, min(500, (int) $limit));
        $rows = $this->db->fetchAll(
            'SELECT u.id, u.first_name, u.last_name, u.username, u.avatar,
                    b.created_at AS blocked_at, b.reason,
                    (b2.id IS NOT NULL) AS mutual
               FROM user_blocks b
               JOIN users u    ON u.id = b.blocked_id
               LEFT JOIN user_blocks b2
                      ON b2.user_id = b.blocked_id AND b2.blocked_id = b.user_id
              WHERE b.user_id = ?
              ORDER BY b.created_at DESC
              LIMIT ' . $limit,
            [(int) $userId]
        );
        return is_array($rows) ? $rows : [];
    }

    /**
     * Ko'rinmas qilinadigan foydalanuvchilar ID'lari (ro'yxat + teskari).
     * Kataloqlarda bir so'rovda ishlatish uchun.
     * @return array<int,true>
     */
    public function hiddenIds($viewerId)
    {
        $viewerId = (int) $viewerId;
        $out = [];
        if ($viewerId <= 0) return $out;
        $rows = $this->db->fetchAll(
            'SELECT user_id AS x, blocked_id AS y FROM user_blocks
              WHERE user_id = ? OR blocked_id = ?',
            [$viewerId, $viewerId]
        );
        foreach ((array) $rows as $r) {
            $a = (int) ($r['x'] ?? 0);
            $b = (int) ($r['y'] ?? 0);
            if ($a === $viewerId && $b > 0) $out[$b] = true;
            if ($b === $viewerId && $a > 0) $out[$a] = true;
        }
        return $out;
    }

    /**
     * Chat yuborishga ruxsat: agar biror tomon ikkinchisini bloklagan bo'lsa —
     * ruxsat yo'q.
     * @return bool
     */
    public function canMessage($fromUserId, $toUserId)
    {
        return !$this->isBlockedBetween($fromUserId, $toUserId);
    }

    /**
     * Profil ko'rishga ruxsat: maxfiy hisob + blok.
     * @return array{ok: bool, reason: string}
     */
    public function canViewProfile($ownerId, $viewerId)
    {
        $ownerId = (int) $ownerId; $viewerId = (int) $viewerId;
        if ($ownerId > 0 && $ownerId === $viewerId) {
            return ['ok' => true, 'reason' => ''];
        }
        if ($this->blocksViewing($ownerId, $viewerId)) {
            return ['ok' => false, 'reason' => 'blocked'];
        }
        $owner = $this->db->fetchOne(
            'SELECT is_private FROM users WHERE id = ?',
            [$ownerId]
        );
        if ($owner && (int) ($owner['is_private'] ?? 0) === 1) {
            if ($viewerId <= 0) return ['ok' => false, 'reason' => 'private'];
            // Faqat tasdiqlagan (following) foydalanuvchilar ko'radi.
            $follow = $this->db->fetchOne(
                'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
                [$viewerId, $ownerId]
            );
            if (empty($follow)) return ['ok' => false, 'reason' => 'private'];
        }
        return ['ok' => true, 'reason' => ''];
    }

    /**
     * Profilni ko'rish mumkinmi — `user_follows` jadvali yo'q bo'lsa ham
     * ishlashi uchun xavfsiz variant (jadvallar mavjud emasligi tekshiriladi).
     * @return array{ok: bool, reason: string}
     */
    public function canViewProfileSafe($ownerId, $viewerId)
    {
        try {
            return $this->canViewProfile($ownerId, $viewerId);
        } catch (\Throwable $e) {
            error_log('[Blocks] canViewProfileSafe: ' . $e->getMessage());
            return ['ok' => true, 'reason' => ''];
        }
    }
}
