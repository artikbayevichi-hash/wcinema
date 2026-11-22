<?php
// ============================================================================
// admin-feedback.php — admin tomonidan "Taklif / shikoyat" xabarlarini o'qish
// ============================================================================
// GET  ?action=list[&status=open|answered|closed|all&q=&limit=&offset=]
// GET  ?action=counts
// POST action=reply&id=N&reply=...   -> javob yozish + bildirishnoma
// POST action=close&id=N            -> yopish
// POST action=delete&id=N           -> o'chirish
//
// Faqat admin: requireAdmin() eng oldinda (barcha yo'llar uchun).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/AdminLog.php';

requireAdmin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = input('action', 'list', 20);

if ($method === 'GET') {
    if ($action === 'counts') {
        $rows = $db->fetchAll(
            'SELECT status, COUNT(*) AS n FROM user_feedback GROUP BY status'
        );
        $counts = ['all' => 0, 'open' => 0, 'answered' => 0, 'closed' => 0];
        foreach ($rows as $r) {
            $counts['all'] += (int) $r['n'];
            if (isset($counts[$r['status']])) {
                $counts[$r['status']] = (int) $r['n'];
            }
        }
        ok(['counts' => $counts]);
    }

    $status = input('status', 'all', 20);
    if (!in_array($status, ['open', 'answered', 'closed'], true)) {
        $status = 'all';
    }
    $q      = input('q', '', 120);
    $limit  = min(100, max(1, inputInt('limit', 30)));
    $offset = max(0, inputInt('offset', 0));

    $where  = [];
    $params = [];
    if ($status !== 'all') {
        $where[]  = 'f.status = ?';
        $params[] = $status;
    }
    if ($q !== '') {
        $where[]  = '(f.message LIKE ? OR u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)';
        $like     = '%' . $q . '%';
        $params[] = $like;
        $params[] = $like;
        $params[] = $like;
        $params[] = $like;
    }
    $sqlWhere = $where ? (' WHERE ' . implode(' AND ', $where)) : '';

    $totalRow = $db->fetchOne(
        'SELECT COUNT(*) AS n FROM user_feedback f
          LEFT JOIN users u ON u.id = f.user_id' . $sqlWhere,
        $params
    );
    $rows = $db->fetchAll(
        'SELECT f.id, f.user_id, f.type, f.message, f.status, f.admin_reply,
                f.replied_at, f.read_at, f.created_at,
                u.first_name, u.last_name, u.username, u.telegram_user_id
           FROM user_feedback f
           LEFT JOIN users u ON u.id = f.user_id' . $sqlWhere . '
          ORDER BY (f.status = \'open\') DESC, f.id DESC
          LIMIT ' . $limit . ' OFFSET ' . $offset,
        $params
    );

    ok([
        'items' => $rows,
        'total' => (int) ($totalRow['n'] ?? 0),
        'limit' => $limit,
        'offset' => $offset,
    ]);
}

if ($method !== 'POST') {
    fail('POST so‘raladi', 405);
}

$id = inputInt('id', 0);
if ($id <= 0) {
    fail('Xabar topilmadi', 404);
}
$row = $db->fetchOne('SELECT * FROM user_feedback WHERE id = ?', [$id]);
if (!$row) {
    fail('Xabar topilmadi', 404);
}

if ($action === 'reply') {
    $reply = input('reply', '', 1000);
    $len = function_exists('mb_strlen') ? mb_strlen($reply) : strlen($reply);
    if ($len < 2) {
        fail('Javob matni juda qisqa');
    }
    $adminId = clientUserId();
    $db->query(
        "UPDATE user_feedback
            SET admin_reply = ?, status = 'answered', replied_at = NOW(),
                replied_by = ?, read_at = NULL
          WHERE id = ?",
        [$reply, $adminId > 0 ? $adminId : null, $id]
    );

    // Foydalanuvchiga bildirishnoma: qo'ng'iroqcha 30 s ichida yoki sahifa
    // ochilganda yangilanadi (notifications.js count poll).
    $ntf = new Notifications($db);
    $preview = function_exists('mb_substr') ? mb_substr($reply, 0, 300) : substr($reply, 0, 300);
    $ntf->add((int) $row['user_id'], 'reply', [
        'title'   => 'Murojaatingizga javob keldi',
        'message' => $preview,
        'url'     => SITE_URL . '/feedback.php',
        'actor_id' => ($adminId > 0 && $adminId !== (int) $row['user_id']) ? $adminId : 0,
    ]);

    AdminLog::add('feedback.reply', ['id' => $id, 'user_id' => (int) $row['user_id']]);
    ok(['success' => true, 'status' => 'answered']);
}

if ($action === 'close') {
    $db->query("UPDATE user_feedback SET status = 'closed' WHERE id = ?", [$id]);
    AdminLog::add('feedback.close', ['id' => $id]);
    ok(['success' => true, 'status' => 'closed']);
}

if ($action === 'delete') {
    $db->query('DELETE FROM user_feedback WHERE id = ?', [$id]);
    AdminLog::add('feedback.delete', ['id' => $id]);
    ok(['success' => true]);
}

fail('Noma’lum amal');
