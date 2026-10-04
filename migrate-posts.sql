-- ============================================================================
-- migrate-posts.sql — Instagram/YouTube/Telegram aralash platforma moduli
-- ---------------------------------------------------------------------------
-- 1) `reels` jadvaliga `format` va `aspect` maydonlari:
--      reel  — 9:16 vertikal (Instagram Reels / Telegram)
--      post  — rasm yoki galereya (carousel), 1:1
--      video — 16:9 YouTube uslubidagi uzun video
-- 2) `reel_media` — galereya (carousel) elementlari va rasm/video medialari
-- 3) `users.is_private` — hisob maxfiyligi (Private / Public)
-- 4) `user_blocks` — bloklangan foydalanuvchilar ro'yxati
-- 5) `notifications.type` ga `login` (kirish ogohlantirishi) qo'shiladi
--
-- Bajarish:  Get-Content -Raw migrate-posts.sql | mysql -u root uzdub
-- ============================================================================

-- --------------------------------------------------------------- 1) format
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reels' AND COLUMN_NAME = 'format'
);
SET @sql := IF(@has = 0,
  "ALTER TABLE `reels`
     ADD COLUMN `format` ENUM('reel','post','video') NOT NULL DEFAULT 'reel'
       COMMENT 'reel=9:16 vertikal, post=rasm/galereya, video=16:9 uzun video'
       AFTER `kind`,
     ADD COLUMN `aspect` ENUM('9:16','1:1','16:9') NOT NULL DEFAULT '9:16'
       COMMENT 'kontent nisbatlari'
       AFTER `format`",
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- `reels.poster` — brauzerda generatsiya qilingan kadr (URL yoki fayl yo'li)
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reels' AND COLUMN_NAME = 'thumb_source'
);
SET @sql := IF(@has = 0,
  "ALTER TABLE `reels` ADD COLUMN `thumb_source` VARCHAR(20) NOT NULL DEFAULT 'manual'
     COMMENT 'manual|client|auto' AFTER `poster`",
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Indeks: profil yorliqlari (Reels / Posts / Videos)
SET @has := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reels' AND INDEX_NAME = 'idx_reels_format'
);
SET @sql := IF(@has = 0,
  "CREATE INDEX `idx_reels_format` ON `reels` (`format`, `status`, `user_id`, `id`)",
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------------- 2) reel_media
-- Galereya (carousel) uchun bir nechta media, shuningdek rasm postlari uchun
-- asosiy media yoziladi. `reels.video_url` "asosiy" media sifatida qoladi —
-- eski kod (feed, player) o'zgarishsiz ishlaydi.
CREATE TABLE IF NOT EXISTS `reel_media` (
  `id`         INT(11)      NOT NULL AUTO_INCREMENT,
  `reel_id`    INT(11)      NOT NULL,
  `idx`        TINYINT(3)   NOT NULL DEFAULT 0        COMMENT 'galereya tartibi (0..n)',
  `kind`       ENUM('image','video') NOT NULL DEFAULT 'image',
  `video_type` ENUM('file','direct','hls','embed','telegram') NOT NULL DEFAULT 'file',
  `video_url`  VARCHAR(500) NOT NULL,
  `poster`     VARCHAR(500) DEFAULT NULL,
  `width`      SMALLINT(6)  NOT NULL DEFAULT 0,
  `height`     SMALLINT(6)  NOT NULL DEFAULT 0,
  `duration`   INT(11)      NOT NULL DEFAULT 0        COMMENT 'video/ovoz (soniya)',
  `views_count` INT(11)     NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_reel_idx` (`reel_id`, `idx`),
  KEY `idx_media_reel` (`reel_id`, `idx`),
  CONSTRAINT `fk_media_reel` FOREIGN KEY (`reel_id`)
      REFERENCES `reels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------- 3) users.is_private
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_private'
);
SET @sql := IF(@has = 0,
  "ALTER TABLE `users`
     ADD COLUMN `is_private` TINYINT(1) NOT NULL DEFAULT 0
       COMMENT '1 = faqat tasdiqlangan foydalanuvchilar profilni ko''radi'
       AFTER `is_registered`,
     ADD COLUMN `show_activity` TINYINT(1) NOT NULL DEFAULT 1
       COMMENT 'layk va izoh bildirishnomalarini korsatish' AFTER `is_private`",
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------------- 4) user_blocks
-- Bloklangan foydalanuvchi: profilni ko'ra olmaydi, xabar yubora olmaydi.
CREATE TABLE IF NOT EXISTS `user_blocks` (
  `id`         INT(11) NOT NULL AUTO_INCREMENT,
  `user_id`    INT(11) NOT NULL              COMMENT 'bloklagan foydalanuvchi',
  `blocked_id` INT(11) NOT NULL              COMMENT 'bloklangan foydalanuvchi',
  `reason`     VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_block` (`user_id`, `blocked_id`),
  KEY `idx_blocked` (`blocked_id`),
  CONSTRAINT `fk_block_user` FOREIGN KEY (`user_id`)
      REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_block_target` FOREIGN KEY (`blocked_id`)
      REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------- 5) bildirishnoma: kirish ogohlantirishi
-- `notifications.type` ENUM'siga `login` qo'shiladi (mavjud bo'lsa o'tkaziladi).
SET @cur := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'
);
SET @sql := IF(@cur IS NOT NULL AND @cur NOT LIKE '%login%',
  "ALTER TABLE `notifications`
     MODIFY COLUMN `type` ENUM('system','like','comment','reply','mention','follow','repost','status','video','login')
       NOT NULL DEFAULT 'system'",
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
