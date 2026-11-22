<?php
// ============================================================================
// perf-head.php — tarmoq ulanishini OLDINDAN ochish (video tezroq ochiladi)
// ---------------------------------------------------------------------------
// Nima uchun kerak:
//   Video Telegram CDN'dan (telesco.pe / cdn-telegram.org) va MTProto orqali
//   (kws<dc>.web.telegram.org) keladi. Brauzer bu domenlarni FAQAT player
//   ishga tushganda topadi — ya'ni DNS + TCP + TLS qadamlari videoning
//   birinchi kadriga qadar kutadi (odatda 100–600 ms, sekin tarmoqda
//   ko'proq).
//
//   `preconnect` shu qadamlarni HTML parse bo'layotganda, CSS/JS yuklanishi
//   bilan PARALLEL boshlaydi. Natija: player ishga tushganda ulanish
//   allaqachon tayyor — "birinchi kadr" deyarli darhol chiqadi.
//
//   `dns-prefetch` — preconnect'ni qo'llab-quvvatlamaydigan brauzerlar uchun
//   zaxira (faqat DNS).
//
// Ishlatish: <head> ichida, boshqa resurslardan OLDIN —
//   require __DIR__ . '/includes/perf-head.php';
//
// Bu belgi `includes/nav.php` ga "site-banner.js allaqachon ulangan" deb
// aytadi — aks holda skript ikki marta yuklanib qoladi.
$GLOBALS['WC_PERF_HEAD'] = true;
//
// Ixtiyoriy: `$PERF_POSTER` (sahifa posteri) berilsa, u `preload` qilinadi —
// thumbnail video yuklanishidan oldin ko'rinadi (qora ekran bo'lmaydi).
// ============================================================================

// Ixtiyoriy poster (mutlaq yoki nisbiy yo'l). `data:`/`tg://` kabi
// manzillarni oldindan yuklab bo'lmaydi — ular o'tkazib yuboriladi.
$__perfPoster = isset($PERF_POSTER) ? trim((string) $PERF_POSTER) : '';
$__perfPosterOk = false;
if ($__perfPoster !== ''
    && (preg_match('#^(https?:)?//#i', $__perfPoster)
        || preg_match('#^(/|uploads/)#i', $__perfPoster))) {
    $__perfPosterOk = true;
}

// Ixtiyoriy Cloudflare Worker (Telegram CDN proxy) — oqim o'sha yerdan
// ketadigan bo'lsa, unga ham oldindan ulanamiz.
$__cfWorker = trim((string) env_value('CLOUDFLARE_WORKER_URL', ''));
$__cfHost   = $__cfWorker !== '' ? (string) (parse_url($__cfWorker, PHP_URL_HOST) ?: '') : '';

