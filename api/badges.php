<?php
// ============================================================================
// api/badges.php — BITTA so'rovda ikkita badge
// ============================================================================
// Oldin har sahifada ikki mustaqil poller bor edi:
//   notifications.js -> api/notifications.php?action=count  (30 s)
//   dm-badge.js      -> api/dm.php?action=unread            (15 s)
// Millionlab tomoshabin uchun bu ikki barobar PHP/MySQL yuki edi.
//
// Endi:
//   * bitta so'rov: { unread, dm, recent };
//   * serverda Badges kesh (APCu yoki bitta fayl), yozuvda darhol o'chirish;
//   * brauzerda `Cache-Control: private, max-age=30` — kesh yaroqliligida
//     SERVERGA{SO'ROV KETMAYDI}. Private = CDN/shared cache keshlay olmaydi;
//     `Vary: Cookie` = boshqa foydalanuvchiga o'tmaydi.
//
// `?r=<stamp>` faqat foydalanuvchi harakati (read/send) dan keyin yuboriladi
// va keshlanmaydi — badge darhol yangilanadi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Notifications.php';
require_once __DIR__ . '/../includes/DM.php';
require_once __DIR__ . '/../includes/Badges.php';

$uid   = clientUserId();
$fresh = trim((string) (input('r', '', 24) ?? '')) !== '';

header_remove('Expires');
header_remove('Pragma');
header('Vary: Cookie');
if ($fresh) {
    header('X-WC-Cache: BYPASS');
    header('Cache-Control: private, no-store, max-age=0');
} else {
    header('X-WC-Cache: PRIVATE');
    header('Cache-Control: private, max-age=30, stale-while-revalidate=30');
}

// Tizimga kirmagan: so'rov yo'q, DB yo'q, 0 qaytaramiz.
if ($uid <= 0) {
    ok(['unread' => 0, 'dm' => 0, 'recent' => []]);
}

$ntf = new Notifications();
$dm  = new DM();

$data = Badges::remember($uid, function () use ($uid, $ntf, $dm) {
    $unread = $ntf->unreadCount($uid);

    // O'ng tepadagi "yangi bildirishnoma" kartochkalari uchun eng so'nggi
    // o'qilmaganlar — avvalgi `count` endpointi bilan bir xil ko'rinish.
    // `listFor(..., false)` ikkinchi COUNT so'rovini qilmaydi.
    $recent = [];
    if ($unread > 0) {
        $latest = $ntf->listFor($uid, 30, 0, false);
        foreach (($latest['items'] ?? []) as $it) {
            if (!empty($it['is_read'])) {
                continue;
            }
            $recent[] = [
                'id'   => (int) $it['id'],
                'type' => (string) $it['type'],
                'text' => (string) ($it['text'] ?? ''),
                'url'  => (string) ($it['url'] ?? ''),
                'at'   => (string) ($it['at'] ?? ''),
            ];
        }
    }

    return [
        'unread' => $unread,
        'dm'     => $dm->unreadTotal($uid),
        'recent' => $recent,
    ];
});

ok($data);
