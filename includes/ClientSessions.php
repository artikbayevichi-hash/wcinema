<?php
// ============================================================================
// ClientSessions - brauzerdagi (MTProto) foydalanuvchi uchun IMZOLANGAN sessiya
// ============================================================================
// MUAMMO (nimadan himoya qiladi):
//   Sayt brauzerdagi GramJS/MTProto orqali ishlaydi, shuning uchun serverda
//   PHP sessiyasi bo'lmaydi. Ilgari joriy foydalanuvchi har so'rovda
//   `tg_me` JSON'i bilan aniqlanardi — ya'ni HAR KIM istalgan Telegram ID
//   ni yozib, boshqa foydalanuvchi nomidan ish qila olardi (DM, bloklash,
//   layk, yuklash...).
//
// YECHIM:
//   Server bir marta (login paytida) tasodifiy tokenni yaratadi, uni
//   HttpOnly cookie sifatida beradi va bazada faqat SHA-256 hash'ini
//   saqlaydi. Keyingi so'rovlarda foydalanuvchi `tg_me` dan EMAS, shu
//   cookie'dan aniqlanadi. Cookie'ni qo'lda o'zgartirish hech narsa
//   bermaydi — bazadagi hash bilan mos kelishi shart.
//
// ESLATMA: token qanday "isbot" asosida berilishi api/client-session.php
// da hal qilinadi (initData HMAC / bot tasdig'i / vaqtincha moslik rejimi).
// ============================================================================

class ClientSessions
{
    /** Cookie nomi (HttpOnly). */
    const COOKIE = 'wc_cs';

    /** Standart amal qilish muddati (kun). */
    const TTL_DAYS = 30;

    /** @var Database|null */
    private static $db = null;

    /** @var bool|null jadval tayyorligi (bir marta tekshiriladi) */
    private static $ready = null;

    private static function db()
    {
        if (self::$db === null) {
            self::$db = Database::getInstance();
        }
        return self::$db;
    }

