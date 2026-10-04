<?php
// ============================================================================
// api/settings.php — Foydalanuvchi sozlamalari (Account Privacy + Profile Edit)
// ---------------------------------------------------------------------------
//   GET    action=get              → o'z sozlamalari + profil ma'lumotlari
//   GET    action=blocks           → bloklangan foydalanuvchilar ro'yxati
//   POST   action=save             → { is_private, show_activity, ... }
//   POST   action=profile          → { first_name, last_name, username, bio, avatar }
//   POST   action=block            → { user_id }  (toggle)
//   POST   action=unblock          → { user_id }
//
// Xavfsizlik: joriy foydalanuvchi `reelUserId()` orqali aniqlanadi (PHP
// sessiyasi yoki brauzerdagi `tg_me`). Blok va tahrirlash faqat o'z
// hisobi uchun — boshqa foydalanuvchining ma'lumotiga tegilmaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$settings = new Settings();
$blocks   = new Blocks();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = input('action', 'get', 30);

/** Joriy foydalanuvchi ID'sini oladi (yo'q bo'lsa — 401 bilan chiqadi). */
function settings_uid()
{
    $uid = reelUserId();
    if ($uid <= 0) fail('Avval tizimga kiring', 401);
    return $uid;
}

// ------------------------------------------------------------- javob yordamchisi
function settings_profile(array $me)
{
    return [
        'id'         => (int) $me['id'],
        'first_name' => (string) ($me['first_name'] ?? ''),
        'last_name'  => (string) ($me['last_name'] ?? ''),
        'username'   => (string) ($me['username'] ?? ''),
        'avatar'     => (string) ($me['avatar'] ?? ''),
        'bio'        => (string) ($me['bio'] ?? ''),
        'full_name'  => trim(($me['first_name'] ?? '') . ' ' . ($me['last_name'] ?? '')),
    ];
}

function settings_flags(array $me)
{
    return [
        'is_private'    => (int) ($me['is_private'] ?? 0) === 1,
        'show_activity' => (int) ($me['show_activity'] ?? 1) === 1,
    ];
}

// ------------------------------------------------------------ GET: o'z sozlamalari
if ($method === 'GET' && $action === 'get') {
    $uid = settings_uid();
    $me = $settings->get($uid);
    if (!$me) fail('Topilmadi', 404);
    $rows = $blocks->listBlocked($uid);
    ok([
        'settings' => settings_flags($me),
        'profile'  => settings_profile($me),
        'blocked'  => count($rows),
    ]);
}

// ----------------------------------------------------------- GET: blok ro'yxati
if ($method === 'GET' && $action === 'blocks') {
    $uid = settings_uid();
    $out = [];
    foreach ($blocks->listBlocked($uid) as $r) {
        $out[] = [
            'id'         => (int) $r['id'],
            'first_name' => (string) ($r['first_name'] ?? ''),
            'last_name'  => (string) ($r['last_name'] ?? ''),
            'username'   => (string) ($r['username'] ?? ''),
            'avatar'     => (string) ($r['avatar'] ?? ''),
            'full_name'  => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')),
            'mutual'     => (int) ($r['mutual'] ?? 0) === 1,
            'blocked_at' => (string) ($r['blocked_at'] ?? ''),
        ];
    }
    ok(['blocks' => $out]);
}

// ------------------------------------------------- GET: bloklash uchun qidiruv
// Profil sahifasidan "Bloklash" bosilganda foydalanuvchi shu yerga yozadi.
if ($method === 'GET' && $action === 'search') {
    $uid = settings_uid();
    $q   = trim((string) input('q', '', 60));
    if ($q === '') {
        ok(['results' => []]);
    }
    $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
    $rows = Database::getInstance()->fetchAll(
        "SELECT id, first_name, last_name, username, avatar
           FROM users
          WHERE id <> ?
            AND (first_name LIKE ? OR last_name LIKE ? OR username LIKE ?
                 OR CONCAT(first_name, ' ', last_name) LIKE ?)
          ORDER BY
            (username = ?) DESC,
            (first_name = ?) DESC,
            id DESC
          LIMIT 12",
        [$uid, $like, $like, $like, $like, $q, $q]
    );
    $hidden = array_keys($blocks->listBlocked($uid));
    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'id'         => (int) $r['id'],
            'full_name'  => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: 'Foydalanuvchi',
            'username'   => (string) ($r['username'] ?? ''),
            'avatar'     => (string) ($r['avatar'] ?? ''),
            'blocked'    => in_array((int) $r['id'], $hidden, true),
        ];
    }
    ok(['results' => $out]);
}

// ------------------------------------------------------------------ POST amallar
if ($method !== 'POST') fail('POST kerak', 405);
$uid = settings_uid();

if ($action === 'save') {
    $r = $settings->update($uid, [
        'is_private'    => input('is_private', ''),
        'show_activity' => input('show_activity', ''),
    ]);
    if (!$r['ok']) fail($r['error'], 400);
    $now = $settings->get($uid);
    ok(['changed' => $r['changed'], 'settings' => settings_flags($now)]);
}

if ($action === 'profile') {
    // Faqat yuborilgan maydonlar yoziladi — bo'sh maydon (masalan avatar)
    // avvalgisini o'chirmasligi kerak.
    $f = [];
    foreach (['first_name', 'last_name', 'username', 'bio', 'avatar', 'remove_avatar'] as $k) {
        if (isset($_POST[$k])) $f[$k] = input($k, '', 600);
    }
    if (!$f) fail('Hech narsa yuborilmadi', 400);
    $r = $settings->updateProfile($uid, $f);
    if (!$r['ok']) fail($r['error'], 400);
    $now = $settings->get($uid);
    ok(['changed' => $r['changed'], 'profile' => settings_profile($now)]);
}

if ($action === 'block') {
    $target = inputInt('user_id');
    if ($target <= 0) fail('user_id kerak', 400);
    if ($target === $uid) fail('O‘zingizni bloklash mumkin emas', 400);
    $r = $blocks->toggle($uid, $target, input('reason', '', 250) ?: null);
    ok(['blocked' => $r['blocked'], 'user_id' => $target]);
}

if ($action === 'unblock') {
    $target = inputInt('user_id');
    if ($target <= 0) fail('user_id kerak', 400);
    $blocks->unblock($uid, $target);
    ok(['blocked' => false, 'user_id' => $target]);
}

fail('Noma’lum amal', 400);
