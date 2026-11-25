<?php
// ============================================================================
// Settings.php — Foydalanuvchi sozlamalari (Hisob maxfiyligi + profil)
// ---------------------------------------------------------------------------
// `users` jadvalidagi `is_private` va `show_activity` maydonlarini o'qiydi /
// yozadi. Blok ro'yxati alohida `includes/Blocks.php` da.
//
// Avatar ikki xil manzil bilan keladi: tashqi http(s) havola (Telegram
// photo_url) yoki `api/avatar.php` yaratgan `uploads/avatars/...` fayli.
// Ikkalasi ham xavfsiz tarzda qabul qilinadi.
//
// Kuzatish so'rovlari uchun alohida jadval yo'q: `user_follows` da status
// ustuni yo'q. `followRequestsTable()` faqat information_schema orqali
// tekshiradi va jadval yaratmaydi.
//
// Barcha metodlar `Database` orqali ishlaydi, holat saqlamaydi.
// ============================================================================

class Settings
{
    /** @var Database */
    private $db;

    public function __construct(?Database $db = null)
    {
        $this->db = $db ?: Database::getInstance();
    }

    /**
     * Foydalanuvchi sozlamalari + profil ma'lumotlari.
     * @return array<string,mixed>
     */
    public function get($userId)
    {
        $userId = (int) $userId;
        $row = $this->db->fetchOne(
            'SELECT id, first_name, last_name, username, avatar, bio,
                    is_private, show_activity, is_premium, last_login_at
               FROM users WHERE id = ?',
            [$userId]
        );
        if (!$row) return [];

        $row['id']            = (int) $row['id'];
        $row['is_private']    = (int) ($row['is_private'] ?? 0) === 1;
        $row['show_activity'] = (int) ($row['show_activity'] ?? 1) === 1;
        $row['is_premium']    = (int) ($row['is_premium'] ?? 0) === 1;
        $row['full_name']     = trim(
            ($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? '')
        );
        return $row;
    }

    /**
     * Sozlamalarni yangilash. Faqat o'zgartirilgan maydonlar yoziladi.
     *
     * @param int   $userId
     * @param array $fields  ['is_private' => bool, 'show_activity' => bool,
     *                       'first_name' => string, ...]
     * @return array{ok: bool, changed: string[], error: string}
     */
    public function update($userId, array $fields)
    {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return ['ok' => false, 'changed' => [], 'error' => 'Foydalanuvchi topilmadi'];
        }
        $now = $this->db->fetchOne(
            'SELECT first_name, last_name, username, bio, avatar, is_private, show_activity
               FROM users WHERE id = ?',
            [$userId]
        );
        if (!$now) {
            return ['ok' => false, 'changed' => [], 'error' => 'Foydalanuvchi topilmadi'];
        }

        $data = [];

        // --- maxfiylik ---
        if (array_key_exists('is_private', $fields)) {
            $v = self::boolish($fields['is_private']);
            if ($v === null) return $this->err('is_private: 1 yoki 0 bo‘lishi kerak');
            if ((int) $v !== (int) $now['is_private']) $data['is_private'] = $v ? 1 : 0;
        }
        if (array_key_exists('show_activity', $fields)) {
            $v = self::boolish($fields['show_activity']);
            if ($v === null) return $this->err('show_activity: 1 yoki 0 bo‘lishi kerak');
            if ((int) $v !== (int) $now['show_activity']) $data['show_activity'] = $v ? 1 : 0;
        }

