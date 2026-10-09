<?php
// ============================================================================
// includes/nav.php - YouTube TV uslubidagi navigatsiya qobig'i
// ============================================================================
//   KATTA EKRAN (>=1000px): chap yon panel (mini guide)
//     Sichqoncha/fokus panelga kirsa — kengayadi, chiqsa — yig'iladi.
//     Tartib (tepadan pastga):
//       Profil · Qidiruv · Bosh sahifa · Reels · Chat · Kino · Animelar ·
//       Multfilmlar · Kutubxona · Bildirishnomalar
//
//   TELEFON  (<1000px): yuqori panel + pastki panel
//     Pastki panel: Bosh sahifa · Reels · Chat · Qidiruv · Profil
//
//   TV REJIMI (html.tv): pult bilan boshqarishga moslashgan katta interfeys.
//     Avtomatik aniqlanadi yoki `assets/js/tv-mode.js` orqali yoqiladi (`?tv=1`).
//
// Sahifalar qo'ng'iroqdan OLDIN $NAV_ACTIVE o'rnatishi mumkin:
//   'home', 'reels', 'chat', 'upload', 'profile', 'notifications',
//   'saved', 'liked', 'history', 'later', 'search'
// ============================================================================

if (!isset($NAV_ACTIVE)) { $NAV_ACTIVE = ''; }

