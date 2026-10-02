-- ============================================================================
-- Migratsiya: kino-platforma sxemasiga moslash
-- ============================================================================
-- Bu fayl "uzdub" bazasiga qo'shimchalar qiladi. Mavjud jadvallar
-- (users, content, episodes, categories, genres, likes, watch_progress,
-- watchlist, user_sessions, notifications) O'ZGARTIRILMAYDI.
--
-- Ishga tushirish:
--   C:\xampp\mysql\bin\mysql.exe -u root uzdub < migrate.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4-QADAM: Telegram'ga yuborish tarixi
-- ---------------------------------------------------------------------------
-- Eski prototipdagi "video_deliveries" jadvali "videos" bilan bog'langan edi.
-- Endi u "content" va "episodes" ga bog'lanadi:
--   content_id  - film yoki serial
--   episode_id  - qism (0 = butun film)
--
-- UNIQUE cheklovi: bitta foydalanuvchi bir xil qismni ikki marta
-- yuborilmasligini ta'minlaydi (Telegram limitlarini tejash uchun).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_deliveries` (
  `id`             int(11) NOT NULL AUTO_INCREMENT,
  `user_id`        int(11) NOT NULL,
  `content_id`     int(11) NOT NULL,
  `episode_id`     int(11) NOT NULL DEFAULT 0,
  `telegram_chat_id` varchar(32) NOT NULL,
  `message_id`     bigint(20) DEFAULT NULL,
  `telegram_file_id` varchar(255) DEFAULT NULL,
  `file_size`      bigint(20) DEFAULT NULL,
  `status`         enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  `error`          text DEFAULT NULL,
  `created_at`     timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_content_episode` (`user_id`,`content_id`,`episode_id`),
  KEY `content_id` (`content_id`),
  KEY `episode_id` (`episode_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `cd_ibfk_1` FOREIGN KEY (`user_id`)    REFERENCES `users`    (`id`) ON DELETE CASCADE,
  CONSTRAINT `cd_ibfk_2` FOREIGN KEY (`content_id`) REFERENCES `content`  (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------------
-- Bot orqali yuborilgan fayllarni eslab qolish (Telegram'da mavjud bo'lishi
-- uchun file_id saqlanadi - keyin qayta yuklash kerak bo'lmaydi)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `telegram_file_cache` (
  `id`          int(11) NOT NULL AUTO_INCREMENT,
  `content_id`  int(11) NOT NULL,
  `episode_id`  int(11) NOT NULL DEFAULT 0,
  `file_id`     varchar(255) NOT NULL,
  `file_size`   bigint(20) DEFAULT NULL,
  `file_name`   varchar(255) DEFAULT NULL,
  `created_at`  timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_content_episode` (`content_id`,`episode_id`),
  CONSTRAINT `tfc_ibfk_1` FOREIGN KEY (`content_id`) REFERENCES `content` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
