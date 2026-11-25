<?php
// ============================================================================
// settings.php — Foydalanuvchi sozlamalari (bitta oyna)
// ----------------------------------------------------------------------------
// Ankerlar (includes/nav.php dagi #igSettings oynasidan keladigan havolalar):
//   #profile       — Profilni tahrirlash (Avatar manzili + fayldan rasm)
//   #privacy       — Hisob maxfiyligi
//   #notifications — Bildirishnomalar
//   #blocked       — Bloklanganlar
//
// Bo'limlar tartibi: avval profil, so'ngra maxfiylik, bildirishnomalar va
// bloklar — hammasi bitta sahifada, uzoqqa aylantirish shart emas.
//
// Bildirishnoma sozlamalari: `users` jadvalida ham, `SiteSettings` da ham
// foydalanuvchi boshiga oid maydon yo'q (SiteSettings butun sayt uchun umumiy).
// Shuning uchun ular XAVFSIZ tarzda faqat brauzer localStorage'da saqlanadi,
// serverga hech narsa yozilmaydi va yangi migration qo'shilmaydi.
//
// Kuzatish so'rovlari: `user_follows` da status yo'q, `follow_requests`
// jadvali yo'q — bo'lim faqat mos jadval topilganda ko'rsatiladi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user     = $auth->getCurrentUser();
$userId   = $user ? (int) $user['id'] : null;
$settings = new Settings();

