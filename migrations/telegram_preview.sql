-- ============================================================================
-- migrations/telegram_preview.sql — kichik faststart PREVIEW ma'lumotlari
-- ----------------------------------------------------------------------------
-- Asosiy video (1 GB+) brauzer -> Telegram DC orqali oqadi, lekin birinchi
-- kadr uchun kutish uzoq bo'ladi. Bu jadval har bir film uchun OLDINDAN
-- tayyorlangan 2–5 MB lik qisqa (20 s) preview videoning Telegram
-- manzilini saqlaydi. Brauzer avval SHUNI o'ynatadi, keyin asl videoga
-- o'tadi. Video baytlari yana to'g'ridan-to'g'ri Telegram'dan keladi.
--
-- Eslatma: `telegram_meta` ga ustun qo'shilmadi — har bir (channel, post)
-- uchun faqat BITTA to'liq video bor, preview esa alohida Telegram posti.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `telegram_preview` (
    `channel`         VARCHAR(64)  NOT NULL COMMENT 'asl kanal (wcinemauz)',
    `post`            INT(11)      NOT NULL COMMENT 'asl post raqami',
    `preview_channel` VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'preview joylangan ommaviy kanal',
    `preview_post`    INT(11)      NOT NULL DEFAULT 0  COMMENT 'preview post raqami',
    `size`            INT(11)      NOT NULL DEFAULT 0,
    `mime`            VARCHAR(64)  NOT NULL DEFAULT 'video/mp4',
    `w`               INT(11)      NOT NULL DEFAULT 0,
    `h`               INT(11)      NOT NULL DEFAULT 0,
    `dur`             INT(11)      NOT NULL DEFAULT 0,
    -- INSTANT kadr: 1 s, 240p, ~100–200 KB. Sekin tarmoqda birinchi kadr
    -- 2 s ichida chiqishi uchun avval SHU o'ynatiladi, keyin 19 MB intro.
    -- Eski bazalarga TgPreview::ensure() tomonidan qo'shiladi;
    -- `telegram_meta` ga hech qanday ALTER qilinmaydi.
    `instant_channel`  VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'instant klip joylangan guruh',
    `instant_post`     INT(11)      NOT NULL DEFAULT 0  COMMENT 'instant klip post raqami',
    `instant_size`     INT(11)      NOT NULL DEFAULT 0,
    `instant_w`        INT(11)      NOT NULL DEFAULT 0,
    `instant_h`        INT(11)      NOT NULL DEFAULT 0,
    `instant_dur`      INT(11)      NOT NULL DEFAULT 0,
    `instant_fname`    VARCHAR(255) NOT NULL DEFAULT '',
    `instant_file_id`  VARCHAR(255) NOT NULL DEFAULT '',
    `instant_unique_id` VARCHAR(64) NOT NULL DEFAULT '',
    `status`          ENUM('ok','error','pending') NOT NULL DEFAULT 'pending',
    `error`           VARCHAR(500) NOT NULL DEFAULT '',
    `t`               INT(11)      NOT NULL DEFAULT 0,
    PRIMARY KEY (`channel`, `post`),
    KEY `idx_status_t` (`status`, `t`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Yangi video qo'shilganda bu yerga navbat yoziladi. Fon worker
-- (`php cli/tg-preview.php --queue`) vazifalarni ketma-ket bajaradi.
-- `bot_file_id`, `bot_file_unique_id`, `fname` ustunlari eski bazalarga
-- TgPreview::ensure() tomonidan avtomatik qo'shiladi (telegram_meta ga
-- hech qanday ALTER qilinmaydi).
CREATE TABLE IF NOT EXISTS `telegram_preview_queue` (
    `channel`    VARCHAR(64)  NOT NULL COMMENT 'asl kanal',
    `post`       INT(11)      NOT NULL COMMENT 'asl post raqami',
    `regen`      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = mavjud preview qayta yaratilsin',
    `attempts`   INT(11)      NOT NULL DEFAULT 0,
    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
    `created`    INT(11)      NOT NULL DEFAULT 0,
    `updated`    INT(11)      NOT NULL DEFAULT 0,
    PRIMARY KEY (`channel`, `post`),
    KEY `idx_pq_updated` (`updated`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
