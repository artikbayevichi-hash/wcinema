<?php
// ============================================================================
// tg-persist.php — doimiy MTProto ulanishini BUTUN saytga tarqatadi
// ---------------------------------------------------------------------------
// Maqsad: foydalanuvchi istalgan foydalanuvchi sahifasida bo'lganida
// (video ochilmagan taqdirda ham) bitta Telegram ulanishi tirik turadi.
// Shunda keyingi sahifada/video bosilganda qayta ulanish kutib qolmaydi.
//
// Faqat `includes/nav.php` oxiridan chaqiriladi. Asosiy sahifalar
// (index / watch / reels / chat) `tg-stream.js` ni o'zlari yuklaydi — bu
// yerda IKKINCHI nusxa yuklanmaydi: DOMContentLoaded vaqtida
// `window.TgStream` mavjud bo'lsa faqat `init()` chaqiriladi (idempotent:
// kaBound / swKeepBound / S.reg qo'riqlari bor).
//
// E'tibor: auth_key faqat brauzer localStorage'ida yashaydi. Session bo'lmagan
// foydalanuvchida `warmFast()` hech qanday WebSocket ochmaydi (bekor trafik
// yo'q) — faqat SW o'rnatiladi.
// ============================================================================

$__tgBase    = rtrim((string) (parse_url(SITE_URL, PHP_URL_PATH) ?: ''), '/');
$__tgApiId   = (int) (defined('TG_API_ID') ? TG_API_ID : 0);
$__tgApiHash = (string) (defined('TG_API_HASH') ? TG_API_HASH : '');
$__tgProtoV  = (int) (@filemtime(__DIR__ . '/../assets/js/tg-mtproto.js') ?: 1);
$__tgStreamV = (int) (@filemtime(__DIR__ . '/../assets/js/tg-stream.js') ?: 1);
$__tgProtoSrc  = $__tgBase . '/assets/js/tg-mtproto.js?v=' . $__tgProtoV;
$__tgStreamSrc = $__tgBase . '/assets/js/tg-stream.js?v=' . $__tgStreamV;
?>
<script>
(function () {
  // `window.APP` ba'zi sahifalarda keyinroq to'ldiriladi — shuning uchun
  // FAQAT yo'q bo'lgan kalitlarni qo'shamiz, mavjudlarini buzmaymiz.
  try {
    window.APP = window.APP || {};
    if (!window.APP.base) window.APP.base = <?php echo json_encode($__tgBase, JSON_UNESCAPED_SLASHES); ?>;
    if (!window.APP.tg) window.APP.tg = {
      apiId: <?php echo $__tgApiId; ?>,
      apiHash: <?php echo json_encode($__tgApiHash, JSON_UNESCAPED_SLASHES); ?>
    };
  } catch (e) {}

  var proto  = <?php echo json_encode($__tgProtoSrc, JSON_UNESCAPED_SLASHES); ?>;
  var stream = <?php echo json_encode($__tgStreamSrc, JSON_UNESCAPED_SLASHES); ?>;

  function load(src, done) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = done;
    s.onerror = done;   // xato bo'lsa ham keyingi qadamga o'tamiz (sayt buzilmaydi)
    document.head.appendChild(s);
  }

  // `TgStream.init()` doimiy (sahifadan uzoqroq yashaydigan) taymerlar va
  // listenerlar ochadi. App Shell scope'i ularni sahifa bilan birga
  // o'chirmasligi uchun `WCApp.untracked()` ichida chaqiramiz.
  function initStream() {
    try {
      if (!window.TgStream) return;
      if (window.WCApp && window.WCApp.untracked) {
        window.WCApp.untracked(function () { window.TgStream.init(); });
      } else {
        window.TgStream.init();
      }
    } catch (e) {}
  }

  function ready() {
    // `tg-mtproto.js` -> `window.TgFast` (tez MTProto klienti). `tg-stream.js`
    // uni CHAQIRUV VAQTIDA o'qiydi, shuning uchun ketma-ketlik muhim emas —
    // lekin `init()` dan OLDIN yuklangan bo'lishi shart.
    // Ba'zi sahifalarda tg-stream.js bor, ammo tg-mtproto.js FAQAT prefetch
    // (ijro etilmaydi) -> TgFast yo'q -> tez yo'l ishlamaydi. Shuni ham
    // to'g'rilaymiz: ikkalasi bor bo'lsagina hech narsa yuklamaymiz.
    if (window.TgStream && window.TgFast) {
      initStream();
      return;
    }
    if (window.TgStream) {
      load(proto, initStream);
      return;
    }
    load(proto, function () {
      load(stream, initStream);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }
})();
</script>
