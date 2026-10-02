<?php
// ============================================================================
// includes/nav.php - YouTube uslubidagi navigatsiya qobig'i
// ============================================================================
//   KATTA EKRAN (>=1000px): chap yon panel (sidebar)
//     [🎬 W CINEMA]
//     Bosh sahifa · Reels · Bildirishnomalar
//     ▸ Kutubxona  (Tarix · Yoqqanlar · Saqlanganlar · Keyinroq ko'rish)
//     Profil / Sozlamalar · Yana · Telegram holati + footer
//
//   TELEFON  (<1000px): yuqori panel (brend + qidiruv/bildirishnoma)
//                       + pastki panel (Home | Qidiruv | Reels | ＋ | Profil)
//
// Sahifalar qo'ng'iroqdan OLDIN $NAV_ACTIVE o'rnatishi mumkin:
//   'home', 'reels', 'upload', 'profile', 'notifications',
//   'saved', 'liked', 'history', 'later'
// ============================================================================

if (!isset($NAV_ACTIVE)) { $NAV_ACTIVE = ''; }

// Ishtirokchi foydalanuvchi uchun havolalar
$igIsAdmin  = $auth->isAdmin();
$igLogged   = (bool) $user;
$igProfileH = $igLogged ? 'profile.php' : 'login.php';
$igCreateH  = $igLogged ? 'reels-upload.php' : 'login.php';
$igAvatar   = '<span class="ig-avatar ig-avatar-in">?</span>';
if ($igLogged) {
    $igIn = mb_strtoupper(mb_substr($user['first_name'] ?? '?', 0, 1)) ?: '?';
    $igAvatar = !empty($user['avatar'])
        ? '<img class="ig-avatar" src="' . esc($user['avatar']) . '" alt="">'
        : '<span class="ig-avatar ig-avatar-in">' . esc($igIn) . '</span>';
}

/**
 * Yon panel elementi (icon + label). Faollikni $igActive bilan belgilaydi.
 */
