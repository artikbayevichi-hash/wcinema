<?php
// ============================================================================
// includes/nav.php - YouTube TV uslubidagi navigatsiya qobig'i
// ============================================================================
//   KATTA EKRAN (>=1000px): chap yon panel (ixcham, qotiq mini guide)
//     Faqat hamburger tugmasi kengaytiradi; hover bilan o'zgarmaydi.
//     Tartib: Bosh sahifa · Reels · Chat · kategoriyalar · Kutubxona ·
//       Bildirishnomalar · Taklif/shikoyat · Sozlamalar.
//     Profil faqat tepa panelning o'ngida — bitta.
//
//   TELEFON  (<1000px): yuqori panel + pastki panel
//     Yuqori: brend · kataloglar · qidiruv · taklif · bildirishnoma · sozlamalar.
//     Pastki: Bosh sahifa · Reels · + · Chat · Siz (yagona profil).
//
//   TV REJIMI (html.tv): pult bilan boshqarishga moslashgan katta interfeys.
//     Avtomatik aniqlanadi yoki `assets/js/tv-mode.js` orqali yoqiladi (`?tv=1`).
//
// Sahifalar qo'ng'iroqdan OLDIN $NAV_ACTIVE o'rnatishi mumkin:
//   'home', 'reels', 'chat', 'upload', 'profile', 'notifications',
//   'saved', 'liked', 'history', 'later', 'search'
// ============================================================================

if (!isset($NAV_ACTIVE)) { $NAV_ACTIVE = ''; }

// Donat oynasi: admin kiritgan karta/Telegram ma'lumotlari. Hech narsa
// sozlanmagan bo'lsa ham asosiy bot bilan bog'lanish ishlayveradi —
// "To'lov keyinroq" degan o'chiq tugma yo'q.
if (!class_exists('SiteSettings')) { require_once __DIR__ . '/SiteSettings.php'; }
$wcDonateSet   = SiteSettings::all();
$wcDonateCard  = preg_replace('/\D/', '', (string) $wcDonateSet['donate_card']);
$wcDonateName  = trim((string) $wcDonateSet['donate_holder']);
$wcDonateTg    = ltrim(trim((string) $wcDonateSet['donate_telegram']), '@');
if ($wcDonateTg === '' && defined('TELEGRAM_BOT_USERNAME')) {
    $wcDonateTg = (string) TELEGRAM_BOT_USERNAME;
}
$wcDonateHref  = $wcDonateTg !== '' ? 'https://t.me/' . rawurlencode($wcDonateTg) : '#';

