<?php
// ============================================================================
// Avatars.php - profil rasmini yuklash (avatar upload)
// ----------------------------------------------------------------------------
// Profil rasmi `users.avatar` ustunida oddiy URL sifatida saqlanadi, shuning
// uchun u hamma joyda (navigatsiya, chat, izohlar, qidiruv, bildirishnoma)
// avtomatik ko'rinadi. Fayl `uploads/avatars/` papkasiga yoziladi.
//
// Telegram Login Widget `photo_url` (http manzil) ham `users.avatar` da
// saqlanadi - uni bu modul O'CHIRMAYDI: `remove()` faqat o'zimiz yuklagan
// fayllarni (ya'ni `uploads/avatars/...` ni) o'chiradi.
// ============================================================================

require_once __DIR__ . '/Uploader.php';

class Avatars
{
    /** Rasm uchun maksimal MB. */
    const MAX_MB = 5;

    /** Qabul qilinadigan kengaytmalar. */
    const EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    /** Qabul qilinadigan MIME turlari. */
    const MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    /** Papka manzili (absolyut). */
    public static function dir()
    {
        return UPLOAD_DIR . 'avatars';
    }

    /**
     * Yuklangan rasmni saqlaydi.
     *
     * @param  int   $userId
     * @param  array $file  $_FILES['avatar']
     * @return array{ok: bool, url?: string, error?: string}
     */
    public static function save($userId, array $file)
    {
        $dir = self::dir();
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        // Papkadagi PHP fayllar bajarilmasin (rasm tashqarisidagi yuklashlar).
        $ht = $dir . '/.htaccess';
        if (is_dir($dir) && !is_file($ht)) {
            @file_put_contents($ht, "Options -Indexes\n<FilesMatch \"\\.(php|phtml|php3|php4|php5|phar)$\">\n    Require all denied\n</FilesMatch>\n");
        }

        $err = Uploader::checkFile($file, self::MAX_MB * 1024 * 1024, self::EXT, self::MIME, 'rasm');
        if ($err !== null) {
            return ['ok' => false, 'error' => $err];
        }

        // Kengaytmani SAQLAYMIZ (GD yo'q - konvertatsiya qilinmaydi), faqat
        // xavfsiz va noyob qilib qo'yamiz.
        $ext = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        if (!in_array($ext, self::EXT, true)) {
            $ext = 'jpg';
        }
        $name = 'u' . (int) $userId . '_' . substr(bin2hex(random_bytes(8)), 0, 16) . '.' . $ext;
        $dest = $dir . '/' . $name;
        if (!@move_uploaded_file($file['tmp_name'], $dest)) {
            return ['ok' => false, 'error' => 'Rasmni saqlab bo\'lmadi'];
        }
        @chmod($dest, 0644);

        $url = Uploader::urlFor($dest);
        if (!$url) {
            @unlink($dest);
            return ['ok' => false, 'error' => 'Rasm manzilini yasab bo\'lmadi'];
        }
        return ['ok' => true, 'url' => $url];
    }

    /**
     * Faqat shu modul yuklagan rasmni o'chiradi (`uploads/avatars/...`).
     * Telegram `photo_url` kabi tashqi manzillarga tegmaydi.
     */
    public static function remove($url)
    {
        if (!is_string($url) || $url === '') {
            return;
        }
        if (strpos($url, 'uploads/avatars/') !== 0) {
            return;
        }
        $rel = rawurldecode(substr($url, strlen('uploads/')));
        // Papkadan chiqib ketishga (../) qarshi himoya.
        if ($rel === '' || strpos($rel, '..') !== false) {
            return;
        }
        $abs = UPLOAD_DIR . $rel;
        if (is_file($abs)) {
            @unlink($abs);
        }
    }
}