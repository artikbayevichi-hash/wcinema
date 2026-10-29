<?php
// ============================================================================
// admin-users.php - Foydalanuvchilar boshqaruvi (faqat admin)
// ============================================================================
//   • qidiruv (ism, username, telegram id, user_id, email) + filtr
//   • premium berish / olish
//   • ban / unban (sabab bilan)
//   • sahifalash
//
// Barcha o'zgarishlar POST + redirect (PRG) — sahifa yangilanganda takror
// bajarilmaydi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/AdminUsers.php';

if (!$auth->isAdmin()) {
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin-users.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}

$users = new AdminUsers();
$base  = rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\');
$msg   = (string) ($_GET['msg'] ?? '');
$err   = (string) ($_GET['err'] ?? '');

// ------------------------------------------------------------------ amallar
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = (string) ($_POST['action'] ?? '');
    $id     = (int) ($_POST['id'] ?? 0);
    $back   = (string) ($_POST['back'] ?? ($base . '/admin-users.php'));

    // Faqat shu sahifaga qaytish (ochiq yo'naltirishni oldini olamiz).
    if ($back === '' || $back[0] !== '/' || strpos($back, '//') === 0) {
        $back = $base . '/admin-users.php';
    }

    $done = '';
    if ($action === 'premium' && $id > 0) {
        $on = (string) ($_POST['on'] ?? '1') === '1';
        if ($users->setPremium($id, $on)) {
            $done = $on ? 'premium_on' : 'premium_off';
        }
    } elseif ($action === 'ban' && $id > 0) {
        $reason = (string) ($_POST['reason'] ?? '');
        if ($users->setBanned($id, true, $reason)) {
            $done = 'banned';
        }
    } elseif ($action === 'unban' && $id > 0) {
        if ($users->setBanned($id, false)) {
            $done = 'unbanned';
        }
    }

    $sep = (strpos($back, '?') === false) ? '?' : '&';
    header('Location: ' . $back . ($done !== '' ? $sep . 'msg=' . $done : $sep . 'err=1'));
    exit;
}

// ------------------------------------------------------------------ ro'yxat
$q      = trim((string) ($_GET['q'] ?? ''));
$filter = (string) ($_GET['filter'] ?? 'all');
if (!in_array($filter, ['all', 'premium', 'banned'], true)) {
    $filter = 'all';
}
$page = max(1, (int) ($_GET['page'] ?? 1));

$data  = $users->listUsers($q, $filter, $page, 25);
$sum   = $users->summary();

$qs = function ($over = []) use ($q, $filter, $page) {
    $p = array_merge(['q' => $q, 'filter' => $filter, 'page' => $page], $over);
    $p = array_filter($p, function ($v) { return $v !== '' && $v !== null; });
    return '?' . http_build_query($p);
};

$messages = [
    'premium_on'  => ['ok',  'Premium yoqildi ✅'],
    'premium_off' => ['ok',  'Premium o‘chirildi'],
    'banned'      => ['ok',  'Foydalanuvchi ban qilindi 🚫'],
    'unbanned'    => ['ok',  'Ban olib tashlandi ✅'],
];
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Foydalanuvchilar — Admin</title>
    <link rel="stylesheet" href="assets/css/admin.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/admin.css') ?: 1; ?>">
