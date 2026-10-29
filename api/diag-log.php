<?php
// ============================================================================
// api/diag-log.php — diag.php natijalarini saqlash (faqat localhost)
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
if (!preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/', $host)) {
    http_response_code(403);
    exit('Faqat localhost');
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '' || strlen($raw) > 65536) {
    http_response_code(400);
    exit;
}

$dir = dirname(__DIR__) . '/storage';
if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
}
@file_put_contents($dir . '/diag.jsonl', $raw . "\n", FILE_APPEND);

ok(['saved' => true]);
