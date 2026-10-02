-- ============================================================================
--  W CINEMA - Reels tizimi
--  Ishga tushirish:  mysql -u root uzdub < migrate-reels.sql
--  (migrate.sql dan keyin, xohalgancha ko'p marta xavfsiz - IF NOT EXISTS)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- reels - qisqa vertikal videolar
--
-- DIQQAT: sizning sxemangizdagi "movie_id" bu bazada "content_id" +
-- "episode_id" ga bo'lingan. Sababi: mazmurning ikki darajasi bor -
-- film (content) va uning qismlari (episodes). Virtual reel qaysi
-- qismdan olinganini aniq ko'rsatishi kerak, aks holda "1-qism" bilan
-- "2-qism" chalkashtiriladi.
--
-- "video_url" faqat 'upload' turi uchun to'ladi. 'clip' turida bo'sh
-- qoladi - manba asosiy kontentdan olinadi.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reels` (
    `id`               int(11)      NOT NULL AUTO_INCREMENT,
    `user_id`          int(11)      NOT NULL,
    `content_id`       int(11)      DEFAULT NULL,
    `episode_id`       int(11)      DEFAULT NULL,

    `kind`             enum('upload','clip') NOT NULL DEFAULT 'upload',
    `title`            varchar(200)  DEFAULT NULL,
    `description`      varchar(500)  DEFAULT NULL,

    `video_type`       enum('file','direct','hls','embed') NOT NULL DEFAULT 'file',
    `video_url`        varchar(500)  DEFAULT NULL,
    `poster`           varchar(500)  DEFAULT NULL,

    -- virtual reel (clip) uchun
    `start_time`       int(11)      NOT NULL DEFAULT 0,
    `end_time`         int(11)      NOT NULL DEFAULT 0,

    -- 0 = kutilmoqda, 1 = tasdiqlandi, 2 = rad etildi
    `status`           tinyint(1)   NOT NULL DEFAULT 0,
    `reject_reason`    varchar(255)  DEFAULT NULL,

    `views_count`      int(11)      NOT NULL DEFAULT 0,
    `likes_count`      int(11)      NOT NULL DEFAULT 0,
    `shares_count`     int(11)      NOT NULL DEFAULT 0,

    `created_at`       timestamp    NOT NULL DEFAULT current_timestamp(),
    `updated_at`       timestamp    NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),

    PRIMARY KEY (`id`),
    -- Oqim har doim "tasdiqlanganlar ichidan eng yangisi" bo'yicha o'qiladi.
    -- Bu indeks shu so'rov uchun kerak (sort + filtr).
    KEY `idx_feed`      (`status`, `kind`, `id`),
    KEY `idx_user`      (`user_id`, `status`),
    KEY `idx_content`   (`content_id`),
    KEY `idx_created`   (`created_at`),

    -- author o'z reelini o'chira olmasligi kerak (modifikatsiyadan keyin
    -- ham FK to'gri ishlasligi uchun bu qo'yilmaydi - onicha xato)
    CONSTRAINT `fk_reels_user`    FOREIGN KEY (`user_id`)    REFERENCES `users`    (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_reels_content` FOREIGN KEY (`content_id`) REFERENCES `content`  (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_reels_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- reel_likes - kim qaysi reelni yoqgan
--
-- Alohida jadval (likes kabi emas), chunki reel_like ham foydalanuvchining
-- O'Z reelini yoqishi mumkin - bu "Top Authors" reytingida kerak.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reel_likes` (
    `id`         int(11)    NOT NULL AUTO_INCREMENT,
    `reel_id`    int(11)    NOT NULL,
    `user_id`    int(11)    NOT NULL,
    `created_at` timestamp  NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    -- Bitta odam bitta reelni faqat BIR marta yoqa oladi. Shu kafolat
    -- double-count'ning oldini oladi va "toggle" mantiqini soddalashtiradi.
    UNIQUE KEY `uniq_reel_user` (`reel_id`, `user_id`),
    KEY `idx_user` (`user_id`),
    CONSTRAINT `fk_rl_reel` FOREIGN KEY (`reel_id`) REFERENCES `reels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_rl_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- reel_views - kim qaysi reelni ko'rgan
--
-- Nima uchun alohida jadval, oddiy int hisob emas:
--  1) "bir odam necha marta ko'rdi" ni aniqlash mumkin bo'ladi
--     (mashhur trendni sun'iy oshirmaslik uchun);
--  2) "Top Authors" reytingi haqiqiy ko'rishlar bo'yicha hisoblanadi.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reel_views` (
    `id`         int(11)    NOT NULL AUTO_INCREMENT,
    `reel_id`    int(11)    NOT NULL,
    `user_id`    int(11)    DEFAULT NULL,
    `created_at` timestamp  NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    KEY `idx_reel`      (`reel_id`),
    KEY `idx_reel_user` (`reel_id`, `user_id`),
    CONSTRAINT `fk_rv_reel` FOREIGN KEY (`reel_id`) REFERENCES `reels` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_rv_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- reel_settings - kim admin
--
-- DIQQAT: alohida "admins" jadvali yo'q. Shuning uchun adminlik
-- users.is_premium = 1 orqali belgilanadi (bu W CINEMA da ham premium
-- ma'no kasb etadi). Kelajakda alohida rol tizimi kerak bo'lsa, shu
-- jadval kengaytiriladi - endi hech narsa o'zgarMAYDI.
-- ---------------------------------------------------------------------------