</head>
<body>
<div class="wrap">

    <div class="top">
        <img src="assets/img/logo.png" alt="">
        <div>
            <h1>Foydalanuvchilar</h1>
            <div class="sub"><?php echo number_format($sum['total'], 0, '.', ' '); ?> ta ro‘yxatdan o‘tgan</div>
        </div>
        <div class="sp"></div>
        <a class="btn ghost" href="admin.php">← Panel</a>
        <a class="btn ghost" href="admin.php?logout=1">Chiqish</a>
    </div>

    <?php if ($msg !== '' && isset($messages[$msg])): ?>
        <div class="flash <?php echo $messages[$msg][0]; ?>"><?php echo htmlspecialchars($messages[$msg][1]); ?></div>
    <?php elseif ($err !== ''): ?>
        <div class="flash err">Amal bajarilmadi. Qayta urinib ko‘ring.</div>
    <?php endif; ?>

    <div class="grid">
        <div class="stat"><b><?php echo number_format($sum['total'], 0, '.', ' '); ?></b><span>Jami</span></div>
        <div class="stat"><b><?php echo number_format($sum['premium'], 0, '.', ' '); ?></b><span>Premium</span></div>
        <div class="stat<?php echo $sum['banned'] ? ' warn' : ''; ?>"><b><?php echo (int) $sum['banned']; ?></b><span>Ban</span></div>
        <div class="stat"><b><?php echo (int) $sum['today']; ?></b><span>Bugun qo‘shildi</span></div>
        <div class="stat"><b><?php echo (int) $sum['active24']; ?></b><span>24 soatda aktiv</span></div>
    </div>

    <form class="toolbar" method="GET" action="admin-users.php">
        <input type="search" name="q" value="<?php echo htmlspecialchars($q); ?>"
               placeholder="Ism, @username, Telegram ID yoki email…">
        <input type="hidden" name="filter" value="<?php echo htmlspecialchars($filter); ?>">
        <button class="btn" type="submit">Qidirish</button>
        <?php if ($q !== ''): ?><a class="btn ghost" href="admin-users.php?filter=<?php echo urlencode($filter); ?>">Tozalash</a><?php endif; ?>
    </form>

    <div class="tabs" style="margin-bottom:14px">
        <a class="<?php echo $filter === 'all' ? 'on' : ''; ?>" href="<?php echo htmlspecialchars($qs(['filter' => 'all', 'page' => 1])); ?>">Hammasi</a>
        <a class="<?php echo $filter === 'premium' ? 'on' : ''; ?>" href="<?php echo htmlspecialchars($qs(['filter' => 'premium', 'page' => 1])); ?>">Premium</a>
        <a class="<?php echo $filter === 'banned' ? 'on' : ''; ?>" href="<?php echo htmlspecialchars($qs(['filter' => 'banned', 'page' => 1])); ?>">Ban qilinganlar</a>
    </div>

    <?php if (!$data['rows']): ?>
        <div class="panel muted">Hech narsa topilmadi.</div>
    <?php else: ?>
    <div style="overflow-x:auto">
    <table class="tbl">
        <thead>
            <tr>
                <th>ID</th>
                <th>Foydalanuvchi</th>
                <th>Telegram</th>
                <th>Holat</th>
                <th>Ro‘yxatdan</th>
                <th>Oxirgi faollik</th>
                <th>Amallar</th>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($data['rows'] as $r): ?>
            <tr>
                <td class="muted">#<?php echo (int) $r['id']; ?></td>
                <td>
                    <div class="u">
                        <?php if (!empty($r['avatar'])): ?>
                            <img class="av" src="<?php echo htmlspecialchars((string) $r['avatar']); ?>" alt="" loading="lazy">
                        <?php else: ?>
                            <span class="av" style="display:inline-block"></span>
                        <?php endif; ?>
                        <div>
                            <div class="nm"><?php
                                echo htmlspecialchars(trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: 'Foydalanuvchi');
                            ?></div>
                            <div class="un"><?php echo $r['username'] ? '@' . htmlspecialchars((string) $r['username']) : '&nbsp;'; ?></div>
                        </div>
                    </div>
                </td>
                <td class="muted"><?php echo htmlspecialchars((string) ($r['telegram_user_id'] ?? '—')); ?></td>
                <td>
                    <?php if ((int) $r['is_premium'] === 1): ?><span class="badge prem">PREMIUM</span><?php endif; ?>
                    <?php if ((int) $r['is_banned'] === 1): ?><span class="badge ban" title="<?php echo htmlspecialchars((string) ($r['ban_reason'] ?? '')); ?>">BAN</span><?php endif; ?>
                    <?php if ((int) $r['is_premium'] !== 1 && (int) $r['is_banned'] !== 1): ?><span class="badge ok">oddiy</span><?php endif; ?>
                </td>
                <td class="muted"><?php echo $r['created_at'] ? htmlspecialchars(substr((string) $r['created_at'], 0, 10)) : '—'; ?></td>
                <td class="muted"><?php echo $r['last_activity'] ? htmlspecialchars(substr((string) $r['last_activity'], 0, 16)) : '—'; ?></td>
                <td class="actions">
                    <form method="POST" action="admin-users.php" style="display:inline"
                          onsubmit="return confirm('Premium holatini o‘zgartirasizmi?')">
                        <input type="hidden" name="action" value="premium">
                        <input type="hidden" name="id" value="<?php echo (int) $r['id']; ?>">
                        <input type="hidden" name="on" value="<?php echo (int) $r['is_premium'] === 1 ? '0' : '1'; ?>">
                        <input type="hidden" name="back" value="<?php echo htmlspecialchars($_SERVER['REQUEST_URI'] ?? ''); ?>">
                        <button class="btn sm <?php echo (int) $r['is_premium'] === 1 ? 'ghost' : 'ok'; ?>" type="submit">
                            <?php echo (int) $r['is_premium'] === 1 ? 'Premiumni olish' : 'Premium berish'; ?>
                        </button>
                    </form>

                    <?php if ((int) $r['is_banned'] === 1): ?>
                        <form method="POST" action="admin-users.php" style="display:inline"
                              onsubmit="return confirm('Banni olib tashlaysizmi?')">
                            <input type="hidden" name="action" value="unban">
                            <input type="hidden" name="id" value="<?php echo (int) $r['id']; ?>">
                            <input type="hidden" name="back" value="<?php echo htmlspecialchars($_SERVER['REQUEST_URI'] ?? ''); ?>">
                            <button class="btn sm ok" type="submit">Unban</button>
                        </form>
                    <?php else: ?>
                        <form method="POST" action="admin-users.php" style="display:inline"
                              onsubmit="var r=prompt('Ban sababi (ixtiyoriy):',''); if(r===null) return false; this.reason.value=r; return true;">
                            <input type="hidden" name="action" value="ban">
                            <input type="hidden" name="id" value="<?php echo (int) $r['id']; ?>">
                            <input type="hidden" name="reason" value="">
                            <input type="hidden" name="back" value="<?php echo htmlspecialchars($_SERVER['REQUEST_URI'] ?? ''); ?>">
                            <button class="btn sm bad" type="submit">Ban</button>
                        </form>
                    <?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    </div>

    <?php if ($data['pages'] > 1): ?>
        <div class="toolbar" style="margin-top:16px;justify-content:center">
            <?php if ($data['page'] > 1): ?>
                <a class="btn ghost sm" href="<?php echo htmlspecialchars($qs(['page' => $data['page'] - 1])); ?>">← Oldingi</a>
            <?php endif; ?>
            <span class="muted"><?php echo (int) $data['page']; ?> / <?php echo (int) $data['pages']; ?></span>
            <?php if ($data['page'] < $data['pages']): ?>
                <a class="btn ghost sm" href="<?php echo htmlspecialchars($qs(['page' => $data['page'] + 1])); ?>">Keyingi →</a>
            <?php endif; ?>
        </div>
    <?php endif; ?>
    <?php endif; ?>

    <div class="note">
        Ban qilingan foydalanuvchi: saytga kira olmaydi, layk/DM/yuklash ishlamaydi
        (sessiyalari darhol bekor qilinadi). Premium esa faqat belgi — kontent
        cheklovlari `is_premium` ga bog‘langan joylarda ishlaydi.
    </div>
</div>
</body>
</html>
