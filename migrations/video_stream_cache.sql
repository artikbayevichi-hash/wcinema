-- ============================================================================
-- video_stream_cache — kontent/video uchun umumiy ma'lumotlarning doimiy keshi
-- ============================================================================
-- Maqsad: birinchi tomoshabin video ochganda olinadigan qo'shimcha ma'lumotlar
-- (poster, preview, embed tekshiruvi, doc id/dc/size, HLS holati va h.k.)
-- bir marta SQLga yoziladi. Keyingi tomoshabinlar shu videoni ochganda ular
-- qayta so'ralmaydi — faqat video baytlari olinadi.
--
-- `scope` qiymatlari:
--   • 'boot'  — bitta video uchun umumiy ma'lumotlar (~2 KB, har ochilishda);
--   • 'index' — MP4 indeks xaritasi: moov o'rni + ixtiyoriy keyframe jadvali
--               (kalit = sha1('vi:' . doc_id . ':' . size), 7 kun yashaydi).
--
-- MUHIM: foydalanuvchi sessiyasiga bog'liq `file_reference` BU JADVALGA
-- YOZILMAYDI. U faqat brauzerning o'z localStorage'ida saqlanadi. Video
-- baytlari ham bu yerga YOZILMAYDI — faqat ularning koordinatalari.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `video_stream_cache` (
    `cache_key`  VARCHAR(64)  NOT NULL COMMENT 'sha1: tg:channel/post | ct:id:episode | url:...',
    `scope`      VARCHAR(32)  NOT NULL DEFAULT 'boot' COMMENT 'boot | global | index',
    `payload`    LONGTEXT     NOT NULL COMMENT 'JSON ma\'lumotlar',
    `ttl`        INT UNSIGNED NOT NULL DEFAULT 21600 COMMENT 'kesh yashash vaqti, soniya',
    `hits`       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'keshdan qancha marta o\'qildi',
    `created_at` INT UNSIGNED NOT NULL,
    `updated_at` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`cache_key`, `scope`),
    KEY `idx_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
