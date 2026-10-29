<?php
// ============================================================================
// api/admin-users.php - foydalanuvchilar (yangi admin panel uchun, JSON)
// ============================================================================
//   GET  ?q=&filter=all|premium|banned&page=1
//   POST action=premium|ban|unban
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/AdminUsers.php';
require_once __DIR__ . '/../includes/AdminLog.php';

requireAdmin();

$au = new AdminUsers();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $q      = (string) input('q', '', 120);
    $filter = (string) input('filter', 'all', 20);
    if (!in_array($filter, ['all', 'premium', 'banned'], true)) {
        $filter = 'all';
    }
    $page = max(1, inputInt('page', 1));

    $data = $au->listUsers($q, $filter, $page, 25);

    ok([
        'rows'    => array_map(function ($r) {
            return [
                'id'          => (int) $r['id'],
                'tg'          => (string) ($r['telegram_user_id'] ?? ''),
                'name'        => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')),
                'username'    => (string) ($r['username'] ?? ''),
                'avatar'      => (string) ($r['avatar'] ?? ''),
                'premium'     => (int) $r['is_premium'] === 1,
                'banned'      => (int) $r['is_banned'] === 1,
                'ban_reason'  => (string) ($r['ban_reason'] ?? ''),
                'created_at'  => (string) ($r['created_at'] ?? ''),
                'last_active' => (string) ($r['last_activity'] ?? ''),
            ];
        }, $data['rows']),
        'total'    => $data['total'],
        'pages'    => $data['pages'],
        'page'     => $data['page'],
        'summary'  => $au->summary(),
    ]);
}

$action = (string) input('action', '', 20);
$id     = inputInt('id', 0);
if ($id <= 0) {
    fail('id kerak', 400);
}
$u = $au->get($id);
if (!$u) {
    fail('Foydalanuvchi topilmadi', 404);
}

if ($action === 'premium') {
    $on = inputInt('on', 0) === 1;
    $au->setPremium($id, $on);
    AdminLog::add('user.premium', ['id' => $id, 'on' => $on]);
    ok(['premium' => $on]);
}

if ($action === 'ban') {
    $reason = (string) input('reason', '', 255);
    $au->setBanned($id, true, $reason);
    AdminLog::add('user.ban', ['id' => $id, 'reason' => $reason]);
    ok(['banned' => true]);
}

if ($action === 'unban') {
    $au->setBanned($id, false);
    AdminLog::add('user.unban', ['id' => $id]);
    ok(['banned' => false]);
}

fail('Noma\'lum amal', 400);
