<?php
// ============================================================================
// StreamCache — video ochilishida qilinadigan qo'shimcha so'rovlar natijasini
// kontent bo'yicha SQLda saqlaydigan kichik qatlam.
// ============================================================================
// Nima uchun alohida jadval:
//   Fayl keshlari (TgResolve, tg-embed) serverda bor, LEKIN ular har xil
//   formatda va har xil muddatda yashaydi. Bir video ochilganda 5-6 xil
//   manbadan ma'lumot yig'ish o'rniga hammasini BITTA yozuvga yig'ib,
//   keyingi tomoshabinlarga BITTA SQL o'qish bilan beramiz.
//
// Xavfsizlik:
//   `file_reference` (Telegram chiptasi) bu yerga YOZILMAYDI — u faqat
//   uni olgan brauzer sessiyasida ishlaydi.
// ============================================================================

final class StreamCache
{
    const DEFAULT_TTL = 21600; // 6 soat
    const SCOPE_BOOT  = 'boot';
    const SCOPE_GLOBAL = 'global';
    // Kontentga tegishli MP4 indeks xaritasi (moov o'rni + ixtiyoriy
    // keyframe jadvali). `boot` yozuvidan alohida: u har ochilishda o'qiladi,
    // indeks esa katta bo'lishi mumkin — bir-biriga aralashmasin.
    const SCOPE_INDEX = 'index';

    /** Jadval bir marta yaratiladi; migratsiyasiz ham ishlayveradi. */
    private static $ready = false;

    private static function db()
    {
        return Database::getInstance()->getConnection();
    }

    private static function ensure()
    {
        if (self::$ready) {
            return true;
        }
        try {
            self::db()->exec(
                "CREATE TABLE IF NOT EXISTS `video_stream_cache` (
                    `cache_key`  VARCHAR(64)  NOT NULL,
                    `scope`      VARCHAR(32)  NOT NULL DEFAULT 'boot',
                    `payload`    LONGTEXT     NOT NULL,
                    `ttl`        INT UNSIGNED NOT NULL DEFAULT 21600,
                    `hits`       INT UNSIGNED NOT NULL DEFAULT 0,
                    `created_at` INT UNSIGNED NOT NULL,
                    `updated_at` INT UNSIGNED NOT NULL,
                    PRIMARY KEY (`cache_key`, `scope`),
                    KEY `idx_updated` (`updated_at`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            );
            self::$ready = true;
            return true;
        } catch (Throwable $e) {
            error_log('StreamCache: jadval yaratilmadi: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Keshdan o'qish. Muddat tugagan bo'lsa null qaytaradi (caller yangisini
     * quradi). O'qish soni ham hisoblanadi — testlarda "ikkinchi foydalanuvchi
     * keshdan oldi" ekanligini shuni bilan tekshiramiz.
     */
    public static function get($key, $scope = self::SCOPE_BOOT)
    {
        if (!is_string($key) || $key === '' || !self::ensure()) {
            return null;
        }
        try {
            $st = self::db()->prepare(
                'SELECT payload, ttl, created_at, updated_at FROM `video_stream_cache`
                 WHERE cache_key = ? AND scope = ? LIMIT 1'
            );
            $st->execute([$key, $scope]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                return null;
            }
            $ttl = (int) $row['ttl'];
            if ($ttl > 0 && (time() - (int) $row['updated_at']) > $ttl) {
                return null;
            }
            $data = json_decode($row['payload'], true);
            if (!is_array($data)) {
                return null;
            }

            // Hit hisobini yangilash ixtiyoriy — xato bersa ham asosiy javob buzilmaydi.
            try {
                $up = self::db()->prepare(
                    'UPDATE `video_stream_cache` SET hits = hits + 1
                     WHERE cache_key = ? AND scope = ?'
                );
                $up->execute([$key, $scope]);
            } catch (Throwable $e) {
                // jim qoldiramiz
            }
            return $data;
        } catch (Throwable $e) {
            error_log('StreamCache get: ' . $e->getMessage());
            return null;
        }
    }

    /** Yozish / yangilash. */
    public static function put($key, array $payload, $scope = self::SCOPE_BOOT, $ttl = self::DEFAULT_TTL)
    {
        if (!is_string($key) || $key === '' || !self::ensure()) {
            return false;
        }
        $ttl = max(60, min(604800, (int) $ttl));
        try {
            $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json === false) {
                return false;
            }
            $now = time();
            $st = self::db()->prepare(
                'INSERT INTO `video_stream_cache`
                    (cache_key, scope, payload, ttl, hits, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    payload = VALUES(payload),
                    ttl = VALUES(ttl),
                    updated_at = VALUES(updated_at)'
            );
            return (bool) $st->execute([$key, $scope, $json, $ttl, $now, $now]);
        } catch (Throwable $e) {
            error_log('StreamCache put: ' . $e->getMessage());
            return false;
        }
    }

    /** Bir yozuvni o'chirish (testlar va "yangilash" tugmasi uchun). */
    public static function forget($key, $scope = self::SCOPE_BOOT)
    {
        if (!self::ensure()) {
            return false;
        }
        try {
            $st = self::db()->prepare(
                'DELETE FROM `video_stream_cache` WHERE cache_key = ? AND scope = ?'
            );
            return (bool) $st->execute([$key, $scope]);
        } catch (Throwable $e) {
            return false;
        }
    }

    /** Test/monitoring uchun yozuv holati. */
    public static function info($key, $scope = self::SCOPE_BOOT)
    {
        if (!self::ensure()) {
            return null;
        }
        try {
            $st = self::db()->prepare(
                'SELECT hits, ttl, created_at, updated_at FROM `video_stream_cache`
                 WHERE cache_key = ? AND scope = ? LIMIT 1'
            );
            $st->execute([$key, $scope]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            return $row ?: null;
        } catch (Throwable $e) {
            return null;
        }
    }
}