function ig_item($href, $key, $icon, $label, $active, $extra = '') {
    $cls = $active === $key ? ' active' : '';
    // title: yon panel kichrayganda (ikonka rejimi) ustiga olib borsa nomi chiqadi
    return '<a class="ig-item' . $cls . '" href="' . $href . '" title="' . esc($label) . '"' . $extra . '>'
         . '<span class="ig-ico">' . $icon . '</span>'
         . '<span class="ig-txt">' . $label . '</span></a>';
}
?>
<?php
// ---------------------------------------------------------------------------
// TELEGRAM KIRISH HIMOYASI (guard)
// ---------------------------------------------------------------------------
// Sayt serveri auth_key'ni ko'rmaydi, shuning uchun tekshiruv faqat
// brauzerda: localStorage'da kalit bo'lmasa — login sahifasiga o'tamiz.
// Bu skript nav.php orqali BARCHA asosiy sahifalarda eng boshida ishlaydi.
// ---------------------------------------------------------------------------
$tgBase = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
?>
<script>
(function () {
  try {
    var v = localStorage.getItem('wc_mtproto_auth_v1');
    // GramJS sessiyasi "1"+base64 satr (~350 belgi). Unda "authKey"
    // so'zi yo'q — shuning uchun uzunlikni tekshiramiz. Kalitning
    // haqiqiy yaroqliligi keyin `verify()` da aniqlanadi.
    if (v && v.length > 20) return;                    // kalit bor — o'tamiz
    var here = location.pathname + location.search;
    location.replace(<?php echo json_encode($tgBase); ?> + '/tg-login.php?next=' + encodeURIComponent(here));
  } catch (e) {}
})();
</script>
<!-- ============================== Desktop: yon panel ============================== -->
<aside class="ig-side" id="igSide">
    <a class="ig-brand" href="index.php">
        <span class="ig-logo">🎬</span>
        <span class="ig-brand-text"><?php echo htmlspecialchars(SITE_NAME); ?></span>
    </a>

    <nav class="ig-nav">
        <div class="ig-group">
            <?php echo ig_item('index.php', 'home', '🏠', 'Bosh sahifa', $NAV_ACTIVE); ?>
            <?php echo ig_item('reels.php', 'reels', '🎞️', 'Reels', $NAV_ACTIVE); ?>
            <?php echo ig_item('notifications.php', 'notifications', '🔔', 'Bildirishnomalar', $NAV_ACTIVE); ?>
        </div>

        <div class="ig-sep"></div>

        <!-- Kutubxona (YouTube'dagi kabi ochiladigan bo'lim) -->
        <button class="ig-item ig-lib-toggle" id="igLibBtn" type="button"
                aria-expanded="false" aria-controls="igLibMenu" title="Kutubxona">
            <span class="ig-ico">📚</span>
            <span class="ig-txt">Kutubxona</span>
            <span class="ig-caret">▾</span>
        </button>
        <div class="ig-sub" id="igLibMenu" hidden>
            <?php echo ig_item('history.php', 'history', '🕘', 'Tarix', $NAV_ACTIVE); ?>
            <?php echo ig_item('profile.php?tab=liked', 'liked', '👍', 'Yoqqanlar', $NAV_ACTIVE); ?>
            <?php echo ig_item('saved.php', 'saved', '🔖', 'Saqlanganlar', $NAV_ACTIVE); ?>
            <?php echo ig_item('saved.php', 'later', '⏰', 'Keyinroq ko‘rish', $NAV_ACTIVE); ?>
        </div>

        <?php if ($igIsAdmin): ?>
            <div class="ig-sep"></div>
            <div class="ig-group">
                <?php echo ig_item('admin-content.php', 'admin', '🗂', 'Kontent boshqaruvi', $NAV_ACTIVE); ?>
                <?php echo ig_item('admin-reels.php', 'admin-reels', '🎞', 'Reels moderatsiya', $NAV_ACTIVE); ?>
            </div>
        <?php endif; ?>
    </nav>

    <div class="ig-side-bottom">
        <!-- Telegram ulanish ko'rsatkich: kalit saqlanganmi yoki yo'qmi -->
        <div class="ig-tg-status" id="tgStatus" title="Telegram ulanish holati">
            <span class="ig-tg-dot" id="tgStatusDot"></span>
            <span class="ig-tg-txt" id="tgStatusTxt">Telegram</span>
        </div>

        <?php echo ig_item($igProfileH, 'profile', $igAvatar, 'Profil / Sozlamalar', $NAV_ACTIVE); ?>

        <div class="ig-more">
            <button class="ig-item" id="igMoreBtn" type="button">
                <span class="ig-ico">⚙️</span><span class="ig-txt">Yana</span>
            </button>
            <div class="ig-more-menu" id="igMoreMenu" hidden>
                <a href="saved.php">🔖 Saqlanganlar</a>
                <a href="reels-upload.php">🎬 Reels yuklash</a>
                <?php if ($igIsAdmin): ?>
                    <a href="admin-content.php">🗂 Kontent boshqaruvi</a>
                    <a href="admin-reels.php">🎞 Reels moderatsiya</a>
                <?php endif; ?>
                <?php if ($igLogged): ?>
                    <a href="profile.php">👤 Profilim</a>
                    <a href="logout.php">⏻ Chiqish</a>
                <?php else: ?>
                    <a href="login.php">🔐 Kirish</a>
                <?php endif; ?>
                <hr>
                <a id="tgReauthLink" href="javascript:void(0)" style="cursor:pointer">🔒 Telegramdan chiqish</a>
                <hr>
                <div class="ig-more-meta">Boshqa mahsulotlar · Meta</div>
                <a href="https://t.me/<?php echo htmlspecialchars(TELEGRAM_BOT_USERNAME); ?>" target="_blank" rel="noopener">✈️ Telegram bot</a>
                <a href="login.php">👥 Hisob sozlamalari</a>
            </div>
        </div>

        <!-- Yon panelni ochish/yopish tugmasi (ikonka rejimi) -->
        <button class="ig-item ig-toggle" id="igCollapseBtn" type="button"
                title="Yon panelni yopish" aria-label="Yon panelni yopish">
            <span class="ig-ico">☰</span>
            <span class="ig-txt ig-toggle-txt">Yon panelni yopish</span>
        </button>

        <div class="ig-side-foot">
            © <?php echo date('Y'); ?> <?php echo htmlspecialchars(SITE_NAME); ?>
            <span>🎬 W CINEMA · Meta mahsulotlari</span>
        </div>
    </div>
