-- ============================================================================
-- migrate-alerts-blocked.sql
-- ----------------------------------------------------------------------------
-- `users.is_bot_blocked` ustunini qo'shadi.
--
-- Nima uchun kerak:
--   includes/Alerts.php (isBlocked, ~236-qator) har bildirishnoma yuborishdan
--   oldin shu ustunni so'raydi:
--
--       SELECT is_bot_blocked FROM users WHERE id = ? LIMIT 1
--
--   Lekin ustun hech qaysi migration'da yaratilmagan edi. Natijada HAR bir
--   login va HAR bir reel follow da baza xatosi chiqardi:
--
--       Column not found: 1054 Unknown column 'is_bot_blocked'
--
--   push() bu xatoda false qaytaradi, ya'ni Telegram bildirishnomalari
--   foydalanuvchiga UMUMAN yetib bormasdi.
--
-- Hozircha ustunni hech qanday kod YOZMAYDI (bot.php da "foydalanuvchi botni
-- blokladi" holatini aniqlash yo'q). Shuning uchun standart qiymat 0 va
-- isBlocked() har doim false qaytaradi - bildirishnomalar yuboriladi. Keyin
-- bot.php ga bloklash aniqlash qo'shilsa, ustun tayyor turadi.
--
-- Ishga tushirish:  mysql -u root uzdub < migrate-alerts-blocked.sql
-- Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE `users`
    ADD COLUMN IF NOT EXISTS `is_bot_blocked` TINYINT(1) NOT NULL DEFAULT 0;
