// ============================================================================
// NAMOYASH: Telegram MTProto klienti brauzerda (auth_key foydalanuvchida)
//
// Bu fayl dalil (proof) uchun. Uzumchi arxitektura:
//   1. QR chiqadi -> foydalanuvchi o'z Telegram ilovasidan skanerlaydi
//   2. auth_key FAYDALANUVCHINING brauzeriga (localStorage) tushadi
//   3. Video shu auth_key orqali Telegram CDN dan oqadi
//   4. Sayt serveri video baytini UMUMAN ko'rmaydi
//
// Ishga tushirish: http://localhost/tele_uzdub/tg-proof.php
// ============================================================================
<?php
require_once __DIR__ . '/includes/bootstrap.php';

$tgPost  = isset($_GET['post']) ? preg_replace('/[^A-Za-z0-9_]/', '', (string) $_GET['post']) : 'wcinemauz';
$tgMsgId = (int) ($_GET['id'] ?? 2);
?>
<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MTProto namoyash — W CINEMA</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#0f1115;color:#e8eaed;min-height:100vh;padding:20px}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:22px;margin-bottom:6px}
  .sub{color:#9aa0a6;font-size:14px;margin-bottom:20px;line-height:1.6}
  .card{background:#1a1d23;border:1px solid #2a2e37;border-radius:14px;padding:20px;margin-bottom:16px}
  .card h2{font-size:16px;margin-bottom:12px;color:#8ab4f8}
  button{background:#2a6df4;color:#fff;border:0;border-radius:10px;padding:12px 18px;
         font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}
  button:hover{background:#1f5fd8}
  button:disabled{background:#3a3f4b;cursor:not-allowed}
  button.ghost{background:#2a2e37}
  input{background:#0f1115;border:1px solid #2a2e37;border-radius:10px;padding:12px;
        color:#e8eaed;font-size:15px;width:100%;font-family:inherit}
  #log{font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7;
       background:#0b0d10;border:1px solid #2a2e37;border-radius:10px;padding:12px;
       max-height:230px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  #qrBox{text-align:center;padding:16px;background:#fff;border-radius:12px;display:inline-block}
  #qrBox canvas,#qrBox img{display:block;image-rendering:pixelated}
  .st{font-size:13px;color:#9aa0a6;margin-top:8px}
  .ok{color:#3ddc84}.err{color:#f28b82}.warn{color:#fdd663}
  /* SW izlari (so'rov qatorlari) - xabmaydi, faqat o'qish uchun ixcham */
  .tr{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#6b7280}
  video{width:100%;border-radius:10px;background:#000;display:block}
  .pill{display:inline-block;background:#20242c;border:1px solid #2a2e37;border-radius:20px;
        padding:4px 12px;font-size:12px;margin:4px 4px 0 0}
  .pill.g{background:#12351f;border-color:#1d5c33;color:#6ee7a0}
  .prow{padding:6px 10px;border-radius:8px;font-size:13px;border:1px solid #2a2e37;margin-bottom:5px}
  .prow:hover{background:#20242c}
  a{color:#8ab4f8}
</style>
</head>
<body>
<div class="wrap">
  <h1>MTProto namoyash — brauzerda Telegram klient</h1>
  <div class="sub">
    Auth_key <b>faqat shu brauzerda</b> qoladi. Server hech qanday video baytini ko&prime;rmaydi —
    butun trafik <code>Brauzer &rarr; Telegram CDN</code> bo&prime;linadi.<br>
    Namoyash filmi: <code>t.me/<?= htmlspecialchars($tgPost) ?>/<?= $tgMsgId ?></code>
  </div>

  <!-- 1-QADAM -->
  <div class="card">
    <h2>1-qadam — Telegram&rsquo;ga QR bilan kirish</h2>
    <div class="row">
      <button id="btnStart">QR yaratish</button>
      <span class="st" id="qrStatus">Tugmani bosing &rarr; QR chiqadi</span>
    </div>
    <div style="margin-top:14px;text-align:center">
      <div id="qrBox" hidden></div>
    </div>
    <div class="st" style="margin-top:12px">
      Telegram &rarr; <b>Settings</b> &rarr; <b>Devices</b> &rarr; <b>Link Desktop Device</b> &rarr; QR skanerlang.
    </div>
  </div>

  <!-- 2FA (parol) — faqat Telegram shuni so'raganda chiqadi -->
  <div class="card" id="pwdCard" hidden>
    <h2>2-qadam — Telegram paroli (2FA)</h2>
    <div class="sub" style="margin-bottom:12px">
      Akkauntingizda <b>2-qadamli tasdiqlash</b> yoqilgan.
      Telegram parolini shu yerda kiriting. U <b>faqat shu brauzerda</b>
      ishlatiladi va hech qayerga yuborilmaydi.
    </div>
    <div class="row">
      <input type="password" id="pwdInput" placeholder="Telegram paroli" autocomplete="off">
      <button id="btnPwd">Kirish</button>
    </div>
    <div class="st" id="pwdStatus" style="margin-top:10px"></div>
  </div>

  <!-- 2-QADAM -->
  <div class="card">
    <h2>2-qadam — Video Telegram&rsquo;dan yuklash</h2>
    <div class="row">
      <input id="postInput" value="<?= htmlspecialchars($tgPost) ?>/<?= $tgMsgId ?>"
             placeholder="kanal/xabar">
      <button id="btnLoad" disabled>Videoni yuklash</button>
    </div>
    <div style="margin-top:12px" id="playBox"></div>
    <div class="st" id="playStatus" style="margin-top:10px"></div>

    <div style="margin-top:16px">
      <button id="btnList" class="ghost" disabled>So&prime;nggi postlarni ko&prime;rish</button>
      <div id="postList" style="margin-top:10px"></div>
    </div>
  </div>

  <!-- XOTIRA -->
  <div class="card">
    <h2>3-qadam — Xotira (localStorage)</h2>
    <div id="mem"></div>
    <div class="row" style="margin-top:14px">
      <button id="btnForget" class="ghost">Sessiyani o&prime;chirish</button>
      <span class="st">Telegram'dagi &ldquo;Active Sessions&rdquo;dan ham chiqarish mumkin</span>
    </div>
  </div>

  <!-- LOG -->
  <div class="card">
    <h2>Log</h2>
    <div id="log"></div>
  </div>
</div>

<script src="assets/js/tg-client.bundle.js?v=<?= @filemtime(__DIR__ . '/assets/js/tg-client.bundle.js') ?: 1 ?>"></script>
<script src="assets/js/tg-probe.js?v=<?= @filemtime(__DIR__ . '/assets/js/tg-probe.js') ?: 1 ?>"></script>
<script>
(function () {
  'use strict';

  var API_ID   = <?= (int) TG_API_ID ?>;
  var API_HASH = <?= json_encode(TG_API_HASH) ?>;
  var MEM_KEY  = 'wc_mtproto_auth_v1';

  var T = window.TgBundle || {};
  var client = null;
  var authed = false;

  // ------------------------------------------------------------------ log
  // Xatolar tez-tez takrorlanadi (masalan noto'g'ri parol). Bir xil
  // xabarni ko'p marta yozmasligimiz uchun "ovozini" kamaytiramiz.
  var lastMsg = '';
  var lastRepeat = 0;
  function log(msg, cls) {
    var el = document.getElementById('log');
    if (msg === lastMsg) {
      lastRepeat++;
      // Har 20 marta takrorlanganda bitta qatorga birlashtiramiz
      if (lastRepeat % 20 !== 0) return;
      var tail = el.lastElementChild;
      if (tail && tail.dataset.repeat) {
        tail.textContent = '[' + tail.dataset.t + '] ' + msg
          + '  (x' + lastRepeat + ')';
        el.scrollTop = el.scrollHeight;
        return;
      }
    }
    lastMsg = msg;
    lastRepeat = 1;
    var t = new Date().toLocaleTimeString('uz-UZ');
    var line = document.createElement('div');
    line.dataset.t = t;
    line.dataset.repeat = '1';
    if (cls) line.className = cls;
    line.textContent = '[' + t + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // ------------------------------------------------------- QR (o'zimiz chizamiz)
  // Telegram login token - bu base64 url-encoded satr. Uni QR qilib chizamiz.
  function drawQR(text, size) {
    var box = document.getElementById('qrBox');
    box.hidden = false;
    box.innerHTML = '';
    var qr = T.qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    var count = qr.getModuleCount();
    var scale = (size || 240) / count;
    var cv = document.createElement('canvas');
    cv.width = cv.height = count * scale;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(c * scale, r * scale, scale, scale);
      }
    }
    box.appendChild(cv);
  }

  // ------------------------------------------------------- base64url (token)
  // GramJS QR tokenini XOM BAYTLAR sifatida beradi (Buffer/Uint8Array).
  // Telegram esa uni base64url matnida kutadi:
  //   tg://login?token=<base64url>
  // "+" -> "-", "/" -> "_", "=" olib tashlanadi (URL-safe base64).
  function bytesToBase64Url(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bin = '';
    // Katta massivlarda String.fromCharCode limiti oshmasligi uchun
    // bo'laklab qo'shamiz.
    var CHUNK = 8192;
    for (var i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ------------------------------------------------------------ 2FA parol
  // Telegram akkauntingizga kirganda 2-qadamli tasdiqlash (cloud password)
  // parolini so'rashi mumkin. Bu parol:
  //   - FAQAT shu sahifada ishlatiladi
  //   - W CINEMA serveriga umuman yuborilmaydi
  //   - localStorage'ga HAM yozilmaydi (kalit bo'lsa ham - bu yo'q)
  var pwdResolve = null;

  function askPassword() {
    // GramJS har urinishda chaqiradi. Biz hali javob kutayotgan
    // bo'lsak, xuddi shu promise'ni qaytaramiz.
    if (pwdResolve) return pwdResolve;

    document.getElementById('pwdCard').hidden = false;
    var inp = document.getElementById('pwdInput');
    var st = document.getElementById('pwdStatus');
    inp.value = '';
    st.innerHTML = 'Telegram <b>Settings &rarr; Privacy and Security &rarr; Two-Step Verification</b> ' +
                   'dagi parolni kiriting.';
    inp.focus();

    pwdResolve = new Promise(function (resolve) {
      function submit() {
        var v = inp.value.trim();
        if (!v) { st.innerHTML = '<span class="err">Parol bo\'sh</span>'; return; }
        st.innerHTML = 'Tekshirilmoqda...';
        pwdResolve = null;      // keyingi urinish uchun tayyor
        inp.value = '';
        resolve(v);
      }
      document.getElementById('btnPwd').onclick = submit;
      inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    });

    log('2FA so\'raldi - Telegram parolini kiriting', 'warn');
    return pwdResolve;
  }

  // ------------------------------------------------------------ localStorage
  function saveSession(str) {
    try { localStorage.setItem(MEM_KEY, str); return true; }
    catch (e) { log('localStorage yozilmadi: ' + e.message, 'err'); return false; }
  }
  function loadSession() {
    try { return localStorage.getItem(MEM_KEY) || ''; } catch (e) { return ''; }
  }
  function showMem() {
    var s = loadSession();
    var box = document.getElementById('mem');
    if (!s) { box.innerHTML = '<span class="st">Hali sessiya yo&prime;q</span>'; return; }
    var kb = (s.length / 1024).toFixed(1);
    box.innerHTML = '<span class="pill g">auth_key saqlangan</span>'
      + '<span class="pill">' + kb + ' KB</span>'
      + '<span class="pill">faqat shu brauzerda</span>';
  }

  // ------------------------------------------------------------------- login
  async function startQR() {
    // HIMOYA: bitta auth_key bilan IKKI TA Telegram klientini ochish
    // mumkin emas — ular bir-birining paketlariga aralashadi va Telegram
    // "AUTH_BYTES_INVALID" beradi (sabab: MTProto seq chegarasiga
    // mos kelmaydi). Shuning uchun klient bir marta ochilgan bo'lsa,
    // qayta chaqirish butunlay bekor qilinadi.
    if (client && typeof client.isConnected !== 'undefined' && client.isConnected) {
      log('Sessiya allaqachon ochiq — qayta ulanmayman', 'warn');
      return;
    }
    if (window.__starting) {
      log('Ulanish jarayonda — kutib turibman', 'warn');
      return;
    }
    window.__starting = true;

    var btn = document.getElementById('btnStart');
    btn.disabled = true;
    document.getElementById('qrStatus').textContent = 'Telegram serverga ulanmoqda...';
    log('GramJS yuklandi: ' + (T.TelegramClient ? 'ha' : 'YOQ'));

    try {
      var saved = loadSession();
      client = new T.TelegramClient(
        new T.StringSession(saved),
        API_ID,
        API_HASH,
        {
          connectionRetries: 3,
          // Brauzerda TCP socket yo'q -> GramJS'ning WebSocket transportini
          // ishlatamiz (Telegram Web ham shu yo'l bilan ishlaydi).
          networkSocket: T.PromisedWebSockets,
          app: { platform: 'web' }
        }
      );

      log('MTProto sessiya ochilmoqda (auth_key: ' + (saved ? 'keshdan' : 'yangi') + ')');

      // DIQQAT: GramJS'ning `start()` foydalanuvchini QAYTARMAGAN -
      // u `undefined` beradi (faqat ulanish va autentifikatsiyani bajaradi).
      // Foydalanuvchi ma'lumotini alohida `getMe()` orqali olamiz.
      await client.start({
        // GramJS QR rejimini shu yolg'an xato orqali taniydi: telefon
        // so'raganda "RESTART_AUTH_WITH_QR" xatosi tashlaymiz va u
        // o'zi auth.exportLoginToken ga o'tadi.
        phoneNumber: async () => {
          var e = new Error('QR login');
          e.errorMessage = 'RESTART_AUTH_WITH_QR';
          throw e;
        },
        // Akkauntda 2-qadamli tasdiqlash (cloud password) yoqilgan bo'lsa,
        // Telegram shu yerda parol so'raydi. Biz foydalanuvchidan so'raymiz.
        password: askPassword,
        qrCode: async ({ token }) => {
          // GramJS `token` ni XOM BAYTLAR (Buffer/Uint8Array) sifatida
          // beradi. Telegram esa uni base64url matnida kutadi:
          //   tg://login?token=<base64url-baytlar>
          // Agar baytlarni to'g'ridan-to'g'ri satrga aylantirsak, QR ichida
          // chalkash (belgili kodlar) matn chiqadi va Telegram uni
          // "skaner qilinmaydi" deb rad etadi.
          var b64 = bytesToBase64Url(token);
          var url = 'tg://login?token=' + b64;
          drawQR(url, 240);
          document.getElementById('qrStatus').innerHTML =
            'QR skanerlang &rarr; <span class="warn">Token ' + token.length + ' bayt</span>';
          log('QR yaratildi: ' + url.slice(0, 46) + '... (' + token.length + ' bayt)');
        },
        onError: (err) => {
          var m = (err && (err.errorMessage || err.message)) || 'noma\'lum';
          var st = document.getElementById('pwdStatus');

          // --- 2FA holatlari (xato emas, normal jarayon) ---
          if (m === 'SESSION_PASSWORD_NEEDED') {
            log('Telegram 2FA parolini so\'radi', 'warn');
            return;  // false -> GramJS keyingi urinishni boshlaydi
          }
          if (m === 'PASSWORD_HASH_INVALID') {
            log('Parol noto\'g\'ri - qayta kiritish kerak', 'err');
            st.innerHTML = '<span class="err">Parol noto\'g\'ri. Yana urinib ko\'ring.</span>';
            return;
          }

          // --- haqiqiy xatolar ---
          log('XATO: ' + m, 'err');
          return true;   // true -> GramJS urinishni to'xtatadi (AUTH_USER_CANCEL)
        }
      });

      authed = true;
      var sess = client.session.save();
      saveSession(sess);
      log('auth_key saqlandi (' + (sess.length / 1024).toFixed(1) + ' KB) - faqat shu brauzerda', 'ok');

      // Endi foydalanuvchini o'zimiz so'raymiz
      var me = await client.getMe();
      var who = '@' + (me.username || (me.firstName + ' ' + (me.lastName || ''))).trim();
      log('Muvaffaqiyat! Kirildi: ' + who, 'ok');

      document.getElementById('qrStatus').innerHTML = '<span class="ok">Kirildi: ' + who + '</span>';
      document.getElementById('qrBox').hidden = true;
      document.getElementById('pwdCard').hidden = true;
      document.getElementById('btnLoad').disabled = false;
      var bl = document.getElementById('btnList');
      if (bl) bl.disabled = false;
      showMem();
      btn.textContent = 'Ulanish';
      btn.disabled = false;
      btn.classList.add('ghost');

      loadVideo();
    } catch (e) {
      // GramJS "AUTH_USER_CANCEL" degani bizning onError dagi "to'xtat"
      // signalimizni aylantiradi - bu aslida quyidagi haqiqiy xatoni
      // ko'rsatadi, shuning uchun undan foydalanmaymiz.
      var msg = (e && e.message) ? e.message : String(e);
      log('XATO: ' + msg, 'err');
      document.getElementById('qrStatus').innerHTML =
        '<span class="err">Xato: ' + msg + '</span>';
      btn.disabled = false;
      btn.textContent = 'Qayta urinish';
    } finally {
      // Ulanish urinish tugadi (muvaffaqiyat yoki xato) — keyingi
      // chaqiruvga yo'l ochiq. (Ishga tushganda belgi qo'yiladi.)
      window.__starting = false;
    }
  }

  // ------------------------------------------------------- video Telegram'dan
  function parsePost(v) {
    var m = String(v).match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#]+)\/(\d+)/i)
         || String(v).match(/^@?([^/?#]+)\/(\d+)$/);
    if (!m) return null;
    return { peer: m[1], id: parseInt(m[2], 10) };
  }

  // --------------------------------------------------- xabar topish (to'g'ri usul)
  //
  // DIQQAT 1: `messages.getHistory` dagi `offsetId` - CHEGARASIZ shart.
  // Ya'ni offsetId=2 desangiz Telegram id < 2 bo'lgan xabarni qaytaradi
  // (ya'ni id=1 ni, id=2 ni EMAS). Shu sababli avvalgi urinishda
  // boshqa xabar keldi va "video yo'q" chiqdi.
  //
  // DIQQAT 2: Kanal xabarlari uchun `messages.getMessages` ishlamaydi -
  // kerak bo'lgani `channels.getMessages` (maydon nomi `channel`, `peer`
  // emas). GramJS'ning `client.api` qatlami buni avtomatik to'g'rilamaydi,
  // lekin `client.getMessageByLink(link)` hamma shaklni (t.me/kanal/1,
  // t.me/c/123/1, privat havola) o'zi to'g'ri ochadi - shuning uchun
  // undan boshlaymiz.
  function peerOf(peer) { return '@' + String(peer).replace(/^@/, ''); }

  async function fetchPost(peer, id) {
    var link = 'https://t.me/' + peerOf(peer).slice(1) + '/' + id;
    var P = peerOf(peer);

    // 1) GramJS'ning tayyor metodi - eng to'g'ri yo'l
    try {
      var m = await client.getMessageByLink(link);
      if (m && m.id) return m;
    } catch (e) {
      log('  getMessageByLink: ' + (e.errorMessage || e.message), 'warn');
    }

    // 2) Zaxira: kanal uchun channels.getMessages (maydon: channel)
    try {
      var r = await client.api.channels.getMessages({ channel: P, id: [id] });
      var c = r && (r.messages || r)[0];
      if (c && c.id) return c;
    } catch (e) {
      log('  channels.getMessages: ' + (e.errorMessage || e.message), 'warn');
    }

    // 3) Oddiy guruh (private) uchun
    try {
      var r2 = await client.api.messages.getMessages({ peer: P, id: [id] });
      var m2 = r2 && r2.messages && r2.messages[0];
      if (m2 && m2.id) return m2;
    } catch (e) {
      log('  messages.getMessages: ' + (e.errorMessage || e.message), 'warn');
    }

    // 4) Zaxira: getHistory (offsetId chegarasiz - shuning uchun +1)
    try {
      var h = await client.api.messages.getHistory({ peer: P, offsetId: id + 1, limit: 1 });
      return (h && h.messages && h.messages[0]) || null;
    } catch (e) {
      log('  getHistory: ' + (e.errorMessage || e.message), 'warn');
      return null;
    }
  }

  // Xabardagi videoni topish. Album (guruh) postlarda video boshqa
  // xabarda bo'lishi mumkin - shuning uchun qo'shnilar ham tekshiriladi.
  function docOf(msg) {
    if (!msg || !msg.media) return null;
    if (msg.media.document) return msg.media.document;
    if (msg.media.webpage && msg.media.webpage.document) return msg.media.webpage.document;
    return null;
  }

  function describe(msg) {
    if (!msg) return '(xabar yo\'q)';
    var s = '#' + msg.id + ' · ' + (msg.media ? msg.media.className : 'medi yo\'q');
    if (msg.groupedId) s += ' · ALBUM';
    if (msg.message) s += ' · "' + String(msg.message).slice(0, 50) + '"';
    return s;
  }

  // Album bo'lsa yoki video topilmasa - qo'shni xabarlarni ko'ramiz
  async function findVideoInPost(msg, peer, id) {
    var doc = docOf(msg);
    if (doc) return doc;

    // Album: id atrofidagi 10 ta xabarni tekshiramiz
    var ids = [];
    for (var i = id; i < id + 10; i++) ids.push(i);
    try {
      var r = await client.api.channels.getMessages({ channel: peerOf(peer), id: ids });
      var list = (r && r.messages) || [];
      log('  ' + list.length + ' ta qo\'shni xabar tekshirildi (album bo\'lishi mumkin)', 'warn');
      for (var k = 0; k < list.length; k++) {
        var d2 = docOf(list[k]);
        if (d2) {
          log('  video #' + list[k].id + ' da topildi (album)', 'ok');
          return d2;
        }
      }
    } catch (e) {
      log('  album tekshiruvi: ' + (e.errorMessage || e.message), 'warn');
    }
    return null;
  }

  // Videoning texnik ko'rsatkichlari
  //
  // DIQQAT: `doc.size` GramJS'da "big-integer" obyekti (Long), oddiy son
  // EMAS. Shu sababli to'g'ridan-to'g'ri arifmetika ishlamaydi - avval
  // String'ga o'tkazib, keyin Number qilamiz.
  function bytesOf(doc) {
    var s = doc && doc.size;
    if (s === undefined || s === null) return 0;
    if (typeof s === 'number') return s;
    if (typeof s === 'string') return Number(s);
    return Number(s.toString());
  }

  function videoInfo(doc) {
    var a = (doc.attributes || []).find(function (x) {
      return x.className === 'DocumentAttributeVideo';
    });
    return {
      w: a ? a.w : 0,
      h: a ? a.h : 0,
      duration: a ? a.duration : 0,
      codec: (a && (a.videoCodec || (a.codec && a.codec.name))) || 'h264',
      filename: (function () {
        var f = (doc.attributes || []).find(function (x) {
          return x.className === 'DocumentAttributeFilename';
        });
        return f ? f.fileName : '';
      })()
    };
  }

  async function loadVideo() {
    var st = document.getElementById('playStatus');
    var box = document.getElementById('playBox');
    var val = document.getElementById('postInput').value.trim();
    var p = parsePost(val);
    if (!p) { st.innerHTML = '<span class="err">Manzilni tushunmadim</span>'; return; }

    box.innerHTML = '';
    st.textContent = 'Telegram\'dan yuklanmoqda...';
    var t0 = performance.now();

    try {
      log('Xabar so\'ralmoqda: ' + p.peer + '/' + p.id);

      var msg = await fetchPost(p.peer, p.id);
      if (!msg) throw new Error('Xabar topilmadi (kanal ommaboy emasmi? yoki ' + p.id + ' raqamli post yo\'q)');

      log('Topildi: ' + describe(msg));
      if (msg.id !== p.id) log('DIQQAT: so\'ralgan ' + p.id + ', kelgani ' + msg.id, 'warn');

      var doc = await findVideoInPost(msg, p.peer, p.id);
      if (!doc) {
        throw new Error('Bu xabarda video topilmadi (' + describe(msg) + ')');
      }

      var size = bytesOf(doc);
      var info = videoInfo(doc);
      var mb = (size / 1048576).toFixed(1);
      var dur = info.duration ? Math.round(info.duration / 60) + ' daqiqa' : '?';

      st.innerHTML = 'Topildi: <b>' + mb + ' MB</b> · ' + info.w + '&times;' + info.h
        + ' · ' + dur + ' · serverdan <b>0 bayt</b>';
      log('Video topildi: ' + mb + ' MB, ' + info.w + 'x' + info.h + ', ' + dur);
      log('Koder: ' + info.codec + (info.filename ? ' · fayl: ' + info.filename : ''));

// ================================================= TELEGRAM CDN (Service Worker)
      //
      // Nima uchun shunday? (bu qaror sinovdan chiqdi, quyida dalil)
      //
      //   Bu videoning MP4 tuzilmasi:
      //       ftyp(32) -> free(8) -> mdat(543 MB) -> moov(2.4 MB)
      //   Ya'ni INDEKS (moov) faylning OXIRIDA.
      //
      //   MSE (MediaSource Extensions) bu vazifani BAJON QILMAYDI:
      //   Chrome'ning MSE qatlami faqat FRAGMENTLANGAN MP4 (moof+mdat)
      //   qabul qiladi. Telegram videolari mos (fragmentlanmagan) MP4 -
      //   shuning uchun MSE ularni rad etadi: video.error = 4.
      //   (Brauzerda tekshirildi: bo'laklab oqish, hatto butun faylni
      //    bitta append qilib ham - har doim XATO 4.)
      //
      //   Oddiy <video src> esa ISHLAYDI. Chunki u o'zi qaror qabul qiladi:
      //   avval boshdan boshlaydi, keyin indeks topilmaganini sezib faylning
      //   OXIRIDAN qayta so'raydi, so'ng kerakli baytlarni so'raydi.
      //   Ya'ni barcha "qiyin" ishni brauzer o'zi qiladi.
      //
      //   Bizning vazifamiz faqat bitta: brauzerga Telegram CDN ni
      //   oddiy HTTP server sifatida ko'rsatish. Shu uchun Service Worker.
      //
      //   Natijada:
      //     - <video> butunlay oddiy: src, seek, to'xtatish, sifat - hamma
      //     - faylning 520 MB emas, FAQAT kerakli qismi o'qiladi
      //     - sayt serveri umuman video ko'rmaydi
      var v = document.createElement('video');
      v.controls = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.style.width = '100%';
      v.style.maxWidth = '720px';
      v.style.background = '#000';
      v.style.borderRadius = '10px';
      box.appendChild(v);

      if (!('serviceWorker' in navigator)) {
        throw new Error('Brauzeringiz Service Worker\'ni qo\'llamaydi');
      }

      // --- 1) Service Worker tayyorligini tekshiramiz --------------------
      //
      // SW sahifa ochilishidayin ro'yxatdan o'tkaziladi (quyida init qismida),
      // shuning uchun bu yerda odatda allaqachon tayyor.
      if (!navigator.serviceWorker.controller) {
        st.innerHTML = 'Service Worker tayyorlanmoqda...';
        var okSw = await ensureWorker();
        if (!okSw) {
          st.innerHTML = '<span class="warn">Service Worker tayyor emas — sahifa qayta yuklanmoqda...</span>';
          return;   // ensureWorker() o'zi reload qiladi
        }
      }
      log('Service Worker faol (sahifani boshqaradi)', 'ok');

      // DIQQAT: `navigator.serviceWorker.controller` ni bir marta OLIB
      // SAQLAMASLIK KERAK. Service Worker yangilanganda (yoki sahifa qayta
      // yuklanganda) controller obyekti ALMASHADI, lekin eski obyekt saqlanib
      // qolsa — unga yuborilgan xabarlar JIMGINA yo'qoladi (xato ham chiqmaydi).
      // Shu sababli har doim jonli qiymatni so'raymiz.
      function swCtl() {
        return navigator.serviceWorker.controller;
      }

      // --- 2) MTProto manzilini tayyorlaymiz ---------------------------
      // upload.getFile ga kerakli hujjat ma'lumotlari. GramJS'ning qulay
      // iterDownload oqimi ham shu ichida ishlaydi, lekin u ketma-ket
      // BUTUN faylni o'qishga mo'ljallangan - bizga esa TUTUNCHA istalgan
      // oraliq kerak (seek uchun).
      var Loc = T.Api.InputDocumentFileLocation;
      var loc = new Loc({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: ''
      });
      log('Manzil tayyor: DC ' + doc.dcId + ' · id ' + doc.id, 'ok');

      // --- 3) SW bilan bog'lanamiz (MessageChannel) --------------------
      //
      // SW o'z xotirasiga ishonmaydi: brauzer uni ixtiyoriy paytda o'chirib
      // tashlaydi va qayta ishga tushganda "javobgar port" yo'qoladi. Shuning
      // uchun `connect()` qayta chaqirilishi mumkin bo'lgan funksiya qildik.
      var chan = null;
      var totalRead = 0;

      // Telegram'dan aniq baytlarni o'qish
      function readBytes(offset, length) {
        // DIQQAT, IKKI QOIDA (ikkisini buzsa Telegram "LIMIT_INVALID" beradi
        // va video umuman o'ynamaydi):
        //
        //   1) `offset` 4096 ga tekislangan bo'lishi SHART.
        //   2) `limit` HAM 4096 ga bo'linishi shART!
        //
        // 2-qoida oson o'tib ketadi va shuning uchun ko'pincha xato qilinadi:
        // "length + (offset - aligned)" odatda 4096 ga tegilmaydi
        // (masalan 512 KB + 37 bayt), va Telegram butun so'rovni rad etadi.
        //
        // YO'NALISH MUHIM: limitni YUQORIGA tegislaymiz. Pastga tegislasak,
        // `skip` baytlar yig'ilib qoladi va biz so'ramandan KAMROQ bayt
        // qaytaramiz (masalan 524288 + 1 -> 524287) — SW buni "fayl tugadi"
        // deb tushunib oraliqni kesib qoldiradi, brauzer buzilgan MP4 oladi.
        var aligned = Math.floor(offset / 4096) * 4096;
        var skip = offset - aligned;

        var want = Math.ceil((length + skip) / 4096) * 4096;
        if (want < 4096) want = 4096;        // juda kichik so'rovlar uchun

        return client.invoke(new T.Api.upload.GetFile({
          location: loc,
          offset: aligned,
          limit: want,
          precise: true
        }), doc.dcId).then(function (res) {
          var b = res.bytes;

          // Telegram so'ramaganda KAMROQ bayt qaytarishi mumkin (fayl oxiri,
          // yoki boshqa DC'da vaqtincha yetishmovchilik). Shu holatda ortiqcha
          // joyni nol bilan to'ldirib, haqiqiydek yubormasligimiz kerak -
          // aks holda brauzer buzilgan MP4 oladi. Shuning uchun faqat
          // QO'LGA KETGAN qismini qaytaramiz.
          var take = Math.min(length, Math.max(0, b.length - skip));
          if (take <= 0) throw new Error('Telegram bo\'sh javob berdi');

          return b.slice(skip, skip + take);
        });
      }

      // SW'ga o'zimizni "javobgar" deb tanishtirish
      //
      // Bu funksiya KO'P MARTA chaqiriladi va har doim xuddi shu ishni qiladi:
      //   • sahifa ochilganda,
      //   • SW o'zini qayta ishga tushirganda (bo'sh turgan paytda brauzer
      //     uni o'chirib tashlaydi),
      //   • SW yangilanganida (controller obyekti almashadi),
      //   • SW "qayta ulan" deb murojaat qilganda.
      // Har chaqiruv yangi kanal yaratadi — eskisi endi kerak emas.
      function connect() {
        var ctl = swCtl();
        if (!ctl) return false;
        chan = new MessageChannel();
        chan.port1.onmessage = onRead;
        chan.port1.start();
        ctl.postMessage({ type: 'provide', size: size }, [chan.port2]);
        return true;
      }

      // SW so'rov yuborganda javob beramiz
      function onRead(ev) {
        var d = ev.data || {};
        if (d.type !== 'read') return;
        var port = ev.ports && ev.ports[0];

        readBytes(d.offset, d.length).then(function (out) {
          totalRead += out.length;
          if (port) port.postMessage({ type: 'result', id: d.id, bytes: out });

          var pct = Math.min(100, Math.round(totalRead / size * 100));
          st.innerHTML = 'Telegram CDN dan: <b>' + pct + '%</b> · '
            + (totalRead / 1048576).toFixed(1) + '/' + mb + ' MB · '
            + 'serverdan <b>0 bayt</b>';
        }).catch(function (err) {
          var m = (err && (err.errorMessage || err.message)) || String(err);

          if (m === 'NO_PROVIDER') {
            // SW o'zini qayta ishga tushirgan - qayta ulanib, so'rovni
            // takror qilamiz. (Brauzer SW'ni bo'sh turgan paytda o'chiraveradi)
            log('SW qayta ishga tushdi - qayta ulanmoqda...', 'warn');
            connect();
            retryRange(d.offset, d.length);
            return;
          }

          if (port) port.postMessage({ type: 'result', id: d.id, error: m });
          log('Telegram o\'qish xatosi: ' + m, 'err');
        });
      }

      // SW'dan "javob yo'q" kelganda, yangi so'rovni o'zimiz uchratamiz.
      // Sahifaning fetch() ham SW orqali o'tadi, demak shu yangi so'rov
      // <video> ning keyingi so'rovi kabi ishlaydi.
      function retryRange(offset, length) {
        setTimeout(function () {
          fetch('tgfile/?size=' + size + '&t=' + Date.now(), {
            headers: { Range: 'bytes=' + offset + '-' + (offset + length - 1) }
          }).catch(function () { /* javob muhim emas */ });
        }, 80);
      }

      // SW o'zi "qayta ulan" deb murojaat qilganda javob beramiz.
      // (SW'ning xotirasi bo'sh bo'lib qolsa — u tez-tez o'chib ketadi.)
      window.__tgReconnect = connect;
      navigator.serviceWorker.addEventListener('message', function (ev) {
        var d = ev.data || {};
        if (d.type === 'needProvider' && typeof window.__tgReconnect === 'function') {
          window.__tgReconnect();
        }
        // SW'ning o'z izi: qaysi oraliqlar so'raldi, xato bo'lsa nimasi.
        // Bu log muhim — "format qo'llab-quvvatlanmaydi" degan xatoning
        // transportdan kelayotganini yoki yo'qligini shundan ko'ramiz.
        if (d.type === 'log') log('SW · ' + d.msg, 'tr');
      });

      // SW yangilanganda controller obyekti ALMASHADI. Eski obyektka yuborilgan
      // xabarlar jimgina yo'qoladi — shuning uchun yangi controller'ga darhol
      // qayta ulanib, o'zimizni qayta tanishtiramiz.
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        log('Service Worker yangilandi — qayta ulanmoqda...', 'warn');
        if (typeof window.__tgReconnect === 'function') window.__tgReconnect();
      });

      connect();

      // --- 4) Fayl FORMATINI aniqlaymiz (brauzergа yubormasdan turib) ----
      //
      // Nima uchun? "<video> XATO 4: format qo'llab-quvvatlanmaydi" degan
      // xato IKKITA narsadan kelishi mumkin:
      //   (a) transport noto'g'ri (biz noto'g'ri bayt beramiz), yoki
      //   (b) faylning o'zi brauzerda o'ynatilmaydi (MKV, yoki HEVC/H.265 -
      //       Chrome uni H.264 ni qo'llab-quvvatlamaydi).
      // Ularni ajratish uchun MP4 sarlavhasini qo'lda O'QAMIZ va
      // (b) isbotlanadigan bo'ladi. Bu uchun Telegram'dan bir nechta
      // kichik oraliq so'raymiz — butun fayl emas.
      // Oraliq olish — SW orqali, Telegram'dan (brauzer hajmiga to'g'ri
      // keladigan so'rovni o'zi yuboradi).
      function rangeOf(start, end) {
        return fetch('tgfile/?size=' + size + '&t=' + Date.now(),
          { headers: { Range: 'bytes=' + start + '-' + end } })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          })
          .then(function (b) { return new Uint8Array(b); });
      }

      var probe;
      try {
        probe = await probeMp4(size, rangeOf);
      } catch (pe) {
        probe = { error: String((pe && pe.message) || pe), playable: true,
                  summary: 'sarlavha o\'qilmadi: ' + ((pe && pe.message) || pe) };
        log('MP4 tahlili muvaffaqiyatsiz: ' + probe.error, 'warn');
      }
      window.__probe = probe;
      log('MP4 tahlili: ' + probe.summary, probe.playable ? 'ok' : 'err');
      if (probe.truncated) log('  ' + probe.truncated, 'warn');

      // --- 5) Agar fayl BRAUZERDA OYNATILMAYDIGAN bo'lsa ---------------
      //
      // Bu yerda yashirinch chora yo'q va kerak ham emas:
      //   • MKV ni Chrome o'qimaydi — buni hech qanday "yo'qotish" bilmaydi.
      //   • Server orqali MP4'ga o'girish videoni YUKLAB KETISHNI talab
      //     qiladi, bizning asosiy qoidamiz esa — server yuk OLMASLIGI.
      // To'g'ri yo'l: foydalanuvchini Telegram ilovasiga yo'naltiramiz.
      if (!probe.playable) {
        var why = probe.reason || 'bu format brauzerda qo\'llab-quvvatlanmaydi';
        var urlTg = 'https://t.me/' + p.peer + '/' + p.id;
        // Bo'sh qora <video> qoldirmaymiz — u CTA ning ustida chalkash
        // ko'rinardi ("nima uchun hech narsa yo'q?").
        if (v.parentNode) v.parentNode.removeChild(v);
        st.innerHTML = '<div style="padding:14px;border:1px solid #f28b82;'
          + 'border-radius:10px;background:#3d1f1f">'
          + '<b>' + why + '</b><br><span style="opacity:.85">'
          + 'Transport to\'g\'ri ishladi — fayl Telegram\'dan to\'liq o\'qildi. '
          + 'Muammo faqat formatda.</span>'
          + '<a href="' + urlTg + '" target="_blank" rel="noopener"'
          + ' style="display:inline-block;margin-top:12px;padding:11px 20px;'
          + 'background:#2aabee;color:#fff;border-radius:8px;'
          + 'font-weight:600;text-decoration:none">'
          + 'Telegram ilovasida ochish &rarr;</a></div>';
        log('Bu fayl brauzerda oynatilmaydi — Telegram\'ga yo\'naltirildi', 'warn');
        return;
      }

      // --- 6) <video> ga soxta CDN URL beramiz -------------------------
      // Brauzer endi shu URL ga Range so'rovi yuboradi - SW ularni yoniga
      // olib, Telegram'dan so'raydi.
      var url = 'tgfile/?size=' + size + '&t=' + Date.now();
      v.src = url;
      log('<video src> = ' + url, 'ok');
      st.innerHTML = 'Telegram CDN ulanmoqda...';

      // --- 6) Natija loglari ------------------------------------------
      v.addEventListener('loadedmetadata', function () {
        log('Metadata: ' + Math.round(v.duration) + ' soniya, '
          + v.videoWidth + 'x' + v.videoHeight + ' — serverdan 0 bayt', 'ok');
        st.innerHTML = '<span class="ok">Tayyor: ' + Math.round(v.duration / 60)
          + ' daqiqa · serverdan 0 bayt</span>';
      });
      v.addEventListener('canplay', function () {
        log('Oqishga tayyor — o\'ynashni bosing', 'ok');
      });
      v.addEventListener('timeupdate', function () {
        if (v.currentTime > 0 && !window.__firstPlay) {
          window.__firstPlay = true;
          log('▶ OQMOQDA! (' + (totalRead / 1048576).toFixed(1)
            + ' MB o\'qildi, serverdan 0 bayt)', 'ok');
        }
      });
      v.addEventListener('error', function () {
        var err = v.error || {};
        var sabab = {
          1: 'o\'qish to\'xtatildi',
          2: 'tarmoq xatosi',
          3: 'dekoding xatosi — koder mos emas',
          4: 'format qo\'llab-quvvatlanmaydi'
        }[err.code] || 'noma\'lum';
        log('<video> XATO ' + err.code + ': ' + sabab, 'err');
        st.innerHTML = '<span class="err">Video o\'ynamadi (' + sabab + ')</span>';
      });

      log('Tayyor. Endi brauzer o\'zi kerakli baytlarni so\'raydi.', 'ok');

    } catch (e) {
      var em = (e && (e.errorMessage || e.message)) || e;
      log('Yuklash xatosi: ' + em, 'err');
      st.innerHTML = '<span class="err">' + em + '</span>';
    }
  }

  // =========================================================================
  //  MP4 Sarlavhasini Tikilash  ->  assets/js/tg-probe.js
  // =========================================================================
  //
  // DIQQAT: bu kod endi BU YERDA EMAS. U `assets/js/tg-probe.js` da yashaydi
  // va yuqoridagi <script> qatori orqali yuklanadi.
  //
  // Ilgari shu yerda nusxa bor edi. U xato edi: quti yozuvidagi indekslar
  // FAYL manzilidan boshlanardi, DataView esa BO'LAKka qaragan edi ->
  // "Offset is outside the bounds of the DataView". Nusxa o'zgartirilganda
  // eskirib qolardi va tuzatish unga yetib borMAYdi (sinov ham aynan
  // nusxani tekshirardi, shuning uchun xato "yashil" ko'rinardi).
  //
  // Endi bitta manba bor: bitta fayl, bitta sinov.
  // ------------------------------------------------- Service Worker (sahifa ochilishida)
  //
  // Nima uchun shu yerda? <video> so'rovi faqat Service Worker orqali
  // Telegram'ga boradi. Agar SW sahifani boshqarmasa, <video> so'rovi
  // butunlay serverga (404) ketadi — hech narsa o'ynamaydi.
  //
  // Eng ko'p uchraydigan holat: SW BIRINCHI marta o'rnatilganda joriy sahifa
  // hali boshqarilmaydi. Buni tuzatish uchun sahifani bir marta qayta
  // yuklash kerak. Lekin bunda ikki xavf bor:
  //
  //   1) Hali faollashmagan SW ni kutmasdan qayta yuklash — yana bir xil
  //      natija, cheksiz urinish.
  //   2) "Allaqachon qayta yukladim" belgisini DOIMIY saqlash — bu ham
  //      yomon: sessionStorage sahifa qayta yuklanganda ham o'chmaydi, ya'ni
  //      bir marta belgi qo'yilgach, keyingi barcha urinishlar darhol
  //      "qo'lda Ctrl+F5 qiling" deya to'xtaydi. (Aynan shu holat bo'ldi.)
  //
  // Shuning uchun: avval KUTAMIZ (controllerchange), keyin vaqt bilan
  // chegaralangan qayta yuklaymiz — oxirgi urinishdan 6 s o'tgan bo'lsa.
  // Bu cheksiz halqani ham, butunlay qotib qolishni ham yo'q qiladi.
  var RELOAD_AT = 'wc_sw_reload_at';       // oxirgi urinish VAQT_I (soniya)

  function waitForController(ms) {
    return new Promise(function (res) {
      if (navigator.serviceWorker.controller) { res(true); return; }
      var settled = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (settled) return;
        settled = true;
        res(true);
      }, { once: true });
      setTimeout(function () {
        if (settled) return;
        settled = true;
        res(!!navigator.serviceWorker.controller);
      }, ms);
    });
  }

  async function ensureWorker() {
    if (!('serviceWorker' in navigator)) {
      log('Bu brauzer Service Worker\'ni qo\'llab-quvvatlamaydi', 'err');
      return false;
    }

    var reg;
    try {
      // `updateViaCache: 'none'` — SW skriptini har doim SERVER dan oladi.
      // Aks holda brauzer eski kodni HTTP keshidan beradi va yangi tuzatishlar
      // (bo'lak hajmi, Range mantiqi) umuman qo'llanilmay qoladi — bu holat
      // juda chalkash: kod yangilangan, lekin xuddi eskidek xato beradi.
      reg = await navigator.serviceWorker.register('tg-cdn-worker.js', {
        scope: './',
        updateViaCache: 'none'
      });
      await navigator.serviceWorker.ready;
    } catch (e) {
      log('Service Worker o\'rnatilmadi: ' + ((e && e.message) || e), 'err');
      return false;
    }

    if (navigator.serviceWorker.controller) return true;

    // --- 1) SW faollashgacha kutamiz ---------------------------------
    // SW `activate` da `clients.claim()` chaqiradi, lekin u sahifaga
    // yetib borishi kechikishi mumkin. 4 s kutamiz.
    log('Service Worker faollashmoqda...', 'st');
    if (await waitForController(4000)) return true;

    // --- 2) Aniq "homiylash" so'raymiz -------------------------------
    // Bu ishonchliroq: `activate` hodisasi o'tib ketgan bo'lishi mumkin
    // (sahifa keyin yuklangan), lekin `claim` har qachon chaqirsa bo'ladi.
    try {
      if (reg && reg.active) reg.active.postMessage({ type: 'claim' });
      if (await waitForController(3000)) return true;
    } catch (e) { /* keyingi bosqichga o'tamiz */ }

    // --- 3) Sahifani qayta yuklaymiz (vaqt bilan cheklangan) ---------
    if (!reloadPage('Service Worker birinchi marta o\'rnatilmoqda')) {
      // --- 4) To'liq tozalash (oxirgi chora) -------------------------
      // Yuqoridagilar ish bermasa, ro'yxat buzilgan bo'lishi mumkin:
      // yarim qolgan o'rnatish, eskirgan skript, noto'g'ri scope.
      // Bunday holatdan faqat to'liq o'chirib, qayta o'rnatish chiqadi.
      log('Service Worker holati buzilgan — to\'liq tozalanmoqda...', 'warn');
      try {
        var rs = await navigator.serviceWorker.getRegistrations();
        for (var i = 0; i < rs.length; i++) await rs[i].unregister();
        if (window.caches && caches.keys) {
          var keys = await caches.keys();
          for (var j = 0; j < keys.length; j++) await caches.delete(keys[j]);
        }
      } catch (e) { /* keyingi qadamga o'tamiz */ }

      reloadPage('Service Worker qaytadan o\'rnatilmoqda');
    }
    return false;

    // Sahifani qayta yuklash — lekin CHEKSIZ halqa bo'lmasligi uchun.
    // Oxirgi urinishdan 6 s o'tgan bo'lsa faqat qayta yuklaymiz.
    //
    // Nima uchun VAQT emas, "bayroq" emas? sessionStorage sahifa qayta
    // yuklanganda ham o'chmaydi. Shu sababli bir marta belgi qo'yilgach,
    // keyingi barcha urinishlar "qo'lda Ctrl+F5 qiling" deya to'xtab
    // qolardi — bu aynan sizni bezovta qilgan holat edi.
    function reloadPage(why) {
      var now = Date.now();
      var last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_AT) || 0) || 0; } catch (e) {}

      if (now - last < 6000) {
        log('Service Worker sahifani boshqarmadi. Sahifani qo\'lda yangilab '
          + '(Ctrl+F5) ko\'ring.', 'err');
        return false;
      }
      try { sessionStorage.setItem(RELOAD_AT, String(now)); } catch (e) {}
      log(why + ' — sahifa qayta yuklanmoqda...', 'warn');
      setTimeout(function () { location.reload(); }, 600);
      return true;
    }
  }

  // -------------------------------------------------------------------- init
  // Diagnostika uchun: konsoldan `__wc.tuzilish()` deb chaqirib, SW'ni
  // majburlab tekshirish mumkin.
  window.__wc = {
    ensureWorker: ensureWorker,
    probeMp4: probeMp4,
    // `__wc.probeContainer(new Uint8Array([...]))` — formatni bir qo'llab
    // ko'rish uchun. Masalan MKV sarlavhasi: [0x1A,0x45,0xDF,0xA3,...]
    probeContainer: probeContainer,
    tuzilish: async function () {
      var rs = await navigator.serviceWorker.getRegistrations();
      return {
        controller: !!navigator.serviceWorker.controller,
        royxatlar: rs.map(function (r) {
          return {
            scope: r.scope,
            active: r.active && r.active.state,
            waiting: !!r.waiting,
            installing: !!r.installing,
            skript: r.active && r.active.scriptURL
          };
        })
      };
    }
  };

  document.getElementById('btnStart').onclick = startQR;
  document.getElementById('btnLoad').onclick = loadVideo;
  document.getElementById('btnForget').onclick = function () {
    localStorage.removeItem(MEM_KEY);
    showMem();
    document.getElementById('qrBox').hidden = true;
    document.getElementById('qrStatus').textContent =
      'Sessiya o&prime;chirildi. Qayta QR yaratish uchun tugmani bosing.';
    document.getElementById('btnStart').textContent = 'QR yaratish';
    document.getElementById('btnStart').disabled = false;
    log('Sessiya localStorage\'dan o&prime;chirildi', 'warn');
  };
  showMem();

  // ------------------------------------------------- avtomatik ulanish (sessiya bor bo'lsa)
  //
  // Buni ikki sababga kerak:
  //   1) Foydalanuvchi har safar tugmani bosmasin.
  //   2) Service Worker birinchi marta o'rnatilganda biz sahifani BIR MARTA
  //      qayta yuklaymiz - shundan keyin hammasi avtomatik davom etsin.
  // DIQQAT: bu avtomatik ulanish AFAQAT BIR TA shaklda bo'lishi kerak.
  // Ikki marta `startQR()` ishga tushsa, bitta auth_key bilan IKKITA
  // Telegram klienti ochiladi va ular bir-birining paketlariga aralashadi —
  // natijada "AUTH_BYTES_INVALID" xatosi chiqadi (16:31 da shunday bo'lgan).
  ensureWorker().then(function (workerOk) {
    // `workerOk === false` bo'lsa, ensureWorker() o'zi sahifani qayta
    // yuklamoqda — keyingi qadam uning ishi.
    if (!workerOk) return;

    // Sessiya allaqachon saqlangan bo'lsa - QR soravermaymiz. Bu haqiqiy
    // sayt uchun muhim: foydalanuvchi har kunda saytga kirsag ham bir
    // marta skanerlash shart emas, kalit shu brauzerda turadi.
    if (loadSession()) {
      setTimeout(function () {
        log('Saqlangan sessiya topildi - avtomatik ulanmoqda...', 'ok');
        startQR();
      }, 600);
    } else {
      log('Tayyor. "QR yaratish" tugmasini bosing.');
    }
  });

  // ------------------------------------------------- so'nggi postlar ro'yxati
  // Qaysi xabarda video borligini ko'rish uchun. Ro'yxatga bosilganda
  // shu xabar avtomatik yuklanadi.
  document.getElementById('btnList').onclick = async function () {
    var box = document.getElementById('postList');
    var p = parsePost(document.getElementById('postInput').value.trim());
    if (!p) { box.innerHTML = '<span class="err">Avval kanal nomini kiriting</span>'; return; }

    this.disabled = true;
    box.innerHTML = '<span class="st">Yuklanmoqda...</span>';
    var list = [];
    try {
      // GramJS'ning qulay metodi - ichida messages.getHistory chaqiradi
      list = await client.getMessages(peerOf(p.peer), { limit: 20 }) || [];
    } catch (e) {
      log('Ro\'yxat (getMessages): ' + (e.errorMessage || e.message), 'warn');
      // Zaxira: kanal uchun channels.getMessages (id bo'yicha)
      try {
        var r = await client.api.channels.getMessages({
          channel: peerOf(p.peer),
          id: [p.id, p.id - 1, p.id + 1, p.id + 2, p.id - 2],
        });
        list = (r && r.messages) || [];
      } catch (e2) {
        box.innerHTML = '<span class="err">'
          + ((e2 && (e2.errorMessage || e2.message)) || e2) + '</span>';
        log('Ro\'yxat xatosi: ' + ((e2 && (e2.errorMessage || e2.message)) || e2), 'err');
        return;
      }
    }

    try {
      list = Array.from(list).filter(Boolean);
      if (!list.length) { box.innerHTML = '<span class="warn">Xabar topilmadi</span>'; return; }

      box.innerHTML = '';
      list.forEach(function (m) {
        var d = docOf(m);
        var row = document.createElement('div');
        row.className = 'prow';
        var badge = d
          ? '<span class="ok">▶ ' + (bytesOf(d) / 1048576).toFixed(0) + ' MB</span>'
          : '<span class="st">' + (m.groupedId ? 'albom' : 'matn') + '</span>';
        row.innerHTML = '<b>#' + m.id + '</b> ' + badge + ' <span class="st">'
          + (m.message ? String(m.message).slice(0, 46) : '') + '</span>';
        if (d) {
          row.style.cursor = 'pointer';
          row.onclick = function () {
            document.getElementById('postInput').value = p.peer + '/' + m.id;
            loadVideo();
          };
        }
        box.appendChild(row);
      });
      log('Ro\'yxat: ' + list.length + ' ta post, videoli: '
        + list.filter(function (m) { return !!docOf(m); }).length, 'ok');
    } catch (e) {
      var em = (e && (e.errorMessage || e.message)) || e;
      box.innerHTML = '<span class="err">' + em + '</span>';
      log('Ro\'yxat xatosi: ' + em, 'err');
    } finally {
      document.getElementById('btnList').disabled = false;
    }
  };

  // (Sessiya bo'lsa avtomatik ulanish yuqoridagi `ensureWorker().then(...)`
  //  ichida — BIR TA yo'l bilan. Ikkala o'rnida ham bo'lsa, ikki marta
  //  startQR() ishga tushib, bir auth_key ustida ikki klient ochiladi va
  //  Telegram "AUTH_BYTES_INVALID" beradi.)
})();
</script>
</body>
</html>