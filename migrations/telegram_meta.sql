-- ============================================================================
-- migrations/telegram_meta.sql
-- Telegram video metama'lumotini doimiy saqlash jadvali.
--
-- Bu jadval `includes/TgMeta.php::ensure()` tomonidan ham o'z-o'zidan
-- yaratiladi. Qo'lda yaratish uchun (masalan production'da):
--   mysql -u root -p uzdub < migrations/telegram_meta.sql
--
-- Eslatma: jadval faqat METAMA'LUMOT saqlaydi (har bir video uchun ~300 bayt).
-- Video baytlari bu yerdan o'tmaydi — ular to'g'ridan-to'g'ri brauzer ->
-- Telegram DC orqali yuklanadi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `telegram_meta` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `channel` VARCHAR(100) NOT NULL,
    `post` INT NOT NULL,
    `doc_id` VARCHAR(40) DEFAULT NULL,
    `access_hash` VARCHAR(40) DEFAULT NULL,
    `file_reference` TEXT,
    `dc` SMALLINT NOT NULL DEFAULT 0,
    `size` BIGINT NOT NULL DEFAULT 0,
    `mime` VARCHAR(120) DEFAULT NULL,
    `fn` VARCHAR(500) DEFAULT NULL,
    `w` INT NOT NULL DEFAULT 0,
    `h` INT NOT NULL DEFAULT 0,
    `dur` INT NOT NULL DEFAULT 0,
    `source` VARCHAR(16) NOT NULL DEFAULT 'bot',
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `error` VARCHAR(500) DEFAULT NULL,
    `t` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tgmeta_ch_post` (`channel`, `post`),
    KEY `idx_tgmeta_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
