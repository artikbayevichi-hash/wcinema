-- ============================================================================
--  W CINEMA - Reels: Telegram izohlari (forum topics)
-- ============================================================================
--  Ishga tushirish:  mysql -u root uzdub < migrate-reel-topics.sql
--  Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
--
--  G'oya: har bir reel uchun Telegram'dagi "W CINEMA CHATS" forum-guruhida
--  alohida MAVZU (topic) ochiladi. Izohlar o'sha mavzuda saqlanadi
--  (serverda kontent fayli saqlanmaydi). `tg_topic_id` - Telegram
--  qaytargan `message_thread_id`. U bo'lmasa izohlar mavzusi hali
--  ochilmagan (birinchi izohda avtomatik ochiladi).
-- ============================================================================

ALTER TABLE `reels`
    ADD COLUMN IF NOT EXISTS `tg_topic_id` BIGINT NULL DEFAULT NULL AFTER `channel_post`;

ALTER TABLE `reels`
    ADD INDEX IF NOT EXISTS `idx_reels_tg_topic` (`tg_topic_id`);
