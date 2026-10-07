-- ============================================================================
-- migrate-dm.sql - Shaxsiy (1:1) xabarlar (Direct Messages)
-- ============================================================================
-- Nima uchun kerak: ilgari shaxsiy chat butunlay Telegram DM (MTProto) orqali
-- ishlardi - ya'ni xabar faqat ikki tomon ham Telegram sessiyasiga ega bo'lsa
-- va Telegram bir-birini tanish imkonini bersa yetib borardi. Amalda ko'p
-- hollarda xabar QARSHI TOMONGA YETMASDI (MTProto access hash, maxfiylik,
// akkaunt cheklovlari).
//
-- Endi shaxsiy xabarlar SAYT serverida saqlanadi (dm_messages) va mijoz
-- `api/dm.php` orqali o'qiydi/yuboradi/poll qiladi. Shunda xabar HAR DOIM
-- qabul qiluvchiga yetib boradi (u saytga kirganda ko'radi).
--
-- 4 ta umumiy xona (Hammaga/Kino/Anime/Multfilm) avvalgidek Telegram
-- forum-mavzularida qoladi - ular baribir ishonchli ishlaydi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dm_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    body TEXT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'text',
    media_url VARCHAR(500) NULL,
    ref TEXT NULL,
    mime VARCHAR(80) NULL,
    duration INT NOT NULL DEFAULT 0,
    width INT NOT NULL DEFAULT 0,
    height INT NOT NULL DEFAULT 0,
    client_id VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL DEFAULT NULL,
    INDEX idx_dm_pair (sender_id, recipient_id, id),
    INDEX idx_dm_pair_rev (recipient_id, sender_id, id),
    INDEX idx_dm_inbox (recipient_id, read_at, id),
    UNIQUE KEY uniq_dm_client (sender_id, client_id),
    FOREIGN KEY (sender_id)    REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Yozmoqda..." holati (qisqa umrli; faqat shaxsiy chat uchun).
CREATE TABLE IF NOT EXISTS dm_typing (
    user_id INT NOT NULL,
    peer_id INT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, peer_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (peer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;