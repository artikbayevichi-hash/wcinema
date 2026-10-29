<?php
$body = file_get_contents('php://input');
$entry = date('c') . " | " . $body . "\n";
file_put_contents(__DIR__ . '/../errlog.txt', $entry, FILE_APPEND | LOCK_EX);
http_response_code(204);