    /**
     * Jadvalni (kerak bo'lsa) yaratadi.
     *
     * Nima uchun runtime'da: migratsiya SQL faylini qo'lda ishga tushirishni
     * unutish oson; jadval bo'lmasa BUTUN sayt 401 bo'lib qolardi.
     */
    public static function ensure()
    {
        if (self::$ready !== null) {
            return self::$ready;
        }
        self::$ready = false;
        try {
            self::db()->query(
                "CREATE TABLE IF NOT EXISTS client_sessions (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    user_id INT UNSIGNED NOT NULL,
                    token_hash CHAR(64) NOT NULL,
                    created_at DATETIME NOT NULL,
                    last_used_at DATETIME NULL,
                    expires_at DATETIME NOT NULL,
                    ip VARCHAR(45) NULL,
                    user_agent VARCHAR(255) NULL,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_client_token (token_hash),
                    KEY idx_client_user (user_id),
                    KEY idx_client_exp (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            self::$ready = true;
        } catch (Throwable $e) {
            error_log('[ClientSessions] jadval yaratilmadi: ' . $e->getMessage());
            self::$ready = false;
        }
        return self::$ready;
    }

    /**
     * Cookie yo'li — ilova qaysi papkada turgan bo'lsa (`/tele_uzdub/`).
     * Aks holda cookie faqat `/api/` da ko'rinib qolardi.
     */
    public static function cookiePath()
    {
        $path = (string) (parse_url(SITE_URL, PHP_URL_PATH) ?: '');
        $path = rtrim($path, '/') . '/';
        return $path === '' ? '/' : $path;
    }

    /** Joriy so'rov cookie'sidagi tokenni qaytaradi (bo'lmasa ''). */
    public static function rawToken()
    {
        $t = (string) ($_COOKIE[self::COOKIE] ?? '');
        return preg_match('/^[a-f0-9]{64}$/', $t) ? $t : '';
    }

    /**
     * Tokenni tekshirib, foydalanuvchi ID'sini qaytaradi (0 — yaroqsiz).
     */
    public static function resolve($token)
    {
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            return 0;
        }
        if (!self::ensure()) {
            return 0;
        }
        $hash = hash('sha256', $token);

        // BAN: ban qilingan foydalanuvchining sessiyasi ishlamaydi.
        // `is_banned` ustuni bo'lmasa (eski baza) — oddiy so'rovga qaytamiz.
        $row = null;
        try {
            $row = self::db()->fetchOne(
                "SELECT cs.id, cs.user_id, cs.last_used_at
                   FROM client_sessions cs
                   JOIN users u ON u.id = cs.user_id
                  WHERE cs.token_hash = ? AND cs.expires_at > NOW()
                    AND u.is_banned = 0 LIMIT 1",
                [$hash]
            );
        } catch (Throwable $e) {
            $row = self::db()->fetchOne(
                "SELECT id, user_id, last_used_at FROM client_sessions
                  WHERE token_hash = ? AND expires_at > NOW() LIMIT 1",
                [$hash]
            );
        }
        if (!$row) {
            return 0;
        }

        // `last_used_at` — har so'rovda yozmaslik uchun 5 daqiqada bir marta.
        $last = !empty($row['last_used_at']) ? strtotime((string) $row['last_used_at']) : 0;
        if (!$last || (time() - $last) > 300) {
            self::db()->query(
                "UPDATE client_sessions SET last_used_at = ? WHERE id = ?",
                [date('Y-m-d H:i:s'), (int) $row['id']]
            );
        }
        return (int) $row['user_id'];
    }

    /** Joriy cookie egasining foydalanuvchi ID'si (0 — yo'q). */
    public static function currentUserId()
    {
        return self::resolve(self::rawToken());
    }

    /**
     * Foydalanuvchi uchun yangi sessiya yaratadi va cookie beradi.
     *
     * @return string yaratilgan token (cookie'ga yozilgan)
     */
    public static function issue($userId)
    {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return '';
        }

        $token = bin2hex(random_bytes(32));          // 64 belgi
        $now   = time();
        $days  = defined('CLIENT_SESSION_DAYS') ? (int) CLIENT_SESSION_DAYS : self::TTL_DAYS;
        $expTs = $now + (max(1, $days) * 86400);

        if (self::ensure()) {
            try {
                self::db()->insert('client_sessions', [
                    'user_id'      => $userId,
                    'token_hash'   => hash('sha256', $token),
                    'created_at'   => date('Y-m-d H:i:s', $now),
                    'last_used_at' => date('Y-m-d H:i:s', $now),
                    'expires_at'   => date('Y-m-d H:i:s', $expTs),
                    'ip'           => substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45),
                    'user_agent'   => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
                ]);
            } catch (Throwable $e) {
                error_log('[ClientSessions] issue: ' . $e->getMessage());
                return '';
            }

            // Eski (muddati o'tgan) yozuvlarni seyrek tozalaymiz (1%).
            if (random_int(1, 100) === 1) {
                self::db()->query("DELETE FROM client_sessions WHERE expires_at < NOW()");
            }
        }

        self::setCookie($token, $expTs);
        return $token;
    }

    /** Cookie'ni o'rnatadi (HttpOnly + SameSite=Lax + HTTPS'da Secure). */
    private static function setCookie($token, $expires)
    {
        $secure = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
            || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
            || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';

        if (headers_sent()) {
            return;
        }
        setcookie(self::COOKIE, (string) $token, [
            'expires'  => (int) $expires,
            'path'     => self::cookiePath(),
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $_COOKIE[self::COOKIE] = (string) $token;
    }

    /** Joriy sessiyani butunlay bekor qiladi (logout). */
    public static function revokeCurrent()
    {
        $token = self::rawToken();
        if ($token !== '' && self::ensure()) {
            try {
                self::db()->query(
                    "DELETE FROM client_sessions WHERE token_hash = ?",
                    [hash('sha256', $token)]
                );
            } catch (Throwable $e) {
                error_log('[ClientSessions] revoke: ' . $e->getMessage());
            }
        }
        if (!headers_sent()) {
            setcookie(self::COOKIE, '', [
                'expires'  => time() - 3600,
                'path'     => self::cookiePath(),
                'secure'   => false,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
        unset($_COOKIE[self::COOKIE]);
    }
}
