-- ============================================================================
-- Telegram orqali BRAUZER login uchun tasdiqlash-tokenlar jadvali
--
-- Oqim: sayt token yaratadi -> foydalanuvchi t.me/bot?start=auth_TOKEN
--       bosadi -> bot chatni token'ga bog'laydi -> sayt polling orqali
--       tasdiqlashni ko'radi va sessiya ochadi.
-- ============================================================================
CREATE TABLE IF NOT EXISTS telegram_login_tokens (
    token VARCHAR(64) PRIMARY KEY,
    telegram_id VARCHAR(100) NULL,
    telegram_chat_id VARCHAR(100) NULL,
    first_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    username VARCHAR(100) NULL,
    photo_url VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    consumed TINYINT(1) DEFAULT 0,
    INDEX idx_expires (expires_at),
    INDEX idx_telegram_id (telegram_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;