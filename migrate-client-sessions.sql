-- ============================================================================
-- migrate-client-sessions.sql
-- Brauzer (MTProto) foydalanuvchisi uchun IMZOLANGAN sessiyalar.
-- ============================================================================
-- Nima uchun: sayt brauzerdagi GramJS orqali ishlaydi, serverda PHP sessiyasi
-- yo'q. Ilgari joriy foydalanuvchi `tg_me` JSON'i bilan aniqlanardi — bu
-- boshqa odam nomidan ish qilish imkonini berardi.
--
-- Endi token HttpOnly cookie'da, bazada esa faqat SHA-256 hash saqlanadi.
--
-- ESLATMA: bu jadval `includes/ClientSessions.php` tomonidan ham avtomatik
-- yaratiladi (CREATE TABLE IF NOT EXISTS) — qo'lda ishga tushirmasangiz ham
-- bo'ladi. Bu fayl hujjat/sxema uchun.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_sessions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    last_used_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    ip VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_client_token (token_hash),
    KEY idx_client_user (user_id),
    KEY idx_client_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
