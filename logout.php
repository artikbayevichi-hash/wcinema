<?php
require_once 'config.php';
require_once 'includes/Database.php';
require_once 'includes/Auth.php';

$auth = new Auth();
$auth->logout();

// Chiqishdan keyin avtomatik kirish sahifasiga qaytamiz (eski login.php emas).
header('Location: tg-login.php');
exit;