// Ishtirokchi foydalanuvchi uchun havolalar
$igIsAdmin  = $auth->isAdmin();
// Admin panel sahifalarida admin KALITI bilan kirgan bo'lsa, Telegram (MTProto)
// guard'ini o'tkazib yuboramiz — panel kalit bilan ishlaydi. Oddiy sayt
// sahifalarida esa guard avvalgidek qoladi.
$igAdminPage = in_array(basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')), ['admin-content.php'], true);
$igLogged   = (bool) $user;
$igProfileH = 'profile.php';
$igCreateH  = 'reels-upload.php';
$igAvatar   = '<span class="ig-avatar ig-avatar-in">?</span>';
if ($igLogged) {
    $igIn = mb_strtoupper(mb_substr($user['first_name'] ?? '?', 0, 1)) ?: '?';
    $igAvatar = !empty($user['avatar'])
        ? '<img class="ig-avatar" src="' . esc($user['avatar']) . '" alt="">'
        : '<span class="ig-avatar ig-avatar-in">' . esc($igIn) . '</span>';
}
// Kategoriyalar (chap panel bandlari). Bazaga yangi kategoriya qo'shilsa,
// u ham avtomatik paydo bo'ladi.
$igCats = [];
try { $igCats = $catalog->getCategories(); } catch (Exception $e) { $igCats = []; }
// Serial / Dokumental bo'limlari saytdan olib tashlangan — hech qayerda
// (chap guide, mobil menyu, chiplar, qidiruv) ko'rinmasin.
$igHiddenCats = ['serial', 'dokumental', 'dokument', 'dok'];
$igCats = array_values(array_filter($igCats, function ($c) use ($igHiddenCats) {
    return !in_array((string) ($c['slug'] ?? ''), $igHiddenCats, true);
}));
$igCatOrder = ['kino', 'film', 'anime', 'multfilm', 'multflim'];
usort($igCats, function ($a, $b) use ($igCatOrder) {
    $ia = array_search($a['slug'] ?? '', $igCatOrder, true);
    $ib = array_search($b['slug'] ?? '', $igCatOrder, true);
    $ia = $ia === false ? 999 : $ia;
    $ib = $ib === false ? 999 : $ib;
    return $ia - $ib;
});
$igActiveCat = isset($_GET['cat']) ? (string) $_GET['cat'] : '';

// Mobil header'dagi "Kataloglar" tugmasi menyusi — Kino / Animelar / Multfilmlar.
$igCatMenu = [];
foreach (['kino', 'anime', 'multfilm'] as $_mcSlug) {
    $_mcName = $_mcSlug;
    foreach ($igCats as $_mcCat) {
        if ((string) ($_mcCat['slug'] ?? '') === $_mcSlug) {
            $_mcName = (string) ($_mcCat['name'] ?? $_mcSlug);
            break;
        }
    }
    $igCatMenu[] = ['slug' => $_mcSlug, 'label' => ig_cat_label($_mcSlug, $_mcName)];
}

/** Kategoriya ikonkasi nomi (SVG kaliti). */
function ig_cat_icon($slug) {
    static $m = [
        'kino' => 'movie', 'film' => 'movie', 'anime' => 'anime', 'multfilm' => 'smile',
        'multflim' => 'smile', 'serial' => 'tv', 'dokumental' => 'globe', 'dokument' => 'globe'
    ];
    return isset($m[$slug]) ? $m[$slug] : 'tag';
}
/** YouTube uslubidagi kontur ikonka (SVG). Default: oq kontur, ichi bo'sh. */
function ig_svg($name) {
    static $icons = [
        // Qidiruv — Lucide uslubidagi lupa
        'search'   => '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        // Bosh sahifa — Lucide House (zamonaviy uy, eshik bilan)
        'home'     => '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.5a2 2 0 0 1 2.582 0l7 5.5A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        // Film — Lucide Film (kino lentasi)
        'film'     => '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
        // Kino — Lucide Clapperboard (rejissyor taxtasi)
        'movie'    => '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M6.2 5.3l3.1 3.9"/><path d="m12.3 3.5 3 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        // Reels — Lucide Clapperboard-Play uslubi (video + play)
        'reels'    => '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.35a.645.645 0 0 1-.968-.56V7.65c0-.52.563-.844.968-.56z"/><path d="M12 17v4"/><path d="M8 21h8"/>',
        // Chat — Lucide MessageCircle (pufakcha + uch nuqta)
        'chat'     => '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
        // Kutubxona — Lucide Library (kitoblar javoni)
        'library'  => '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
        // Tarix — Lucide History (orqaga soat)
        'history'  => '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
        // Soat
        'clock'    => '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        // Keyinroq ko'rish — Lucide BookmarkPlus
        'later'    => '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
        // Yoqqanlar — Lucide Heart
        'like'     => '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
        'heart'    => '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
        // ThumbUp — Lucide
        'thumbUp'  => '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z"/>',
        // ThumbDown — Lucide
        'thumbDown'=> '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z"/>',
        // Taklif/shikoyat — Lucide Send (qog'oz samolyot)
        'send'     => '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
        // Ro'yxat — Lucide List
        'list'     => '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
        // Kamera — Lucide Camera
        'camera'   => '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
        // O'chirish — Lucide Trash2
        'trash'    => '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
        // Tasdiqlash — Lucide Check
        'check'    => '<path d="M20 6 9 17l-5-5"/>',
        // Yopish — Lucide X
        'close'    => '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        // Orqaga — Lucide ChevronLeft
        'back'     => '<path d="m15 18-6-6 6-6"/>',
        // Tahrirlash — Lucide Pencil
        'edit'     => '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
        // Chiqish — Lucide LogOut
        'logout'   => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
        // Yuklab olish — Lucide Download
        'download' => '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
        // Rasm — Lucide Image
        'image'    => '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
        // O'ynatish — Lucide Play
        'play'     => '<polygon points="6 3 20 12 6 21 6 3"/>',
        // Murojaatlarim — Lucide ClipboardList (clipboard + ro'yxat)
        'bookmark' => '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
        // Bildirishnomalar — Lucide Bell (zamonaviy qo'ng'iroq)
        'bell'     => '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        // Kontent boshqaruvi — Lucide LayoutDashboard
        'folder'   => '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
        // Sozlamalar — Lucide Settings (tishli g'ildirak)
        'settings' => '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
        // Animelar — Lucide Sparkles (yulduzchalar — sehrli)
        'anime'    => '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
        // Multfilmlar — Lucide SmilePlus (kulgi yuz)
        'smile'    => '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
        // Seriallar — retro TV
        'tv'       => '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><path d="m17 2-5 5-5-5"/>',
        // Dunyo / Bot — Lucide Globe
        'globe'    => '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
        // Teg — Lucide Tag
        'tag'      => '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
        // Qo'shish — Lucide Plus
        'plus'     => '<path d="M5 12h14"/><path d="M12 5v14"/>',
        // Foydalanuvchi — Lucide User
        'user'     => '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        // Kataloglar — Lucide LayoutGrid
        'catalog'  => '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    ];
    $inner = isset($icons[$name]) ? $icons[$name] : $icons['tag'];
    return '<svg class="ig-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' . $inner . '</svg>';
}
/** Kategoriya ko'rinadigan nomi (YouTube TV uslubida). */
function ig_cat_label($slug, $name) {
    static $m = [
        'kino' => 'Kino', 'film' => 'Kinolar', 'anime' => 'Animelar',
        'multfilm' => 'Multfilmlar', 'multflim' => 'Multfilmlar',
        'serial' => 'Seriallar', 'dokumental' => 'Dokumental'
    ];
    return isset($m[$slug]) ? $m[$slug] : $name;
}
/** Yon panel elementi (icon + label). */
function ig_item($href, $key, $icon, $label, $active, $extra = '') {
    $cls = $active === $key ? ' active' : '';
    return '<a class="ig-item' . $cls . '" href="' . $href . '" title="' . esc($label) . '"' . $extra . '>'
         . '<span class="ig-ico">' . ig_svg($icon) . '</span>'
         . '<span class="ig-txt">' . esc($label) . '</span></a>';
}
?>
<?php
$tgBase = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
// ============================================================================
//  LOGO: WebP birinchi, PNG zaxira
// ----------------------------------------------------------------------------
//  logo.png 53 KB edi (sekin internetda ~2 s). WebP 12 KB — 4.4 barobar
//  kichik. `<picture>` bilan zamonaviy brauzerlar WebP oladi, eskilari
//  PNG ga qaytadi (shu sabab PNG fayl o'chirmaymiz).
// ============================================================================
function wc_logo_img($alt = '', $attrs = '') {
    $webp = @filemtime(__DIR__ . '/../assets/img/logo.webp') ?: 1;
    $png  = @filemtime(__DIR__ . '/../assets/img/logo.png') ?: 1;
    $altEsc = htmlspecialchars($alt !== '' ? $alt : SITE_NAME);
    return '<picture>'
         . '<source srcset="assets/img/logo.webp?v=' . $webp . '" type="image/webp">'
         . '<img src="assets/img/logo.png?v=' . $png . '" alt="' . $altEsc . '" ' . $attrs . '>'
         . '</picture>';
}
?>
<script>
(function () {
  // ------------------------------------------------------------------
  // 1) TV REJIMI — <head> da `tv-boot.php` allaqachon `.tv-mode`
  //    klassini qo'ygan bo'lishi kerak (FOUC bo'lmasligi uchun).
  //    Bu yerda faqat Telegram kirish himoyasi (guard) ishlaydi.
  //    TV boshqaruvi: `assets/js/tv-mode.js` (pult / D-Pad).
  // ------------------------------------------------------------------
  try {
    var v = localStorage.getItem('wc_mtproto_auth_v1');
    if (v && v.length > 20) return;                    // kalit bor — o'tamiz
<?php if (!($igIsAdmin && $igAdminPage)): ?>
    var here = location.pathname + location.search;
    location.replace(<?php echo json_encode($tgBase); ?> + '/1stlogin.php?next=' + encodeURIComponent(here));
<?php endif; ?>
  } catch (e) {}
})();
</script>
<!-- ==================== Desktop: YouTube uslubidagi tepa panel ====================
     Hamburger chapdagi yo‘l ko‘rsatkichni ochadi/yopadi; qidiruv o‘rtada;
     "Yaratish", bildirishnoma va avatar o‘ngda. Barcha tugmalar oldingi
     funksiyalarini saqlaydi (qidiruv #igSearch, bildirishnoma #igNtf). -->
<header class="yt-mast" id="ytMast">
    <div class="yt-mast-left">
        <button class="yt-icon-btn" id="igMenuBtn" type="button"
                aria-label="Menyu" aria-controls="igSide" aria-expanded="false" title="Menyu">
            <span class="yt-menu-lines" aria-hidden="true"><i></i><i></i><i></i></span>
        </button>
        <a class="yt-mast-brand" href="index.php" aria-label="<?php echo esc(SITE_NAME); ?> — bosh sahifa">
            <?php echo wc_logo_img(SITE_NAME, 'width="30" height="30"'); ?>
            <span><?php echo htmlspecialchars(SITE_NAME); ?></span>
        </a>
    </div>
    <a class="yt-mast-search" href="index.php" data-nav-search="1" title="Qidiruv" role="button">
        <span class="ig-ico"><?php echo ig_svg('search'); ?></span>
        <span class="yt-mast-search-ph">Qidiruv</span>
        <span class="yt-mast-search-btn" aria-hidden="true"><?php echo ig_svg('search'); ?></span>
    </a>
    <div class="yt-mast-right">
        <a class="yt-create-pill" href="<?php echo $igCreateH; ?>" title="Reels yuklash" aria-label="Reels yuklash">
            <span class="ig-ico"><?php echo ig_svg('plus'); ?></span><span>Yaratish</span>
        </a>
        <a class="ig-mobar-btn yt-mast-ntf" href="notifications.php" title="Bildirishnomalar" aria-label="Bildirishnomalar">
            <?php echo ig_svg('bell'); ?>
        </a>
        <a class="yt-mast-avatar ig-profile-top" href="<?php echo $igProfileH; ?>" title="Profil" aria-label="Profil">
            <?php echo $igAvatar; ?>
        </a>
    </div>
</header>

<!-- ============================== Desktop: yon panel ============================== -->
<aside class="ig-side" id="igSide">
    <nav class="ig-nav">
        <!-- YouTube tartibi: Bosh sahifa · Reels · Chat · kategoriyalar · Siz · sozlamalar -->
        <?php echo ig_item('index.php', 'home', 'home', 'Bosh sahifa', $NAV_ACTIVE); ?>
        <?php echo ig_item('reels.php', 'reels', 'reels', 'Reels', $NAV_ACTIVE); ?>
        <a class="ig-item<?php echo $NAV_ACTIVE === 'chat' ? ' active' : ''; ?>" href="chat.php" title="Chat">
            <span class="ig-ico"><?php echo ig_svg('chat'); ?><span class="ig-ntf-badge" id="igChatBadge" hidden></span></span>
            <span class="ig-txt">Chat</span>
        </a>

        <div class="ig-sep"></div>

        <!-- Kategoriyalar (Kino / Animelar / Multfilmlar ...) -->
        <div class="ig-group">
            <?php foreach ($igCats as $c):
                $_slug  = (string) ($c['slug'] ?? '');
                // "Serial" va "Dokumental" bo'limlari butunlay olib tashlangan.
                if (in_array($_slug, ['serial', 'dokumental', 'dokument'], true)) { continue; }
                $_label = ig_cat_label($_slug, (string) ($c['name'] ?? $_slug));
                $_cls   = ($igActiveCat === $_slug) ? ' active' : '';
            ?>
                <a class="ig-item<?php echo $_cls; ?>"
                   href="index.php?cat=<?php echo urlencode($_slug); ?>"
                   title="<?php echo esc($_label); ?>">
                    <span class="ig-ico"><?php echo ig_svg(ig_cat_icon($_slug)); ?></span>
                    <span class="ig-txt"><?php echo esc($_label); ?></span>
                </a>
            <?php endforeach; ?>
        </div>

        <div class="ig-sep"></div>

        <!-- Profil faqat tepa panelning o'ng burchagida. Chap guide'da
             takroriy profil tugmasi bo'lmaydi (ikki avatar birga chiqib qolardi). -->

        <!-- Kutubxona (ochiladigan bo'lim) -->
        <button class="ig-item ig-lib-toggle" id="igLibBtn" type="button"
                aria-expanded="false" aria-controls="igLibMenu" title="Kutubxona">
            <span class="ig-ico"><?php echo ig_svg('library'); ?></span>
            <span class="ig-txt">Kutubxona</span>
            <span class="ig-caret">▾</span>
        </button>
        <div class="ig-sub" id="igLibMenu" hidden>
            <?php echo ig_item('history.php', 'history', 'history', 'Tarix', $NAV_ACTIVE); ?>
            <?php echo ig_item('profile.php?tab=liked', 'liked', 'like', 'Yoqqanlar', $NAV_ACTIVE); ?>
            <?php echo ig_item('saved.php', 'saved', 'bookmark', 'Saqlanganlar', $NAV_ACTIVE); ?>
            <?php echo ig_item('watch-later.php', 'later', 'later', 'Keyinroq ko‘rish', $NAV_ACTIVE); ?>
        </div>

        <!-- Bildirishnomalar -->
        <?php echo ig_item('notifications.php', 'notifications', 'bell', 'Bildirishnomalar', $NAV_ACTIVE); ?>

        <!-- Takliflar yoki shikoyat qilish: oynani feedback.js ochadi -->
        <button class="ig-item" type="button" data-feedback-open
                aria-haspopup="dialog" aria-controls="feedbackDialog" title="Taklif yoki shikoyat">
            <span class="ig-ico"><?php echo ig_svg('send'); ?></span>
            <span class="ig-txt">Taklif yoki shikoyat</span>
        </button>
        <a class="ig-item ig-feedback-link" href="feedback.php"
           title="Murojaatlarim" aria-label="Murojaatlarim">
            <span class="ig-ico"><?php echo ig_svg('bookmark'); ?></span>
            <span class="ig-txt">Murojaatlarim</span>
        </a>

        <?php if ($igIsAdmin): ?>
            <div class="ig-sep"></div>
            <div class="ig-group">
                <?php echo ig_item('admin-content.php', 'admin', 'folder', 'Kontent boshqaruvi', $NAV_ACTIVE); ?>
            </div>
        <?php endif; ?>
    </nav>

    <div class="ig-side-bottom">
        <!-- Sozlamalar (alohida oyna) -->
        <div class="ig-more">
            <button class="ig-item" id="igMoreBtn" type="button">
                <span class="ig-ico"><?php echo ig_svg('settings'); ?></span><span class="ig-txt">Sozlamalar</span>
            </button>
        </div>

        <div class="ig-side-foot">
            © <?php echo date('Y'); ?> <?php echo htmlspecialchars(SITE_NAME); ?>
            <span><?php echo wc_logo_img('', 'width="14" height="14" style="object-fit:contain;vertical-align:-2px;margin-right:4px"'); ?>W CINEMA</span>
        </div>
    </div>
</aside>

<!-- ============================== Telefon: YouTube uslubidagi yuqori panel ============================== -->
<!-- YouTube mobili: logo chapda, qidiruv/taklif/bildirishnoma/sozlamalar o'ngda.
     Profil yuqorida yo'q — u faqat pastki "Siz" tabida (bitta). -->
<header class="ig-mobar">
    <div class="ig-mobar-row">
        <a class="ig-mobar-brand" href="index.php"><?php echo wc_logo_img(SITE_NAME, 'width="30" height="30"'); ?><span><?php echo htmlspecialchars(SITE_NAME); ?></span></a>
        <div class="ig-mobar-actions">
            <?php if ($igCatMenu): ?>
            <div class="ig-mobar-cats">
                <button class="ig-mobar-btn" id="igCatBtnM" type="button"
                        aria-label="Kataloglar" aria-haspopup="true" aria-expanded="false"
                        aria-controls="igCatMenuM"><?php echo ig_svg('catalog'); ?></button>
                <div class="ig-mobar-cats-menu" id="igCatMenuM" hidden>
                    <?php foreach ($igCatMenu as $_mc): ?>
                    <a class="ig-mobar-cat<?php echo $igActiveCat === $_mc['slug'] ? ' active' : ''; ?>"
                       href="index.php?cat=<?php echo urlencode($_mc['slug']); ?>">
                        <span class="ig-mobar-cat-ico"><?php echo ig_svg(ig_cat_icon($_mc['slug'])); ?></span>
                        <span class="ig-mobar-cat-txt"><?php echo esc($_mc['label']); ?></span>
                    </a>
                    <?php endforeach; ?>
                </div>
            </div>
            <?php endif; ?>
            <a class="ig-mobar-btn" href="index.php" data-nav-search="1" title="Qidiruv" aria-label="Qidiruv"><?php echo ig_svg('search'); ?></a>
            <button class="ig-mobar-btn" type="button" data-feedback-open
                    aria-haspopup="dialog" aria-controls="feedbackDialog" aria-label="Taklif yoki shikoyat"><?php echo ig_svg('send'); ?></button>
            <a class="ig-mobar-btn" href="notifications.php" aria-label="Bildirishnomalar"><?php echo ig_svg('bell'); ?></a>
            <button class="ig-mobar-btn" id="igMoreBtnM" type="button"
                    title="Sozlamalar" aria-label="Sozlamalar"><?php echo ig_svg('settings'); ?></button>
        </div>
    </div>
</header>

<!-- ============================== Telefon: pastki panel ============================== -->
<!-- YouTube mobili: Bosh sahifa | Reels | + Yaratish | Chat | Siz -->
<nav class="ig-tabbar">
    <a href="index.php" class="<?php echo $NAV_ACTIVE === 'home' ? 'active' : ''; ?>" aria-label="Bosh sahifa"><?php echo ig_svg('home'); ?><span class="ig-tab-lbl">Bosh sahifa</span></a>
    <a href="reels.php" class="<?php echo $NAV_ACTIVE === 'reels' ? 'active' : ''; ?>" aria-label="Reels"><?php echo ig_svg('reels'); ?><span class="ig-tab-lbl">Reels</span></a>
    <a href="<?php echo $igCreateH; ?>" class="ig-tab-create" aria-label="Yaratish" title="Reels yuklash"><?php echo ig_svg('plus'); ?><span class="ig-tab-lbl">Yaratish</span></a>
    <a href="chat.php" class="<?php echo $NAV_ACTIVE === 'chat' ? 'active' : ''; ?>" aria-label="Chat"><?php echo ig_svg('chat'); ?><span class="ig-ntf-badge ig-tab-badge" id="igChatBadgeM" hidden></span><span class="ig-tab-lbl">Chat</span></a>
    <a href="<?php echo $igProfileH; ?>" class="ig-tab-profile <?php echo $NAV_ACTIVE === 'profile' ? 'active' : ''; ?>" aria-label="Siz"><?php echo $igAvatar; ?><span class="ig-tab-lbl">Siz</span></a>
</nav>

<!-- Doimiy donor tugmasi: umumiy nav kiritilgan barcha sahifalarda ko'rinadi. -->
<button class="donate-fab" type="button" data-donate-open
        aria-haspopup="dialog" aria-controls="donateDialog">
    <span class="donate-fab-icon" aria-hidden="true"><?php echo ig_svg('heart'); ?></span>
    <span>Donat</span>
</button>

<!-- Donat: karta admin tomonidan kiritilsa nusxalanadi; Telegram havolasi
     doimo ishlaydi. O'chiq tugma yo'q. -->
<div class="donate-dialog" id="donateDialog" role="dialog" aria-modal="true"
     aria-labelledby="donateTitle" aria-describedby="donateDescription" hidden>
    <div class="donate-backdrop" data-donate-close></div>
    <section class="donate-panel" tabindex="-1">
        <button class="donate-x" type="button" data-donate-close-button aria-label="Oynani yopish">&times;</button>
        <div class="donate-heart" aria-hidden="true"><?php echo ig_svg('heart'); ?></div>
        <p class="donate-kicker">W CINEMA'ni qo'llab-quvvatlang</p>
        <h2 id="donateTitle">Donat loyihani rivojlantiradi</h2>
        <p class="donate-description" id="donateDescription">
            Sayt sizga yoqsa, bot orqali bog'lanib yoki karta bilan hissa qo'shishingiz mumkin.
        </p>
        <?php if ($wcDonateCard !== ''): ?>
        <div class="donate-method">
            <strong>Karta orqali</strong>
            <button class="donate-copy" type="button" data-donate-copy="<?php echo htmlspecialchars($wcDonateCard, ENT_QUOTES, 'UTF-8'); ?>">
                <span><?php echo htmlspecialchars($wcDonateCard, ENT_QUOTES, 'UTF-8'); ?></span>
                <span class="donate-copy-label">Nusxalash</span>
            </button>
            <?php if ($wcDonateName !== ''): ?>
            <p class="donate-method-note">Karta egasi: <?php echo htmlspecialchars($wcDonateName, ENT_QUOTES, 'UTF-8'); ?></p>
            <?php endif; ?>
            <p class="donate-method-note">O'tkazmadan keyin botga xabar yuboring.</p>
        </div>
        <?php endif; ?>
        <a class="donate-primary" href="<?php echo htmlspecialchars($wcDonateHref, ENT_QUOTES, 'UTF-8'); ?>"
           target="_blank" rel="noopener noreferrer">
            Telegram orqali yordam yuborish
            <span aria-hidden="true">&rarr;</span>
        </a>
        <p class="donate-privacy">Karta ma'lumotlari bu saytda so'ralmaydi va saqlanmaydi.</p>
        <button class="donate-dismiss" type="button" data-donate-close-button>Yopish</button>
    </section>
</div>

<!-- Qidiruv takliflari va profil belgilari. Faqat oq/#000 palitrasi;
     yangi CSS fayli yaratilmaydi (qolgan uslublar mavjud .ig-* klasslarda). -->
<style>
.ig-search-suggest { max-height: 340px; overflow: auto; padding: 4px 12px 8px; border-bottom: 1px solid var(--line); }
.ig-search-suggest[hidden] { display: none; }
.ig-search-suggest .ig-sug-h { font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--muted); margin: 8px 2px 4px; }
.ig-search-suggest .ig-sprof { padding: 6px; gap: 10px; }
.ig-search-suggest .ig-sprof-av { width: 36px; height: 36px; }
.ig-search-suggest .ig-sprof-info b { font-size: 13px; }
.ig-sug-row { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 10px; text-decoration: none; color: var(--text); }
.ig-sug-row:hover { background: var(--card); }
.ig-sug-row .ig-sres-thumb { display: block; width: 38px; height: 38px; aspect-ratio: auto; flex: 0 0 38px; border-radius: 8px; }
.ig-sug-txt { display: flex; flex-direction: column; min-width: 0; }
.ig-sug-row .ig-sres-title { margin: 0; font-size: 13px; font-weight: 600; }
.ig-sug-row .ig-sres-sub { display: block; margin: 0; font-size: 11px; }
.ig-sprof-badge { display: inline-flex; align-items: center; gap: 2px; margin-left: 5px; vertical-align: middle; color: var(--text); }
.ig-sprof-badge svg { width: 13px; height: 13px; display: block; }
.ig-sprof-follow { display: inline-block; width: max-content; max-width: 100%; margin-top: 3px; padding: 2px 7px; border: 1px solid var(--text); border-radius: 999px; font-size: 11px; line-height: 1.2; color: var(--text); }
.ig-sprof-follow[hidden] { display: none; }
</style>

<!-- ============================== Qidiruv oynasi (alohida) ============================== -->
<div class="ig-search" id="igSearch" role="dialog" aria-label="Saytdan qidirish" hidden>
    <div class="ig-search-bar">
        <span class="ig-search-ico"><?php echo ig_svg('search'); ?></span>
        <label class="sr-only" for="igSearchInput">Saytdan qidirish</label>
        <input id="igSearchInput" type="search" placeholder="Qidirish" autocomplete="off">
        <button class="ig-search-close" id="igSearchClose" type="button" aria-label="Yopish"><?php echo ig_svg('back'); ?></button>
    </div>
    <div class="ig-search-chips" id="igSearchChips" role="toolbar" aria-label="Natija turi">
        <button type="button" class="ig-chip on" data-cat="">Hammasi</button>
        <button type="button" class="ig-chip" data-cat="profiles">Profillar</button>
        <button type="button" class="ig-chip" data-cat="reels">Reels</button>
        <button type="button" class="ig-chip" data-cat="content">Kino</button>
    </div>
    <div class="ig-search-suggest" id="igSearchSuggest" aria-label="Jonli takliflar" aria-live="polite" hidden></div>
    <div class="ig-search-body">
        <div class="ig-search-hint" id="igSearchHint">Qidirish uchun nom yozing</div>
        <div class="ig-search-recent" id="igSearchRecent" hidden></div>
        <div class="ig-search-grid" id="igSearchGrid"></div>
    </div>
</div>

<!-- ============================== TV rejimi: YouTube TV uslubidagi qidiruv ============================== -->
<!-- YouTube TV'da "Qidiruv" bosilganda to'liq ekranni egallagan qidiruv
     oynasi ochiladi: yuqorida KATTAGINA maydon (pult klaviaturasi shu
     yerga ochiladi), pastida esa yozilayotgan so'zga qarab natijalar
     jonli paydo bo'ladi. Shu oynaga kirsangiz — fokus maydonga tushadi,
     pastga bosing — natijalar orasida yurursiz. -->
<div class="tv-search" id="tvSearch" role="dialog" aria-modal="true" aria-label="Qidirish" hidden>
    <div class="tv-search-bar">
        <span class="tv-search-ico"><?php echo ig_svg('search'); ?></span>
        <label class="sr-only" for="tvSearchInput">Saytdan qidirish</label>
        <input id="tvSearchInput" type="search" placeholder="Qidirish…" autocomplete="off"
               autocorrect="off" autocapitalize="off" spellcheck="false"
               readonly inputmode="none" tabindex="-1" data-tv-skip>
        <button class="tv-search-clear" id="tvSearchClear" type="button" aria-label="Tozalash" hidden>&times;</button>
        <button class="tv-search-back" id="tvSearchBack" type="button" aria-label="Orqaga">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>
        </button>
    </div>
    <div class="tv-search-main">
    <!-- Chap: pult bilan boshqariladigan ekran klaviaturasi (YouTube TV kabi) -->
    <div class="tv-search-left">
        <div class="tv-kb" id="tvKb" role="group" aria-label="Klaviatura"></div>
    </div>
    <!-- O'ng: jonli natijalar -->
    <div class="tv-search-body">
        <div class="tv-search-hint" id="tvSearchHint">Qidirish uchun nom yozing — pultdagi klaviatura shu yerga ochiladi</div>
        <div class="tv-search-grid" id="tvSearchGrid"></div>
    </div>
    </div><!-- /tv-search-main -->
</div>

<!-- ============================== Sozlamalar oynasi (alohida) ============================== -->
<div class="ig-settings" id="igSettings" hidden>
    <div class="ig-settings-panel" role="dialog" aria-modal="true" aria-label="Sozlamalar">
        <div class="ig-set-head">
            <span class="ig-set-title">Sozlamalar</span>
            <button class="ig-set-close" id="igSetClose" type="button" aria-label="Yopish">
                <svg class="ig-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>
            </button>
        </div>
        <div class="ig-set-body">

            <div class="ig-set-group">
                <div class="ig-set-label">Hisob</div>
                <a class="ig-set-row" href="profile.php">
                    <span class="ig-set-ico"><?php echo ig_svg('user'); ?></span>
                    <span class="ig-set-txt">Profil</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="saved.php">
                    <span class="ig-set-ico"><?php echo ig_svg('bookmark'); ?></span>
                    <span class="ig-set-txt">Saqlanganlar</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="history.php">
                    <span class="ig-set-ico"><?php echo ig_svg('history'); ?></span>
                    <span class="ig-set-txt">Tarix</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="reels-upload.php">
                    <span class="ig-set-ico"><?php echo ig_svg('plus'); ?></span>
                    <span class="ig-set-txt">Joylash</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="settings.php#privacy">
                    <span class="ig-set-ico"><?php echo ig_svg('settings'); ?></span>
                    <span class="ig-set-txt">Maxfiylik va bloklar</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="settings.php#notifications">
                    <span class="ig-set-ico"><?php echo ig_svg('bell'); ?></span>
                    <span class="ig-set-txt">Bildirishnomalar</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="settings.php#blocked">
                    <span class="ig-set-ico"><?php echo ig_svg('close'); ?></span>
                    <span class="ig-set-txt">Bloklanganlar</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
            </div>

            <div class="ig-set-group">
                <div class="ig-set-label">Ko&#8217;rinish</div>
                <button class="ig-set-row" id="tvToggleLink" type="button">
                    <span class="ig-set-ico"><?php echo ig_svg('tv'); ?></span>
                    <span class="ig-set-txt">TV rejimi</span>
                    <span class="ig-set-val" id="setTvVal">O&#8217;chiq</span>
                </button>
            </div>

            <?php if ($igIsAdmin): ?>
            <div class="ig-set-group">
                <div class="ig-set-label">Administrator</div>
                <a class="ig-set-row" href="admin-content.php">
                    <span class="ig-set-ico"><?php echo ig_svg('folder'); ?></span>
                    <span class="ig-set-txt">Kontent boshqaruvi</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
            </div>
            <?php endif; ?>

            <div class="ig-set-group">
                <div class="ig-set-label">Aloqa</div>
                <button class="ig-set-row" type="button" data-feedback-open aria-haspopup="dialog" aria-controls="feedbackDialog">
                    <span class="ig-set-ico"><?php echo ig_svg('send'); ?></span>
                    <span class="ig-set-txt">Taklif yoki shikoyat yuborish</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </button>
                <a class="ig-set-row" href="feedback.php">
                    <span class="ig-set-ico"><?php echo ig_svg('bookmark'); ?></span>
                    <span class="ig-set-txt">Murojaatlarim</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <a class="ig-set-row" href="https://t.me/<?php echo htmlspecialchars(TELEGRAM_BOT_USERNAME); ?>" target="_blank" rel="noopener">
                    <span class="ig-set-ico"><?php echo ig_svg('globe'); ?></span>
                    <span class="ig-set-txt">Bot&#8217;ga o&#8217;tish</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
            </div>

            <?php if ($igLogged): ?>
            <div class="ig-set-group">
                <a class="ig-set-row danger" href="logout.php">
                    <span class="ig-set-ico"><?php echo ig_svg('logout'); ?></span>
                    <span class="ig-set-txt">Chiqish</span>
                </a>
            </div>
            <?php endif; ?>

        </div>
    </div>
</div>

<!-- ============================== Taklif / shikoyat oynasi ============================== -->
<div class="feedback-dialog" id="feedbackDialog" role="dialog" aria-modal="true"
     aria-labelledby="feedbackTitle" hidden>
    <div class="feedback-backdrop" data-feedback-close></div>
    <section class="feedback-panel" tabindex="-1">
        <button class="feedback-x" type="button" data-feedback-close aria-label="Yopish">&times;</button>
        <div class="feedback-kicker">W CINEMA · ALOQA</div>
        <h2 id="feedbackTitle">Takliflar yoki shikoyat qilish</h2>
        <p class="feedback-lead">Fikringizni yozing — admin o‘qib, javob yozadi. Javob kelganda saytda bildirishnoma olasiz.</p>

        <form id="feedbackForm">
            <div class="feedback-kind" role="radiogroup" aria-label="Xabar turi">
                <label><input type="radio" name="feedbackType" value="suggestion" checked><span>Taklif</span></label>
                <label><input type="radio" name="feedbackType" value="complaint"><span>Shikoyat</span></label>
            </div>
            <label class="feedback-label" for="feedbackMessage">Xabaringiz</label>
            <textarea id="feedbackMessage" name="feedbackMessage" maxlength="1000" rows="6"
                      placeholder="Nima yoqmayapti yoki nima yaxshilashni taklif qilasiz?"></textarea>
            <div class="feedback-foot">
                <span class="feedback-count"><b id="feedbackCount">0</b>/1000</span>
                <a href="feedback.php" class="feedback-mine">Murojaatlarim</a>
                <button class="feedback-send" id="feedbackSend" type="submit">Yuborish</button>
            </div>
            <p class="feedback-status" id="feedbackStatus" role="status" aria-live="polite"></p>
        </form>
    </section>
</div>

<!-- ============================== Bildirishnomalar oynasi (flyout) ============================== -->
<div class="ig-ntf" id="igNtf" hidden>
    <div class="ig-ntf-panel" role="dialog" aria-modal="true" aria-label="Bildirishnomalar">
        <div class="ig-ntf-head">
            <span class="ig-ntf-title">Bildirishnomalar</span>
            <div class="ig-ntf-head-actions">
                <button class="ig-ntf-mark" id="igNtfMarkAll" type="button">Barchasini o‘qish</button>
                <button class="ig-ntf-close" id="igNtfClose" type="button" aria-label="Yopish">
                    <svg class="ig-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </div>
        </div>
        <div class="ig-ntf-body" id="igNtfBody">
            <div class="ig-ntf-empty">Yuklanmoqda…</div>
        </div>
        <a class="ig-ntf-all" href="notifications.php">Barchasini ko‘rish</a>
    </div>
</div>

<script>
// DIQQAT: bu skript sahifaning YUQORI qismida turadi, shuning uchun hamma
// ish `DOMContentLoaded` ichida bajariladi (`tv-mode.js` esa alohida yuklanadi).
window.addEventListener('DOMContentLoaded', function () {
    var TG_KEY = 'wc_mtproto_auth_v1';

    // Telegram profil rasmi (TgStream saqlagan data-URL) avatar o'rniga
    // qo'yiladi — chap paneldagi va pastki paneldagi profil tugmalarida.
    // Profil rasmi avatar o'rniga qo'yiladi — chap paneldagi va pastki
    // paneldagi profil tugmalarida. Avval saytga YUKLANGAN rasm
    // (`wc_avatar_url_v1`), u bo'lmasa Telegram'dan olingan data-URL
    // (`wc_tg_photo_v1`, TgStream saqlagan).
    function igApplyPhoto() {
        var ph = null;
        try {
            ph = localStorage.getItem('wc_avatar_url_v1')
              || localStorage.getItem('wc_tg_photo_v1');
        } catch (e) {}
        if (!ph) return;
        var nodes = document.querySelectorAll('.ig-profile-top .ig-avatar, .ig-tab-profile .ig-avatar');
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.tagName === 'IMG') { n.src = ph; continue; }
            var img = document.createElement('img');
            img.className = 'ig-avatar';
            img.alt = '';
            img.src = ph;
            if (n.parentNode) n.parentNode.replaceChild(img, n);
        }
    }
    igApplyPhoto();
    window.addEventListener('wc:tgPhoto', igApplyPhoto);

    // "Telegramdan chiqish"
    var re = document.getElementById('tgReauthLink');
    if (re) {
        re.addEventListener('click', function () {
            if (!confirm('Telegram hisobidan chiqilsinmi?\nKeyin kirish sahifasi qaytadan ochiladi.')) return;
            try {
                localStorage.removeItem(TG_KEY);
                localStorage.removeItem('wc_tgweb_v1');
                localStorage.removeItem('wc_tg_mode_v1');
            } catch (e) {}
            location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/1stlogin.php');
        });
    }

    // PHP hisobdan chiqishda ham Telegram kalitini tozalaymiz
    var lg = document.querySelector('a[href="logout.php"]');
    if (lg) lg.addEventListener('click', function () {
        try {
            localStorage.removeItem(TG_KEY);
            localStorage.removeItem('wc_tgweb_v1');
            localStorage.removeItem('wc_tg_mode_v1');
        } catch (e) {}
    });

    // ---------------- "Sozlamalar" oynasi (alohida) ----------------
    var setBtn   = document.getElementById('igMoreBtn');
    var setBtnM  = document.getElementById('igMoreBtnM');
    var setPanel = document.getElementById('igSettings');
    var setClose = document.getElementById('igSetClose');

    function igSettingsOpen(open) {
        if (!setPanel) return;
        if (open) igCatOpen(false);
        setPanel.hidden = !open;
        try { document.body.style.overflow = open ? 'hidden' : ''; } catch (e) {}
    }
    function igSettingsBind(b) {
        if (b && setPanel) b.addEventListener('click', function (e) {
            e.preventDefault();
            igSettingsOpen(true);
        });
    }
    igSettingsBind(setBtn);
    igSettingsBind(setBtnM);
    // settings.php da #privacy, #notifications, #blocked ankerlari bor —
    // havolalar to'g'ridan-to'g'ri shu bo'limlarga o'tadi (qo'shimcha JS yo'q).

    // ---------------- YouTube uslubidagi menyu tugmasi ----------------
    // Hamburger chap paneldagi yozuvlarni ochadi. Hover/fokusda ochilish
    // saqlanib qoladi, lekin tugma yordamida panel "yelimlab" qo'yiladi.
    var menuBtn = document.getElementById('igMenuBtn');
    var side    = document.getElementById('igSide');
    if (menuBtn && side) {
        var sideKey = 'wc_side_open';
        function igSideOpen(open) {
            side.classList.toggle('open', !!open);
            menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            try { localStorage.setItem(sideKey, open ? '1' : '0'); } catch (e) {}
        }
        var sideSaved = false;
        try { sideSaved = localStorage.getItem(sideKey) === '1'; } catch (e) {}
        igSideOpen(sideSaved);
        menuBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            igSideOpen(!side.classList.contains('open'));
        });
        document.addEventListener('click', function (e) {
            if (!side.classList.contains('open')) return;
            if (side.contains(e.target) || menuBtn.contains(e.target)) return;
            igSideOpen(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && side.classList.contains('open')) igSideOpen(false);
        });
    }

    if (setClose) setClose.addEventListener('click', function () { igSettingsOpen(false); });
    if (setPanel) setPanel.addEventListener('click', function (e) {
        // Fon (panel tashqarisi) bosilsa yopiladi.
        if (e.target === setPanel) igSettingsOpen(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && setPanel && !setPanel.hidden) igSettingsOpen(false);
    });

    // ---------------- "Kataloglar" menyusi (mobil header) ----------------
    var catBtn  = document.getElementById('igCatBtnM');
    var catMenu = document.getElementById('igCatMenuM');
    function igCatOpen(open) {
        if (!catMenu || !catBtn) return;
        catMenu.hidden = !open;
        catBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        catBtn.classList.toggle('open', !!open);
    }
    if (catBtn && catMenu) {
        catBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            igCatOpen(catMenu.hidden);
        });
        document.addEventListener('click', function (e) {
            if (catMenu.hidden) return;
            if (catMenu.contains(e.target) || e.target === catBtn) return;
            igCatOpen(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !catMenu.hidden) igCatOpen(false);
        });
    }

    // TV rejimi holatini ko'rsatish
    var setTvVal = document.getElementById('setTvVal');
    if (setTvVal) setTvVal.textContent = document.documentElement.classList.contains('tv') ? 'Yoniq' : 'O\'chiq';

    // ---------------- TV rejimi tugmasi ----------------
    var tvl = document.getElementById('tvToggleLink');
    if (tvl) tvl.addEventListener('click', function () {
        var on = document.documentElement.classList.contains('tv');
        try { localStorage.setItem('wc_tv_mode', on ? '0' : '1'); } catch (e) {}
        try {
            var url = new URL(location.href);
            url.searchParams.delete('tv');
            location.href = url.toString();
        } catch (e) { location.reload(); }
    });

    // ---------------- Kutubxona bo'limi ----------------
    var libBtn = document.getElementById('igLibBtn');
    var libMenu = document.getElementById('igLibMenu');
    var libKey = 'ig_lib_open';
    function igSetLib(open) {
        if (!libBtn || !libMenu) return;
        libMenu.hidden = !open;
        libBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        libBtn.classList.toggle('open', !!open);
        try { localStorage.setItem(libKey, open ? '1' : '0'); } catch (e) {}
    }
    if (libBtn && libMenu) {
        libBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            igSetLib(libMenu.hidden);
        });
        var libActive = libMenu.querySelector('.ig-item.active');
        var openByDefault = false;
        try { openByDefault = localStorage.getItem(libKey) === '1'; } catch (e) {}
        igSetLib(openByDefault || !!libActive);
    }

    // ---------------- Alohida qidiruv oynasi ----------------
    // "Qidiruv" (chap panel / mobil) bosilganda shu oyna ochiladi.
    var searchBox  = document.getElementById('igSearch');
    var searchInp  = document.getElementById('igSearchInput');
    var searchGrid = document.getElementById('igSearchGrid');
    var searchRecent = document.getElementById('igSearchRecent');
    var searchHint = document.getElementById('igSearchHint');
    var searchX    = document.getElementById('igSearchClose');
    var searchSuggest = document.getElementById('igSearchSuggest');
    var searchTimer = null;
    var suggestTimer = null;
    var suggestCtrl = null;          // jonli takliflar uchun alohida AbortController
    var igSearchKey = 'wc_recent_searches_v1';
    // So'rov navbatini saqlash uchun token obyekti — har bir oyna o'z
    // tokeniga ega (sekin javob keyingisini bekor qilmasligi uchun).
    var igTokenSearch = { n: 0 };
    var igTokenTv    = { n: 0 };
    var igTokenSuggest = { n: 0 };   // takliflar FULL natijalarga yozmasligi uchun
    var igTypeFilter = '';           // Hammasi / Profillar / Reels / Kino
    (function () {
        var box = document.getElementById('igSearchChips');
        if (!box) return;
        box.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('[data-cat]') : null;
            if (!b) return;
            igTypeFilter = b.getAttribute('data-cat') || '';
            var all = box.querySelectorAll('[data-cat]');
            for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === b);
            igSuggestHide();
            igRunSearch();
        });
    })();

    // ---------------- TV rejimi: YouTube TV uslubidagi qidiruv ----------------
    // Pult bilan boshqariladigan to'liq ekranli qidiruv. Fokus avval
    // maydonga tushadi (pult klaviaturasi shu yerda ochiladi), natijalar
    // esa yozilayotgan so'zga qarab jonli yangilanadi.
    var tvSearchBox   = document.getElementById('tvSearch');
    var tvSearchInp   = document.getElementById('tvSearchInput');
    var tvSearchGrid  = document.getElementById('tvSearchGrid');
    var tvSearchHint  = document.getElementById('tvSearchHint');
    var tvSearchClear = document.getElementById('tvSearchClear');
    var tvSearchBack  = document.getElementById('tvSearchBack');
    var tvSearchTimer = null;
    var tvSearchSeq   = 0;
    var tvSearchLast  = null;      // natijalar ichidagi oxirgi fokus

    /** TV rejimi faolmi? (`tv-mode.js` `<html>` ga `.tv-mode` qo'yadi.) */
    function igIsTv() {
        return !!(document.documentElement && document.documentElement.classList.contains('tv-mode'));
    }

    function igRecentRead() {
        try {
            var a = JSON.parse(localStorage.getItem(igSearchKey) || '[]');
            return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 6) : [];
        } catch (e) { return []; }
    }
    function igRecentSave(q) {
        q = String(q || '').trim();
        if (q.length < 2) return;
        var a = igRecentRead().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
        a.unshift(q);
        try { localStorage.setItem(igSearchKey, JSON.stringify(a.slice(0, 6))); } catch (e) {}
        igRecentRender();
    }
    function igRecentRender() {
        if (!searchRecent) return;
        var a = igRecentRead();
        searchRecent.hidden = !a.length;
        searchRecent.innerHTML = a.map(function (q) {
            return '<button type="button" class="ig-recent-chip" data-recent="' + igEsc(q) + '">' + igEsc(q) + '</button>';
        }).join('');
        searchRecent.querySelectorAll('[data-recent]').forEach(function (b) {
            b.addEventListener('click', function () {
                searchInp.value = b.getAttribute('data-recent') || '';
                igRunSearch();
            });
        });
    }

    function igEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function igSearchBase() {
        if (window.APP && window.APP.base) return window.APP.base;
        var p = location.pathname;
        var i = p.lastIndexOf('/');
        return i >= 0 ? p.slice(0, i) : '';
    }

    function igOpenSearch() {
        // TV rejimida — YouTube TV uslubidagi to'liq ekranli qidiruv.
        if (igIsTv() && tvSearchBox) { igTvOpenSearch(); return; }
        if (!searchBox) return;
        igCatOpen(false);
        igSuggestHide();
        searchBox.hidden = false;
        igRecentRender();
        // Kichik ochiladigan panel: sahifa skroli va boshqa tugmalar ishlayveradi.
        if (searchInp) setTimeout(function () { searchInp.focus(); }, 30);
    }

    function igCloseSearch() {
        igSuggestHide();
        if (!searchBox) return;
        searchBox.hidden = true;
    }

    function igResultCard(c) {
        var poster = c.poster
            ? '<img src="' + igEsc(c.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '<div class="ig-sres-ph">' + igEsc(c.category || 'W CINEMA') + '</div>';
        var sub = [];
        if (c.category) sub.push(c.category);
        if (c.year) sub.push(c.year);
        if (c.is_series && (c.episodes || c.total_episodes)) {
            if (c.category_slug === 'anime') {
                var isRel = parseInt(c.episodes, 10) || 0;
                var isTot = parseInt(c.total_episodes, 10) || 0;
                sub.push(isTot > isRel ? (isRel + '/' + isTot) : String(isRel || isTot));
            } else {
                sub.push((c.episodes || c.total_episodes) + ' qism');
            }
        }
        return '<a class="ig-sres" href="watch.php?c=' + (parseInt(c.id, 10) || 0) + '">'
             + '<div class="ig-sres-thumb">' + poster + '</div>'
             + '<div class="ig-sres-title">' + igEsc(c.title) + '</div>'
             + (sub.length ? '<div class="ig-sres-sub">' + igEsc(sub.join(' · ')) + '</div>' : '')
             + '<div class="ig-sres-id">ID: ' + (parseInt(c.id, 10) || 0) + '</div>'
             + '</a>';
    }

    function igProfileCard(u) {
        var name = [u.first_name, u.last_name].filter(Boolean).join(' ');
        var handle = u.username ? ('@' + u.username) : '';
        var av = u.avatar
            ? '<img src="' + igEsc(u.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '<span class="ig-sprof-ph">' + igEsc((u.first_name || '?').charAt(0).toUpperCase()) + '</span>';

        // Tasdiqlangan / Premium belgisi: faqat oq kontur (rangli UI yo'q).
        // `premium` API'dan keladi; `verified` kelajakdagi maydon uchun
        // xavfsiz qo'shimcha (yo'q bo'lsa hech narsa chiqmaydi).
        var verified = !!(u.premium || u.verified);
        var badge = verified
            ? '<span class="ig-sprof-badge" title="' + (u.premium ? 'Premium · tasdiqlangan' : 'Tasdiqlangan') + '"'
              + ' aria-label="' + (u.premium ? 'Premium · tasdiqlangan' : 'Tasdiqlangan') + '">'
              + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              + '<circle cx="12" cy="12" r="9"/><path d="m8.3 12.2 2.5 2.5 4.9-5.2"/></svg>'
              + (u.premium
                  ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.6 5.5 6 .9-4.3 4.2 1 5.9-5.3-2.8-5.3 2.8 1-5.9L3.4 9.2l6-.9z"/></svg>'
                  : '')
              + '</span>'
            : '';
        // "Kuzatilmoqda" yorlig'i: search API javobidagi `following` maydoni.
        var followed = u.following === true || u.following === 1;
        var followTag = followed
            ? '<span class="ig-sprof-follow">Kuzatilmoqda</span>'
            : '';

        // Bir xil ism bo'lsa ham @username ularni ajratib turadi. Username
        // yo'q bo'lsa ism ikki marta chiqmasligi kerak.
        return '<a class="ig-sprof" href="profile.php?user_id=' + (parseInt(u.id, 10) || 0) + '">'
             + '<span class="ig-sprof-av">' + av + '</span>'
             + '<span class="ig-sprof-info"><b>' + igEsc(handle || name || 'Foydalanuvchi') + badge + '</b>'
             + (handle && name ? '<span>' + igEsc(name) + '</span>' : '')
             + followTag + '</span>'
             + '</a>';
    }

    function igReelCard(r) {
        var poster = r.poster
            ? '<img src="' + igEsc(r.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '<div class="ig-sres-ph">Reels</div>';
        var who = r.author_username ? ('@' + r.author_username) : (r.author_name || '');
        return '<a class="ig-sres" href="reels.php?reel=' + (parseInt(r.id, 10) || 0) + '">'
             + '<div class="ig-sres-thumb">' + poster + '</div>'
             + '<div class="ig-sres-title">' + igEsc(r.title) + '</div>'
             + (who ? '<div class="ig-sres-sub">' + igEsc(who) + '</div>' : '')
             + '</a>';
    }

    function igSection(title, html) {
        if (!html) return '';
        return '<div class="ig-sres-sec"><div class="ig-sres-sec-h">' + title + '</div>' + html + '</div>';
    }

    // ================================================================
    //  JONLI TAKLIFLAR (faqat oddiy #igSearch oynasi; TV oynasiga tegmaydi)
    //  · ~300 ms debounce;
    //  · alohida token + AbortController — eski javob yangi natija ustiga
    //    yozilmaydi, shuningdek eski so'rov bekor qilinadi;
    //  · bitta /api/search.php so'rovi ishlatiladi (profil, kino, reels).
    // ================================================================
    function igSuggestHide() {
        if (suggestCtrl) {
            try { suggestCtrl.abort(); } catch (e) {}
            suggestCtrl = null;
        }
        igTokenSuggest.n++;
        if (searchSuggest) {
            searchSuggest.hidden = true;
            searchSuggest.innerHTML = '';
        }
    }

    function igSuggestRow(kind, item) {
        if (kind === 'profile') return igProfileCard(item);
        var isReel = kind === 'reel';
        var href = isReel
            ? 'reels.php?reel=' + (parseInt(item.id, 10) || 0)
            : 'watch.php?c=' + (parseInt(item.id, 10) || 0);
        var thumb = item.poster
            ? '<img src="' + igEsc(item.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '';
        var sub = isReel
            ? (item.author_username ? '@' + item.author_username : (item.author_name || 'Reels'))
            : (item.category || ('ID: ' + (parseInt(item.id, 10) || 0)));
        return '<a class="ig-sug-row" href="' + href + '">'
             + '<span class="ig-sres-thumb">' + thumb + '</span>'
             + '<span class="ig-sug-txt"><span class="ig-sres-title">' + igEsc(item.title || 'Reels') + '</span>'
             + '<span class="ig-sres-sub">' + igEsc(sub) + '</span></span></a>';
    }

    function igRunSuggest() {
        if (!searchInp || !searchSuggest) return;
        var q = searchInp.value.trim();
        var seq = ++igTokenSuggest.n;
        if (suggestCtrl) {
            try { suggestCtrl.abort(); } catch (e) {}
            suggestCtrl = null;
        }
        if (q.length < 2 && !/^\d+$/.test(q)) {
            searchSuggest.hidden = true;
            searchSuggest.innerHTML = '';
            return;
        }
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        suggestCtrl = ctrl;
        var opts = {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        };
        if (ctrl) opts.signal = ctrl.signal;
        fetch(igSearchBase() + '/api/search.php?limit=12&q=' + encodeURIComponent(q), opts)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                // Eski so'rov javobi kelsa — hech narsa o'zgartirmaymiz.
                if (seq !== igTokenSuggest.n || ctrl !== suggestCtrl) return;
                if (searchInp.value.trim() !== q) return;
                var profiles = (d && d.profiles) || [];
                var content  = (d && d.content) || [];
                var reels    = (d && d.reels) || [];
                var html = '';
                if (profiles.length) {
                    html += '<div class="ig-sug-h">Profillar</div>'
                          + profiles.slice(0, 4).map(function (u) { return igSuggestRow('profile', u); }).join('');
                }
                if (content.length) {
                    html += '<div class="ig-sug-h">Kinolar</div>'
                          + content.slice(0, 4).map(function (c) { return igSuggestRow('content', c); }).join('');
                }
                if (reels.length) {
                    html += '<div class="ig-sug-h">Reelslar</div>'
                          + reels.slice(0, 3).map(function (r) { return igSuggestRow('reel', r); }).join('');
                }
                searchSuggest.innerHTML = html;
                searchSuggest.hidden = !html;
            })
            .catch(function (e) {
                if (e && e.name === 'AbortError') return;
                if (seq !== igTokenSuggest.n) return;
                searchSuggest.hidden = true;
            });
    }

    /**
     * Qidiruv natijalarini yuklab, berilgan `grid` ichiga chizadi.
     *
     * Ikkala oyna — oddiy `.ig-search` (telefon/desktop) va TV `.tv-search` —
     * ham shu YAGONA funksiyadan foydalanadi: natija va tuzilma bir xil
     * bo'ladi, farq faqat chizilish uslubida.
     */
    function igSearchInto(q, grid, hint, token, onDone) {
        if (!grid) return;
        if (q.length < 2 && !/^\d+$/.test(q)) {
            grid.innerHTML = '';
            if (hint) {
                hint.hidden = false;
                hint.textContent = 'Qidirish uchun kamida 2 ta harf yozing';
            }
            if (typeof onDone === 'function') onDone(0);
            return;
        }
        if (hint) { hint.hidden = false; hint.textContent = 'Qidirilmoqda…'; }
        var seq = ++token.n;
        fetch(igSearchBase() + '/api/search.php?limit=12&q=' + encodeURIComponent(q), {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (seq !== token.n) return;
            var profiles = (d && d.profiles) || [];
            var content  = (d && d.content) || [];
            var reels    = (d && d.reels) || [];
            // Faqat asosiy oynada tur filtri ishlaydi; TV natijalari o'zgarishsiz.
            // Barcha ma'lumotlar BITTA so'rovdan olingan — qo'shimcha so'rov yo'q.
            if (token === igTokenSearch && igTypeFilter) {
                if (igTypeFilter === 'profiles') { content = []; reels = []; }
                else if (igTypeFilter === 'reels') { profiles = []; content = []; }
                else if (igTypeFilter === 'content') { profiles = []; reels = []; }
            }
            var html = '';
            if (profiles.length) {
                html += igSection('Profillar', profiles.map(igProfileCard).join(''));
            }
            if (content.length) {
                html += igSection('Kinolar', '<div class="ig-search-cards">' + content.map(igResultCard).join('') + '</div>');
            }
            if (reels.length) {
                html += igSection('Reelslar', '<div class="ig-search-cards">' + reels.map(igReelCard).join('') + '</div>');
            }
            grid.innerHTML = html;
            // TV'da har bir harfda emas, natija tanlanganda saqlanadi.
            if (token !== igTokenTv) igRecentSave(q);
            if (hint) {
                hint.hidden = (profiles.length + content.length + reels.length) > 0;
                hint.textContent = 'Natija topilmadi';
            }
            if (typeof onDone === 'function') {
                onDone(profiles.length + content.length + reels.length);
            }
        }).catch(function () {
            if (seq !== token.n) return;
            if (hint) {
                hint.hidden = false;
                hint.textContent = 'Qidirishda xatolik yuz berdi';
            }
        });
    }

    function igRunSearch() {
        if (!searchInp || !searchGrid) return;
        igSuggestHide();
        igSearchInto(searchInp.value.trim(), searchGrid, searchHint, igTokenSearch);
    }

    // ================================================================
    //  TV QIDIRUV — YouTube TV uslubi
    //  · ochilganda fokus avval KATTA maydonga tushadi (pult klaviaturasi
    //    shu yerga ochiladi) — xuddi YouTube TV kabi;
    //  · natijalar yozilayotgan so'zga qarab JONLI yangilanadi;
    //  · maydondan ↓ bosilsa natijalar orasiga o'tiladi, ↑ orqaga.
    // ================================================================
    function igTvOpenSearch() {
        if (!tvSearchBox) return;
        igCatOpen(false);
        tvSearchBox.hidden = false;
        document.body.style.overflow = 'hidden';
        if (tvSearchGrid) tvSearchGrid.innerHTML = '';
        if (tvSearchClear) tvSearchClear.hidden = true;
        if (tvSearchHint) {
            tvSearchHint.hidden = false;
            tvSearchHint.textContent = 'Qidirish uchun nom yozing — pultdagi klaviatura shu yerga ochiladi';
        }
        if (tvSearchInp) tvSearchInp.value = '';
        igTvBuildKb();
        igTvShowRecent();
        // Fokus birinchi tugmaga (YouTube TV kabi).
        setTimeout(function () { igTvFocusKey('.tv-key'); }, 40);
    }

    function igTvCloseSearch() {
        if (!tvSearchBox) return;
        tvSearchBox.hidden = true;
        document.body.style.overflow = '';
        // Fokusni "Qidiruv" bandiga qaytaramiz (pult bilan "orqaga" tabiiy).
        // Birinchi KO'RINADIGAN qidiruv tugmasiga qaytaramiz (mast faqat
        // kompyuterda, mobar faqat telefonda).
        var backs = document.querySelectorAll('[data-nav-search]');
        var back = null;
        for (var bi = 0; bi < backs.length; bi++) {
            if (backs[bi].getClientRects().length) { back = backs[bi]; break; }
        }
        if (back) {
            try { back.focus(); back.classList.add('tv-focus'); } catch (e) {}
        }
    }

    function igTvRunSearch() {
        if (!tvSearchInp) return;
        var q = tvSearchInp.value.trim();
        if (tvSearchClear) tvSearchClear.hidden = !q;
        if (!q) { igTvShowRecent(); return; }
        var hadFocusInGrid = !!(tvSearchGrid && tvSearchGrid.contains(document.activeElement));
        igSearchInto(q, tvSearchGrid, tvSearchHint, igTokenTv, function (total) {
            if (!total) return;
            // DOM qayta chizildi — fokus natijada bo'lgan bo'lsa uni birinchi
            // natijaga qaytamiz; aks holda maydonda qolamiz.
            var first = tvSearchGrid.querySelector('a.ig-sres, a.ig-sprof');
            if (hadFocusInGrid && first) {
                try { first.focus(); first.classList.add('tv-focus'); } catch (e) {}
            } else if (!hadFocusInGrid && (document.activeElement === document.body || !document.activeElement)) {
                igTvFocusKey('.tv-key');
            }
        });
    }

    // ================================================================
    //  TV EKRAN KLAVIATURASI (YouTube TV uslubi)
    //  9 ustunli tugmalar to'ri: a-z + ʻ, 1-9, 0 - [bo'sh joy] [o'chirish] [tozalash].
    //  Pult strelkalari tugmalar orasida yuradi (tv-mode.js), OK - harf yozadi.
    //  Oddiy klaviatura ham ishlaydi (kompyuterda sinash uchun).
    // ================================================================
    var tvKb = document.getElementById('tvKb');

    function igTvBuildKb() {
        if (!tvKb || tvKb.childElementCount) return;
        var h = '';
        function key(label, val, cls, aria) {
            return '<button type="button" class="tv-key' + (cls ? ' ' + cls : '') + '" data-k="' + val + '"'
                 + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
        }
        'abcdefghijklmnopqrstuvwxyz'.split('').forEach(function (c) { h += key(c, c); });
        h += key('\u02bb', '\u02bb', '', 'Apostrof');
        '123456789'.split('').forEach(function (c) { h += key(c, c); });
        h += key('0', '0');
        h += key('-', '-');
        h += key('Bo\u2018sh joy', 'space', 'tv-key-space', 'Bo\u2018sh joy');
        h += key('\u232b', 'back', 'tv-key-wide', 'O\u2018chirish');
        h += key('\u2715', 'clear', '', 'Tozalash');
        tvKb.innerHTML = h;
    }

    function igTvFocusKey(sel) {
        var k = tvKb && tvKb.querySelector(sel || '.tv-key');
        if (k) { try { k.focus(); k.classList.add('tv-focus'); } catch (e) {} }
    }

    function igTvType(k) {
        if (!tvSearchInp) return;
        var v = tvSearchInp.value;
        if (k === 'back')       { v = v.slice(0, -1); }
        else if (k === 'clear') { v = ''; }
        else if (k === 'space') { if (!v || /\s$/.test(v)) return; v += ' '; }
        else { if (v.length >= 60) return; v += k; }
        tvSearchInp.value = v;
        if (tvSearchClear) tvSearchClear.hidden = !v;
        clearTimeout(tvSearchTimer);
        tvSearchTimer = setTimeout(igTvRunSearch, 280);
    }

    /** Qidiruv bo'sh bo'lganda: so'nggi qidiruvlar (yoki ko'rsatma). */
    function igTvShowRecent() {
        igTokenTv.n++;                       // yo'ldagi eski javobni bekor qilamiz
        if (!tvSearchGrid) return;
        var a = igRecentRead();
        if (!a.length) {
            tvSearchGrid.innerHTML = '';
            if (tvSearchHint) {
                tvSearchHint.hidden = false;
                tvSearchHint.textContent = 'Qidirish uchun chapdagi klaviaturadan nom yozing';
            }
            return;
        }
        if (tvSearchHint) tvSearchHint.hidden = true;
        tvSearchGrid.innerHTML = '<div class="ig-sres-sec"><div class="ig-sres-sec-h">So\u2018nggi qidiruvlar</div>'
            + '<div class="tv-recent">' + a.map(function (q) {
                return '<button type="button" class="tv-recent-item" data-recent="' + igEsc(q) + '">' + igEsc(q) + '</button>';
            }).join('') + '</div></div>';
    }

    if (tvKb) {
        igTvBuildKb();
        tvKb.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('[data-k]') : null;
            if (b) igTvType(b.getAttribute('data-k'));
        });
    }
    if (tvSearchGrid) {
        tvSearchGrid.addEventListener('click', function (e) {
            var t = e.target.closest ? e.target : null;
            if (!t) return;
            var r = t.closest('[data-recent]');
            if (r) {
                if (tvSearchInp) tvSearchInp.value = r.getAttribute('data-recent') || '';
                clearTimeout(tvSearchTimer);
                igTvRunSearch();
                return;
            }
            // Natija tanlandi - so'rovni "so'nggi qidiruvlar"ga saqlaymiz.
            if (t.closest('a.ig-sres, a.ig-sprof') && tvSearchInp) igRecentSave(tvSearchInp.value);
        });
    }

    // Oddiy klaviatura (kompyuterda sinash / USB klaviatura): harf yozadi.
    // `window` + capture — tv-mode.js dagi Space/Enter ishlovidan OLDIN ishlaydi.
    window.addEventListener('keydown', function (e) {
        if (!tvSearchBox || tvSearchBox.hidden) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var k = e.key, t = null;
        if (k === 'Backspace') {
            // Bo'sh bo'lsa - qidiruvdan chiqish (pultdagi "orqaga" ham shu).
            if (tvSearchInp && !tvSearchInp.value) { igTvCloseSearch(); e.preventDefault(); e.stopPropagation(); return; }
            t = 'back';
        } else if (k === ' ' || k === 'Spacebar') {
            t = 'space';
        } else if (k && k.length === 1) {
            if (k === "'" || k === '\u2019' || k === '\u2018' || k === '`') t = '\u02bb';
            else if (/^[\p{L}\p{N}\u02bb\-]$/u.test(k)) t = k.toLowerCase();
        }
        if (!t) return;
        igTvType(t);
        e.preventDefault();
        e.stopPropagation();
    }, true);
    // Bo'sh joy tugmasi fokusdagi tugmani "bosib" yubormasligi uchun.
    window.addEventListener('keyup', function (e) {
        if (tvSearchBox && !tvSearchBox.hidden && (e.key === ' ' || e.key === 'Spacebar')) e.preventDefault();
    }, true);

    if (tvSearchInp) {
        tvSearchInp.addEventListener('input', function () {
            clearTimeout(tvSearchTimer);
            tvSearchTimer = setTimeout(igTvRunSearch, 250);
        });
        tvSearchInp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                clearTimeout(tvSearchTimer);
                igTvRunSearch();
                e.preventDefault();
                return;
            }
            // ↓ — natijalar orasiga o'tish (YouTube TV kabi).
            if (e.key === 'ArrowDown') {
                var first = tvSearchGrid && tvSearchGrid.querySelector('a.ig-sres, a.ig-sprof');
                if (first) {
                    try { first.focus(); first.classList.add('tv-focus'); } catch (err) {}
                    e.preventDefault();
                }
                return;
            }
            if (e.key === 'Escape') {
                igTvCloseSearch();
                e.preventDefault();
            }
        });
    }
    if (tvSearchGrid) {
        tvSearchGrid.addEventListener('keydown', function (e) {
            // ↑ — maydonga qaytish.
            if (e.key === 'ArrowUp' && tvSearchInp) {
                try { tvSearchInp.focus(); tvSearchInp.classList.add('tv-focus'); } catch (err) {}
                e.preventDefault();
            }
        });
    }
    if (tvSearchClear) {
        tvSearchClear.addEventListener('click', function () {
            if (!tvSearchInp) return;
            tvSearchInp.value = '';
            tvSearchClear.hidden = true;
            igTvRunSearch();
            igTvFocusKey('.tv-key');
        });
    }
    if (tvSearchBack) {
        tvSearchBack.addEventListener('click', igTvCloseSearch);
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && tvSearchBox && !tvSearchBox.hidden) igTvCloseSearch();
    });

    if (searchInp) {
        // Yozish paytida FAQAT jonli takliflar (~300 ms). To'liq natijalar
        // Enter yoki filtr tugmasi bosilganda chiziladi — ikki marta so'rov
        // yuborilmaydi, eski natija ustiga yozilmaydi.
        searchInp.addEventListener('input', function () {
            clearTimeout(searchTimer);
            clearTimeout(suggestTimer);
            suggestTimer = setTimeout(igRunSuggest, 300);
        });
        searchInp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                clearTimeout(suggestTimer);
                clearTimeout(searchTimer);
                igRunSearch();
            }
        });
    }
    if (searchSuggest) {
        searchSuggest.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('a')) {
                clearTimeout(suggestTimer);
                igRecentSave(searchInp ? searchInp.value.trim() : '');
                igSuggestHide();
            }
        });
    }
    if (searchX) searchX.addEventListener('click', igCloseSearch);
    // YouTube uslubidagi kichik panel: tashqarisiga bosilganda yopiladi.
    // Qidiruv tugmasi ustiga bosilganda esa ochilgach darhol yopilib qolmasligi
    // uchun uni istisno qilamiz (`[data-nav-search]` o'zi ochadi).
    document.addEventListener('click', function (e) {
        if (!searchBox || searchBox.hidden) return;
        if (searchBox.contains(e.target)) return;
        if (e.target.closest && e.target.closest('[data-nav-search]')) return;
        igCloseSearch();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && searchBox && !searchBox.hidden) igCloseSearch();
    });

    document.querySelectorAll('[data-nav-search]').forEach(function (a) {
        a.addEventListener('click', function (e) {
            e.preventDefault();
            igOpenSearch();
        });
    });
});
</script>
<script src="assets/js/tv-mode.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/tv-mode.js') ?: 1; ?>"></script>
<?php /* Bitta badge so'rovi: notifications + DM. 15/30 s lik ikki poller
        o'rniga bitta so'rov va kesh; video o'ynayotganda deyarli so'rov yo'q.
        notifications.js / dm-badge.js dan OLDIN yuklanishi shart. */ ?>
<script src="assets/js/badge-poll.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/badge-poll.js') ?: 1; ?>"></script>
<script src="assets/js/notifications.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/notifications.js') ?: 1; ?>"></script>
<script src="assets/js/dm-badge.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/dm-badge.js') ?: 1; ?>"></script>
<script src="assets/js/donate.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/donate.js') ?: 1; ?>"></script>
<script src="assets/js/feedback.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/feedback.js') ?: 1; ?>"></script>
<?php /* perf-head.php bor sahifalarda e'lon skripti allaqachon header'da. */ ?>
<?php if (empty($GLOBALS['WC_PERF_HEAD'])): ?>
<script defer src="assets/js/site-banner.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/site-banner.js') ?: 1; ?>"></script>
<?php endif; ?>
<?php /* Eski `tv.js` spatial navigatsiyasi `tv-mode.js` ichiga ko'chirildi. */ ?>
<?php /* Doimiy MTProto ulanishi: barcha foydalanuvchi sahifalarida bitta klient
        tirik turadi. Ikki marta yuklanishning oldini `tg-persist.php` ichidagi
        DOMContentLoaded tekshiruvi oladi (asosiy sahifalarda TgStream bor). */ ?>
<?php require __DIR__ . '/tg-persist.php'; ?>