// Ishtirokchi foydalanuvchi uchun havolalar
$igIsAdmin  = $auth->isAdmin();
// Admin panel sahifalarida admin KALITI bilan kirgan bo'lsa, Telegram (MTProto)
// guard'ini o'tkazib yuboramiz — panel kalit bilan ishlaydi. Oddiy sayt
// sahifalarida esa guard avvalgidek qoladi.
$igAdminPage = in_array(basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')), ['admin-content.php', 'admin-reels.php'], true);
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
$igName = $igLogged ? ($user['first_name'] ?? 'Profil') : 'Profil';

// Kategoriyalar (chap panel bandlari). Bazaga yangi kategoriya qo'shilsa,
// u ham avtomatik paydo bo'ladi.
$igCats = [];
try { $igCats = $catalog->getCategories(); } catch (Exception $e) { $igCats = []; }
$igCatOrder = ['kino', 'film', 'anime', 'multfilm', 'multflim', 'serial', 'dokumental', 'dokument'];
usort($igCats, function ($a, $b) use ($igCatOrder) {
    $ia = array_search($a['slug'] ?? '', $igCatOrder, true);
    $ib = array_search($b['slug'] ?? '', $igCatOrder, true);
    $ia = $ia === false ? 999 : $ia;
    $ib = $ib === false ? 999 : $ib;
    return $ia - $ib;
});
$igActiveCat = isset($_GET['cat']) ? (string) $_GET['cat'] : '';

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
        'search'   => '<circle cx="10.8" cy="10.8" r="6.6"/><line x1="15.6" y1="15.6" x2="21" y2="21"/>',
        'home'     => '<path d="M3.8 10.4 12 3.7l8.2 6.7V19a1.7 1.7 0 0 1-1.7 1.7h-3.2v-6H8.7v6H5.5A1.7 1.7 0 0 1 3.8 19z"/>',
        'film'     => '<path fill-rule="evenodd" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm6 4.3v7.4l6-3.7z"/>',
        'movie'    => '<path fill-rule="evenodd" d="M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zm5 4.2v6.6l5.6-3.3z"/>',
        'reels'    => '<path fill-rule="evenodd" d="M7.4 3h9.2A4.4 4.4 0 0 1 21 7.4v9.2a4.4 4.4 0 0 1-4.4 4.4H7.4A4.4 4.4 0 0 1 3 16.6V7.4A4.4 4.4 0 0 1 7.4 3zm3.2 6.2v5.6l4.7-2.8z"/><path d="M3.2 8.4h17.6"/><path d="M8.1 3.2 11 8.4M15.1 3.2 18 8.4"/>',
        // Chat — Telegram'ga o'xshash samolyotcha, saytning kontur uslubida.
        'chat'     => '<path d="M21.3 4.3 3.2 11.4a.55.55 0 0 0 .06 1.04l4.6 1.45 1.45 4.6a.55.55 0 0 0 1.04.06L21.3 4.3z"/><path d="M7.86 13.89 21.3 4.3"/>',
        'library'  => '<path d="M12 6.4C10.5 5 8.3 4.4 5.7 4.7a1.1 1.1 0 0 0-1 1.1v11.9a1.1 1.1 0 0 0 1.2 1.1c2.3-.2 4.3.3 6.1 1.5 1.8-1.2 3.8-1.7 6.1-1.5a1.1 1.1 0 0 0 1.2-1.1V5.8a1.1 1.1 0 0 0-1-1.1c-2.6-.3-4.8.3-6.3 1.7z"/><path d="M12 6.4v13.8"/>',
        'history'  => '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 1.9"/>',
        'clock'    => '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 1.9"/>',
        'like'     => '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
        'heart'    => '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
        'thumbUp'  => '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
        'thumbDown'=> '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>',
        'send'     => '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
        'list'     => '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
        'camera'   => '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
        'trash'    => '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        'check'    => '<path d="M20 6 9 17l-5-5"/>',
        'close'    => '<path d="M18 6 6 18M6 6l12 12"/>',
        'back'     => '<path d="M15 5l-7 7 7 7"/>',
        'edit'     => '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
        'logout'   => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
        'download' => '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
        'image'    => '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
        'play'     => '<polygon points="6 3 20 12 6 21 6 3"/>',
        'bookmark' => '<path d="M6.6 4.5h10.8a.8.8 0 0 1 .8.8V20l-6.2-4.1L5.8 20V5.3a.8.8 0 0 1 .8-.8z"/>',
        'bell'     => '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
        'folder'   => '<path d="M3.6 6.6a1.6 1.6 0 0 1 1.6-1.6h4l2 2.2h7.6a1.6 1.6 0 0 1 1.6 1.6v9.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z"/>',
        'settings' => '<path style="fill:none" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle style="fill:none" cx="12" cy="12" r="3"/>',
        'anime'    => '<path d="M12 3.5l2 5.2 5.2 2-5.2 2-2 5.2-2-5.2L4.8 10.7l5.2-2z"/><path d="M18.7 15.4l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
        'smile'    => '<circle style="fill:none" cx="12" cy="12" r="8.2"/><path style="fill:none" d="M8.3 14a4.4 4.4 0 0 0 7.4 0"/><circle cx="9.2" cy="9.9" r="1.15" style="fill:currentColor;stroke:none"/><circle cx="14.8" cy="9.9" r="1.15" style="fill:currentColor;stroke:none"/>',
        'tv'       => '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8.2 3.6 12 6.8l3.8-3.2"/>',
        'globe'    => '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.5 2.4 2.5 13.9 0 16.4M12 3.8c-2.5 2.4-2.5 13.9 0 16.4"/>',
        'tag'      => '<path d="M4 4h7.2l8.8 8.8-7.2 7.2L4 11.2z"/><circle cx="8.2" cy="8.2" r="1.2" style="fill:currentColor;stroke:none"/>',
        'plus'     => '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        'user'     => '<circle cx="12" cy="8.4" r="3.4"/><path d="M5.4 19.4a6.6 6.6 0 0 1 13.2 0"/>',
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
         . '<span class="ig-txt">' . $label . '</span></a>';
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
    location.replace(<?php echo json_encode($tgBase); ?> + '/tg-login.php?next=' + encodeURIComponent(here));
<?php endif; ?>
  } catch (e) {}
})();
</script>
<!-- ============================== Desktop: yon panel ============================== -->
<aside class="ig-side" id="igSide">
    <a class="ig-brand" href="index.php">
        <?php echo wc_logo_img(SITE_NAME, 'width="32" height="32"'); ?>
        <span class="ig-brand-text"><?php echo htmlspecialchars(SITE_NAME); ?></span>
    </a>

    <nav class="ig-nav">
        <!-- Profil (eng yuqorida) -->
        <a class="ig-item ig-profile-top<?php echo $NAV_ACTIVE === 'profile' ? ' active' : ''; ?>"
           href="<?php echo $igProfileH; ?>" title="Profil">
            <span class="ig-ico"><?php echo $igAvatar; ?></span>
            <span class="ig-txt"><?php echo esc($igName); ?></span>
        </a>

        <!-- Qidiruv -->
        <a class="ig-item<?php echo $NAV_ACTIVE === 'search' ? ' active' : ''; ?>"
           href="index.php" data-nav-search="1" title="Qidiruv">
            <span class="ig-ico"><?php echo ig_svg('search'); ?></span><span class="ig-txt">Qidiruv</span>
        </a>

        <!-- Bosh sahifa -->
        <?php echo ig_item('index.php', 'home', 'home', 'Bosh sahifa', $NAV_ACTIVE); ?>

        <!-- Reels -->
        <?php echo ig_item('reels.php', 'reels', 'reels', 'Reels', $NAV_ACTIVE); ?>

        <!-- Chat -->
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
            <?php echo ig_item('saved.php', 'later', 'clock', 'Keyinroq ko‘rish', $NAV_ACTIVE); ?>
        </div>

        <!-- Bildirishnomalar -->
        <?php echo ig_item('notifications.php', 'notifications', 'bell', 'Bildirishnomalar', $NAV_ACTIVE); ?>

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