// MTProto asl ulanishi `kws<dc>.web.telegram.org` ga ketadi (tg-mtproto.js
// dagi `dcHosts`). Eski `venus` domeni faqat zaxira — unga preconnect qilsak,
// haqiqiy ulanish boshqa domenga ketib, TLS handshake yana boshidan boshlanadi
// (sekin tarmoqda bu 0.5–2 s kechikish beradi).
//
// `watch.php` joriy videoning `source='gram'` doc meta'sini HTML'ga inline
// qilib bergan — DC'ni shu yerdan olamiz, qo'shimcha DB so'rovi yo'q.
$__perfDc = 0;
if (isset($__inlineDocMeta, $playback) && is_array($__inlineDocMeta)
    && is_array($playback) && !empty($playback['channel'])
    && (int) ($playback['post'] ?? 0) > 0) {
    $__perfKey = (string) $playback['channel'] . '/' . (int) $playback['post'];
    $__perfDc  = (int) ($__inlineDocMeta[$__perfKey]['dc'] ?? 0);
}
?>
<?php if ($__perfDc > 0): ?>
<link rel="preconnect" href="https://kws<?php echo (int) $__perfDc; ?>.web.telegram.org" crossorigin>
<link rel="preconnect" href="https://kws<?php echo (int) $__perfDc; ?>-1.web.telegram.org" crossorigin>
<link rel="dns-prefetch" href="//kws<?php echo (int) $__perfDc; ?>.web.telegram.org">
<link rel="dns-prefetch" href="//kws<?php echo (int) $__perfDc; ?>-1.web.telegram.org">
<?php else: ?>
<link rel="preconnect" href="https://venus.web.telegram.org" crossorigin>
<link rel="dns-prefetch" href="//venus.web.telegram.org">
<?php endif; ?>
<link rel="preconnect" href="https://api.telegram.org" crossorigin>
<link rel="preconnect" href="https://cdn.telesco.pe">
<link rel="preconnect" href="https://telesco.pe">
<link rel="dns-prefetch" href="//cdn.telesco.pe">
<link rel="dns-prefetch" href="//telesco.pe">
<?php if ($__cfHost !== ''): ?>
<link rel="preconnect" href="https://<?php echo htmlspecialchars($__cfHost, ENT_QUOTES); ?>" crossorigin>
<link rel="dns-prefetch" href="//<?php echo htmlspecialchars($__cfHost, ENT_QUOTES); ?>">
<?php endif; ?>
<?php if ($__perfPosterOk): ?>
<link rel="preload" as="image" href="<?php echo htmlspecialchars($__perfPoster, ENT_QUOTES); ?>" fetchpriority="high">
<?php endif; ?>
<?php
// Ilova qaysi papkada turgan bo'lsa (`/tele_uzdub/`) — barcha asset URL'lari
// shu prefiks bilan boshlanishi kerak. DIQQAT: bu o'zgaruvchi quyida ham
// ishlatiladi, shuning uchun eng boshida e'lon qilinadi.
$__base  = rtrim((string) (parse_url(SITE_URL, PHP_URL_PATH) ?: ''), '/');

