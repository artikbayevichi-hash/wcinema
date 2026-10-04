-- ============================================================================
--  W CINEMA - Sayt foydalanuvchi nomlari (@username)
-- ============================================================================
--  Ishga tushirish:  mysql -u root uzdub < migrate-tg-names.sql
--  Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
--
--  G'oya: sayt sessiyasi yo'q, Telegram akkauntdan boshqa ism/username
--  bo'lmasligi mumkin. Har bir foydalanuvchi saytga kirganda o'ziga
--  @username tanlaydi; u shu jadvalda saqlanadi. Izohlarda boshqalar
--  shu nomni ko'radi va "@username" orqali belgilash (mention) mumkin.
--  Bu FAQAT metadata - izohlar matni saqlanmaydi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `tg_names` (
    `tg_id`      BIGINT       NOT NULL,
    `username`   VARCHAR(32)  NOT NULL,
    `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`tg_id`),
    UNIQUE KEY `uniq_tg_names_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