// Faqat information_schema orqali tekshiramiz — jadval yaratmaymiz.
$followRequestTable = null;
try {
    $followRequestTable = $settings->followRequestsTable();
} catch (\Throwable $e) {
    $followRequestTable = null;
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Sozlamalar &mdash; <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/settings.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/settings.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <style data-wc-style="1">
        /* Faqat oq/qora palitrasi; mavjud CSS o'zgaruvchilaridan foydalanamiz. */
        .st-sec[id] { scroll-margin-top: 76px; }
        .st-sec:target > .st-sec-head { color: var(--text); }
        .st-sec:target > .st-card { box-shadow: 0 0 0 1px var(--text); }

        .st-ava-row { display: flex; align-items: flex-start; gap: 12px; }
        .st-ava-preview {
            flex: 0 0 auto; width: 54px; height: 54px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: var(--card-2); border: 1px solid var(--line);
            overflow: hidden; font-size: 20px; font-weight: 800; color: var(--text);
        }
        .st-ava-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .st-ava-side { flex: 1 1 auto; min-width: 0; }
        .st-ava-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .st-ava-pick, .st-ava-remove {
            display: inline-flex; align-items: center; justify-content: center;
            width: auto; margin: 0; padding: 9px 12px; border-radius: 10px;
            font-size: 12.5px; font-weight: 700; cursor: pointer;
        }
        .st-ava-pick:disabled, .st-ava-remove:disabled { opacity: .55; cursor: wait; }
        .st-ava-hint { display: block; margin-top: 6px; font-size: 11.5px; color: var(--muted); }
        .st-ntf-note { margin: 8px 4px 0; font-size: 11.5px; line-height: 1.4; color: var(--muted); }
        .st-ntf-note.ok { color: var(--text); }

        @media (max-width: 420px) {
            .st-ava-row { flex-direction: column; }
            .st-ava-preview { width: 48px; height: 48px; }
        }
    </style>
</head>
<body class="st-body ig-shell">

<?php $NAV_ACTIVE = 'profile'; $WC_SPA = true; require __DIR__ . '/includes/nav.php'; ?>

<div id="wc-page" data-wc-page="settings">
<script>if (window.WCApp) window.WCApp.beginPage();</script>

<header class="st-top">
    <a class="st-back" href="profile.php" aria-label="Orqaga"><?php echo ig_svg('back'); ?></a>
    <div class="st-title">Sozlamalar</div>
</header>

<main class="st-main">

    <!-- ==================== 0) PROFIL KARTASI (Instagram uslubi) ============ -->
    <!-- Ma'lumotlar settings.js da `api/settings.php` javobidan to'ldiriladi. -->
    <section class="st-hero">
        <span class="st-hero-av" id="stHeroAv"><i></i></span>
        <span class="st-hero-main">
            <span class="st-hero-name" id="stHeroName">Hisobingiz</span>
            <span class="st-hero-user" id="stHeroUser"></span>
        </span>
        <a class="st-hero-btn" href="profile.php">Profil</a>
    </section>

    <!-- ==================== 1) PROFILNI TAHRIRLASH (#profile) =============== -->
    <section class="st-sec" id="profile">
        <div class="st-sec-head">Profilni tahrirlash</div>
        <div class="st-card">
            <form class="st-form" id="stForm" autocomplete="off">
                <div class="st-field">
                    <label class="st-label" for="stName">Ism <span style="color:var(--accent-2)">*</span></label>
                    <input class="st-input" id="stName" maxlength="100" required>
                </div>
                <div class="st-field">
                    <label class="st-label" for="stLast">Familiya</label>
                    <input class="st-input" id="stLast" maxlength="100">
                </div>
                <div class="st-field">
                    <label class="st-label" for="stUser">Foydalanuvchi nomi</label>
                    <input class="st-input" id="stUser" maxlength="40" placeholder="@foydalanuvchi">
                </div>
                <div class="st-field">
                    <label class="st-label" for="stAvatar">Avatar manzili</label>
                    <div class="st-ava-row">
                        <span class="st-ava-preview" id="stAvaPreview" aria-hidden="true">?</span>
                        <div class="st-ava-side">
                            <input class="st-input" id="stAvatar" maxlength="500"
                                   placeholder="https://&hellip; yoki uploads/avatars/&hellip;">
                            <div class="st-ava-actions">
                                <label class="st-btn ghost st-ava-pick" id="stAvatarPick" for="stAvatarFile">Fayldan rasm yuklash</label>
                                <input type="file" id="stAvatarFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
                                <button type="button" class="st-btn ghost st-ava-remove" id="stAvatarRemove">Rasmni o&#8217;chirish</button>
                            </div>
                            <span class="st-ava-hint">JPG, PNG, WebP yoki GIF &middot; eng ko&#8217;pi 5 MB. Rasm darhol saqlanadi (profil oynasidagi kabi).</span>
                        </div>
                    </div>
                </div>
                <div class="st-field">
                    <label class="st-label" for="stBio">
                        Qisqa tavsif <span class="st-count" id="stBioCount">0 / 500</span>
                    </label>
                    <textarea class="st-textarea" id="stBio" rows="3" maxlength="500"
                              placeholder="O‘zingiz haqingizda&hellip;"></textarea>
                </div>
                <button class="st-btn" id="stSaveBtn" type="submit">Saqlash</button>
            </form>
        </div>
    </section>

    <!-- ==================== 2) HISOB MAXFIYLIGI (#privacy) ================== -->
    <section class="st-sec" id="privacy">
        <div class="st-sec-head">Hisob maxfiyligi</div>
        <div class="st-card">

            <label class="st-row" for="stPrivate">
                <span class="st-row-ico">&#128274;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Maxfiy hisob
                        <span class="st-priv" id="stPrivBadge" hidden>MAXFIY</span>
                    </span>
                    <span class="st-row-s" id="stPrivateHint">Hamma profilni ko‘ra oladi.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stPrivate">
            </label>

            <label class="st-row" for="stActivity">
                <span class="st-row-ico">&#128101;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Faollikni ko‘rsatish</span>
                    <span class="st-row-s">Yoqtirish va kuzatish — kim yozganini boshqalar ko‘radi.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stActivity">
            </label>

        </div>
    </section>

    <!-- ==================== 3) BILDIRISHNOMALAR (#notifications) ============ -->
    <section class="st-sec" id="notifications">
        <div class="st-sec-head">Bildirishnomalar</div>
        <div class="st-card">

            <label class="st-row" for="stNtfLike">
                <span class="st-row-ico">&#9825;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Layklar</span>
                    <span class="st-row-s">Reels va postlaringizga qo‘yilgan layklar haqida xabar.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stNtfLike" data-ntf="like">
            </label>

            <label class="st-row" for="stNtfComment">
                <span class="st-row-ico">&#9998;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Izohlar</span>
                    <span class="st-row-s">Izoh va javoblar haqida xabar.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stNtfComment" data-ntf="comment">
            </label>

            <label class="st-row" for="stNtfFollow">
                <span class="st-row-ico">&#128101;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Yangi kuzatuvchilar</span>
                    <span class="st-row-s">Sizni kuzata boshlaganlar haqida xabar.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stNtfFollow" data-ntf="follow">
            </label>

            <label class="st-row" for="stNtfDm">
                <span class="st-row-ico">&#9993;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Shaxsiy xabarlar (DM)</span>
                    <span class="st-row-s">Kelgan xabarlar haqida xabar.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stNtfDm" data-ntf="dm">
            </label>

        </div>
        <div class="st-ntf-note" id="stNtfState" aria-live="polite">
            Bu tugmachalar faqat shu qurilmada saqlanadi (foydalanuvchi sozlamalari uchun alohida jadval mavjud emas).
        </div>
    </section>

    <?php if ($followRequestTable): ?>
    <!-- Mos jadval topilganda ko'rsatiladi. Hozirgi bazada bunday jadval yo'q. -->
    <section class="st-sec" id="requests">
        <div class="st-sec-head">Kuzatish so‘rovlari</div>
        <div class="st-card">
            <div class="st-empty">Hozircha kutilayotgan so‘rov yo‘q.</div>
        </div>
    </section>
    <?php endif; ?>

    <!-- ==================== 4) BLOKLANGANLAR (#blocked) ===================== -->
    <section class="st-sec" id="blocked">
        <div class="st-sec-head">
            Bloklanganlar <b id="stBlockCount"></b>
        </div>
        <div class="st-card">

            <div class="st-search">
                <input type="text" id="stSearch" autocomplete="off"
                       placeholder="Foydalanuvchini qidirish va bloklash&hellip;">
                <div class="st-res" id="stSearchRes" hidden></div>
            </div>

            <div class="st-blocked-list" id="stBlockList"></div>
        </div>
    </section>

    <div class="st-msg" id="stMsg" hidden></div>

</main>

<div class="st-toast" id="stToast" hidden></div>

<script src="assets/js/settings.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/settings.js') ?: 1; ?>"></script>
<script>
/* Qo'shimcha funksionallik (settings.js ga tegmaymiz):
   1) #igSettings / ankerlarga to'g'ri bo'limga o'tish;
   2) bildirishnoma tugmachalari — faqat localStorage;
   3) avatar faylini api/avatar.php orqali yuklash (profile.php modali bilan bir xil). */
(function () {
    'use strict';

    var $ = function (s) { return document.querySelector(s); };
    var NKEY = 'wc_notification_settings_v1';
    var ME_KEY = 'wc_tg_me_v1';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function meRaw() {
        try { return localStorage.getItem(ME_KEY) || ''; } catch (e) { return ''; }
    }

    var toastTimer = null;
    function flash(msg, ok) {
        var t = $('#stToast');
        if (!t) return;
        t.textContent = msg;
        t.classList.toggle('err', !ok);
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
    }

    // --------------------------------------------------------- 1) ANKERLAR
    var IDS = ['profile', 'privacy', 'notifications', 'requests', 'blocked'];

    function goToHash(canonicalize) {
        var raw = '';
        try { raw = decodeURIComponent(location.hash || '').replace(/^#/, ''); } catch (e) {}
        // Hash yo'q — oddiy ochilish: sahifa tepasidan (profil kartasidan) boshlaymiz.
        if (!raw) return;
        var h = raw;
        // #igSettings oynasidan kelgan eski havolalar to'g'ri bo'limga tushadi.
        if (h === 'igSettings' || h === 'settings' || h === 'account'
            || h === 'accountPrivacy' || h === 'maxfiylik') h = 'privacy';
        if (h === 'profileEdit') h = 'profile';
        if (h === 'followRequests') h = 'requests';
        if (IDS.indexOf(h) < 0) return;
        var el = document.getElementById(h);
        if (!el) return;
        if (canonicalize && (location.hash || '').replace(/^#/, '') !== h) {
            try { history.replaceState(null, '', '#' + h); } catch (e) {}
        }
        el.scrollIntoView({ block: 'start' });
    }
    goToHash(true);
    window.addEventListener('hashchange', function () { goToHash(false); });

    // ------------------------------------------ 2) BILDIRISHNOMA SOZLAMALARI
    var DEFAULTS = { like: true, comment: true, follow: true, dm: true };
    var LABELS = {
        like: 'layk', comment: 'izoh', follow: 'yangi kuzatuvchi', dm: 'shaxsiy xabar'
    };

    function readPrefs() {
        var out = {};
        Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
        try {
            var raw = localStorage.getItem(NKEY);
            var j = raw ? JSON.parse(raw) : null;
            if (j && typeof j === 'object') {
                Object.keys(DEFAULTS).forEach(function (k) {
                    if (typeof j[k] === 'boolean') out[k] = j[k];
                });
            }
        } catch (e) {}
        return out;
    }

    function note(msg) {
        var box = $('#stNtfState');
        if (!box) return;
        box.textContent = msg + ' (faqat shu qurilmada saqlanadi).';
        box.className = 'st-ntf-note ok';
    }

    var prefs = readPrefs();
    Object.keys(DEFAULTS).forEach(function (k) {
        var el = $('[data-ntf="' + k + '"]');
        if (!el) return;
        el.checked = prefs[k] !== false;
        el.addEventListener('change', function () {
            prefs[k] = !!el.checked;
            try { localStorage.setItem(NKEY, JSON.stringify(prefs)); } catch (e) {}
            note(LABELS[k] + ': ' + (prefs[k] ? 'yoqilgan' : 'o‘chirilgan'));
        });
    });

    // ------------------------------------------- 3) AVATAR: URL + FAYL YUKLASH
    var avInput  = $('#stAvatar');
    var avFile   = $('#stAvatarFile');
    var avPick   = $('#stAvatarPick');
    var avRemove = $('#stAvatarRemove');
    var avPrev   = $('#stAvaPreview');

    function currentName() {
        var f = $('#stName'), l = $('#stLast'), h = $('#stHeroName');
        var n = [f ? f.value.trim() : '', l ? l.value.trim() : ''].filter(Boolean).join(' ');
        return n || (h ? h.textContent.trim() : '?') || '?';
    }

    // Ixtiyoriy matnni innerHTML ga qo'ymaymiz — faqat DOM orqali.
    function setAvatarUI(url) {
        var letter = ((currentName().charAt(0)) || '?').toUpperCase();
        if (avPrev) {
            avPrev.textContent = '';
            if (url) {
                var img = document.createElement('img');
                img.src = url;
                img.alt = '';
                img.onerror = function () { avPrev.textContent = letter; };
                avPrev.appendChild(img);
            } else {
                avPrev.textContent = letter;
            }
        }
        var hero = $('#stHeroAv');
        if (hero) {
            hero.textContent = '';
            if (url) {
                var hi = document.createElement('img');
                hi.src = url;
                hi.alt = '';
                hi.onerror = function () { if (hi.parentNode) hi.parentNode.removeChild(hi); };
                hero.appendChild(hi);
            } else {
                var i = document.createElement('i');
                i.textContent = letter;
                hero.appendChild(i);
            }
        }
    }

    function origData() {
        var form = $('#stForm');
        try { return JSON.parse((form && form.dataset.orig) || '{}') || {}; } catch (e) { return {}; }
    }

    function origSetAvatar(url) {
        var form = $('#stForm');
        if (!form) return;
        var o = origData();
        o.avatar = url || '';
        form.dataset.orig = JSON.stringify(o);
    }

    if (avInput) {
        avInput.addEventListener('input', function () {
            setAvatarUI(avInput.value.trim());
        });
    }

    if (avFile && avPick) {
        // <label for> allaqachon fayl tanlash oynasini ochadi — ikki marta
        // ochilmasligi uchun standart harakatni to'xtatamiz.
        avPick.addEventListener('click', function (e) {
            e.preventDefault();
            avFile.click();
        });
        avFile.addEventListener('change', function () {
            var file = avFile.files && avFile.files[0];
            avFile.value = '';
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                flash('Rasm hajmi 5 MB dan oshmasligi kerak', false);
                return;
            }
            var fd = new FormData();
            fd.append('avatar', file);
            var raw = meRaw();
            if (raw) fd.append('tg_me', raw);

            avPick.disabled = true;
            flash('Rasm yuklanmoqda…', true);
            fetch('api/avatar.php', {
                method: 'POST',
                body: fd,
                headers: { 'Accept': 'application/json' }
            }).then(function (r) { return r.json().catch(function () { return null; }); })
              .then(function (d) {
                  avPick.disabled = false;
                  if (!d || !d.success || !d.avatar) {
                      flash((d && d.message) || 'Rasm yuklanmadi', false);
                      return;
                  }
                  if (avInput) avInput.value = d.avatar;
                  origSetAvatar(d.avatar);
                  setAvatarUI(d.avatar);
                  flash('Profil rasmi yangilandi', true);
              }).catch(function () {
                  avPick.disabled = false;
                  flash('Tarmoq xatosi', false);
              });
        });
    }

    if (avRemove) {
        avRemove.addEventListener('click', function () {
            var body = new URLSearchParams();
            body.set('remove', '1');
            var raw = meRaw();
            if (raw) body.set('tg_me', raw);

            avRemove.disabled = true;
            fetch('api/avatar.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: body.toString()
            }).then(function (r) { return r.json().catch(function () { return null; }); })
              .then(function (d) {
                  avRemove.disabled = false;
                  if (!d || !d.success) {
                      flash((d && d.message) || 'Rasm o‘chirilmadi', false);
                      return;
                  }
                  if (avInput) avInput.value = '';
                  origSetAvatar('');
                  setAvatarUI('');
                  flash('Profil rasmi o‘chirildi', true);
              }).catch(function () {
                  avRemove.disabled = false;
                  flash('Tarmoq xatosi', false);
              });
        });
    }

    // settings.js ma'lumotlarni keyinroq to'ldiradi — ko'rinishni unga moslab
    // yangilaymiz va kerak bo'lsa anker bo'yicha qayta o'tamiz.
    var qs = '?action=get';
    if (meRaw()) qs += '&tg_me=' + encodeURIComponent(meRaw());
    fetch('api/settings.php' + qs, {
        headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (d) {
          if (d && d.success && d.profile) {
              var serverUrl = d.profile.avatar || '';
              var shown = avInput ? (avInput.value.trim() || serverUrl) : serverUrl;
              setAvatarUI(shown);
          }
          goToHash(false);
      }).catch(function () {});
})();
</script>
</div>
</body>
</html>
