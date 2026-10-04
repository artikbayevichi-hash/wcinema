-- ============================================================================
-- migrate-chat.sql - Chat tizimi (Instagram/Telegram uslubida)
-- ============================================================================
-- Xabarlar serverda SAQLANMAYDI:
--   * 4 ta umumiy chat (Hammaga / Kino / Anime / Multfilm) - Telegram
--     forum-guruhdagi MAVZULAR (topic) sifatida yashaydi.
--   * Shaxsiy chatlar - foydalanuvchilar o'rtasidagi Telegram DM (MTProto).
--
-- Baza faqat ikkita yengil jadvalni saqlaydi:
--   chat_rooms    - 4 umumiy xona va ularning Telegram topic id si
--   chat_contacts - kim qaysi odam bilan chat ochgan (ro'yxat tartibi uchun)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_key VARCHAR(40) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    tg_topic_id INT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO chat_rooms (room_key, title, sort_order) VALUES
    ('general',  'Hammaga',   1),
    ('kino',     'Kino',      2),
    ('anime',    'Anime',     3),
    ('multfilm', 'Multfilm',  4)
ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order);

CREATE TABLE IF NOT EXISTS chat_contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    peer_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_chat_owner_peer (owner_id, peer_id),
    INDEX idx_chat_owner (owner_id),
    INDEX idx_chat_peer (peer_id),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (peer_id)  REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
