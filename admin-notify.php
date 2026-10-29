<?php
// ============================================================================
// admin-notify.php - bildirishnoma yuborish (faqat admin)
// ============================================================================
// Ikki kanal:
//   1) SAYT ICHI  — `notifications` jadvali (qo'ng'iroq belgisi, sahifa)
//   2) TELEGRAM   — bot orqali shaxsiy chatga (ixtiyoriy; foydalanuvchi
//                   botga /start bosgan bo'lishi kerak)
//
// Kimga: hammasi | faqat premium | bitta foydalanuvchi (id yoki @username).
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/Notifications.php';

if (!$auth->isAdmin()) {
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin-notify.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}

$db    = Database::getInstance();
$base  = rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\');
$MAX   = 500;   // bir marta yuborishdagi maksimal qabul qiluvchi

// ---------------------------------------------------------------- yuborish
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    @set_time_limit(180);

    $audience = (string) ($_POST['audience'] ?? 'all');
    $who      = trim((string) ($_POST['who'] ?? ''));
    $title    = trim((string) ($_POST['title'] ?? ''));
    $message  = trim((string) ($_POST['message'] ?? ''));
    $url      = trim((string) ($_POST['url'] ?? ''));
    $toTg     = !empty($_POST['to_telegram']);

    if ($title === '' || $message === '') {
        header('Location: admin-notify.php?err=empty');
        exit;
    }

    // Qabul qiluvchilarni tanlash
    if ($audience === 'premium') {
        $rows = $db->fetchAll(
            "SELECT id, telegram_chat_id FROM users
              WHERE is_premium = 1 AND is_banned = 0 ORDER BY id DESC LIMIT $MAX"
        );
    } elseif ($audience === 'one') {
        $key = ltrim($who, '@');
        $rows = $db->fetchAll(
            "SELECT id, telegram_chat_id FROM users
              WHERE (telegram_user_id = ? OR username = ? OR id = ?) LIMIT 1",
            [$key, $key, (int) $key]
        );
    } else {
        $rows = $db->fetchAll(
            "SELECT id, telegram_chat_id FROM users
              WHERE is_banned = 0 ORDER BY id DESC LIMIT $MAX"
        );
    }

    $notif = new Notifications($db);
    $inApp = 0;
    $tgOk  = 0;
    $tgErr = 0;

    if ($toTg) {
        $bot = new TelegramBot();
        $bot->setTimeout(10);
    }

    foreach ($rows as $r) {
        $uid = (int) $r['id'];
        if ($notif->add($uid, 'system', [
            'title'   => $title,
            'message' => $message,
            'url'     => $url,
        ])) {
            $inApp++;
        }

        if ($toTg) {
            $chat = trim((string) ($r['telegram_chat_id'] ?? ''));
            if ($chat === '') {
                $u = $db->fetchOne("SELECT telegram_user_id FROM users WHERE id = ?", [$uid]);
                $chat = trim((string) ($u['telegram_user_id'] ?? ''));
            }
            if ($chat !== '') {
                $text = '<b>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . "</b>\n\n"
                    . htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
                $res = $bot->sendMessage($chat, $text);
                if (!empty($res['ok'])) {
                    $tgOk++;
                } else {
                    $tgErr++;
                }
                usleep(45000);   // ~22 xabar/s — Telegram limitidan past
            }
        }
    }

    header('Location: admin-notify.php?sent=1&inapp=' . $inApp
        . '&total=' . count($rows) . '&tgok=' . $tgOk . '&tgerr=' . $tgErr);
    exit;
}

// ---------------------------------------------------------------- statistika
$nAll     = (int) ($db->fetchOne("SELECT COUNT(*) n FROM users WHERE is_banned = 0")['n'] ?? 0);
$nPremium = (int) ($db->fetchOne("SELECT COUNT(*) n FROM users WHERE is_premium = 1 AND is_banned = 0")['n'] ?? 0);
$nTg      = (int) ($db->fetchOne("SELECT COUNT(*) n FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''")['n'] ?? 0);

