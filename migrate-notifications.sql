-- ============================================================================
-- migrate-notifications.sql
-- ----------------------------------------------------------------------------
-- Instagram uslubidagi bildirishnomalar tizimi uchun `notifications`
-- jadvalini kengaytiradi.
--
-- Nima qo'shiladi:
--   * actor_id  - bildirishnomani keltirib chiqargan foydalanuvchi (kim like
--                 bosdi / izoh yozdi / follow qildi).
--   * reel_id   - bog'liq reel (agar mavjud bo'lsa).
--   * group_key - bir xil hodisalarni guruhlash kaliti. Masalan bitta reelga
--                 tushgan layklar "like:43" kaliti bilan birlashtiriladi va
--                 interfeysda "Ali va yana 3 kishi yoqtirdi" ko'rinishida
--                 chiqadi (Instagram kabi).
--   * read_at   - o'qilgan vaqt (is_read yonida aniqroq vaqt uchun).
--
-- `type` ENUM ham kengaytiriladi: reply, mention, repost, status.
--
-- Ishga tushirish:  mysql -u root uzdub < migrate-notifications.sql
-- Xavfsiz: bir necha marta ishga tushirish mumkin (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE `notifications`
    ADD COLUMN IF NOT EXISTS `actor_id`  INT(11)      NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS `reel_id`   INT(11)      NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS `group_key` VARCHAR(150) NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS `read_at`   DATETIME     NULL DEFAULT NULL;

-- `type` ni kengaytiramiz. Eski qiymatlar saqlanib qoladi.
ALTER TABLE `notifications`
    MODIFY COLUMN `type`
    ENUM('system','like','comment','reply','mention','follow','repost','status','video')
    NOT NULL;

-- Tez o'qish uchun qo'shma indeks: "foydalanuvchining o'qilmaganlari, eng
-- yangisi birinchi". Mavjud idx_user_id / idx_is_read o'rnini bosmaydi,
-- balki ularni bitta indeksda birlashtiradi.
CREATE INDEX IF NOT EXISTS `idx_ntf_user_read` ON `notifications` (`user_id`, `is_read`, `id`);