// Sayt sozlamalarini (e'lon va h.q.) HTML ichiga INLINE qilamiz:
// `site-banner.js` endi `api/site-config.php` ga ALOHIDA so'rov yubormaydi —
// bu har bir sahifada bitta RTT (odatda 40–150 ms) kamayadi.
$__siteCfg = [];
if (class_exists('SiteSettings')) {
    $__s = SiteSettings::all();
    $__siteCfg = [
        'success'     => true,
        'site_name'   => $__s['site_name'] !== '' ? $__s['site_name'] : (defined('SITE_NAME') ? SITE_NAME : ''),
        'notice'      => (string) $__s['notice'],
        'notice_link' => (string) $__s['notice_link'],
        'banner_url'  => (string) $__s['banner_url'],
        'maintenance' => (int) $__s['maintenance'] === 1,
    ];
}
?>
<script>window.__WCSITECFG = <?php echo json_encode($__siteCfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;</script>
<?php
// Admin panel → Sozlamalar dagi e'lon (agar bo'lsa). `defer` — render'ni
// bloklamaydi, e'lon bo'lmasa skript hech narsa qilmaydi.
$__bannerV = @filemtime(__DIR__ . '/../assets/js/site-banner.js') ?: 1;
?>
<script defer src="<?php echo htmlspecialchars($__base, ENT_QUOTES); ?>/assets/js/site-banner.js?v=<?php echo (int) $__bannerV; ?>"></script>
<?php
// Service Worker'ni HTML parse paytida ro'yxatdan o'tkazamiz.
//
// Nima uchun: odatda SW `tg-stream.js` (5.3 MB bundle yuklangach) ichida
// ro'yxatdan o'tadi — birinchi video ochilishida o'rnatish tugashini
// kutish (yoki sahifani qayta yuklash) kerak bo'ladi. Bu yerda ro'yxatdan
// o'tish 735 KB bundle dekodlanishi bilan PARALLEL boshlanadi, natijada
// birinchi ochilishdagi kutish deyarli yo'qoladi.
//
// `tg-stream.js` o'sha skriptni qayta `register()` qiladi — bu xavfsiz:
// brauzer bir xil scope uchun mavjud registratsiyani qaytaradi.
$__swUrl = $__base . '/tg-cdn-worker.js';
$__swScp = ($__base !== '' ? $__base : '') . '/';

// Teleproto default bundle yoki eski GramJS fallback yangilanganda URL ham
// o'zgaradi — brauzer avvalgi bundle nusxasini qayta ishlatib qolmaydi.
$__bundleV = max(
    (int) (@filemtime(__DIR__ . '/../assets/js/teleproto-client.bundle.js.gz') ?: 1),
    (int) (@filemtime(__DIR__ . '/../assets/js/tg-client.bundle.js.gz') ?: 1)
);
?>
<script>window.__WCBUNDLEV = <?php echo (int) $__bundleV; ?>;</script>
<script>
(function () {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(<?php echo json_encode($__swUrl); ?>, {
      scope: <?php echo json_encode($__swScp); ?>,
      updateViaCache: 'none'
    }).then(function (reg) {
      try { if (reg && reg.active) reg.active.postMessage({ type: 'claim' }); } catch (e) {}
    }).catch(function () {});
  } catch (e) {}
})();
</script>
<?php
// ---------------------------------------------------------------------------
// Video ochilish metrikasi + "issiq start" prefetch.
//
// `defer` — HTML parse'ni bloklamaydi. Ikkala skript ham hech narsani
// o'zgartirmaydi: o'lchov yuboradi (tg-perf.js) va bo'sh vaqtda eng ko'p
// ko'rilgan videolarni tayyorlaydi (tg-prefetch.js). Xato bo'lsa — jim.
//
// Boshqarish (konsoldan):
//   localStorage.setItem('wc_perf','0')      -> o'lchovni o'chirish
//   localStorage.setItem('wc_prefetch','0')  -> prefetch'ni o'chirish
// ---------------------------------------------------------------------------
$__perfUrl = $__base . '/api/perf.php';
$__perfV   = @filemtime(__DIR__ . '/../assets/js/tg-perf.js') ?: 1;
$__pfV     = @filemtime(__DIR__ . '/../assets/js/tg-prefetch.js') ?: 1;
?>
<script>
window.__WCPERF = { url: <?php echo json_encode($__perfUrl); ?> };
window.__WCPF   = {};
</script>
<?php
// ---------------------------------------------------------------------------
// Speculation Rules: kursor karta ustida ~200 ms turganда brauzer tomosha
// sahifasini fonda "prerender" qiladi — bosilganda sahifa DARHOL ochiladi.
//
// Nima uchun JS bilan: `navigator.connection.saveData` / 2G bo'lsa umuman
// yoqilmaydi (foydalanuvchi trafigini bekorga sarflamaymiz). Ro'yxat
// dinamik bo'lgani uchun `selector_matches` ishlatiladi — har bir havolani
// sanab chiqish shart emas.
//
// Qo'llab-quvvatlamaydigan brauzerlar (Safari/Firefox) skriptni jimgina
// o'tkazib yuboradi — xatti-harakat o'zgarmaydi.
// ---------------------------------------------------------------------------
?>
<script>
(function () {
  try {
    if (!window.HTMLScriptElement || !HTMLScriptElement.supports
        || !HTMLScriptElement.supports('speculationrules')) return;
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || '')))) return;
    var rules = {
      prerender: [{
        source: 'document',
        where: { selector_matches: 'a[href*="watch.php"]' },
        eagerness: 'moderate'
      }]
    };
    var s = document.createElement('script');
    s.type = 'speculationrules';
    s.textContent = JSON.stringify(rules);
    document.head.appendChild(s);
  } catch (e) {}
})();
</script>
<script defer src="<?php echo htmlspecialchars($__base, ENT_QUOTES); ?>/assets/js/tg-perf.js?v=<?php echo (int) $__perfV; ?>"></script>
<script defer src="<?php echo htmlspecialchars($__base, ENT_QUOTES); ?>/assets/js/tg-prefetch.js?v=<?php echo (int) $__pfV; ?>"></script>
