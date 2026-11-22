-- ============================================================================
-- migrate-feedback.sql — "Takliflar / shikoyatlar" (foydalanuvchi <-> admin)
-- ============================================================================
-- Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
--
-- Oddiy xabar almashish: foydalanuvchi yozadi -> admin javob yozadi ->
-- foydalanuvchiga `notifications` jadvaliga "reply" bildirishnomasi qo'shiladi
-- va u saytga kirganda qo'ng'iroqchada ko'rinadi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `user_feedback` (
    `id`          INT(11) NOT NULL AUTO_INCREMENT,
    `user_id`     INT(11) NOT NULL,
    `type`        ENUM('suggestion','complaint') NOT NULL DEFAULT 'suggestion',
    `message`     TEXT NOT NULL,
    `status`      ENUM('open','answered','closed') NOT NULL DEFAULT 'open',
    `admin_reply` TEXT NULL DEFAULT NULL,
    `replied_by`  INT(11) NULL DEFAULT NULL,
    `replied_at`  DATETIME NULL DEFAULT NULL,
    `read_at`     DATETIME NULL DEFAULT NULL,
    `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_uf_user`   (`user_id`, `id`),
    KEY `idx_uf_status` (`status`, `id`),
    CONSTRAINT `fk_uf_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eski o'rnatishlarda jadval bor, lekin javob ustunlari yo'q bo'lishi mumkin.
ALTER TABLE `user_feedback`
    ADD COLUMN IF NOT EXISTS `status`      ENUM('open','answered','closed') NOT NULL DEFAULT 'open' AFTER `message`,
    ADD COLUMN IF NOT EXISTS `admin_reply` TEXT NULL DEFAULT NULL AFTER `status`,
    ADD COLUMN IF NOT EXISTS `replied_by`  INT(11) NULL DEFAULT NULL AFTER `admin_reply`,
    ADD COLUMN IF NOT EXISTS `replied_at`  DATETIME NULL DEFAULT NULL AFTER `replied_by`,
    ADD COLUMN IF NOT EXISTS `read_at`     DATETIME NULL DEFAULT NULL AFTER `replied_at`;
