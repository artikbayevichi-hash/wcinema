-- W CINEMA — kontent v2 migratsiyasi (MariaDB / XAMPP uchun; MySQL 8 da "IF NOT EXISTS" ni olib tashlang)
-- Qo'shilmasa ham panel ishlaydi: yangi maydonlar faqat ustun mavjud bo'lsa saqlanadi.
ALTER TABLE content  ADD COLUMN IF NOT EXISTS original_title VARCHAR(255) NULL AFTER title;
ALTER TABLE content  ADD COLUMN IF NOT EXISTS genres         VARCHAR(500) NULL;
ALTER TABLE content  ADD COLUMN IF NOT EXISTS trailer_url    VARCHAR(500) NULL;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS subtitle_url   VARCHAR(500) NULL;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS audio_lang     VARCHAR(30)  NULL;
-- Tezlik uchun (ro'yxat filtrlari):
-- CREATE INDEX idx_content_status ON content (status, id);
-- CREATE INDEX idx_content_cat    ON content (category_id);
