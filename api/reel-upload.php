<?php
// ============================================================================
// api/reel-upload.php - O'CHIRILGAN (serverga fayl yuklanmaydi)
// ============================================================================
// Ilgari foydalanuvchi MP4 faylni serverga yuklardi. Endi barcha reelslar
// Telegram kanalga tushadi (api/reel-intent.php -> bot -> REELS_CHANNEL).
//
// Bu endpoint atayin 410 (Gone) qaytaradi: eski sahifa yoki skript qolib
// qolsa ham serverga hech qanday video fayl YOZILMAYDI.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

fail('Fayl yuklash o‘chirilgan. Reels endi Telegram kanali orqali joylanadi.', 410);
