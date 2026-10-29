<?php
// ============================================================================
// api/site-config.php - ommaviy sayt sozlamalari (e'lon, texnik ish)
// ============================================================================
//   GET -> { success, site_name, notice, notice_link, banner_url, maintenance }
//
// Faqat KO'RSATISH uchun ma'lumot. Maxfiy narsa yo'q.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/SiteSettings.php';

$s = SiteSettings::all();

ok([
    'site_name'   => $s['site_name'] !== '' ? $s['site_name'] : SITE_NAME,
    'notice'      => (string) $s['notice'],
    'notice_link' => (string) $s['notice_link'],
    'banner_url'  => (string) $s['banner_url'],
    'maintenance' => (int) $s['maintenance'] === 1,
]);