</aside>

<!-- ============================== Telefon: yuqori panel ============================== -->
<header class="ig-mobar">
    <a class="ig-mobar-brand" href="index.php">🎬 <span><?php echo htmlspecialchars(SITE_NAME); ?></span></a>
    <div class="ig-mobar-actions">
        <a class="ig-mobar-btn" href="index.php" data-nav-search="1" aria-label="Qidiruv">🔍</a>
        <a class="ig-mobar-btn" href="notifications.php" aria-label="Bildirishnomalar">🔔</a>
    </div>
</header>

<!-- ============================== Telefon: pastki panel ============================== -->
<nav class="ig-tabbar">
    <a href="index.php" class="<?php echo $NAV_ACTIVE === 'home' ? 'active' : ''; ?>" aria-label="Bosh sahifa">🏠</a>
    <a href="index.php" data-nav-search="1" aria-label="Qidiruv" class="<?php echo $NAV_ACTIVE === 'search' ? 'active' : ''; ?>">🔍</a>
    <a href="reels.php" class="ig-tab-create <?php echo $NAV_ACTIVE === 'reels' ? 'active' : ''; ?>" aria-label="Reels">🎞️</a>
    <a href="<?php echo $igCreateH; ?>" aria-label="Yaratish">＋</a>
    <a href="<?php echo $igProfileH; ?>" class="ig-tab-profile <?php echo $NAV_ACTIVE === 'profile' ? 'active' : ''; ?>" aria-label="Profil"><?php echo $igAvatar; ?></a>
</nav>