<!-- ============================== Telefon: yuqori panel ============================== -->
<header class="ig-mobar">
    <a class="ig-mobar-brand" href="index.php"><?php echo wc_logo_img(SITE_NAME, 'width="32" height="32"'); ?><span><?php echo htmlspecialchars(SITE_NAME); ?></span></a>
    <div class="ig-mobar-actions">
        <?php /* Telefonda qidiruv yuqoridagi panelda emas - faqat pastki
                navigatsiyada (Instagram uslubidagi markaziy "Qidiruv"). */ ?>
        <a class="ig-mobar-btn" href="notifications.php" aria-label="Bildirishnomalar"><?php echo ig_svg('bell'); ?></a>
        <button class="ig-mobar-btn" id="igMoreBtnM" type="button" aria-label="Sozlamalar"><?php echo ig_svg('settings'); ?></button>
    </div>
</header>

<!-- ============================== Telefon: pastki panel ============================== -->
<!-- Instagram tartibi: Bosh sahifa | Reels | Chat(markazda) | Qidiruv | Profil -->
<nav class="ig-tabbar">
    <a href="index.php" class="<?php echo $NAV_ACTIVE === 'home' ? 'active' : ''; ?>" aria-label="Bosh sahifa"><?php echo ig_svg('home'); ?></a>
    <a href="reels.php" class="<?php echo $NAV_ACTIVE === 'reels' ? 'active' : ''; ?>" aria-label="Reels"><?php echo ig_svg('reels'); ?></a>
    <a href="chat.php" class="<?php echo $NAV_ACTIVE === 'chat' ? 'active' : ''; ?>" aria-label="Chat"><?php echo ig_svg('chat'); ?><span class="ig-ntf-badge ig-tab-badge" id="igChatBadgeM" hidden></span></a>
    <a href="index.php" data-nav-search="1" aria-label="Qidiruv" class="<?php echo $NAV_ACTIVE === 'search' ? 'active' : ''; ?>"><?php echo ig_svg('search'); ?></a>
    <a href="<?php echo $igProfileH; ?>" class="ig-tab-profile <?php echo $NAV_ACTIVE === 'profile' ? 'active' : ''; ?>" aria-label="Profil"><?php echo $igAvatar; ?></a>
</nav>

