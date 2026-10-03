<?php
// ============================================================================
// includes/nav.php - YouTube TV uslubidagi navigatsiya qobig'i
// ============================================================================
//   KATTA EKRAN (>=1000px): chap yon panel (mini guide)
//     Sichqoncha/fokus panelga kirsa — kengayadi, chiqsa — yig'iladi.
//     Tartib (tepadan pastga):
//       Profil · Qidiruv · Bosh sahifa · Reels · Kino · Animelar ·
//       Multfilmlar · Kutubxona · Bildirishnomalar
//
//   TELEFON  (<1000px): yuqori panel + pastki panel
//
//   TV REJIMI (html.tv): pult bilan boshqarishga moslashgan katta interfeys.
//     Avtomatik aniqlanadi yoki `assets/js/tv.js` orqali yoqiladi.
//
// Sahifalar qo'ng'iroqdan OLDIN $NAV_ACTIVE o'rnatishi mumkin:
//   'home', 'reels', 'upload', 'profile', 'notifications',
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
        'search'   => '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
        'home'     => '<path d="M4 10.7 12 4l8 6.7V19a1.3 1.3 0 0 1-1.3 1.3h-3.6v-5.4H8.9v5.4H5.3A1.3 1.3 0 0 1 4 19z"/>',
        'film'     => '<path fill-rule="evenodd" d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm6 4.3v7.4l6-3.7z"/>',
        'movie'    => '<path fill-rule="evenodd" d="M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zm5 4.2v6.6l5.6-3.3z"/>',
        'reels'    => '<path fill-rule="evenodd" d="M5.2 9.4h13.6a2 2 0 0 1 2 2v6.4a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2v-6.4a2 2 0 0 1 2-2zm5.1 2.6v5.4l5-2.7z"/><path d="M4.4 4h13.2l-1.8 3.6H2.6z"/>',
        'library'  => '<rect x="4" y="4.5" width="4.6" height="15" rx="1"/><rect x="10" y="4.5" width="4.6" height="15" rx="1"/><path d="M15.6 5.6l3.1 13.6a1 1 0 0 0 1.2.8l1.1-.3"/>',
        'history'  => '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 1.9"/>',
        'clock'    => '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 1.9"/>',
        'like'     => '<path d="M7.3 10.3v9.5H5a1.2 1.2 0 0 1-1.2-1.2v-7.1A1.2 1.2 0 0 1 5 10.3z"/><path d="M7.3 10.3 11 3.8a1.9 1.9 0 0 1 1.9 2.3l-.8 3.4h4.7a1.9 1.9 0 0 1 1.9 2.3l-1.3 5.9a1.9 1.9 0 0 1-1.9 1.5H7.3"/>',
        'bookmark' => '<path d="M6.6 4.5h10.8a.8.8 0 0 1 .8.8V20l-6.2-4.1L5.8 20V5.3a.8.8 0 0 1 .8-.8z"/>',
        'bell'     => '<path d="M6.6 16.6V11a5.4 5.4 0 0 1 10.8 0v5.6l1.7 2.1H4.9z"/><path d="M9.9 20.3a2.1 2.1 0 0 0 4.2 0"/>',
        'folder'   => '<path d="M3.6 6.6a1.6 1.6 0 0 1 1.6-1.6h4l2 2.2h7.6a1.6 1.6 0 0 1 1.6 1.6v9.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z"/>',
        'settings' => '<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9.5" cy="7" r="2.2"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="14.5" cy="17" r="2.2"/><line x1="4" y1="12" x2="20" y2="12"/>',
        'anime'    => '<path d="M12 3.5l2 5.2 5.2 2-5.2 2-2 5.2-2-5.2L4.8 10.7l5.2-2z"/><path d="M18.7 15.4l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
        'smile'    => '<circle cx="12" cy="12" r="8.2"/><path d="M8.6 14.2a4 4 0 0 0 6.8 0"/><circle cx="9.3" cy="10" r="1.1" style="fill:currentColor;stroke:none"/><circle cx="14.7" cy="10" r="1.1" style="fill:currentColor;stroke:none"/>',
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
?>
<script>
(function () {
  // ------------------------------------------------------------------
  // 1) TV REJIMINI ANIQLASH (pult bilan boshqarish uchun)
  //    - `?tv=1` / `?tv=0` bilan majburan yoqish/o'chirish
  //    - `localStorage['wc_tv_mode']` eslab qolinadi
  //    - aks holda TV user-agent avtomatik aniqlanadi
  // ------------------------------------------------------------------
  try {
    var p = new URLSearchParams(location.search);
    var forced = p.get('tv');
    var saved = null;
    try { saved = localStorage.getItem('wc_tv_mode'); } catch (e) {}
    var ua = navigator.userAgent || '';
    var isTv = /(SmartTV|Tizen|Web0S|WebOS|NetCast|BRAVIA|HbbTV|PlayStation|Xbox|Roku|AppleTV|Android TV|GoogleTV|AFT[BMN]|CrKey)/i.test(ua);
    var on = (forced === '1') ? true
           : (forced === '0') ? false
           : (saved === '1' ? true : (saved === '0' ? false : isTv));
    if (on) document.documentElement.classList.add('tv');
  } catch (e) {}

  // ------------------------------------------------------------------
  // 2) TELEGRAM KIRISH HIMOYASI (guard)
  //    Kalit faqat brauzer localStorage'ida. Bo'lmasa — login sahifasi.
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
        <img class="ig-logo" src="assets/img/logo.png?v=<?php echo @filemtime(__DIR__ . '/../assets/img/logo.png') ?: 1; ?>" alt="<?php echo htmlspecialchars(SITE_NAME); ?>" width="32" height="32">
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
            <span><img src="assets/img/logo.png?v=<?php echo @filemtime(__DIR__ . '/../assets/img/logo.png') ?: 1; ?>" alt="" width="14" height="14" style="object-fit:contain;vertical-align:-2px;margin-right:4px">W CINEMA</span>
        </div>
    </div>
</aside>

<!-- ============================== Telefon: yuqori panel ============================== -->
<header class="ig-mobar">
    <a class="ig-mobar-brand" href="index.php"><img class="ig-logo" src="assets/img/logo.png?v=<?php echo @filemtime(__DIR__ . '/../assets/img/logo.png') ?: 1; ?>" alt="<?php echo htmlspecialchars(SITE_NAME); ?>" width="32" height="32"><span><?php echo htmlspecialchars(SITE_NAME); ?></span></a>
    <div class="ig-mobar-actions">
        <a class="ig-mobar-btn" href="index.php" data-nav-search="1" aria-label="Qidiruv"><?php echo ig_svg('search'); ?></a>
        <a class="ig-mobar-btn" href="notifications.php" aria-label="Bildirishnomalar"><?php echo ig_svg('bell'); ?></a>
        <button class="ig-mobar-btn" id="igMoreBtnM" type="button" aria-label="Sozlamalar"><?php echo ig_svg('settings'); ?></button>
    </div>
</header>

<!-- ============================== Telefon: pastki panel ============================== -->
<nav class="ig-tabbar">
    <a href="index.php" class="<?php echo $NAV_ACTIVE === 'home' ? 'active' : ''; ?>" aria-label="Bosh sahifa"><?php echo ig_svg('home'); ?></a>
    <a href="index.php" data-nav-search="1" aria-label="Qidiruv" class="<?php echo $NAV_ACTIVE === 'search' ? 'active' : ''; ?>"><?php echo ig_svg('search'); ?></a>
    <a href="reels.php" class="ig-tab-create <?php echo $NAV_ACTIVE === 'reels' ? 'active' : ''; ?>" aria-label="Reels"><?php echo ig_svg('reels'); ?></a>
    <a href="<?php echo $igCreateH; ?>" aria-label="Yaratish"><?php echo ig_svg('plus'); ?></a>
    <a href="<?php echo $igProfileH; ?>" class="ig-tab-profile <?php echo $NAV_ACTIVE === 'profile' ? 'active' : ''; ?>" aria-label="Profil"><?php echo $igAvatar; ?></a>
</nav>

<!-- ============================== Qidiruv oynasi (alohida) ============================== -->
<div class="ig-search" id="igSearch" hidden>
    <div class="ig-search-bar">
        <span class="ig-search-ico"><?php echo ig_svg('search'); ?></span>
        <input id="igSearchInput" type="search" placeholder="Qidirish" autocomplete="off">
        <button class="ig-search-close" id="igSearchClose" type="button" aria-label="Yopish">&larr;</button>
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
                    <span class="ig-set-txt">Reels yuklash</span>
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
                <div class="ig-set-label">Telegram</div>
                <a class="ig-set-row" href="https://t.me/<?php echo htmlspecialchars(TELEGRAM_BOT_USERNAME); ?>" target="_blank" rel="noopener">
                    <span class="ig-set-ico"><?php echo ig_svg('globe'); ?></span>
                    <span class="ig-set-txt">Bot&#8217;ga o&#8217;tish</span>
                    <span class="ig-set-arrow">&rsaquo;</span>
                </a>
                <button class="ig-set-row" id="tgReauthLink" type="button">
                    <span class="ig-set-ico"><?php echo ig_svg('tag'); ?></span>
                    <span class="ig-set-txt">Telegramdan chiqish</span>
                </button>
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

<script>
// DIQQAT: bu skript sahifaning YUQORI qismida turadi, shuning uchun hamma
// ish `DOMContentLoaded` ichida bajariladi (`tv.js` esa alohida yuklanadi).
window.addEventListener('DOMContentLoaded', function () {
    var TG_KEY = 'wc_mtproto_auth_v1';

    // Telegram profil rasmi (TgStream saqlagan data-URL) avatar o'rniga
    // qo'yiladi — chap paneldagi va pastki paneldagi profil tugmalarida.
    function igApplyPhoto() {
        var ph = null;
        try { ph = localStorage.getItem('wc_tg_photo_v1'); } catch (e) {}
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
            sub.push((c.episodes || c.total_episodes) + ' qism');
        }
        return '<a class="ig-sres" href="index.php?c=' + (parseInt(c.id, 10) || 0) + '">'
             + '<div class="ig-sres-thumb">' + poster + '</div>'
             + '<div class="ig-sres-title">' + igEsc(c.title) + '</div>'
             + (sub.length ? '<div class="ig-sres-sub">' + igEsc(sub.join(' · ')) + '</div>' : '')
             + '</a>';
    }

    function igRunSearch() {
        if (!searchInp || !searchGrid) return;
        var q = searchInp.value.trim();
        if (q.length < 2) {
            searchGrid.innerHTML = '';
            if (searchHint) {
                searchHint.hidden = false;
                searchHint.textContent = 'Qidirish uchun kamida 2 ta harf yozing';
            }
            return;
        }
        if (searchHint) { searchHint.hidden = false; searchHint.textContent = 'Qidirilmoqda…'; }
        fetch(igSearchBase() + '/api/catalog.php?per_page=24&q=' + encodeURIComponent(q), {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        }).then(function (r) { return r.json(); }).then(function (d) {
            var items = (d && d.items) || [];
            searchGrid.innerHTML = items.map(igResultCard).join('');
            if (searchHint) {
                searchHint.hidden = items.length > 0;
                searchHint.textContent = 'Natija topilmadi';
            }
        }).catch(function () {
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
<script src="assets/js/tv.js?v=<?php echo @filemtime(__DIR__ . '/../assets/js/tv.js') ?: 1; ?>"></script>