<script>
// DIQQAT: bu skript `<body>` ning YUQORI qismida (nav.php orqali) turadi,
// `tg-stream.js` esa PAGANING OXIRIDA yuklanadi. Shuning uchun bu yerda
// `window.TgStream` hali YO'Q. Barcha Telegram bilan bog'liq kod
// `DOMContentLoaded` ICHIDA bajariladi — undan keyin barcha skriptlar
// yuklanib bo'ladi. Aks holda ko'rsatkich doim kulrang qolib qolardi.
window.addEventListener('DOMContentLoaded', function () {
    // ------------------------------------------------------------------
    // Telegram ulanish ko'rsatkichi
    //
    // Foydalanuvchi ko'zi oldida (yon panel) bitta nuqta:
    //   kulrang = kalit yo'q (QR kerak)
    //   sariq   = kalit bor, Telegram tasdiqlash kutilmoqda
    //   yashil  = ulangan, videolar ochiladi
    //   qizil   = kalit bor lekin Telegram rad etdi
    //
    // Kalit `localStorage` da: `wc_mtproto_auth_v1`.
    // ------------------------------------------------------------------
    var tgBox = document.getElementById('tgStatus');
    var tgTxt = document.getElementById('tgStatusTxt');
    var TG_KEY = 'wc_mtproto_auth_v1';

    function tgSet(cls, text, title) {
        if (!tgBox || !tgTxt) return;
        tgBox.classList.remove('ok', 'err', 'wait');
        if (cls) tgBox.classList.add(cls);
        tgTxt.textContent = text;
        tgBox.title = title || '';
    }

    if (tgBox && window.TgStream) {
        // `hasSession()` faqat KALIT bor-yo'qligini biladi — u hali
        // Telegram tomonidan tekshirilmagan. Shuning uchun boshlang'ich
        // holat "tekshirilmoqda" (sariq) bo'lib, haqiqiy natija
        // `wc:tgReady` (yashil) yoki muvaffaqiyatsizlik (qizil) bilan
        // keladi. Aks holda kalit bor deb yashil ko'rsatib, keyin
        // Telegram rad etsa, foydalanuvchi aldirdik.
        //
        // Kalit faqat shu brauzerning localStorage da turadi; serverga
        // hech narsa yuborilmaydi.
        var cached = window.TgStream.hasSession();

        if (cached) {
            tgSet('wait', 'Telegram tekshirilmoqda…',
                'Kalit bor, Telegram tasdiqlash kutilmoqda.');
        } else {
            tgSet('', 'Telegram ulanmagan',
                'Kiring — bir marta QR skanerlang.');
        }

        // Eshik yopilganda (muvaffaqiyatli ulanish) yashilga o'tadi.
        document.addEventListener('wc:tgReady', function () {
            tgSet('ok', 'Telegram ulangan',
                'Kalit shu brauzerda saqlangan. Videolar Telegram CDN dan oqadi.');
        });
    }

    // "Telegramdan chiqish" — kalitni o'chirib, login sahifasiga qaytaramiz.
    // Bu handler `window.TgStream` bo'lmagan sahifalarda ham ishlashi kerak.
    var re = document.getElementById('tgReauthLink');
    if (re) {
        re.addEventListener('click', function () {
            if (!confirm('Telegram hisobidan chiqilsinmi?\n'
                + 'Keyin kirish sahifasi qaytadan ochiladi.')) return;
            try {
                localStorage.removeItem(TG_KEY);
                localStorage.removeItem('wc_tgweb_v1');
                localStorage.removeItem('wc_tg_mode_v1');
            } catch (e) {}
            location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/tg-login.php');
        });
    }

    // PHP hisobdan chiqishda ham Telegram kalitini tozalaymiz — keyin
    // saytga kirganda login sahifasi qaytadan ko'rinadi.
    var lg = document.querySelector('a[href="logout.php"]');
    if (lg) lg.addEventListener('click', function () {
        try {
            localStorage.removeItem(TG_KEY);
            localStorage.removeItem('wc_tgweb_v1');
            localStorage.removeItem('wc_tg_mode_v1');
        } catch (e) {}
    });

    // "Yana" menyusini ochish/yopish
    var btn = document.getElementById('igMoreBtn');
    var menu = document.getElementById('igMoreMenu');
    if (btn && menu) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.hidden = !menu.hidden;
        });
        document.addEventListener('click', function () { menu.hidden = true; });
    }

    // Kutubxona bo'limini ochish/yopish (holat eslab qolinadi).
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
        // Faol sahifa kutubxonada bo'lsa — avtomatik ochiladi.
        var libActive = libMenu.querySelector('.ig-item.active');
        var openByDefault = false;
        try { openByDefault = localStorage.getItem(libKey) === '1'; } catch (e) {}
        igSetLib(openByDefault || !!libActive);
    }

    // Qidiruv havolasi: index.php da bo'linsak, shunchaki qidiruv oynasiga o'tamiz
    document.querySelectorAll('[data-nav-search]').forEach(function (a) {
        a.addEventListener('click', function (e) {
            var inp = document.getElementById('searchInput');
            if (inp) {
                e.preventDefault();
                inp.focus();
                inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });

    // Yon panelni ochish/yopish (kichrayganda faqat ikonkalar)
    var collKey = 'ig_side_collapsed';
    var collBtn = document.getElementById('igCollapseBtn');
    var collTxt = collBtn ? collBtn.querySelector('.ig-toggle-txt') : null;

    function igSetCollapsed(c) {
        document.body.classList.toggle('ig-collapsed', !!c);
        if (collBtn) {
            collBtn.setAttribute('title', c ? 'Yon panelni ochish' : 'Yon panelni yopish');
            collBtn.setAttribute('aria-label', c ? 'Yon panelni ochish' : 'Yon panelni yopish');
        }
        if (collTxt) { collTxt.textContent = c ? 'Yon panelni ochish' : 'Yon panelni yopish'; }
        try { localStorage.setItem(collKey, c ? '1' : '0'); } catch (e) {}
    }

    try { if (localStorage.getItem(collKey) === '1') { igSetCollapsed(true); } } catch (e) {}

    if (collBtn) {
        collBtn.addEventListener('click', function () {
            igSetCollapsed(!document.body.classList.contains('ig-collapsed'));
        });
    }
});
</script>
