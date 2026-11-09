<?php
// Legacy URL compatibility: kontent boshqaruvi yangi admin SPA modulida ishlaydi.
require_once __DIR__ . '/includes/bootstrap.php';

$base = rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\');
$next = ($base === '.' ? '' : $base) . '/admin-panel.php#/content';
if (!$auth->isAdmin()) {
    header('Location: ' . (($base === '.' ? '' : $base) . '/admin-login.php?next=' . rawurlencode($next)));
    exit;
}

header('Location: ' . $next, true, 302);
exit;
