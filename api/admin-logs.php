<?php
// ============================================================================
// api/admin-logs.php - admin amallari jurnali (JSON)
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/AdminLog.php';

requireAdmin();

$limit  = max(1, min(300, inputInt('limit', 100)));
$offset = max(0, inputInt('offset', 0));

ok([
    'rows'  => AdminLog::listAll($limit, $offset),
    'total' => AdminLog::count(),
]);
