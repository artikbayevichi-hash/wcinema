<?php
require_once 'config.php';
require_once 'includes/Database.php';
require_once 'includes/Auth.php';

$auth = new Auth();
$auth->logout();

// Chiqishdan keyin avtomatik kirish (splash) sahifasiga qaytamiz.
header('Location: 1stlogin.php');
exit;
