-- ============================================================================
-- migrate-reel-social.sql
-- ----------------------------------------------------------------------------
-- Reels uchun Instagram-uslubidagi ijtimoiy funksiyalar:
--   * Save     (bookmark)  -> reel_saves + reels.saves_count
--   * Repost               -> reel_reposts + reels.reposts_count
--   * Follow   (kuzatish)  -> user_follows
--
-- Xavfsiz: bir necha marta ishga tushirsa ham bo'ladi
-- (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- ---- reels: hisoblagich ustunlari -----------------------------------------
ALTER TABLE `reels`
    ADD COLUMN IF NOT EXISTS `saves_count`   INT(11) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `reposts_count` INT(11) NOT NULL DEFAULT 0;

-- ---- saqlash (bookmark) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS `reel_saves` (
    `id`         INT(11) NOT NULL AUTO_INCREMENT,
    `reel_id`    INT(11) NOT NULL,
    `user_id`    INT(11) NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_reel_user` (`reel_id`, `user_id`),
    KEY `idx_user` (`user_id`),
    CONSTRAINT `fk_rs_reel` FOREIGN KEY (`reel_id`) REFERENCES `reels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_rs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---- repost ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reel_reposts` (
    `id`         INT(11) NOT NULL AUTO_INCREMENT,
    `reel_id`    INT(11) NOT NULL,
    `user_id`    INT(11) NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_reel_user` (`reel_id`, `user_id`),
    KEY `idx_user` (`user_id`),
    CONSTRAINT `fk_rr_reel` FOREIGN KEY (`reel_id`) REFERENCES `reels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_rr_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---- kuzatish (follow) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_follows` (
    `id`           INT(11) NOT NULL AUTO_INCREMENT,
    `follower_id`  INT(11) NOT NULL,
    `following_id` INT(11) NOT NULL,
    `created_at`   TIMESTAMP NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_follow` (`follower_id`, `following_id`),
    KEY `idx_following` (`following_id`),
    CONSTRAINT `fk_uf_follower`  FOREIGN KEY (`follower_id`)  REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_uf_following` FOREIGN KEY (`following_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
