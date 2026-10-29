<?php
// ============================================================================
// api/admin-settings.php - sayt sozlamalari (admin, JSON)
// ============================================================================
//   GET  -> { success, settings }
//   POST -> patch (site_name, notice, notice_link, banner_url, maintenance)
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/SiteSettings.php';
require_once __DIR__ . '/../includes/AdminLog.php';

requireAdmin();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    ok(['settings' => SiteSettings::all()]);
}

$patch = [];
foreach (['site_name', 'notice', 'notice_link', 'banner_url'] as $k) {
    if (isset($_POST[$k])) {
        $patch[$k] = (string) $_POST[$k];
    }
}
if (isset($_POST['maintenance'])) {
    $patch['maintenance'] = (int) $_POST['maintenance'];
}

$r = SiteSettings::set($patch);
if (empty($r['ok'])) {
    fail($r['error'] ?? 'Saqlanmadi', 400);
}
AdminLog::add('settings.save', $patch);
ok(['settings' => $r['settings'], 'message' => 'Sozlamalar saqlandi']);
