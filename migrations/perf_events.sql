-- ============================================================================
-- perf_events — video ochilish tezligini o'lchash jadvali
-- ----------------------------------------------------------------------------
-- Nima uchun kerak: "sekin" yoki "tez" degan gaplar sub'ektiv. Bu jadval
-- har bir video ochilishining HAQIQIY raqamlarini yig'adi:
--   ttfb_ms        - birinchi bayt kelgunga qadar (Telegram/R2 javobi)
--   first_frame_ms - sahifa ochilgandan birinchi kadr ko'ringuncha
--   canplay_ms     - pleer "o'ynashga tayyor" degan payt
-- Shu raqamlarsiz qaysi bosqichni tuzatish kerakligini BILIB BO'LMAYDI.
--
-- Yozuvlar faqat INSERT — o'qish `api/perf.php?stats=1` orqali.
-- 30 kundan eski yozuvlarni tozalash: api/perf.php ichidagi prune().
-- ============================================================================

CREATE TABLE IF NOT EXISTS perf_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    page VARCHAR(40) NOT NULL DEFAULT '',
    content_id INT NOT NULL DEFAULT 0,
    episode_id INT NOT NULL DEFAULT 0,
    doc_id BIGINT NOT NULL DEFAULT 0,
    net VARCHAR(16) NOT NULL DEFAULT '',
    save_data TINYINT(1) NOT NULL DEFAULT 0,
    ttfb_ms INT NOT NULL DEFAULT 0,
    first_frame_ms INT NOT NULL DEFAULT 0,
    canplay_ms INT NOT NULL DEFAULT 0,
    err VARCHAR(120) NOT NULL DEFAULT '',
    ua VARCHAR(160) NOT NULL DEFAULT '',
    INDEX idx_ts (ts),
    INDEX idx_content (content_id),
    INDEX idx_first_frame (first_frame_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
