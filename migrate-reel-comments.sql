-- ============================================================================
--  W CINEMA - Reels: izohlar (comments)
-- ============================================================================
--  Ishga tushirish:  mysql -u root uzdub < migrate-reel-comments.sql
--  Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
--
--  Nima uchun: Instagram uslubidagi reels uchun "like" bilan bir qatorda
--  "comment" ham kerak. Har bir izoh bitta reelga va bitta foydalanuvchiga
--  bog'lanadi. Reel yoki foydalanuvchi o'chirilsa, izohlar ham avtomatik
--  o'chadi (ON DELETE CASCADE). `comments_count` - tez o'qish uchun
--  (har feed'da COUNT(*) qilmaslik uchun), xuddi `likes_count` kabi.
-- ============================================================================

-- 1) Reels jadvaliga izohlar hisoblagichi
ALTER TABLE `reels`
    ADD COLUMN IF NOT EXISTS `comments_count` INT(11) NOT NULL DEFAULT 0 AFTER `likes_count`;

-- 2) Izohlar jadvali
CREATE TABLE IF NOT EXISTS `reel_comments` (
    `id`         INT(11) NOT NULL AUTO_INCREMENT,
    `reel_id`    INT(11) NOT NULL,
    `user_id`    INT(11) NOT NULL,
    `body`       VARCHAR(1000) NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_rc_reel` (`reel_id`),
    KEY `idx_rc_user` (`user_id`),
    CONSTRAINT `fk_rc_reel` FOREIGN KEY (`reel_id`)
        REFERENCES `reels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_rc_user` FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
