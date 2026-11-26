<?php
// ============================================================================
// logout.php — chiqish (PHP sessiyasi + server cookie + brauzer kaliti)
// ============================================================================
// Uch qatlam tozalanadi, aks holda "chiqdim" bosilgandan keyin odam yana
// kirgan holda qoladi:
//   1) PHP sessiyasi (`$auth->logout()`);
//   2) server bergan imzolangan cookie (`wc_cs`) — LoginGate aynan shuni
//      tekshiradi, shuning uchun uni bekor qilish SHART;
//   3) brauzerdagi Telegram kaliti (localStorage `auth_key`) — buni faqat
//      JS o'chira oladi, shuning uchun kichik sahifa qaytaramiz.
// ============================================================================
require_once 'config.php';
require_once 'includes/Database.php';
require_once 'includes/Auth.php';
require_once 'includes/ClientSessions.php';

$auth = new Auth();
$auth->logout();
ClientSessions::revokeCurrent();
// 30 kunlik admin "qurilma" cookie'si ham bekor qilinishi shart — aks holda
// chiqishdan keyin Auth::isAdmin() yana admin huquqini qaytaradi.
$auth->adminCookieClear();

header('Cache-Control: no-store');
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="uz">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Chiqildi</title>
    <noscript><meta http-equiv="refresh" content="0;url=1stlogin.php"></noscript>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f0f;color:#ffffff;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif">
<div>Chiqildi. Kirish sahifasiga o‘tilmoqda…</div>
<script>
    (function () {
        var keys = [
            'wc_mtproto_auth_v1',  // Telegram auth_key (eng muhimi)
            'wc_tg_me_v1',         // profil keshi
            'wc_tg_photo_v1',      // avatar (data-URL)
            'wc_tg_dckey_v1',      // DC kalitlari
            'wc_tgweb_v1',
            'wc_tg_mode_v1',
            'wc_avatar_url_v1'     // eski avatar URL keshi
        ];
        try {
            for (var i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
        } catch (e) {}
        location.replace('1stlogin.php');
    })();
</script>
</body>
</html>
