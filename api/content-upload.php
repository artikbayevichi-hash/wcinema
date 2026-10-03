<?php
// ============================================================================
// api/content-upload.php - O'CHIRILGAN (serverga fayl yuklanmaydi)
// ============================================================================
// Ilgari admin panel poster rasm yoki video faylni serverga yuklardi.
// Endi hech qanday fayl qabul qilinmaydi: poster Telegram havolasidan
// avtomatik olinadi (api/content-admin.php), video esa t.me URL orqali
// beriladi.
//
// 410 (Gone): eski skript qolib qolsa ham diskka fayl yozilmaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

requireAdmin();

fail('Fayl yuklash o‘chirilgan. Poster uchun Telegram havolasini kiriting.', 410);
