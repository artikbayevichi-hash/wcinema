<?php
// ============================================================================
// AdminLog.php - admin amallari jurnali (audit)
// ============================================================================
// Har bir muhim amal (kontent, qism, ban, premium, bildirishnoma, sozlama)
// shu jadvalga yoziladi. Admin panelning "Loglar" bo'limi shu yerdan o'qiydi.
// ============================================================================

class AdminLog
{
    /** @var Database */
    private static $db = null;
    private static $ready = null;

    private static function db()
    {
        if (self::$db === null) {
            self::$db = Database::getInstance();
        }
        return self::$db;
    }

    public static function ensure()
    {
        if (self::$ready !== null) {
            return self::$ready;
        }
        self::$ready = false;
        try {
            self::db()->query(
                "CREATE TABLE IF NOT EXISTS admin_log (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    admin_id INT UNSIGNED NULL,
                    action VARCHAR(64) NOT NULL,
                    details TEXT NULL,
                    ip VARCHAR(45) NULL,
                    created_at DATETIME NOT NULL,
                    PRIMARY KEY (id),
                    KEY idx_admin_log_time (created_at),
                    KEY idx_admin_log_action (action)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            self::$ready = true;
        } catch (Throwable $e) {
            error_log('[AdminLog] ensure: ' . $e->getMessage());
        }
        return self::$ready;
    }

    /**
     * Amalni yozadi. Xato bo'lsa jim o'tadi — jurnal panelni to'xtatmasligi kerak.
     */
    public static function add($action, $details = '', $adminId = null)
    {
        if (!self::ensure()) {
            return false;
        }
        if ($adminId === null) {
            $adminId = isset($GLOBALS['userId']) ? (int) $GLOBALS['userId'] : null;
        }
        if (is_array($details)) {
            $details = json_encode($details, JSON_UNESCAPED_UNICODE);
        }
        try {
            self::db()->insert('admin_log', [
                'admin_id'   => $adminId ?: null,
                'action'     => mb_substr((string) $action, 0, 64),
                'details'    => mb_substr((string) $details, 0, 4000),
                'ip'         => substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45),
                'created_at' => date('Y-m-d H:i:s'),
            ]);
            return true;
        } catch (Throwable $e) {
            error_log('[AdminLog] add: ' . $e->getMessage());
            return false;
        }
    }

    /** @return array<int,array> */
    public static function listAll($limit = 100, $offset = 0)
    {
        if (!self::ensure()) {
            return [];
        }
        $limit  = max(1, min(500, (int) $limit));
        $offset = max(0, (int) $offset);
        try {
            return self::db()->fetchAll(
                "SELECT id, admin_id, action, details, ip, created_at
                   FROM admin_log
                  ORDER BY id DESC
                  LIMIT $limit OFFSET $offset"
            ) ?: [];
        } catch (Throwable $e) {
            return [];
        }
    }

    public static function count()
    {
        if (!self::ensure()) {
            return 0;
        }
        try {
            $r = self::db()->fetchOne("SELECT COUNT(*) AS n FROM admin_log");
            return (int) ($r['n'] ?? 0);
        } catch (Throwable $e) {
            return 0;
        }
    }
}
