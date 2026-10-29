-- ============================================================================
-- migrate-admin-users.sql
-- Admin panel: ban / premium boshqaruvi uchun ustunlar
-- ============================================================================
-- `includes/AdminUsers.php` bu ustunlarni ish vaqtida ham qo'shadi
-- (SHOW COLUMNS bilan tekshirib) — qo'lda ishga tushirmasangiz ham bo'ladi.
-- ============================================================================

ALTER TABLE users
    ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN ban_reason VARCHAR(255) NULL,
    ADD COLUMN banned_at DATETIME NULL;

CREATE INDEX idx_users_banned ON users (is_banned);
CREATE INDEX idx_users_premium ON users (is_premium);
