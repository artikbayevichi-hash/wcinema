<?php
// ============================================================================
// AdminUsers.php - admin panel uchun foydalanuvchilar bilan ishlash
// ============================================================================
// Vazifalari:
//   • ban / unban (is_banned, ban_reason, banned_at)
//   • premium berish / olish (is_premium)
//   • qidiruv + filtr + sahifalash
//
// Jadval ustunlari ish vaqtida (kerak bo'lsa) qo'shiladi — migratsiyani
// unutib qo'yish panelni ishlamay qo'yishiga olib kelmasligi uchun.
// ============================================================================

class AdminUsers
{
    /** @var Database */
    private $db;

    /** @var bool|null */
    private static $ready = null;

    public function __construct(?Database $db = null)
    {
        $this->db = $db ?: Database::getInstance();
        $this->ensure();
    }

    /** Ban/premium ustunlarini (kerak bo'lsa) qo'shadi. */
    public function ensure()
    {
        if (self::$ready !== null) {
            return self::$ready;
        }
        self::$ready = true;
        try {
            $cols = $this->db->fetchAll('SHOW COLUMNS FROM users');
            $names = array_map(function ($c) { return (string) $c['Field']; }, $cols ?: []);

            if (!in_array('is_banned', $names, true)) {
                $this->db->query('ALTER TABLE users ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0');
            }
            if (!in_array('ban_reason', $names, true)) {
                $this->db->query('ALTER TABLE users ADD COLUMN ban_reason VARCHAR(255) NULL');
            }
            if (!in_array('banned_at', $names, true)) {
                $this->db->query('ALTER TABLE users ADD COLUMN banned_at DATETIME NULL');
            }
        } catch (Throwable $e) {
            error_log('[AdminUsers] ensure: ' . $e->getMessage());
        }
        return self::$ready;
    }

    /**
     * Foydalanuvchilar ro'yxati.
     *
     * @param string $q      qidiruv (ism, username, telegram id, user_id)
     * @param string $filter all|premium|banned
     * @param int    $page   1 dan boshlanadi
     * @param int    $per    sahifadagi qatorlar
     * @return array{rows:array, total:int, pages:int, page:int}
     */
    public function listUsers($q = '', $filter = 'all', $page = 1, $per = 25)
    {
        $where  = ['1 = 1'];
        $params = [];

        $q = trim((string) $q);
        if ($q !== '') {
            $like = '%' . $q . '%';
            $where[] = '(first_name LIKE ? OR last_name LIKE ? OR username LIKE ?
                         OR telegram_user_id = ? OR user_id = ? OR email LIKE ?)';
            array_push($params, $like, $like, $like, $q, $q, $like);
        }
        if ($filter === 'premium') {
            $where[] = 'is_premium = 1';
        } elseif ($filter === 'banned') {
            $where[] = 'is_banned = 1';
        }

        $whereSql = implode(' AND ', $where);

        $cnt = $this->db->fetchOne("SELECT COUNT(*) AS n FROM users WHERE $whereSql", $params);
        $total = (int) ($cnt['n'] ?? 0);

        $per  = max(5, min(100, (int) $per));
        $pages = max(1, (int) ceil($total / $per));
        $page  = max(1, min($pages, (int) $page));
        $off   = ($page - 1) * $per;

        $rows = $this->db->fetchAll(
            "SELECT id, user_id, telegram_user_id, first_name, last_name, username,
                    avatar, is_premium, is_banned, ban_reason, is_bot_blocked,
                    created_at, last_login_at, last_activity
               FROM users
              WHERE $whereSql
              ORDER BY id DESC
              LIMIT $per OFFSET $off",
            $params
        );

        return [
            'rows'  => is_array($rows) ? $rows : [],
            'total' => $total,
            'pages' => $pages,
            'page'  => $page,
        ];
    }

    public function get($id)
    {
        return $this->db->fetchOne('SELECT * FROM users WHERE id = ? LIMIT 1', [(int) $id]);
    }

    /** Premium yoqish/o'chirish. */
    public function setPremium($id, $on)
    {
        return (bool) $this->db->update(
            'users',
            ['is_premium' => $on ? 1 : 0],
            'id = ?',
            [(int) $id]
        );
    }

    /** Ban / unban. */
    public function setBanned($id, $on, $reason = '')
    {
        $id = (int) $id;
        if ($id <= 0) {
            return false;
        }
        $fields = [
            'is_banned'  => $on ? 1 : 0,
            'ban_reason' => $on ? mb_substr(trim((string) $reason), 0, 255) : null,
            'banned_at'  => $on ? date('Y-m-d H:i:s') : null,
        ];
        return (bool) $this->db->update('users', $fields, 'id = ?', [$id]);
    }

    /** Jami / premium / ban / bugungi statistika. */
    public function summary()
    {
        $one = function ($sql) {
            $r = $this->db->fetchOne($sql);
            return $r ? (int) array_values($r)[0] : 0;
        };
        return [
            'total'    => $one('SELECT COUNT(*) FROM users'),
            'premium'  => $one('SELECT COUNT(*) FROM users WHERE is_premium = 1'),
            'banned'   => $one('SELECT COUNT(*) FROM users WHERE is_banned = 1'),
            'today'    => $one('SELECT COUNT(*) FROM users WHERE DATE(created_at) = CURDATE()'),
            'week'     => $one('SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
            'active24' => $one('SELECT COUNT(*) FROM users WHERE last_activity >= DATE_SUB(NOW(), INTERVAL 24 HOUR)'),
        ];
    }
}