<!-- ============================== Qidiruv oynasi (alohida) ============================== -->
<div class="ig-search" id="igSearch" hidden>
    <div class="ig-search-bar">
        <span class="ig-search-ico"><?php echo ig_svg('search'); ?></span>
        <input id="igSearchInput" type="search" placeholder="Qidirish" autocomplete="off">
        <button class="ig-search-close" id="igSearchClose" type="button" aria-label="Yopish"><?php echo ig_svg('back'); ?></button>
    </div>
    <div class="ig-search-body">
        <div class="ig-search-hint" id="igSearchHint">Qidirish uchun nom yozing</div>
        <div class="ig-search-grid" id="igSearchGrid"></div>
    </div>
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
                <a class="ig-set-row" href="settings.php">
                    <span class="ig-set-ico"><?php echo ig_svg('settings'); ?></span>
                    <span class="ig-set-txt">Maxfiylik va bloklar</span>
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
                <a class="ig-set-row" href="https://t.me/<?php echo htmlspecialchars(TELEGRAM_BOT_USERNAME); ?>" target="_blank" rel="noopener">
                    <span class="ig-set-ico"><?php echo ig_svg('globe'); ?></span>
                    <span class="ig-set-txt">Bot&#8217;ga o&#8217;tish</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
            </div>

            <?php if ($igLogged): ?>
            <div class="ig-set-group">
                <a class="ig-set-row danger" href="logout.php">
                    <span class="ig-set-ico"><?php echo ig_svg('user'); ?></span>
                    <span class="ig-set-txt">Chiqish</span>
                </a>
            </div>
            <?php endif; ?>

        </div>
    </div>
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
            location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/tg-login.php');
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
    if (setClose) setClose.addEventListener('click', function () { igSettingsOpen(false); });
    if (setPanel) setPanel.addEventListener('click', function (e) {
        // Fon (panel tashqarisi) bosilsa yopiladi.
        if (e.target === setPanel) igSettingsOpen(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && setPanel && !setPanel.hidden) igSettingsOpen(false);
    });

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
    var searchHint = document.getElementById('igSearchHint');
    var searchX    = document.getElementById('igSearchClose');
    var searchTimer = null;
    var igSearchSeq = 0;

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
        if (!searchBox) return;
        searchBox.hidden = false;
        document.body.style.overflow = 'hidden';
        if (searchInp) setTimeout(function () { searchInp.focus(); }, 30);
    }

    function igCloseSearch() {
        if (!searchBox) return;
        searchBox.hidden = true;
        document.body.style.overflow = '';
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
        var av = u.avatar
            ? '<img src="' + igEsc(u.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '<span class="ig-sprof-ph">' + igEsc((u.first_name || '?').charAt(0).toUpperCase()) + '</span>';
        return '<a class="ig-sprof" href="profile.php?user_id=' + (parseInt(u.id, 10) || 0) + '">'
             + '<span class="ig-sprof-av">' + av + '</span>'
             + '<span class="ig-sprof-info"><b>' + igEsc(u.username ? ('@' + u.username) : name) + '</b>'
             + '<span>' + igEsc(name) + '</span></span>'
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

    function igRunSearch() {
        if (!searchInp || !searchGrid) return;
        var q = searchInp.value.trim();
        if (q.length < 2 && !/^\d+$/.test(q)) {
            searchGrid.innerHTML = '';
            if (searchHint) {
                searchHint.hidden = false;
                searchHint.textContent = 'Qidirish uchun kamida 2 ta harf yozing';
            }
            return;
        }
        if (searchHint) { searchHint.hidden = false; searchHint.textContent = 'Qidirilmoqda…'; }
        var seq = ++igSearchSeq;
        fetch(igSearchBase() + '/api/search.php?limit=12&q=' + encodeURIComponent(q), {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (seq !== igSearchSeq) return;
            var profiles = (d && d.profiles) || [];
            var content  = (d && d.content) || [];
            var reels    = (d && d.reels) || [];
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
            searchGrid.innerHTML = html;
            if (searchHint) {
                searchHint.hidden = (profiles.length + content.length + reels.length) > 0;
                searchHint.textContent = 'Natija topilmadi';
            }
        }).catch(function () {
            if (seq !== igSearchSeq) return;
            if (searchHint) {
                searchHint.hidden = false;
                searchHint.textContent = 'Qidirishda xatolik yuz berdi';
            }
        });
    }

    if (searchInp) {
        searchInp.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(igRunSearch, 300);
        });
        searchInp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { clearTimeout(searchTimer); igRunSearch(); }
        });
    }
    if (searchX) searchX.addEventListener('click', igCloseSearch);
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
<script src="assets/js/notifications.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/notifications.js') ?: 1; ?>"></script>
<script src="assets/js/dm-badge.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/dm-badge.js') ?: 1; ?>"></script>
<?php /* Eski `tv.js` spatial navigatsiyasi `tv-mode.js` ichiga ko'chirildi. */ ?>
