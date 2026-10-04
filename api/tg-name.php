<?php
// ============================================================================
// api/tg-name.php - sayt foydalanuvchi nomlari (@username)
// ============================================================================
// Izohlar Telegram'da saqlanadi; lekin foydalanuvchining ko'rinadigan nomi
// (username) sayt tomonida kerak bo'ladi (mention / reply uchun). Bu
// endpoint faqat shu METADATA ni saqlaydi - izoh matni/fayli saqlanmaydi.
//
// GET  ?ids=1,2,3      -> { names: { "1": "ali", "2": "vali" } }
// POST tg_me + username -> { success: true, username: "ali" }
//
// DIQQAT: `tg_me` brauzerdagi MTProto akkauntining JSON'i. Uning
// kriptografik tasdiqlanishi yo'q (sayt umuman shunga tayanadi), shuning
// uchun bu yer ham xuddi shu darajada ishonchli.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/** Username: kichik harf, 4-32 belgi, harf bilan boshlanadi. */
function tg_name_valid(string $u): bool {
    return (bool) preg_match('/^[a-z][a-z0-9_]{3,31}$/', $u);
}

if ($method === 'POST') {
    // Telegram id ni faqat `tg_me` dan olamiz (mijoz yuborgan `tg_id` ga
    // ishonmaymiz - aks holda boshqaning nomini egallash mumkin bo'lardi).
    $raw = input('tg_me', '', 2000);
    $tg  = ($raw !== '' && $raw[0] === '{') ? json_decode($raw, true) : null;
    $tgId = (is_array($tg) && !empty($tg['id'])) ? (int) $tg['id'] : 0;
    if ($tgId <= 0) {
        fail('tg_me kerak', 401);
    }

    $u = strtolower(ltrim(input('username', '', 40), '@'));
    if (!tg_name_valid($u)) {
        fail('Username noto\'g\'ri: 4-32 belgi, harf bilan boshlanadi (a-z, 0-9, _)');
    }

    // Username boshqa akkauntga tegishli bo'lmasin.
    $owner = $db->fetchOne('SELECT tg_id FROM tg_names WHERE username = ? AND tg_id <> ?', [$u, $tgId]);
    if ($owner) {
        fail('Bu username band. Boshqasini tanlang.');
    }

    $db->query(
        'INSERT INTO tg_names (tg_id, username) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE username = VALUES(username)',
        [$tgId, $u]
    );

    ok(['success' => true, 'username' => $u]);
}

// GET - bir nechta id uchun nomlarni qaytaramiz.
$idsRaw = input('ids', '', 2000);
$names  = [];
if ($idsRaw !== '') {
    $ids = [];
    foreach (explode(',', $idsRaw) as $x) {
        $n = (int) $x;
        if ($n > 0) {
            $ids[$n] = $n;
        }
    }
    if ($ids) {
        $ids = array_values($ids);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $rows = $db->fetchAll("SELECT tg_id, username FROM tg_names WHERE tg_id IN ($ph)", $ids);
        foreach ($rows as $r) {
            $names[(string) $r['tg_id']] = $r['username'];
        }
    }
}

ok(['names' => (object) $names]);
