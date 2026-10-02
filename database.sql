-- UZDUB Telegram Video Platform Database Schema
-- Kino/Anime/Multfilm katalogi uchun yangi sxema
-- MySQL Import uchun SQL fayl

-- Database yaratish
CREATE DATABASE IF NOT EXISTS uzdub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE uzdub;

-- ============================================================================
-- Kategoriyalar (Kino / Anime / Multfilm)
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(20),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kategoriyalarni yaratish
INSERT INTO categories (name, slug, description, icon, color, sort_order) VALUES
('Kino', 'kino', 'Badiiy filmlar', '🎬', '#FF6B6B', 1),
('Anime', 'anime', 'Yapon animatsiyalari', '🎌', '#4ECDC4', 2),
('Multfilm', 'multfilm', 'Animatsion filmlar', '🎨', '#FFE66D', 3),
('Serial', 'serial', 'Teleseriallar', '📺', '#95E1D3', 4),
('Dokumental', 'dokumental', 'Dokumental filmlar', '📹', '#F38181', 5)
ON DUPLICATE KEY UPDATE name=name;

-- ============================================================================
-- Janrlar
-- ============================================================================
CREATE TABLE IF NOT EXISTS genres (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Janrlarni yaratish
INSERT INTO genres (name, slug) VALUES
('Drama', 'drama'),
('Komediya', 'komediya'),
('Fantastika', 'fantastika'),
('Horror', 'horror'),
('Action', 'action'),
('Romantika', 'romantika'),
('Sarguzasht', 'sarguzasht'),
('Tarixiy', 'tarixiy'),
('Oilaviy', 'oilaviy'),
('Triller', 'triller'),
('Detektiv', 'detektiv'),
('Fantaziya', 'fantaziya'),
('Musiqiy', 'musiqiy'),
('Ilmiy', 'ilmiy'),
('Sport', 'sport')
ON DUPLICATE KEY UPDATE name=name;

-- ============================================================================
-- Kontent (Filmlar / Seriallar)
-- ============================================================================
CREATE TABLE IF NOT EXISTS content (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    description TEXT,
    poster VARCHAR(500),
    banner_url VARCHAR(500),
    release_year INT,
    rating DECIMAL(3,1) DEFAULT 0.0,
    views INT DEFAULT 0,
    duration INT,
    studio VARCHAR(255),
    director VARCHAR(255),
    actors TEXT,
    country VARCHAR(100),
    language VARCHAR(50),
    is_series TINYINT(1) DEFAULT 0,
    total_episodes INT DEFAULT 0,
    is_premium TINYINT(1) DEFAULT 0,
    status ENUM('draft', 'published', 'archived') DEFAULT 'published',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_category (category_id),
    INDEX idx_slug (slug),
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    INDEX idx_views (views),
    INDEX idx_rating (rating),
    FULLTEXT idx_search (title, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Episodlar (Serial qismlari)
-- ============================================================================
CREATE TABLE IF NOT EXISTS episodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_id INT NOT NULL,
    season INT DEFAULT 1,
    episode_number INT NOT NULL,
    title VARCHAR(255),
    description TEXT,
    thumbnail VARCHAR(500),
    video_type ENUM('direct', 'embed', 'file', 'hls', 'none') DEFAULT 'direct',
    video_url VARCHAR(1000),
    video_url_720p VARCHAR(1000),
    video_url_1080p VARCHAR(1000),
    duration INT,
    is_premium TINYINT(1) DEFAULT 0,
    views INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
    UNIQUE KEY unique_episode (content_id, season, episode_number),
    INDEX idx_content (content_id),
    INDEX idx_season (season),
    INDEX idx_episode (episode_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Kontent va janr o'rtasidagi bog'lanish
-- ============================================================================
CREATE TABLE IF NOT EXISTS content_genres (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content_id INT NOT NULL,
    genre_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE,
    UNIQUE KEY unique_content_genre (content_id, genre_id),
    INDEX idx_content (content_id),
    INDEX idx_genre (genre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Foydalanuvchilar
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    telegram_user_id VARCHAR(100) UNIQUE,
    telegram_chat_id VARCHAR(100),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    username VARCHAR(100) UNIQUE,
    avatar VARCHAR(500),
    bio TEXT,
    is_premium TINYINT(1) DEFAULT 0,
    last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_telegram_user_id (telegram_user_id),
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- User Sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(45),
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    INDEX idx_last_activity (last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Like
-- ============================================================================
CREATE TABLE IF NOT EXISTS likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    content_id INT NOT NULL,
    type ENUM('like', 'dislike') DEFAULT 'like',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
    UNIQUE KEY unique_like (user_id, content_id),
    INDEX idx_content (content_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Watchlist (Saqlanganlar)
-- ============================================================================
CREATE TABLE IF NOT EXISTS watchlist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    content_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
    UNIQUE KEY unique_watchlist (user_id, content_id),
    INDEX idx_user_id (user_id),
    INDEX idx_content (content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Watch Progress (Ko'rish progressi)
-- ============================================================================
CREATE TABLE IF NOT EXISTS watch_progress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    content_id INT NOT NULL,
    episode_id INT NOT NULL,
    position_seconds INT DEFAULT 0,
    duration_seconds INT DEFAULT 0,
    is_completed TINYINT(1) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
    UNIQUE KEY unique_progress (user_id, content_id, episode_id),
    INDEX idx_user_id (user_id),
    INDEX idx_content (content_id),
    INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Watch History (Ko'rish tarixi)
-- ============================================================================
CREATE TABLE IF NOT EXISTS watch_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    content_id INT NOT NULL,
    episode_id INT NOT NULL,
    watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    progress_seconds INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
    UNIQUE KEY unique_history (user_id, content_id, episode_id),
    INDEX idx_user_id (user_id),
    INDEX idx_watched_at (watched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('system', 'like', 'comment', 'follow', 'video') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    target_url VARCHAR(500),
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Demo ma'lumotlar
-- ============================================================================
-- Demo kontent
INSERT INTO content (user_id, category_id, title, slug, description, poster, release_year, rating, views, is_series, total_episodes, status) VALUES
(1, 1, 'Sinov filmi 1', 'sinov-film-1', 'Bu sinov filmi', 'https://via.placeholder.com/300x450/FF6B6B/ffffff?text=Film+1', 2024, 7.5, 100, 0, 0, 'published'),
(1, 2, 'Sinov anime 1', 'sinov-anime-1', 'Bu sinov anime', 'https://via.placeholder.com/300x450/4ECDC4/ffffff?text=Anime+1', 2024, 8.0, 150, 1, 12, 'published'),
(1, 3, 'Sinov multfilm 1', 'sinov-multfilm-1', 'Bu sinov multfilm', 'https://via.placeholder.com/300x450/FFE66D/333333?text=Multfilm+1', 2024, 7.0, 80, 0, 0, 'published')
ON DUPLICATE KEY UPDATE title=title;

-- Episodlar (anime uchun)
INSERT INTO episodes (content_id, season, episode_number, title, video_type, video_url, duration, views) VALUES
(2, 1, 1, '1-qism', 'embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 1440, 50),
(2, 1, 2, '2-qism', 'embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 1440, 45),
(2, 1, 3, '3-qism', 'embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 1440, 40)
ON DUPLICATE KEY UPDATE title=title;

-- Kontent va janr bog'lanishlari
INSERT INTO content_genres (content_id, genre_id) VALUES
(1, 1), (1, 10),
(2, 2), (2, 12),
(3, 2), (3, 8)
ON DUPLICATE KEY UPDATE content_id=content_id;
