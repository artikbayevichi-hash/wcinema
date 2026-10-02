-- ============================================================================
-- migrate-views.sql
-- ----------------------------------------------------------------------------
-- Unikal ko'rishlar (YouTube uslubi).
--
-- Muammo: `content.views` hozir har bir "play" da +1 bo'lardi. Bir odam
-- videoni 4 marta ochsa — 4 ko'rish bo'lib ko'rinardi. YouTube esa
-- "bir odam = bir ko'rish" deb hisoblaydi.
--
-- Yechim: `content_views` jadvali — har bir (content_id, viewer_key)
-- juftligi FAQAT BIR MARTA yoziladi. `viewer_key`:
--     u:<users.id>      — PHP hisobi (bot / Mini App login), agar bor bo'lsa
--     tg:<telegram_id>  — MTProto'dan olingan Telegram akkaunt id
--     anon:<uuid>       — anonim brauzer (localStorage)
--
-- `content.views` esa shu jadvaldagi COUNT(*) ga teng bo'ladi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_views (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_id INT NOT NULL,
    viewer_key VARCHAR(80) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_content_viewer (content_id, viewer_key),
    KEY idx_content (content_id),
    CONSTRAINT fk_cv_content FOREIGN KEY (content_id) REFERENCES content (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Yangi "unikal" sanoqni 0 dan boshlaymiz (foydalanuvchi shunday tanladi).
UPDATE content SET views = 0;
