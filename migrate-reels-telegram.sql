-- ============================================================================
--  W CINEMA - Reels: Telegram kanal orqali yuklash
-- ============================================================================
--  Ishga tushirish:  mysql -u root uzdub < migrate-reels-telegram.sql
--  Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
--
--  Nima uchun: endi reels fayli serverga YOZILMAYDI. Foydalanuvchi videoni
--  botga yuboradi, bot uni REELS_CHANNEL kanaliga joylaydi, sayt esa faqat
--  kanal xabarini (t.me/... havolasini) saqlaydi va o'qiydi.
-- ============================================================================

-- 1) video_type ga 'telegram' qo'shamiz (kanal postidan o'qiladi)
ALTER TABLE `reels`
    MODIFY COLUMN `video_type`
        ENUM('file','direct','hls','embed','telegram') NOT NULL DEFAULT 'file';

-- 2) Kutilayotgan (hali botga yuborilmagan) reel uchun bir martalik token.
--    Foydalanuvchi botga start=reel_<token> bilan o'tadi; bot shu token
--    orqali qaysi reel ekanini topadi.
ALTER TABLE `reels`
    ADD COLUMN IF NOT EXISTS `ingest_token` VARCHAR(64) DEFAULT NULL AFTER `video_url`;

-- 3) Kanalga joylangan xabar raqami (t.me/<kanal>/<post> uchun).
ALTER TABLE `reels`
    ADD COLUMN IF NOT EXISTS `channel_post` INT(11) DEFAULT NULL AFTER `ingest_token`;

-- 4) Token bo'yicha tez qidiruv + takrorlanmaslik
ALTER TABLE `reels`
    ADD UNIQUE KEY IF NOT EXISTS `uniq_ingest_token` (`ingest_token`);