$sent = isset($_GET['sent']);
$inApp = (int) ($_GET['inapp'] ?? 0);
$total = (int) ($_GET['total'] ?? 0);
$tgOk  = (int) ($_GET['tgok'] ?? 0);
$tgErr = (int) ($_GET['tgerr'] ?? 0);
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Bildirishnoma — Admin</title>
    <link rel="stylesheet" href="assets/css/admin.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/admin.css') ?: 1; ?>">
</head>
<body>
<div class="wrap">

    <div class="top">
        <img src="assets/img/logo.png" alt="">
        <div>
            <h1>Bildirishnoma yuborish</h1>
            <div class="sub">Sayt ichi + Telegram</div>
        </div>
        <div class="sp"></div>
        <a class="btn ghost" href="admin.php">← Panel</a>
        <a class="btn ghost" href="admin.php?logout=1">Chiqish</a>
    </div>

    <?php if ($sent): ?>
        <div class="flash ok">
            Yuborildi: <b><?php echo $inApp; ?></b> / <?php echo $total; ?> foydalanuvchiga (sayt ichi).
            <?php if ($tgOk || $tgErr): ?>
                · Telegram: <b><?php echo $tgOk; ?></b> yetdi<?php echo $tgErr ? ', ' . $tgErr . ' xato' : ''; ?>.
            <?php endif; ?>
        </div>
    <?php elseif (isset($_GET['err'])): ?>
        <div class="flash err">Sarlavha va matn to‘ldirilishi shart.</div>
    <?php endif; ?>

    <div class="panel">
        <form method="POST" action="admin-notify.php">
            <div class="field">
                <label>Kimga</label>
                <select name="audience" id="audience">
                    <option value="all">Hamma (<?php echo $nAll; ?> ta)</option>
                    <option value="premium">Faqat premium (<?php echo $nPremium; ?> ta)</option>
                    <option value="one">Bitta foydalanuvchi</option>
                </select>
            </div>

            <div class="field" id="whoWrap" style="display:none">
                <label>Foydalanuvchi (Telegram ID, @username yoki DB ID)</label>
                <input type="text" name="who" placeholder="8715394666 yoki @doniyor">
            </div>

            <div class="field">
                <label>Sarlavha</label>
                <input type="text" name="title" maxlength="120" placeholder="Yangi film qo‘shildi">
            </div>

            <div class="field">
                <label>Matn</label>
                <textarea name="message" maxlength="1000" placeholder="Bugun “Yangi film” premyerasi — tomosha qiling!"></textarea>
            </div>

            <div class="row2">
                <div class="field">
                    <label>Havola (ixtiyoriy)</label>
                    <input type="text" name="url" maxlength="500" placeholder="<?php echo htmlspecialchars($base); ?>/watch.php?c=1">
                </div>
                <div class="field">
                    <label>Telegram</label>
                    <label style="display:flex;align-items:center;gap:8px;color:#eae6f2;font-size:13.5px">
                        <input type="checkbox" name="to_telegram" value="1" style="width:auto">
                        Bot orqali shaxsiy chatga ham yuborish (<?php echo $nTg; ?> ta ulangan)
                    </label>
                </div>
            </div>

            <button class="btn" type="submit">Yuborish</button>
            <span class="muted" style="margin-left:10px">Bir marta maks. <?php echo $MAX; ?> qabul qiluvchi</span>
        </form>
    </div>

    <div class="note">
        Telegram xabar faqat bot bilan chat ochgan (bir marta <code>/start</code> bosgan)
        foydalanuvchilarga yetadi — qolganlarga sayt ichidagi bildirishnoma boradi.
        <br>Yuborish paytida sahifani yopmang: yuborish tugagach ro‘yxatga qaytadi.
    </div>
</div>
<script>
(function () {
    var sel = document.getElementById('audience');
    var wrap = document.getElementById('whoWrap');
    function sync() { wrap.style.display = sel.value === 'one' ? '' : 'none'; }
    sel.addEventListener('change', sync);
    sync();
})();
</script>
</body>
</html>
