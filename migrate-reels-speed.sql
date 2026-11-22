-- ============================================================================
--  W CINEMA - tezlik indekslari (reels + katalog)
--  Ishga tushirish:  mysql -u root uzdub < migrate-reels-speed.sql
--  Ko'p marta xavfsiz ishga tushadi. Video baytlariga tegmaydi.
-- ============================================================================

-- "top" oqimi: (views*10 + likes*3) ifodasini indekslab bo'lmaydi.
-- Generated column MySQL/MariaDB o'zi yangilaydi — qo'shimcha yozish kodi yo'q.
ALTER TABLE `reels`
  ADD COLUMN IF NOT EXISTS `hot_score` int(11)
      GENERATED ALWAYS AS (`views_count` * 10 + `likes_count` * 3) STORED;

-- new: status + id bo'yicha (eski idx_feed (status,kind,id) tartiblashga
-- yordam bermaydi, chunki kind filtrlanmaydi).
CREATE INDEX IF NOT EXISTS `idx_reels_new` ON `reels` (`status`, `id` DESC);

-- top: tayyor hot_score bo'yicha.
CREATE INDEX IF NOT EXISTS `idx_reels_hot` ON `reels` (`status`, `hot_score` DESC, `id` DESC);

-- Kino / anime / multfilm katalogi: status doim 'published', shuning uchun
-- status birinchi bo'lsa saralash ham, filtr ham indeksdan boradi.
CREATE INDEX IF NOT EXISTS `idx_content_pub_new` ON `content` (`status`, `created_at` DESC, `id` DESC);
CREATE INDEX IF NOT EXISTS `idx_content_pub_popular` ON `content` (`status`, `views` DESC, `created_at` DESC);
CREATE INDEX IF NOT EXISTS `idx_content_pub_rating` ON `content` (`status`, `rating` DESC, `views` DESC);