        // --- profil tahrirlash ---
        if (array_key_exists('first_name', $fields)) {
            $v = mb_substr(self::noTags((string) $fields['first_name']), 0, 100);
            if ($v === '') return $this->err('Ism bo‘sh bo‘lmasligi kerak');
            if ($v !== $now['first_name']) $data['first_name'] = $v;
        }
        if (array_key_exists('last_name', $fields)) {
            // Bo'sh familiya nomi — tozalash uchun ruxsat beriladi.
            $v = mb_substr(self::noTags((string) $fields['last_name']), 0, 100);
            if ($v !== (string) $now['last_name']) $data['last_name'] = $v;
        }
        if (array_key_exists('username', $fields)) {
            $v = ltrim(self::noTags((string) $fields['username']), '@');
            // Bo'sh username — o'zgartirilmaydi (telegram login'ga bog'liq).
            if ($v !== '') {
                if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $v)) {
                    return $this->err('Username: 3–32 ta harf, raqam yoki «_»');
                }
                if ($v !== (string) $now['username']) {
                    // Ism bir xil bo'la oladi, username esa ikkala jadvalda ham
                    // noyob bo'lishi kerak.
                    $taken = function_exists('username_taken')
                        ? username_taken($v, $userId)
                        : (bool) $this->db->fetchOne(
                            'SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id <> ? LIMIT 1',
                            [$v, $userId]
                        );
                    if ($taken) return $this->err('Bu username band');
                    $data['username'] = $v;
                }
            }
        }
        if (array_key_exists('bio', $fields)) {
            $v = mb_substr(self::noTags((string) $fields['bio']), 0, 500);
            if ($v !== (string) $now['bio']) $data['bio'] = $v;
        }
        if (array_key_exists('avatar', $fields)) {
            $v = trim((string) $fields['avatar']);
            if ($v === '') {
                // Avatar o'chirish — faqat aniq so'rov bo'lsa.
                if (array_key_exists('remove_avatar', $fields)
                    && self::boolish($fields['remove_avatar']) === true
                    && (string) $now['avatar'] !== '') {
                    $data['avatar'] = '';
                }
            } else {
                $v = mb_substr($v, 0, 500);
                if (!self::validAvatar($v)) {
                    return $this->err('Avatar manzili http(s) yoki uploads/avatars/... bo‘lishi kerak');
                }
                if ($v !== (string) $now['avatar']) $data['avatar'] = $v;
            }
        }

        // Hech narsa o'zgarmadi — yozish kerak emas.
        if (!$data) return ['ok' => true, 'changed' => [], 'error' => ''];

        try {
            $stmt = $this->db->update('users', $data, 'id = ?', [$userId]);
            if ($stmt === false) return $this->err('Saqlanmadi');
        } catch (\Throwable $e) {
            error_log('[Settings] update: ' . $e->getMessage());
            return $this->err('Saqlanmadi');
        }
        return ['ok' => true, 'changed' => array_keys($data), 'error' => ''];
    }

    /**
     * Profilni tahrirlash (faqat o'z ma'lumotlari).
     * @return array{ok: bool, changed: string[], error: string}
     */
    public function updateProfile($userId, array $fields)
    {
        $allow = ['first_name', 'last_name', 'username', 'bio', 'avatar', 'remove_avatar'];
        $f = [];
        foreach ($allow as $k) {
            if (array_key_exists($k, $fields)) $f[$k] = $fields[$k];
        }
        return $this->update($userId, $f);
    }

    /**
     * Kuzatish so'rovlari uchun mos jadval bormi? (FAQAT o'qish)
     *
     * Hozirgi bazada `user_follows` bor, lekin unda `status` ustuni yo'q,
     * `follow_requests` jadvali esa umuman yo'q. Shuning uchun sozlamalar
     * sahifasi bu metod null qaytarganda butun bo'limni yashiradi — bosilganda
     * ishlamaydigan "Tasdiqlash/Rad etish" tugmalari chiqmaydi.
     *
     * Hech qanday jadval/ustun yaratilmaydi, migration qo'shilmaydi.
     *
     * @return string|null mos jadval nomi yoki null
     */
    public function followRequestsTable()
    {
        try {
            $tables = $this->db->fetchAll(
                "SELECT TABLE_NAME AS name FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME IN ('follow_requests', 'user_follow_requests')"
            );
            foreach ($tables as $t) {
                $name = (string) ($t['name'] ?? '');
                if ($name === '') continue;

                $cols = $this->db->fetchAll(
                    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
                    [$name]
                );
                $have = [];
                foreach ($cols as $c) {
                    $have[strtolower((string) ($c['name'] ?? ''))] = true;
                }
                $from = array_intersect(
                    ['follower_id', 'user_id', 'requester_id', 'from_user_id'],
                    array_keys($have)
                );
                $to = array_intersect(
                    ['following_id', 'target_user_id', 'to_user_id', 'owner_id'],
                    array_keys($have)
                );
                // Minimal moslik: kim so'ragani, kimga qaratilgani va holati.
                if ($from && $to && isset($have['status'])) {
                    return $name;
                }
            }
        } catch (\Throwable $e) {
            error_log('[Settings] followRequestsTable: ' . $e->getMessage());
        }
        return null;
    }

    // ------------------------------------------------------------ yordamchi
    /**
     * Avatar manzili xavfsizmi?
     *
     * Qabul: http(s) havola yoki `api/avatar.php` bergan nisbiy
     * `uploads/avatars/<fayl>.<rasm kengaytmasi>` yo'li.
     * Rad: `../`, `//host`, `javascript:` va boshqa ixtiyoriy nisbiy yo'llar.
     */
    private static function validAvatar($v)
    {
        $v = (string) $v;
        if (preg_match('#^https?://#i', $v)) {
            return true;
        }
        return strpos($v, '..') === false
            && (bool) preg_match(
                '#^uploads/avatars/[A-Za-z0-9][A-Za-z0-9._~%-]*\.(jpg|jpeg|png|webp|gif)$#i',
                $v
            );
    }

    /** "1/true/on/ha" → true; "0/false/off/yo'q" → false; boshqa → null */
    private static function boolish($v)
    {
        if (is_bool($v)) return $v;
        if (is_int($v)) return $v !== 0;
        $s = strtolower(trim((string) $v));
        if ($s === '') return null;
        if (in_array($s, ['1', 'true', 'on', 'ha', 'yes', 'y'], true)) return true;
        if (in_array($s, ['0', 'false', 'off', 'no', 'yoq', 'n'], true)) return false;
        return null;
    }

    /** HTML teglarini olib tashlaydi (bio/ism toza matn bo'lishi uchun). */
    private static function noTags($s)
    {
        $s = preg_replace('/<[^>]*>/u', '', (string) $s);
        return trim((string) $s);
    }

    private function err($msg)
    {
        return ['ok' => false, 'changed' => [], 'error' => $msg];
    }
}
