/* ==========================================================================
 * tg-comments.js - Reels izohlari (Telegram forum topics)
 * --------------------------------------------------------------------------
 * Izohlar sayt serverida EMAS, Telegram'dagi "W CINEMA CHATS" guruhida
 * (har bir reel uchun alohida MAVZU) saqlanadi. Bu modul brauzerdagi
 * mavjud MTProto sessiyasi orqali:
 *   - mavzu xabarlarini o'qiydi (matn, rasm, stiker, GIF, video);
 *   - foydalanuvchi nomidan yozadi (matn/rasm/stiker/GIF).
 *
 * Serverda hech qanday kontent saqlanmaydi. Kalit (sessiya) faqat shu
 * brauzerda qoladi.
 * ========================================================================== */
(function (global) {
  'use strict';

  var CHAT     = (global.APP && global.APP.tgCommentsChat) || '';
  var CHAT_URL = (global.APP && global.APP.tgCommentsUrl) || '';
  var BOT      = (global.APP && global.APP.tgCommentsBot) || '';
  var BASE     = (global.APP && global.APP.base) || '';

  // `lottie.min.js` (298 KB) manzili. `chat.php` da skript teg sifatida
  // yuklanadi; `reels.php` da esa `ensureLottie()` orqali FAQAT `.tgs`
  // animatsiyali stiker topilganda yuklanadi (sahifa ochilishini
  // og'irmaslik uchun).
  var LOTTIE_URL = (global.APP && global.APP.tgLottie) || 'assets/vendor/lottie.min.js';

  var S = {
    reel: null,
    topicId: 0,
    chat: CHAT,
    url: '',
    client: null,
    peer: null,
    users: {},
    names: {},
    avatars: {},       // tg id -> saytga yuklangan rasm URL
    byId: {},
    meId: null,
    replyTo: 0,
    replyName: '',
    expandRoot: 0,     // javob yuborilgach ochiladigan thread
    loading: false,
    count: -1,         // joriy mavzudagi izohlar soni (Telegram'dan)
    likes: {},         // optimistik layk holati: { [msgId]: {count, mine} }
    threads: null,     // root izoh -> javoblar guruhi
    maxLiveId: 0,      // jonli kuzatuvdagi oxirgi xabar id'si
    live: false        // izohlar oynasi ochiq va jonli kuzatuv ishga tushgan
  };

  // Jonli izohlar: faqat ochiq oyna + ko'rinadigan tabda bitta yengil so'rov.
  // Yangi xabar topsakgina to'liq reload() qilamiz (har 2 s da qayta chizish yo'q).
  var LIVE_MS = 2000;
  var liveTimer = null, liveBusy = false, liveGen = 0, liveChan = null;

  // ------------------------------------------------------------- yordamchilar
  function T() { return global.TgStream || null; }
  function A() { var b = T() && T().bundle(); return b ? b.Api : null; }

  function enabled() { return !!CHAT; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function randLong() {
    var b = T() && T().bundle();
    if (b && b.helpers && b.helpers.generateRandomLong) return b.helpers.generateRandomLong();
    if (b && b.utils && b.utils.generateRandomLong) return b.utils.generateRandomLong();
    // 64-bit signed chegarasiga sig'adigan zaxira qiymat.
    return String(Math.floor(Math.random() * 9007199254740991));
  }

  function errMsg(e) {
    if (!e) return 'Xatolik';
    return String(e.errorMessage || e.message || e);
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) { return r.json(); });
  }

  function el(id) { return document.getElementById(id); }

  function listEl() { return el('commentsList'); }
  function countEl() { return el('commentsCount'); }

  // Joriy foydalanuvchi rasmi: avval saytga YUKLANGAN rasm
  // (`wc_avatar_url_v1`), u bo'lmasa Telegram'dan olingan rasm
  // (`wc_tg_photo_v1`).
  function currentUserPhoto() {
    try {
      return localStorage.getItem('wc_avatar_url_v1')
          || localStorage.getItem('wc_tg_photo_v1') || '';
    } catch (e) { return ''; }
  }

  // ------------------------------------------------------- @username (nom)
  var UNAME_KEY = 'wc_tg_username_v1';
  // Nom QAYSI Telegram akkauntga tegishli ekanini ham yozib qo'yamiz. Shunda
  // bitta brauzerda boshqa akkaunt kirsa, avvalgi nom unga "yopishib"
  // qolmaydi - yangi akkauntdan qaytadan so'raladi (yoki serverdan olinadi).
  var UNAME_OWNER_KEY = 'wc_tg_username_owner_v1';

  function meId() {
    var me = T() && T().me ? T().me() : null;
    return me && me.id ? String(me.id) : '';
  }
  function unameOwner() {
    try { return String(localStorage.getItem(UNAME_OWNER_KEY) || ''); } catch (e) { return ''; }
  }
  function username() {
    try {
      // Nom boshqa akkauntga yozilgan bo'lsa - ko'rsatmaymiz (qayta so'raladi).
      var owner = unameOwner();
      var mid = meId();
      if (mid && owner && owner !== mid) return '';
      return String(localStorage.getItem(UNAME_KEY) || '').replace(/^@/, '');
    } catch (e) { return ''; }
  }
  function validUsername(u) {
    return /^[a-z][a-z0-9_]{3,31}$/.test(String(u || '').toLowerCase());
  }
  function setLocalUsername(u, mid) {
    u = String(u || '').replace(/^@/, '').trim().toLowerCase();
    if (!validUsername(u)) return false;
    try {
      localStorage.setItem(UNAME_KEY, u);
      localStorage.setItem(UNAME_OWNER_KEY, String(mid || meId() || ''));
    } catch (e) {}
    return true;
  }
  function clearLocalUsername() {
    try { localStorage.removeItem(UNAME_KEY); localStorage.removeItem(UNAME_OWNER_KEY); } catch (e) {}
  }
  function saveUsername(u) {
    u = String(u || '').replace(/^@/, '').trim().toLowerCase();
    if (!validUsername(u)) return false;
    var mid = meId();
    if (!setLocalUsername(u, mid)) return false;
    if (mid) {
      var me = T() && T().me ? T().me() : null;
      fetchJson(baseUrl('api/tg-name.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'tg_me=' + encodeURIComponent(JSON.stringify({ id: mid, username: (me && me.username) || '' }))
          + '&username=' + encodeURIComponent(u)
      }).catch(function () {});
    }
    return true;
  }
  // Joriy akkauntning nomini serverdan tiklaymiz: foydalanuvchi uni boshqa
  // qurilmada (yoki localStorage tozalanganda) kiritgan bo'lishi mumkin.
  function restoreUsername(mid) {
    if (!mid) return Promise.resolve('');
    return loadNames([mid]).then(function () {
      var srv = S.names[mid] || '';
      if (srv) setLocalUsername(srv, mid);
      return srv;
    }).catch(function () { return ''; });
  }
  function loadNames(ids) {
    var uniq = [];
    (ids || []).forEach(function (id) {
      if (id && uniq.indexOf(String(id)) === -1) uniq.push(String(id));
    });
    if (!uniq.length) return Promise.resolve();
    return fetchJson(baseUrl('api/tg-name.php?ids=' + encodeURIComponent(uniq.join(','))))
      .then(function (d) {
        if (d && d.names) {
          for (var k in d.names) { if (d.names[k]) S.names[k] = d.names[k]; }
        }
        // Saytga yuklangan rasmlar (hammaga ko'rinadi).
        if (d && d.avatars) {
          for (var a in d.avatars) { if (d.avatars[a]) S.avatars[a] = d.avatars[a]; }
        }
      }).catch(function () {});
  }
  function findUserIdByUsername(un) {
    un = String(un || '').toLowerCase();
    for (var k in S.names) { if (String(S.names[k]).toLowerCase() === un) return k; }
    for (var id in S.users) { if (String(S.users[id].username || '').toLowerCase() === un) return id; }
    return null;
  }

  function relTime(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts) * 1000);
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'hozir';
    if (diff < 3600) return Math.floor(diff / 60) + ' daq';
    if (diff < 86400) return Math.floor(diff / 3600) + ' soat';
    if (diff < 604800) return Math.floor(diff / 86400) + ' kun';
    return d.toLocaleDateString();
  }

  // --------------------------------------------------------------- topic API
  //
  // Izohlar mavzusi qayerda ochiladi - bosh sahifaga bog'liq:
  //   reels.php  -> `api/reel-topic.php` (reels.id, reels.jadvali)
  //   watch.php  -> `api/video-topic.php` (content.id, tg_topics jadvali)
//                 `id` sifatida episodes.id yuboriladi - server kontentni
//                 o'zi aniqlaydi, shunda qismlar bitta mavzuni bo'lishadi.
  // Sahifa `window.APP.tgCommentsTopicApi` orqali yo'lni ko'rsatadi. Bu
  // standart qiymat bo'lmasa - reels moduli o'zgarishsiz ishlayveradi.
  var TOPIC_API   = (global.APP && global.APP.tgCommentsTopicApi) || 'api/reel-topic.php';

  function topicQuery(id) {
    // `reel-topic.php` `scope` ni bilmaydi (u faqat reels), shuning uchun
    // qo'shimcha parametr faqat boshqa endpointlar uchun yuboriladi.
    var q = 'id=' + encodeURIComponent(id);
    if (TOPIC_API !== 'api/reel-topic.php') {
      var scope = (global.APP && global.APP.tgCommentsScope) || 'video';
      q += '&scope=' + encodeURIComponent(scope);
    }
    return q;
  }

  function ensureTopic(reel) {
    // Mavzu id'si allaqachon `__WCBOOT.topic` (SQL kesh) dan kelgan bo'lsa,
    // `api/video-topic.php` ga so'rov yuborish SHART EMAS — chat va url
    // `open()` da `APP` dan tuzilgan. Bu bitta so'rov (hamda 1 RTT) tejaydi.
    if (S.topicId > 0) return Promise.resolve(true);
    return fetchJson(baseUrl(TOPIC_API + '?' + topicQuery(reel.id) + '&_=' + Date.now()))
      .then(function (d) {
        if (d && d.disabled) return { disabled: true };
        if (d && d.topic_id) return d;
        // Mavzu yo'q - bot orqali ochamiz.
        return fetchJson(baseUrl(TOPIC_API), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: topicQuery(reel.id)
        });
      })
      .then(function (d) {
        if (d && d.success && d.topic_id) {
          S.topicId = Number(d.topic_id);
          S.chat = d.chat || CHAT;
          S.url = d.url || topicUrl(S.topicId);
          return true;
        }
        if (d && d.disabled) return false;
        var msg = (d && d.message) || 'Mavzu ochilmadi';
        // Bot nomi foydalanuvchiga ko'rsatiladi: u botni guruhga admin
        // qilishi yoki Topics yoqligini tekshirishi kerak bo'ladi.
        if (BOT) {
            var n = String(BOT).replace(/^@/, '');
            if (msg.indexOf(n) < 0) msg += ' — @' + n + ' botni tekshiring';
        }
        throw new Error(msg);
      });
  }

  function baseUrl(path) {
    if (!BASE) return path;
    return BASE.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  function topicUrl(topicId) {
    if (!CHAT_URL || !topicId) return '';
    return CHAT_URL.replace(/\/$/, '') + '/' + topicId;
  }

  // ------------------------------------------------ izohlar SONI (Telegram)
  // Izohlar endi serverda emas - Telegram forum-mavzusida yashaydi, shuning
  // uchun DB `comments_count` eskirgan bo'ladi. Reels yonidagi raqamni
  // (izohlar oynasini ochmasdan turib) shu yerdan olamiz.
  var cntCache = {};      // topicId -> { n, at }
  var CNT_TTL = 45000;    // 45 s

  function cachedCount(topicId) {
    var c = cntCache[topicId];
    if (!c) return -1;
    return (Date.now() - c.at) < CNT_TTL ? c.n : -1;
  }
  function setCount(topicId, n) {
    if (!topicId || !(n >= 0)) return;
    cntCache[topicId] = { n: n, at: Date.now() };
    if (S.topicId === topicId) { S.count = n; notifyRail(n); }
  }
  /** Reels sahifasidagi yon paneldagi raqamni darhol yangilaydi. */
  function notifyRail(n) {
    if (n == null || n < 0) return;
    var R = global.TGReels;
    if (R && typeof R.setCommentCount === 'function') {
      try { R.setCommentCount(S.reel, n); } catch (e) {}
    }
  }
  /** Yangi izoh yuborilganda/o'chirilganda darhol to'g'riladi. */
  function bumpCount(topicId, d) {
    if (!topicId) return;
    var n = cachedCount(topicId);
    if (n < 0) n = Math.max(0, S.count || 0);
    setCount(topicId, Math.max(0, n + d));
    if (S.topicId === topicId) S.count = cntCache[topicId].n;
    announceLive(topicId);
  }

  /** Xuddi shu brauzerning boshqa oynasiga darhol xabar beradi (tarmoqsiz). */
  function announceLive(topicId) {
    if (!liveChan) return;
    try { liveChan.postMessage({ topic: Number(topicId), at: Date.now() }); } catch (e) {}
  }
  try {
    if (global.BroadcastChannel) {
      liveChan = new BroadcastChannel('wc-comments');
      liveChan.onmessage = function (e) {
        var d = e && e.data;
        if (d && S.live && !document.hidden && Number(d.topic) === S.topicId) liveTick();
      };
    }
  } catch (e) { liveChan = null; }

  /**
   * Mavzudagi izohlar soni (izohlar oynasi OCHILMASDAN).
   * @param {Object} reel - { topic_id, comments }
   * @param {Boolean} force - keshni tashlab qayta so'rash
   * @returns {Promise<number>} - aniq son yoki -1 (olib bo'lmadi)
   */
  function commentCount(reel, force) {
    if (!enabled()) return Promise.resolve(-1);
    var tid = reel && reel.topic_id ? Number(reel.topic_id) : 0;
    if (!tid) return Promise.resolve(-1);
    if (!force) {
      var hit = cachedCount(tid);
      if (hit >= 0) return Promise.resolve(hit);
    }
    var Api = A();
    if (!Api) return Promise.resolve(-1);
    return resolvePeer().then(function (peer) {
      return getClient().then(function (c) {
        return c.invoke(new Api.messages.GetReplies({
          peer: toInputChannel(peer),
          msgId: tid,
          offsetId: 0, offsetDate: 0, addOffset: 0,
          limit: 100, maxId: 0, minId: 0, hash: 0
        }));
      });
    }).then(function (res) {
      // 100 ta chegarasi: undan ko'p bo'lsa "100+" deb ko'rsatamiz.
      var n = ((res && res.messages) || []).length;
      setCount(tid, n);
      if (S.topicId === tid) S.count = n;
      return n;
    }).catch(function () {
      // Telegram'da olib bo'lmasa - eski DB soni (bo'lsa) qaytariladi.
      return reel && reel.comments ? Number(reel.comments) : -1;
    });
  }

  // --------------------------------------------------------------- MTProto
  function getClient() {
    if (S.client) return Promise.resolve(S.client);
    if (!T() || !T().client) return Promise.reject(new Error('Klient mavjud emas'));
    return T().client().then(function (c) {
      S.client = c;
      return c;
    });
  }

  function resolvePeer() {
    if (S.peer) return Promise.resolve(S.peer);
    return getClient().then(function (c) {
      return c.getInputEntity(S.chat);
    }).then(function (p) {
      S.peer = p;
      return p;
    });
  }

  function toInputChannel(peer) {
    var Api = A();
    if (peer && peer.className === 'InputPeerChannel') {
      return new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash });
    }
    if (peer && peer.className === 'InputChannel') return peer;
    return peer;
  }

  function ensureJoined() {
    return resolvePeer().then(function (peer) {
      var Api = A();
      var ch = toInputChannel(peer);
      return getClient().then(function (c) {
        return c.invoke(new Api.channels.JoinChannel({ channel: ch }));
      }).catch(function (e) {
        var m = errMsg(e);
        // Allaqachon a'zo / limit - muammo emas.
        if (/USER_ALREADY_PARTICIPANT|CHANNELS_TOO_MUCH/.test(m)) return null;
        // Boshqa xatoni ham yutamiz: o'qish baribir urinib ko'ramiz.
        return null;
      });
    });
  }

  function replyObj(topicId, replyTo) {
    // Telegram forumlarida mavzuga yozish uchun topic ID `reply_to_msg_id` ga
    // beriladi (yana `top_msg_id` ham). `replyTo` berilsa - o'sha xabarga javob.
    var Api = A();
    if (replyTo) {
      return new Api.InputReplyToMessage({ replyToMsgId: Number(replyTo), topMsgId: topicId });
    }
    return new Api.InputReplyToMessage({ replyToMsgId: topicId, topMsgId: topicId });
  }

  function replyObjAlt(topicId) {
    // Zaxira: javobsiz, faqat mavzuga.
    var Api = A();
    return new Api.InputReplyToMessage({ replyToMsgId: 0, topMsgId: topicId });
  }

  function sendRaw(params) {
    // Mavzuga yozamiz; layer boshqacha bo'lsa - zaxira usul.
    var Api = A();
    return getClient().then(function (c) {
      var base = Object.assign({}, params);
      base.randomId = randLong();
      base.replyTo = replyObj(S.topicId, S.replyTo);
      return c.invoke(new Api.messages.SendMessage(base)).catch(function (e) {
        var m = errMsg(e);
        if (/REPLY|TOPIC|MESSAGE_ID/.test(m)) {
          var b2 = Object.assign({}, params);
          b2.randomId = randLong();
          b2.replyTo = replyObjAlt(S.topicId);
          return c.invoke(new Api.messages.SendMessage(b2));
        }
        throw e;
      });
    });
  }

  function sendMediaRaw(media, caption) {
    var Api = A();
    return getClient().then(function (c) {
      var base = {
        peer: S.peer,
        media: media,
        message: caption || '',
        randomId: randLong(),
        replyTo: replyObj(S.topicId, S.replyTo)
      };
      return c.invoke(new Api.messages.SendMedia(base)).catch(function (e) {
        var m = errMsg(e);
        if (/REPLY|TOPIC|MESSAGE_ID/.test(m)) {
          base.randomId = randLong();
          base.replyTo = replyObjAlt(S.topicId);
          return c.invoke(new Api.messages.SendMedia(base));
        }
        throw e;
      });
    });
  }

  // ------------------------------------------------------------- o'qish
  function loadReplies(limit) {
    var Api = A();
    return getClient().then(function (c) {
      var req = {
        peer: S.peer,
        msgId: S.topicId,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: limit || 50,
        maxId: 0,
        minId: 0,
        hash: 0
      };
      return c.invoke(new Api.messages.GetReplies(req));
    });
  }

  // ------------------------------------------------------------- render
  function userOf(id) {
    var u = S.users[id];
    var uname = (S.names && S.names[String(id)]) || (u && u.username) || '';
    uname = uname ? String(uname).replace(/^@/, '') : '';
    var name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '';
    if (!name) name = uname || ('#' + id);
    return { name: name, username: uname, id: id };
  }

  function avatarHtml(authorId, name) {
    var me = T() && T().me ? T().me() : null;
    var mineId = me && me.id ? String(me.id) : '';
    var key = String(authorId);
    // Avval saytga yuklangan rasm (hamma ko'radi), keyin o'zimning Telegram
    // rasmim (faqat shu brauzerda ko'rinadi).
    var photo = S.avatars[key] || ((key === mineId) ? currentUserPhoto() : '');
    if (photo) {
      return '<img class="reels-c-av" src="' + esc(photo) + '" alt="" referrerpolicy="no-referrer">';
    }
    return '<div class="reels-c-av">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>';
  }

  function messageText(m) {
    // Kelgan xabarning `entities` ini HTML ga aylantiramiz (qalin, kursiv,
    // kod, havola, spoiler, sitata...). `TgFormat` yuklanmagan bo'lsa
    // oddiy matn ko'rsatiladi (xom shakl hech qachon innerHTML'ga
    // tashlanmaydi).
    var F = global.TgFormat;
    if (F && F.render) return F.render(m.message || '', m.entities || []);
    var t = m.message || '';
    return esc(t).replace(/\n/g, '<br>');
  }

  // Telegram hujjatini tur bo'yicha aniqlaymiz (stiker/GIF/video/rasm).
  function docWH(d) {
    var w = 0, h = 0;
    (d && d.attributes || []).forEach(function (a) {
      if (!a) return;
      if ((a.className === 'DocumentAttributeVideo' || a.className === 'DocumentAttributeImageSize')
        && a.w && a.h) { w = Number(a.w) || 0; h = Number(a.h) || 0; }
    });
    return { w: w, h: h };
  }
  function docDescriptor(d) {
    if (!d || d.className !== 'Document') return null;
    var attrs = d.attributes || [];
    var isSticker = attrs.some(function (a) { return a.className === 'DocumentAttributeSticker'; });
    var isAnimated = attrs.some(function (a) { return a.className === 'DocumentAttributeAnimated'; });
    var mime = d.mimeType || '';
    var wh = docWH(d);
    if (isSticker) return { kind: 'sticker', mime: mime || 'image/webp', media: d, auto: true, w: wh.w, h: wh.h };
    if (isAnimated) return { kind: 'gif', mime: mime || 'video/mp4', media: d, auto: true, w: wh.w, h: wh.h };
    // Ovozli xabar: `DocumentAttributeAudio` bilan belgilanadi. `voice: true`
    // bo'lsa - Telegram'dagi "ovozli xabar", aks holda oddiy audio fayl.
    var aud = attrs.filter(function (a) { return a.className === 'DocumentAttributeAudio'; })[0];
    if (aud) {
      return {
        kind: 'voice', mime: mime || 'audio/ogg', media: d, auto: true,
        voice: !!aud.voice, duration: Number(aud.duration) || 0,
        wave: aud.waveform || null
      };
    }
    if (mime.indexOf('video/') === 0) return { kind: 'video', mime: mime, media: d, w: wh.w, h: wh.h };
    if (mime.indexOf('audio/') === 0) {
      return { kind: 'voice', mime: mime, media: d, auto: true, voice: false, duration: 0, wave: null };
    }
    if (mime.indexOf('image/') === 0) return { kind: 'photo', mime: mime, media: d, auto: true, w: wh.w, h: wh.h };
    return null;
  }

  function mediaDescriptor(m) {
    var media = m.media;
    if (!media) return null;
    if (media.className === 'MessageMediaPhoto') {
      if (!media.photo) return null;
      var ps = pickSize([].concat(media.photo.sizes || [], media.photo.videoSizes || []));
      return {
        kind: 'photo', mime: 'image/jpeg', media: media.photo, auto: true,
        w: (ps && ps.w) || 0, h: (ps && ps.h) || 0
      };
    }
    if (media.className === 'MessageMediaDocument') return docDescriptor(media.document);
    return null;
  }

  function docMime(d) {
    if (!d) return '';
    if (d.media && d.media.mimeType) return d.media.mimeType;
    return d.mime || '';
  }

  // Qaysi HTML element mos keladi: video (GIF / video / .webm stiker) yoki img.
  function mediaTag(d) {
    if (!d) return 'img';
    if (d.kind === 'gif' || d.kind === 'video') return 'video';
    if (d.kind === 'sticker') {
      var m = docMime(d);
      if (m.indexOf('video/') === 0) return 'video';
      if (m === 'application/x-tgsticker') return 'div';
    }
    return 'img';
  }

  // Picker tugmasi ichidagi media elementini yozamiz (stiker/GIF preview).
  function mediaInnerHtml(d) {
    var tag = mediaTag(d);
    if (tag === 'video') return '<video autoplay loop muted playsinline preload="auto"></video>';
    if (tag === 'div') return '<div class="reels-tgs"></div>';
    return '<img alt="" loading="lazy">';
  }

  // Media o'z o'lchamida va joyi oldindan band bo'lishi uchun width/height.
  function dimAttrs(d) {
    var w = Math.round(Number(d && d.w) || 0);
    var h = Math.round(Number(d && d.h) || 0);
    if (!w || !h || w > 10000 || h > 10000) return '';
    return ' width="' + w + '" height="' + h + '"';
  }

  // Pickerda GIF'lar har xil o'lchamda ko'rinishi uchun aspect-ratio.
  function ratioStyle(d) {
    var w = Math.round(Number(d && d.w) || 0);
    var h = Math.round(Number(d && d.h) || 0);
    if (!w || !h || w > 10000 || h > 10000) return '';
    var r = h / w;
    if (r > 1.6) h = Math.round(w * 1.6);        // juda baland — cheklaymiz
    else if (r < 0.5) h = Math.round(w * 0.5);   // juda past — cheklaymiz
    return ' style="aspect-ratio:' + w + ' / ' + h + '"';
  }

  function blobUrl(buf, mime) {
    var u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var blob = new Blob([u8], { type: mime || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }

  // --------------------------------------------------------- blob URL keshi
  // Sabab: chat yoki reels izohlaridan chiqib, yana kirganda BARCHA
  // rasm/GIF/stikerlarni qayta yuklash kerak bo'lardi - oqibatda xabarlar
  // bir necha sekon "bo'sh" ko'rinib turardi. Endi yuklangan fayllar
  // xotirada saqlanadi (oddiy LRU) va darhol ko'rinadi.
  var URL_CACHE_MAX = 160;
  var urlCache = {};
  var urlOrder = [];

  function cacheKey(d) {
    var m = d && d.media;
    if (!m) return '';
    return (m.className || '') + '#' + (m.id || m.photoId || '');
  }
  function cacheGet(key) {
    if (!key) return '';
    var u = urlCache[key];
    if (!u) return '';
    var i = urlOrder.indexOf(key);
    if (i >= 0) { urlOrder.splice(i, 1); urlOrder.push(key); }   // LRU
    return u;
  }
  function cachePut(key, url) {
    if (!key || !url) return;
    if (!urlCache[key]) urlOrder.push(key);
    urlCache[key] = url;
    while (urlOrder.length > URL_CACHE_MAX) {
      var old = urlOrder.shift();
      if (!urlCache[old]) continue;
      try { URL.revokeObjectURL(urlCache[old]); } catch (e) {}
      delete urlCache[old];
    }
  }

  // ------------------------------------------------- media yuklab olish
  // `client.downloadMedia` bu brauzer bundle'ida ishonchsiz ishlaydi,
  // shuning uchun to'g'ridan-to'g'ri `upload.getFile` dan foydalanamiz —
  // video oqimi ham aynan shu yo'ldan ishlaydi (tg-stream.js).
  var MEDIA_BLOCK = 1024 * 1024;      // 1 MB - bitta so'rov chegarasi
  var MEDIA_MIN = 4096;               // eng kichik ruxsat etilgan `limit`
  var MEDIA_MAX = 25 * 1024 * 1024;   // izohlarda bundan katta media yuklanmaydi

  function sizePx(s) {
    if (!s) return 0;
    var c = s.className;
    if (c === 'PhotoSize') return s.size || 0;
    if (c === 'PhotoSizeProgressive') return Math.max.apply(null, s.sizes || [0]);
    if (c === 'VideoSize') return s.size || 0;
    if (c === 'PhotoCachedSize') return (s.bytes && s.bytes.length) || 0;
    if (c === 'PhotoStrippedSize') return (s.bytes && s.bytes.length) || 0;
    return 0;
  }
  function pickSize(list) {
    var best = null, bestPx = -1;
    (list || []).forEach(function (s) {
      var px = sizePx(s);
      if (px > bestPx) { bestPx = px; best = s; }
    });
    return best;
  }
  function inlineBytes(s) {
    if (!s) return null;
    if (s.className === 'PhotoCachedSize') return s.bytes || null;
    if (s.className === 'PhotoStrippedSize') {
      try {
        var b = T() && T().bundle();
        if (b && b.utils && b.utils.strippedPhotoToJpg) return b.utils.strippedPhotoToJpg(s.bytes);
      } catch (e) {}
    }
    return null;
  }
  function resolveLoc(d) {
    var Api = A();
    var obj = d && d.media;
    if (!obj) return null;
    if (d.kind === 'photo' && obj.className === 'Photo') {
      var list = [].concat(obj.sizes || [], obj.videoSizes || []);
      var sz = pickSize(list);
      return {
        loc: new Api.InputPhotoFileLocation({
          id: obj.id, accessHash: obj.accessHash,
          fileReference: obj.fileReference, thumbSize: (sz && sz.type) || ''
        }),
        dcId: obj.dcId, size: sizePx(sz), inline: inlineBytes(sz), mime: 'image/jpeg'
      };
    }
    if (obj.className === 'Document') {
      var mime = obj.mimeType || d.mime || '';
      // image/* va video/webm stikerlar TO'LIQ yuklanadi (animatsiya uchun).
      // .tgs (Lottie) alohida oqimda animatsiya qilinadi (downloadTgs);
      // bu yerdagi thumbnail faqat zaxira sifatida ishlatiladi.
      var canPlayFull = (d.kind === 'sticker' && mime !== 'application/x-tgsticker');
      var wantThumb = (d.kind === 'sticker' && !canPlayFull);
      var thumb = wantThumb ? pickSize(obj.thumbs || []) : null;
      return {
        loc: new Api.InputDocumentFileLocation({
          id: obj.id, accessHash: obj.accessHash,
          fileReference: obj.fileReference, thumbSize: (thumb && thumb.type) || ''
        }),
        dcId: obj.dcId,
        size: thumb ? (thumb.size || sizePx(thumb)) : (obj.size || 0),
        inline: thumb ? inlineBytes(thumb) : null,
        mime: thumb ? 'image/webp' : mime
      };
    }
    return null;
  }
  // Preview uchun thumbnail: 32 KB dan katta bo'lmagan eng katta o'lcham
  // (aniqroq, lekin baribir tez); bo'lmasa — eng kichigi.
  function pickSmall(list) {
    var PREVIEW_MAX = 32 * 1024;
    var best = null, bestPx = -1, tiny = null, tinyPx = Infinity;
    (list || []).forEach(function (s) {
      var px = sizePx(s);
      if (px <= 0) return;
      if (px <= PREVIEW_MAX && px > bestPx) { bestPx = px; best = s; }
      if (px < tinyPx) { tinyPx = px; tiny = s; }
    });
    return best || tiny;
  }
  // THUMBNAIL lokatsiyasi — asosiy fayl emas. GIF/rasm darhol (blur bilan)
  // ko'rinishi uchun avval shu kichik bo'lak yuklanadi.
  function thumbLoc(d) {
    var Api = A();
    var obj = d && d.media;
    if (!obj) return null;
    if (d.kind === 'photo' && obj.className === 'Photo') {
      var list = [].concat(obj.sizes || [], obj.videoSizes || []);
      var s = pickSmall(list);
      if (!s) return null;
      return {
        loc: new Api.InputPhotoFileLocation({
          id: obj.id, accessHash: obj.accessHash,
          fileReference: obj.fileReference, thumbSize: (s.type) || ''
        }),
        dcId: obj.dcId, size: sizePx(s), inline: inlineBytes(s), mime: 'image/jpeg'
      };
    }
    if (obj.className === 'Document') {
      if ((obj.mimeType || d.mime || '') === 'application/x-tgsticker') return null;
      var t = pickSmall(obj.thumbs || []);
      if (!t) return null;
      return {
        loc: new Api.InputDocumentFileLocation({
          id: obj.id, accessHash: obj.accessHash,
          fileReference: obj.fileReference, thumbSize: (t.type) || ''
        }),
        dcId: obj.dcId, size: t.size || sizePx(t), inline: inlineBytes(t), mime: 'image/jpeg'
      };
    }
    return null;
  }
  function roomInBlock(offset) {
    var aligned = Math.floor(offset / MEDIA_MIN) * MEDIA_MIN;
    return MEDIA_BLOCK - (aligned % MEDIA_BLOCK);
  }
  function readChunk(client, loc, dcId, offset, length) {
    var Api = A();
    var aligned = Math.floor(offset / MEDIA_MIN) * MEDIA_MIN;
    var skip = offset - aligned;
    var want = Math.ceil((length + skip) / MEDIA_MIN) * MEDIA_MIN;
    if (want < MEDIA_MIN) want = MEDIA_MIN;
    var lim = Math.min(MEDIA_BLOCK, roomInBlock(offset));
    if (want > lim) want = lim;
    return client.invoke(new Api.upload.GetFile({
      location: loc, offset: aligned, limit: want, precise: true
    }), dcId).then(function (res) {
      var b = res.bytes || res;
      var u8 = (b instanceof Uint8Array) ? b : new Uint8Array(b || []);
      if (u8.length <= skip) return new Uint8Array(0);
      return u8.slice(skip, skip + Math.min(length, u8.length - skip));
    });
  }
  function readAll(client, loc, dcId, size) {
    var parts = [], total = 0, offset = 0;
    function join() {
      if (parts.length === 1) return parts[0];
      var out = new Uint8Array(total), p = 0;
      for (var i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
      return out;
    }
    function step() {
      if (offset >= size) return Promise.resolve(join());
      var len = Math.min(MEDIA_BLOCK, size - offset);
      return readChunk(client, loc, dcId, offset, len).then(function (chunk) {
        if (!chunk.length) return join();
        parts.push(chunk); total += chunk.length; offset += chunk.length;
        return step();
      });
    }
    return step();
  }
  function showFail(node, msg) {
    var ph = node && node.parentNode && node.parentNode.querySelector('.reels-c-media-fail');
    if (ph) { ph.hidden = false; ph.textContent = msg ? ('Ko‘rsatib bo‘lmadi: ' + msg) : 'Ko‘rsatib bo‘lmadi'; }
  }
  // Yuklash butunlay imkonsiz bo'lganda: naqshni to'liq YO'Q qilamiz, faqat
  // "Ko'rsatib bo'lmadi" yozuvi qoladi. Aks holda `.reels-c-sticker`ning
  // `min-height` va `.reels-tgs`ning `aspect-ratio`si bo'sh kvadrat qoldiradi.
  function markFail(node, msg) {
    showFail(node, msg);
    if (!node || !node.closest) return;
    var box = node.closest('.reels-c-sticker, .reels-c-media');
    if (box) box.setAttribute('data-fail', '1');
  }
  function playIfVideo(node) {
    if (node && node.tagName === 'VIDEO') {
      try { var p = node.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
  }
  function togglePlay(vid) {
    if (!vid) return;
    if (vid.paused) playIfVideo(vid);
    else { try { vid.pause(); } catch (e) {} }
  }

  // Faqat ko'rinish maydonidagi media o'ynaydi (video yoki Lottie) — bir
  // vaqtda o'nlab animatsiyani ishga tushirmaslik uchun (ayniqsa telefonda).
  var playObserver = null;
  function ensureObserver() {
    if (playObserver) return playObserver;
    if (typeof global.IntersectionObserver === 'undefined') return null;
    playObserver = new global.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        var t = en.target;
        if (en.isIntersecting) {
          if (t.__anim) { try { t.__anim.play(); } catch (e) {} }
          else playIfVideo(t);
        } else if (t.__anim) {
          try { t.__anim.pause(); } catch (e) {}
        } else {
          try { t.pause(); } catch (e) {}
        }
      }
    }, { rootMargin: '120px', threshold: 0.01 });
    return playObserver;
  }
  function observePlay(node) {
    if (!node) return;
    if (typeof global.IntersectionObserver === 'undefined') {
      if (node.__anim) { try { node.__anim.play(); } catch (e) {} }
      else playIfVideo(node);
      return;
    }
    ensureObserver().observe(node);
  }
  // `data-thumb` (blurli preview) yoki `data-ready` (to'liq) belgisini
  // media node'iga, ichki `.reels-c-media` konteyneriga va tashqi picker
  // kartasiga (`.reels-c-gif-item`/`.reels-c-sticker-item`) qo'yadi.
  function markLoad(node, state) {
    if (!node) return;
    var attr = (state === 'ready') ? 'data-ready' : 'data-thumb';
    node.setAttribute(attr, '1');
    if (!node.closest) return;
    var inner = node.closest('.reels-c-media, .reels-c-sticker-item');
    if (inner) inner.setAttribute(attr, '1');
    var outer = node.closest('.reels-c-gif-item, .reels-c-sticker-item');
    if (outer) outer.setAttribute(attr, '1');
  }
  function afterLoaded(node) {
    markLoad(node, 'ready');
    if (node.tagName === 'VIDEO') observePlay(node);
  }

  // ---- .tgs (Telegram animated sticker = gzip'langan Lottie JSON) --------
  function gunzip(u8) {
    if (typeof global.DecompressionStream === 'undefined') return Promise.reject(new Error('gzip yo‘q'));
    try {
      var ds = new global.DecompressionStream('gzip');
      var stream = new global.Blob([u8]).stream().pipeThrough(ds);
      return new global.Response(stream).text();
    } catch (e) { return Promise.reject(e); }
  }
  function fullDocLoc(d) {
    var Api = A();
    var obj = d && d.media;
    if (!obj || obj.className !== 'Document') return null;
    return {
      loc: new Api.InputDocumentFileLocation({
        id: obj.id, accessHash: obj.accessHash,
        fileReference: obj.fileReference, thumbSize: ''
      }),
      dcId: obj.dcId,
      size: obj.size || 0,
      mime: obj.mimeType || ''
    };
  }
  // ---- `lottie.min.js` ni TALAB bo'yicha yuklash ------------------------
  // `.tgs` — bu gzip'langan Lottie JSON; uni chizish uchun `lottie` kerak
  // (298 KB). Lekin u faqat `.tgs` stikeri bo'lganda kerak bo'ladi:
  //   * `chat.php` — skript teg sifatida `defer` bilan yuklanadi;
  //   * `reels.php` — SAHIFA ochilishida emas, faqat birinchi `.tgs`
  //     paydo bo'lganda shu yerda yuklanadi.
  // Bu shart emas edi: `global.lottie` yo'q bo'lsa, stiker animatsiyasiz
  // (bo'sh kvadrat = "orqa fon yaratilib qolib") qolib ketardi.
  var lottieWait = null;
  function ensureLottie() {
    if (global.lottie) return Promise.resolve(true);
    if (lottieWait) return lottieWait;
    if (!global.document) { lottieWait = Promise.resolve(false); return lottieWait; }
    lottieWait = new Promise(function (resolve) {
      var s = global.document.createElement('script');
      s.src = LOTTIE_URL;
      s.async = true;
      s.onload = function () { resolve(!!global.lottie); };
      s.onerror = function () { resolve(false); };
      (global.document.head || global.document.documentElement).appendChild(s);
    });
    return lottieWait;
  }
  function tgsFallback(host, d) {
    // Lottie ishlamasa yoki yuklanolmasa — statik thumbnail ko'rsatamiz.
    // Hech narsa chiqsa ham bo'sh kvadrat QOLMASIN (`.reels-c-sticker`ning
    // `min-height` sababli ochilib qoladigan "orqa fon" effekti beradi).
    if (!host) return;
    function giveUp(msg) {
      host.innerHTML = '';
      markFail(host, msg);
    }
    function put(u8, mime) {
      if (!u8 || !u8.length) { giveUp('stiker bo‘sh'); return; }
      host.innerHTML = '';
      var im = document.createElement('img');
      im.className = 'reels-tgs-img'; im.alt = '';
      im.src = blobUrl(u8, mime || 'image/webp');
      host.appendChild(im);
      markLoad(im, 'ready');
    }
    var job = resolveLoc(d);          // TGS uchun thumbnail qaytaradi
    if (!job) { giveUp('stiker topilmadi'); return; }
    if (job.inline && job.inline.length) { put(job.inline, job.mime); return; }
    if (!job.size) { giveUp('hajm noma’lum'); return; }
    getClient().then(function (c) { return readAll(c, job.loc, job.dcId, job.size); })
      .then(function (u8) { put(u8, job.mime); })
      .catch(function () { giveUp('stiker yuklanmadi'); });
  }
  function downloadTgs(host, d) {
    if (!host) return Promise.resolve();
    var job = fullDocLoc(d);
    if (!job || !job.size) { tgsFallback(host, d); return Promise.resolve(); }
    if (job.size > MEDIA_MAX) { tgsFallback(host, d); return Promise.resolve(); }
    // `.tgs` yuklanayotgan paytdagi shimmer ("skelet") cheksiz davom etmasin:
    // 12 s ichida tayyor bo'lmasa — bo'sh kvadrat o'rniga "Ko'rsatib bo'lmadi".
    var t = global.setTimeout(function () {
      if (host.getAttribute && host.getAttribute('data-ready') === '1') return;
      if (!host.isConnected) return;
      markFail(host, 'stiker yuklanmadi');
    }, 12000);
    // `lottie.min.js` faqat shu yerda (birinchi `.tgs` da) yuklanadi.
    return ensureLottie().then(function (ok) {
      if (!ok) throw new Error('Lottie yuklanmadi');
      return getClient().then(function (client) {
        return readAll(client, job.loc, job.dcId, job.size);
      });
    }).then(function (buf) {
      if (!buf || !buf.length) throw new Error('bo‘sh fayl');
      return gunzip(buf);
    }).then(function (text) {
      var data = JSON.parse(text);
      host.innerHTML = '';
      var holder = document.createElement('div');
      holder.className = 'reels-tgs-svg';
      host.appendChild(holder);
      var anim = global.lottie.loadAnimation({
        container: holder,
        renderer: 'svg',
        loop: true,
        autoplay: false,
        animationData: data,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
      });
      host.__anim = anim;
      markLoad(host, 'ready');
      observePlay(host);
      if (global.clearTimeout) global.clearTimeout(t);
    }).catch(function (e) {
      try { console.warn('[tg-comments] tgs yuklanmadi:', errMsg(e)); } catch (er) {}
      if (global.clearTimeout) global.clearTimeout(t);
      tgsFallback(host, d);
    });
  }

  // Yuklab olish navbati (Instagram uslubi):
  //  - avval THUMBNAIL'lar (kichik, tez) — yuqoridan pastga qarab;
  //  - keyin TO'LIQ fayllar — o'sha tartibda.
  // Bir vaqtda bir nechta (DL_CONC) yuklash ishlaydi, shu bilan tepadagi
  // GIF'lar darhol ko'rinadi va pastga qarab ochilib ketadi.
  var DL_CONC = 3;
  var dlHi = [], dlLo = [], dlActive = 0;
  function enqueueJob(job) {
    if (job.prio === 'hi') dlHi.push(job); else dlLo.push(job);
    pumpDownload();
  }
  function pumpDownload() {
    while (dlActive < DL_CONC && (dlHi.length || dlLo.length)) {
      var job = dlHi.length ? dlHi.shift() : dlLo.shift();
      dlActive++;
      Promise.resolve().then(function () { return runJob(job); })
        .then(function () { dlActive--; pumpDownload(); },
              function () { dlActive--; pumpDownload(); });
    }
  }
  function runJob(job) {
    // Eski qidiruvdan qolgan, DOM'dan uzilgan node'lar uchun yuklamaymiz.
    if (job.node && job.node.isConnected === false) return Promise.resolve();
    if (job.type === 'thumb') {
      return loadThumb(job.node, job.d).then(function () {
        enqueueJob({ type: 'full', node: job.node, d: job.d, prio: 'lo' });
      });
    }
    return runDownload(job.node, job.d);
  }
  // Thumbnail'ni imkon qadar tez ko'rsatamiz (blurli preview).
  function loadThumb(node, d) {
    if (!node) return Promise.resolve(false);
    var job = thumbLoc(d);
    if (!job) return Promise.resolve(false);
    function put(u8, mime) {
      if (!u8 || !u8.length) return false;
      var url = blobUrl(u8, mime || job.mime || 'image/jpeg');
      if (node.tagName === 'VIDEO') node.poster = url;
      else if (node.tagName === 'IMG') node.src = url;
      else return false;
      markLoad(node, 'thumb');
      return true;
    }
    if (job.inline && job.inline.length) return Promise.resolve(put(job.inline, job.mime));
    if (!job.size || job.size > MEDIA_MAX) return Promise.resolve(false);
    return getClient().then(function (c) {
      return readAll(c, job.loc, job.dcId, job.size);
    }).then(function (buf) { return put(buf, job.mime); })
      .catch(function () { return false; });
  }

  // Media faqat ko'rinish maydoniga kirganda yuklanadi (lazy).
  var loadObserver = null;
  function ensureLoadObserver() {
    if (loadObserver) return loadObserver;
    if (typeof global.IntersectionObserver === 'undefined') return null;
    loadObserver = new global.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (!en.isIntersecting) continue;
        var node = en.target;
        loadObserver.unobserve(node);
        var d = node.__desc;
        if (d && !node.getAttribute('data-ready')) downloadInto(node, d);
      }
    }, { rootMargin: '250px', threshold: 0.01 });
    return loadObserver;
  }
  function scheduleMediaLoad(node, d) {
    if (!node || !d) return;
    node.__desc = d;
    if (typeof global.IntersectionObserver === 'undefined') { downloadInto(node, d); return; }
    ensureLoadObserver().observe(node);
  }

  function downloadInto(node, d, urgent) {
    if (!node || !d) return Promise.resolve();
    if (urgent) { enqueueJob({ type: 'full', node: node, d: d, prio: 'hi' }); return Promise.resolve(); }
    if (thumbLoc(d)) enqueueJob({ type: 'thumb', node: node, d: d, prio: 'hi' });
    else enqueueJob({ type: 'full', node: node, d: d, prio: 'lo' });
    return Promise.resolve();
  }
  function runDownload(node, d) {
    if (docMime(d) === 'application/x-tgsticker') return downloadTgs(node, d);
    var job = resolveLoc(d);
    if (!job) { showFail(node, 'tur noma’lum'); return Promise.resolve(); }
    if (job.inline && job.inline.length) {
      // `inline` — bu keshlangan THUMBNAIL (webp/jpeg), asosiy fayl emas.
      var iu = blobUrl(job.inline, job.mime || ((d.kind === 'photo') ? 'image/jpeg' : 'image/webp'));
      node.src = iu; afterLoaded(node);
      return Promise.resolve(iu);
    }
    if (!job.size) { showFail(node, 'hajm noma’lum'); return Promise.resolve(); }
    if (job.size > MEDIA_MAX) { showFail(node, 'juda katta'); return Promise.resolve(); }
    var mime = job.mime || docMime(d) || (node.tagName === 'VIDEO' ? 'video/mp4' : 'image/jpeg');
    // Xotirada bor bo'lsa - qayta yuklamaymiz (tez, offline ham ishlaydi).
    var key = cacheKey(d);
    var hit = cacheGet(key);
    if (hit) { node.src = hit; afterLoaded(node); return Promise.resolve(hit); }

    // Kichik stiker/GIF/rasmlar IndexedDB'da ham saqlanadi: sahifa yangilansa
    // ham qayta Telegram'dan so'ralmaydi. Video/ovoz katta bo'lgani uchun
    // faqat xotira keshida qoladi.
    var pkey = persistentMediaKey(d);
    var canPersist = !!pkey && (d.kind === 'sticker' || d.kind === 'gif' || d.kind === 'photo')
      && job.size <= 3 * 1024 * 1024;
    var fromDisk = canPersist ? idbBlobGet(pkey) : Promise.resolve(null);

    return fromDisk.then(function (rec) {
      if (rec && rec.blob) {
        var cached = URL.createObjectURL(rec.blob);
        cachePut(key, cached);
        node.src = cached; afterLoaded(node);
        return cached;
      }
      return getClient().then(function (client) {
        return readAll(client, job.loc, job.dcId, job.size);
      }).then(function (buf) {
        if (!buf || !buf.length) throw new Error('bo‘sh fayl');
        var url = blobUrl(buf, mime);
        cachePut(key, url);
        if (canPersist) idbBlobSet(pkey, buf, mime, CACHE_TTL);
        node.src = url; afterLoaded(node);
        return url;
      });
    }).catch(function (e) {
      showFail(node, errMsg(e));
      try { console.warn('[tg-comments] media yuklanmadi:', d.kind, e); } catch (er) {}
    });
  }

  function mediaHtml(d) {
    if (!d) return '';
    var fail = '<span class="reels-c-media-fail" hidden>Ko‘rsatib bo‘lmadi</span>';
    var wh = dimAttrs(d);
    // Ovozli xabar - alohida "bubblik" (o'ynatish + to'lqin + vaqt).
    if (d.kind === 'voice' && global.TgVoice) return global.TgVoice.voiceHtml(d);
    if (d.kind === 'photo') {
      return '<div class="reels-c-media reels-c-photo"><img alt="" decoding="async"' + wh + '>' + fail + '</div>';
    }
    if (d.kind === 'sticker') {
      var sm = docMime(d);
      if (sm === 'application/x-tgsticker') {
        // Animatsiyali (.tgs / Lottie) stiker.
        return '<div class="reels-c-media reels-c-sticker"><div class="reels-tgs"></div>' + fail + '</div>';
      }
      if (sm.indexOf('video/') === 0) {
        // Video stiker (.webm) — animatsiya uchun <video>.
        return '<div class="reels-c-media reels-c-sticker">'
          + '<video autoplay loop muted playsinline preload="auto"' + wh + '></video>' + fail + '</div>';
      }
      return '<div class="reels-c-media reels-c-sticker"><img alt="" decoding="async"' + wh + '>' + fail + '</div>';
    }
    if (d.kind === 'gif') {
      // Telegram GIF'lari aslida MP4 - avtomatik o'ynaydigan <video>.
      return '<div class="reels-c-media reels-c-video reels-c-gif">'
        + '<video autoplay loop muted playsinline preload="auto"' + wh + '></video>' + fail + '</div>';
    }
    if (d.kind === 'video') {
      return '<div class="reels-c-media reels-c-video reels-c-lazy">'
        + '<div class="reels-c-media-play">▶ Video</div>' + fail + '</div>';
    }
    return '';
  }

  function wireMedia(row, m, d) {
    var box = row.querySelector('.reels-c-media');
    if (!box) return;
    // Ovozli xabar: yuklash faqat bosilganda, keyin o'ynatiladi.
    if (d.kind === 'voice' && global.TgVoice) {
      global.TgVoice.wireVoice(box, d, downloadInto);
      return;
    }
    var img = box.querySelector('img');
    var vid = box.querySelector('video');
    var tgs = box.querySelector('.reels-tgs');
    if (d.kind === 'photo') {
      scheduleMediaLoad(img, d);
      attachZoom(box);
      return;
    }
    if (d.kind === 'sticker') {
      // Telegram/Instagram kabi: doimiy o'ynaydi, bosilganda kattalashtiriladi.
      scheduleMediaLoad(tgs || vid || img, d);
      attachZoom(box);
      return;
    }
    if (d.kind === 'gif') {
      // GIF avtomatik va uzluksiz o'ynaydi (pauza yo'q).
      scheduleMediaLoad(vid, d);
      attachZoom(box);
      return;
    }
    // Video: bosilganda yuklab, <video> ga almashtiramiz.
    var play = box.querySelector('.reels-c-media-play');
    function playIt() {
      if (box.getAttribute('data-busy')) return;
      box.setAttribute('data-busy', '1');
      if (play) play.textContent = 'Yuklanmoqda…';
      var v = document.createElement('video');
      v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      v.setAttribute('controls', 'controls');
      box.innerHTML = '';
      box.appendChild(v);
      downloadInto(v, d, true);
      box.onclick = function () { togglePlay(v); };
    }
    if (play) play.addEventListener('click', playIt);
    box.addEventListener('click', playIt);
  }

  // ---- Rasm / GIF / stikerni bosganda kattalashtirib ko'rsatish ----------
  function mediaNodeIn(box) {
    if (!box) return null;
    var t = box.querySelector('.reels-tgs');
    if (t && t.__anim) return t;              // animatsiyali stiker
    var im = box.querySelector('img');        // rasm / statik stiker
    if (im && im.src) return im;
    return box.querySelector('video') || t;
  }
  function attachZoom(box) {
    if (!box || box.getAttribute('data-zoom')) return;
    box.setAttribute('data-zoom', '1');
    box.classList.add('reels-c-zoom');
    box.addEventListener('click', function (e) {
      var node = mediaNodeIn(box);
      if (!node) return;
      if (!node.__anim && !node.src) return;       // hali yuklanmagan
      e.preventDefault();
      e.stopPropagation();
      openLightbox(node);
    });
  }
  function ensureLightbox() {
    var lb = document.getElementById('reelsLightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.id = 'reelsLightbox';
    lb.className = 'reels-lb';
    lb.hidden = true;
    lb.innerHTML = '<button type="button" class="reels-lb-x" aria-label="Yopish"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      + '<div class="reels-lb-stage"></div>';
    document.body.appendChild(lb);
    lb.addEventListener('click', function () { closeLightbox(); });
    // Capture fazasida ushlaymiz — Escape izohlar oynasini ham yopib yubormasin.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      var box = document.getElementById('reelsLightbox');
      if (!box || box.hidden) return;
      e.stopPropagation();
      e.preventDefault();
      closeLightbox();
    }, true);
    return lb;
  }
  function openLightbox(node) {
    if (!node) return;
    var lb = ensureLightbox();
    var stage = lb.querySelector('.reels-lb-stage');
    if (!stage) return;
    stage.innerHTML = '';
    if (node.__anim && global.lottie && node.__anim.animationData) {
      var holder = document.createElement('div');
      holder.className = 'reels-tgs';
      stage.appendChild(holder);
      try {
        global.lottie.loadAnimation({
          container: holder, renderer: 'svg', loop: true, autoplay: true,
          animationData: node.__anim.animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
        });
      } catch (e) {}
    } else if (node.tagName === 'VIDEO') {
      var v = document.createElement('video');
      v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.src = node.currentSrc || node.src;
      stage.appendChild(v);
      try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    } else if (node.tagName === 'IMG') {
      var im = document.createElement('img');
      im.alt = '';
      im.decoding = 'async';
      im.src = node.currentSrc || node.src;
      stage.appendChild(im);
    } else {
      return;
    }
    lb.hidden = false;
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
  }
  function closeLightbox() {
    var lb = document.getElementById('reelsLightbox');
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    var stage = lb.querySelector('.reels-lb-stage');
    if (stage) stage.innerHTML = '';
    try { document.body.style.overflow = ''; } catch (e) {}
  }

  function senderIdOf(m) {
    var f = m.fromId;
    if (!f) return null;
    if (f.className === 'PeerUser') return String(f.userId);
    return null;
  }

  var SVG_REPLY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17 4 12l5-5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/></svg>';
  var SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="m6 7 1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></svg>';
  var SVG_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5C7.8 17.7 3 13.9 3 9.2 3 6.3 5.2 4.5 7.5 4.5c1.6 0 3 .9 4.5 2.7 1.5-1.8 2.9-2.7 4.5-2.7 2.3 0 4.5 1.8 4.5 4.7 0 4.7-4.8 8.5-9 11.3z"/></svg>';

  function findMsg(id) { return S.byId[String(id)] || null; }

  function senderName(m, authorId) {
    var me = T() && T().me ? T().me() : null;
    if (m && m.out === true) return username() || 'Siz';
    if (authorId && me && String(me.id) === String(authorId)) return username() || 'Siz';
    return authorId ? userOf(authorId).name : 'Foydalanuvchi';
  }

  function isMineMsg(m, authorId) {
    if (!m) return false;
    if (m.out === true) return true;
    var me = T() && T().me ? T().me() : null;
    return !!(authorId && me && String(me.id) === String(authorId));
  }

  // Instagram modeli: faqat 2 qatlam. Reply'ga reply ham "root" izohga
  // bog'lanadi (chuqur nesting yo'q).
  function rootIdOf(m, depth) {
    if (!m) return 0;
    if ((depth || 0) > 50) return Number(m.id);
    var rt = m.replyTo;
    var rid = rt ? (rt.replyToMsgId || 0) : 0;
    if (!rid || Number(rid) === Number(S.topicId)) return Number(m.id);
    var parent = findMsg(rid);
    if (!parent) return Number(m.id);   // ota-ona yuklanmagan — o'zini root qilamiz
    return rootIdOf(parent, (depth || 0) + 1);
  }

  function wireRow(m) {
    var list = listEl();
    if (!list || !m) return;
    var row = list.querySelector('[data-mid="' + m.id + '"]');
    if (!row || row.getAttribute('data-wired')) return;
    row.setAttribute('data-wired', '1');
    var d = mediaDescriptor(m);
    if (d) wireMedia(row, m, d);
  }

  function replyQuote(m) {
    var rt = m.replyTo;
    if (!rt) return '';
    var rid = rt.replyToMsgId || 0;
    if (!rid || Number(rid) === Number(S.topicId)) return '';
    // 2 qatlam modeli: javob to'g'ridan-to'g'ri root izohga bog'langan bo'lsa,
    // quote ortiqcha (u allaqachon root ostida turadi) — ko'rsatmaymiz.
    if (Number(rid) === Number(rootIdOf(m))) return '';
    var src = findMsg(rid);
    var sid = src ? senderIdOf(src) : null;
    var nm = src ? senderName(src, sid) : '';
    var un = '';
    if (src) un = isMineMsg(src, sid) ? username() : (sid ? userOf(sid).username : '');
    var snippet = src && src.message ? String(src.message) : '';
    if (!snippet && src) {
      var sd = mediaDescriptor(src);
      if (sd) snippet = sd.kind === 'photo' ? '📷 Rasm'
        : sd.kind === 'gif' ? 'GIF'
        : sd.kind === 'sticker' ? 'Stiker' : 'Video';
    }
    if (snippet.length > 64) snippet = snippet.slice(0, 64) + '…';
    var av = sid ? avatarHtml(sid, nm) : '';
    return '<div class="reels-c-quote" data-goto="' + esc(rid) + '">'
      + '<span class="reels-c-quote-bar"></span>'
      + (av ? '<span class="reels-c-quote-av">' + av + '</span>' : '')
      + '<span class="reels-c-quote-name">' + esc(nm || 'Javob')
      + (un ? ' <span class="reels-c-quote-un">@' + esc(un) + '</span>' : '')
      + '</span>'
      + (snippet ? '<span class="reels-c-quote-txt">' + esc(snippet) + '</span>' : '')
      + '</div>';
  }

  // Layk holati: optimistik qiymat bo'lsa o'sha, aks holda Telegram reaksiyalari.
  function likeInfo(m) {
    var ov = S.likes && S.likes[String(m.id)];
    if (ov) return { count: Number(ov.count) || 0, mine: !!ov.mine };
    var r = m && m.reactions;
    var count = 0, mine = false;
    if (r && r.results && r.results.length) {
      r.results.forEach(function (x) {
        if (!x) return;
        count += Number(x.count || 0);
        if (x.chosenOrder != null) mine = true;
      });
    }
    return { count: count, mine: mine };
  }

  function likeHtml(m) {
    var info = likeInfo(m);
    return '<div class="reels-c-like">'
      + '<button type="button" class="reels-c-like-btn' + (info.mine ? ' on' : '') + '"'
      + ' data-like="' + esc(m.id) + '" title="Yoqdi" aria-label="Yoqdi"'
      + ' aria-pressed="' + (info.mine ? 'true' : 'false') + '">' + SVG_HEART + '</button>'
      + '<span class="reels-c-like-n">' + (info.count ? formatN(info.count) : '') + '</span>'
      + '</div>';
  }

  function rowHtml(m) {
    var authorId = senderIdOf(m);
    var me = T() && T().me ? T().me() : null;
    var mine = (m.out === true) || (authorId && me && String(me.id) === authorId);
    var u = authorId ? userOf(authorId) : { name: 'Foydalanuvchi', username: '', id: null };
    var name = mine ? (username() || 'Siz') : u.name;
    var handle = mine ? username() : u.username;
    var d = mediaDescriptor(m);
    var body = m.message ? '<div class="reels-c-body">' + messageText(m) + '</div>' : '';
    var av = avatarHtml(mine ? (me && me.id) : authorId, name);
    var isAdmin = !!(global.REELS && global.REELS.isAdmin);
    var canDel = mine || isAdmin;
    // Instagram kabi: javob/o'chirish amallari kontent ostidagi vaqt qatorida.
    var actions = '<button type="button" class="reels-c-mact" data-reply="' + esc(m.id) + '">Javob</button>'
      + (canDel ? '<button type="button" class="reels-c-mact reels-c-mact-del" data-del-tg="' + esc(m.id) + '">O‘chirish</button>' : '');
    return '<div class="reels-c-row" data-mid="' + esc(m.id) + '">'
      + '<div class="reels-c-author">' + av + '</div>'
      + '<div class="reels-c-main">'
      + '<span class="reels-c-name">' + esc(name)
      + (handle ? ' <span class="reels-c-handle">@' + esc(handle) + '</span>' : '')
      + '</span> '
      + replyQuote(m)
      + body
      + mediaHtml(d)
      + '<div class="reels-c-meta">'
      + '<span class="reels-c-time">' + relTime(m.date) + '</span>'
      + actions
      + '</div>'
      + '</div>'
      + likeHtml(m)
      + '</div>';
  }

  function renderMessages(msgs, count) {
    var list = listEl();
    if (!list) return;
    if (!msgs.length) {
      list.innerHTML = '<div class="reels-c-empty">Hali izoh yo‘q. Birinchi bo‘ling!</div>';
      return;
    }
    // Root izohlar (eng yangisi tepada), javoblar root ostida (eski→yangi).
    var sorted = msgs.slice().sort(function (a, b) { return (b.id || 0) - (a.id || 0); });
    var roots = [], children = {};
    sorted.forEach(function (m) {
      var rid = rootIdOf(m);
      if (rid === Number(m.id)) roots.push(m);
      else (children[rid] = children[rid] || []).push(m);
    });
    Object.keys(children).forEach(function (k) {
      children[k].sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    });
    S.threads = { roots: roots, children: children };

    // Eski kuzatuvchilarni tozalaymiz (ro'yxat qayta qurilmoqda).
    if (loadObserver) loadObserver.disconnect();
    if (playObserver) playObserver.disconnect();

    list.innerHTML = roots.map(function (r) {
      var reps = children[String(r.id)] || [];
      // 1-2 ta javob bo'lsa darhol ko'rsatamiz, ko'p bo'lsa yig'amiz.
      var inline = reps.length > 0 && reps.length <= 2;
      var h = '<div class="reels-c-thread" data-root="' + esc(r.id) + '">' + rowHtml(r);
      if (reps.length) {
        h += '<div class="reels-c-replies">';
        if (!inline) {
          h += '<button type="button" class="reels-c-viewreplies" data-view="' + esc(r.id)
            + '" data-n="' + reps.length + '">'
            + reps.length + ' ta javobni ko‘rish</button>';
        }
        h += '<div class="reels-c-replies-list"' + (inline ? '' : ' hidden') + '>'
          + reps.map(rowHtml).join('') + '</div>';
        h += '</div>';
      }
      h += '</div>';
      return h;
    }).join('');

    // Media'larni faqat ko'rinadigan qatorlarga bog'laymiz (yig'ilgan
    // javoblar ochilganda bog'lanadi).
    roots.forEach(function (r) {
      wireRow(r);
      var reps = children[String(r.id)] || [];
      if (reps.length && reps.length <= 2) reps.forEach(wireRow);
    });

    // Foydalanuvchi hozir javob yozgan thread'ni avtomatik ochamiz.
    if (S.expandRoot) {
      var er = String(S.expandRoot);
      var erWrap = list.querySelector('.reels-c-thread[data-root="' + er + '"] .reels-c-replies-list');
      if (erWrap && erWrap.hidden) {
        erWrap.hidden = false;
        var erBtn = list.querySelector('.reels-c-viewreplies[data-view="' + er + '"]');
        if (erBtn) erBtn.textContent = 'Javoblarni yashirish';
        (children[er] || []).forEach(wireRow);
      }
      S.expandRoot = 0;
    }

    var n = (count != null && Number(count) >= 0) ? Number(count) : msgs.length;
    if (countEl()) {
      var cc = countEl();
      cc.textContent = n ? '(' + formatN(n) + ')' : '';
    }
    // Reels'dagi izoh belgisini ham yangilaymiz.
    if (S.reel && S.reel.id) {
      S.reel.comments = n;
      var badge = document.querySelector('#rCommentN_' + S.reel.id);
      if (badge) badge.textContent = n ? formatN(n) : '';
    }
  }

  function formatN(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return String(n);
  }

  function showStatus(html) {
    var list = listEl();
    if (list) list.innerHTML = '<div class="reels-c-empty">' + html + '</div>';
  }

  // Optimistik izoh: yuborish tugmasi bosilgan zahoti matn ko'rinadi,
  // Telegram javobi kelgach reload() uni haqiqiy xabar bilan almashtiradi.
  // Xato bo'lsa bubble o'chiriladi va hisoblagich orqaga qaytariladi.
  function showPending(text) {
    var list = listEl();
    if (!list) return;
    clearPending();
    var node = global.document.createElement('div');
    node.className = 'reels-c-pending';
    node.innerHTML = '<span class="reels-c-pending-dot"></span><span>' + esc(text) + '</span>';
    if (list.firstChild) list.insertBefore(node, list.firstChild);
    else list.appendChild(node);
  }
  function clearPending() {
    var list = listEl();
    if (!list) return;
    var old = list.querySelector('.reels-c-pending');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function tgOpenBlock(msg) {
    var url = S.url || topicUrl(S.topicId);
    var link = url
      ? '<a class="reels-c-open-tg" href="' + esc(url) + '" target="_blank" rel="noopener">Suhbatni ochish</a>'
      : '';
    return esc(msg || '') + link;
  }

  function reload() {
    if (!S.topicId) return Promise.resolve();
    S.loading = true;
    return loadReplies(50).then(function (res) {
      S.users = {};
      (res.users || []).forEach(function (u) { S.users[String(u.id)] = u; });
      var msgs = (res.messages || []).filter(function (m) {
        if (!m) return false;
        // GramJS sinf nomi "Message"; "MessageService" (qo'shilish va h.k.) tashlanadi.
        if (m.className && m.className !== 'Message') return false;
        if (Number(m.id) === Number(S.topicId)) return false; // mavzu sarlavhasi
        return true;
      });
      S.byId = {};
      S.likes = {};
      var ids = [];
      msgs.forEach(function (m) {
        S.byId[String(m.id)] = m;
        var a = senderIdOf(m);
        if (a) ids.push(a);
      });
      return loadNames(ids).then(function () {
        renderMessages(msgs, res.count);
        updateOpenTgLinks();
        msgs.forEach(function (m) {
          if (Number(m.id) > S.maxLiveId) S.maxLiveId = Number(m.id);
        });
        return msgs;
      });
    }).finally(function () { S.loading = false; });
  }

  // ------------------------------------------------------------ jonli oqim
  /** Faqat yangi xabar bormi deb so'raydi; bo'lsa to'liq reload() qiladi. */
  function liveTick() {
    if (!S.live || !S.topicId || S.loading || liveBusy || document.hidden) return;
    var gen = liveGen, tid = S.topicId;
    liveBusy = true;
    loadReplies(20).then(function (res) {
      liveBusy = false;
      if (gen !== liveGen || tid !== S.topicId || !S.live) return;
      var max = 0;
      ((res && res.messages) || []).forEach(function (m) {
        if (m && m.className === 'Message' && Number(m.id) > max) max = Number(m.id);
      });
      if (!max || max <= S.maxLiveId) return;
      // O'qib turgan joyi sakrab ketmasligi uchun scroll holatini saqlaymiz.
      var list = listEl(), top = list ? list.scrollTop : 0;
      return reload().then(function () { if (list) list.scrollTop = top; });
    }).catch(function () { liveBusy = false; });
  }

  function startLive() {
    stopLive();
    S.live = true;
    if (!document.hidden) liveTimer = setInterval(liveTick, LIVE_MS);
  }
  function stopLive() {
    liveGen++;              // eski so'rovning javobi endi qabul qilinmaydi
    S.live = false;
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }
  function pauseLive() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }
  function resumeLive() {
    if (!S.live || document.hidden || liveTimer) return;
    liveTimer = setInterval(liveTick, LIVE_MS);
    liveTick();
  }
  document.addEventListener('visibilitychange', function () {
    if (!S.live) return;
    if (document.hidden) pauseLive(); else resumeLive();
  });
  window.addEventListener('pagehide', stopLive);
  window.addEventListener('pageshow', function () { resumeLive(); });

  // ------------------------------------------------------------- yozish
  /**
   * Yozilgan matnni Telegram `entities` ga aylantiradi:
   *   1) `TgFormat` yengil markupni (`**qalin**`, `*kursiv*`, `>sitata`,
   *      `kod`, `[nom](havola)`) o'ziga aylantiradi va belgilarni matndan
   *      olib tashlaydi;
   *   2) sof matnda `@username` topib, Telegram'ning `mention` entity'sini
   *      qo'shamiz (bu markup offset'lari bilan emas, SOF matn offset'lari
   *      bilan ishlaydi - shuning uchun `extraFn` ichidan).
   * Natija `{ text, entities }`.
   */
  function composeText(text) {
    var F = global.TgFormat;
    if (!F || !F.parse) {
      return { text: text, entities: buildMentions(text) };
    }
    var p = F.parse(text, function (plain) { return buildMentions(plain); });
    var Api = A();
    var ents = [];
    if (Api) {
      (p.entities || []).forEach(function (e) {
        // GrammJS oddiy obyektni ham qabul qiladi, lekin aniq klass
        // yaratish ishonchliroq (schema tekshiruvi ishlaydi).
        var Ctor = Api[e._];
        if (typeof Ctor !== 'function') return;
        try { ents.push(new Ctor(e)); } catch (err) { /* noto'g'ri maydon */ }
      });
    }
    return { text: p.text, entities: ents.length ? ents : null };
  }

  /** @username -> InputMessageEntityMentionName (topilgan userlar uchun). */
  function buildMentions(text) {
    var Api = A();
    if (!Api) return null;
    var ents = [];
    var re = /@([A-Za-z][A-Za-z0-9_]{3,31})/g;
    var m;
    while ((m = re.exec(text))) {
      var uid = findUserIdByUsername(m[1]);
      if (!uid) continue;
      var u = S.users[uid];
      if (!u || u.accessHash == null) continue;
      try {
        ents.push(new Api.InputMessageEntityMentionName({
          offset: m.index,
          length: m[0].length,
          userId: new Api.InputUser({ userId: u.id, accessHash: u.accessHash })
        }));
      } catch (e) {}
    }
    return ents.length ? ents : null;
  }

  // -------------------------------------------------- serverga xabar berish
  // Izohlar Telegram'da saqlanadi, lekin server bu haqda bilmaydi. Shu sabab
  // yozilgach FAQAT METADATA yuboriladi: qaysi reel, kimga javob, qanday
  // mention. Izoh matni serverda SAQLANMAYDI (faqat qisqa preview).
  function reportNotify(kind, text) {
    if (!S.reel || !S.reel.id || !S.topicId) return;
    try {
      var me = T() && T().me ? T().me() : null;
      var body = new URLSearchParams();
      body.set('action', 'report');
      body.set('reel_id', String(S.reel.id));
      body.set('kind', kind || 'comment');
      body.set('text', String(text || '').slice(0, 280));

      if (S.replyTo) {
        var src = findMsg(S.replyTo);
        var sid = src ? senderIdOf(src) : null;
        if (sid) body.set('reply_to', sid);
      }

      var ments = [];
      String(text || '').replace(/@([a-z][a-z0-9_]{3,31})/gi, function (mAll, u) {
        u = String(u).toLowerCase();
        if (ments.indexOf(u) === -1) ments.push(u);
        return mAll;
      });
      if (ments.length) body.set('mentions', ments.slice(0, 20).join(','));

      if (me && me.id) {
        body.set('tg_me', JSON.stringify({ id: me.id, username: me.username || '' }));
      }

      fetch(baseUrl('api/notifications.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).catch(function () {});
    } catch (e) { /* jimgina */ }
  }

  function sendText(text) {
    text = (text || '').trim();
    if (!text) return Promise.resolve(false);
    if (!S.topicId) return Promise.reject(new Error('Izohlar yuklanmagan'));
    var c = composeText(text);
    var payload = { peer: S.peer, message: c.text };
    if (c.entities) payload.entities = c.entities;
    S.expandRoot = S.replyTo || 0;
    // Darhol fikr-mulohaza: tugma bosilganda izoh ko'rinadi, soni o'zgaradi.
    var tid = S.topicId;
    showPending(c.text);
    bumpCount(tid, 1);
    return sendRaw(payload).then(function () {
      reportNotify('comment', c.text);
      clearReply();
      return reload();
    }).catch(function (e) {
      bumpCount(tid, -1);
      throw e;
    }).finally(function () {
      clearPending();
    });
  }

  function sendPhoto(file) {
    if (!file) return Promise.resolve(false);
    var Api = A();
    S.expandRoot = S.replyTo || 0;
    return getClient().then(function (c) {
      return c.uploadFile({ file: file, workers: 1 });
    }).then(function (uploaded) {
      var media = new Api.InputMediaUploadedPhoto({ file: uploaded });
      return sendMediaRaw(media, '');
    }).then(function () { reportNotify('media', ''); finishReply(); bumpCount(S.topicId, 1); return reload(); });
  }

  function sendStickerDoc(doc) {
    var Api = A();
    S.expandRoot = S.replyTo || 0;
    var inputDoc = new Api.InputDocument({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference
    });
    var media = new Api.InputMediaDocument({ id: inputDoc });
    return sendMediaRaw(media, '').then(function () {
      reportNotify('media', ''); finishReply(); bumpCount(S.topicId, 1); return reload();
    });
  }

  // Saqlangan GIF (Document) yuborish — stiker bilan bir xil usul:
  // hujjat InputMediaDocument sifatida ulashiladi (qayta yuklash kerak emas).
  function sendGifDoc(doc) {
    var Api = A();
    S.expandRoot = S.replyTo || 0;
    var inputDoc = new Api.InputDocument({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference
    });
    var media = new Api.InputMediaDocument({ id: inputDoc });
    return sendMediaRaw(media, '').then(function () {
      reportNotify('media', ''); finishReply(); bumpCount(S.topicId, 1); return reload();
    });
  }

  // Ovozli xabar (voice) - `tg-voice.js` yozib beradi, Telegram'ga shu
  // yerda yuklanadi. `DocumentAttributeAudio { voice: true }` atributi bilan
  // "ovozli xabar" ko'rinishida saqlanadi.
  function sendVoice(blob, duration) {
    if (!blob) return Promise.resolve(false);
    if (!S.topicId) return Promise.reject(new Error('Izohlar yuklanmagan'));
    var V = global.TgVoice;
    if (!V) return Promise.reject(new Error('Ovoz moduli topilmadi'));
    S.expandRoot = S.replyTo || 0;
    return V.uploadMedia(blob, duration).then(function (media) {
      return sendMediaRaw(media, '');
    }).then(function () {
      reportNotify('media', '');
      finishReply();
      bumpCount(S.topicId, 1);
      return reload();
    });
  }

  // ------------------------------------------------------------- ochish
  function open(reel) {
    stopLive();
    S.maxLiveId = 0;
    S.reel = reel;
    S.topicId = reel.topic_id ? Number(reel.topic_id) : 0;
    S.users = {};
    S.byId = {};
    S.likes = {};
    S.threads = null;
    S.expandRoot = 0;
    S.replyTo = 0;
    S.replyName = '';
    S.count = cachedCount(S.topicId);
    S.url = S.topicId ? topicUrl(S.topicId) : '';

    initUI();
    clearReply();
    if (!enabled()) return Promise.resolve(false);

    showStatus('<span class="spinner"></span> Izohlar yuklanmoqda…');
    updateOpenTgLinks();

    return ensureTopic(reel).then(function (ok) {
      if (!ok) {
        showStatus('Izohlar sozlanmagan.');
        return false;
      }
      updateOpenTgLinks();
      return ensureJoined().then(resolvePeer).then(function () {
        return getClient();
      }).then(function () {
        return reload();
      }).then(function (msgs) {
        startLive();
        return msgs;
      }).catch(function (e) {
        var m = errMsg(e);
        if (/AUTH_REQUIRED|AUTH_REVOKED|AUTH_KEY/.test(m)) {
          showStatus(tgOpenBlock('Sessiya kerak. Iltimos, qaytadan kiring.'));
        } else if (/CHANNEL_PRIVATE|PEER_ID_INVALID|CHAT_WRITE_FORBIDDEN/.test(m)) {
          showStatus(tgOpenBlock('Guruhga ulanib bo‘lmadi.'));
        } else {
          showStatus(tgOpenBlock('Izohlarni yuklab bo‘lmadi: ' + esc(m)));
        }
        return false;
      });
    }).catch(function (e) {
      // Mavzu ochilmadi (masalan guruhda Topics yoqilmagan yoki bot admin emas).
      showStatus(tgOpenBlock(esc(errMsg(e))));
      return false;
    });
  }

  function updateOpenTgLinks() {
    var a = el('cOpenTg');
    if (!a) return;
    var url = S.url || topicUrl(S.topicId);
    if (url) { a.href = url; a.hidden = false; }
    else { a.hidden = true; }
  }

  function close() {
    stopLive();
    // Yozib turilayotgan ovozni to'xtatib, kompozitorni tiklaymiz.
    if (composerVoice) composerVoice.close();
    S.reel = null;
    S.topicId = 0;
    S.peer = null;
    closePicker();
  }

  // ----------------------------------------------------- reply / o'chirish
  // Javob berilayotgan foydalanuvchining @username'i (bo'lsa).
  function replyHandleOf(id) {
    var src = findMsg(id);
    if (!src) return '';
    var sid = senderIdOf(src);
    if (isMineMsg(src, sid)) return username();
    return sid ? userOf(sid).username : '';
  }
  // Instagram kabi: kiritish maydoniga "@username " ni oldindan qo'yamiz.
  function prefillMention(un) {
    var inp = el('commentInput');
    if (!inp || !un) return;
    if (new RegExp('^@' + un + '(\\s|$)', 'i').test(inp.value)) return;
    inp.value = '@' + un + ' ' + inp.value.replace(/^@[A-Za-z0-9_]{4,32}\s+/, '');
  }
  // Kiritish maydonidagi boshidagi @username ni olib tashlaymiz.
  function stripReplyMention() {
    var inp = el('commentInput');
    if (!inp) return;
    inp.value = inp.value.replace(/^@[A-Za-z0-9_]{4,32}\s+/, '');
  }
  function setReply(id, name, mentionHandle, mentionId) {
    S.replyTo = Number(id) || 0;
    S.replyName = name || '';
    var bar = el('cReplyBar');
    var txt = el('cReplyTxt');
    var av = el('cReplyAv');
    var src = findMsg(mentionId || id);
    var sid = src ? senderIdOf(src) : null;
    var un2 = mentionHandle || replyHandleOf(mentionId || id);
    if (av) av.innerHTML = sid ? avatarHtml(sid, name) : '';
    if (bar) bar.hidden = !S.replyTo;
    if (txt) txt.textContent = un2 ? ('@' + un2 + ' ga javob')
      : (S.replyName ? (S.replyName + ' ga javob') : 'Javob');
    prefillMention(un2);
    closePicker();
    var inp = el('commentInput');
    if (inp) { try { inp.focus(); var L = inp.value.length; inp.setSelectionRange(L, L); } catch (e) {} }
  }
  function clearReply() {
    S.replyTo = 0;
    S.replyName = '';
    var bar = el('cReplyBar');
    if (bar) bar.hidden = true;
  }
  // Javobdan voz kechish: @username'ni ham olib tashlaymiz.
  function cancelReply() {
    stripReplyMention();
    clearReply();
    var inp = el('commentInput');
    if (inp) { try { inp.focus(); var L = inp.value.length; inp.setSelectionRange(L, L); } catch (e) {} }
  }
  // Media yuborilgach: reply holatini va oldindan qo'yilgan mention'ni tozalaymiz.
  function finishReply() {
    stripReplyMention();
    clearReply();
  }
  function deleteMessage(id) {
    var Api = A();
    var list = listEl();
    var row = list ? list.querySelector('[data-mid="' + id + '"]') : null;
    if (row) row.classList.add('reels-c-row-del');
    return getClient().then(function (c) {
      var peer = S.peer;
      function viaApi() {
        // Forum-guruh MTProto'da "channel".
        if (peer && (peer.className === 'InputPeerChannel' || peer.className === 'InputChannel')) {
          return c.invoke(new Api.channels.DeleteMessages({
            channel: toInputChannel(peer),
            id: [Number(id)]
          }));
        }
        return c.invoke(new Api.messages.DeleteMessages({ revoke: true, id: [Number(id)] }));
      }
      // GramJS yuqori darajali usul; ishlamasa - past darajali zaxira.
      if (typeof c.deleteMessages === 'function') {
        return c.deleteMessages(peer, [Number(id)], { revoke: true }).catch(viaApi);
      }
      return viaApi();
    }).then(function () {
      toast('Izoh o‘chirildi');
      bumpCount(S.topicId, -1);
      return reload();
    }).catch(function (e) {
      if (row) row.classList.remove('reels-c-row-del');
      throw e;
    });
  }

  // Kichik xabar (toast) — reels.php'dagi #reelToast.
  function toast(msg) {
    var t = el('reelToast');
    if (!t) { try { console.log('[tg-comments]', msg); } catch (e) {} return; }
    t.textContent = msg;
    t.hidden = false;
    // `.reels-toast` `opacity: 0` bilan boshlanadi — `show` bo'lmasa
    // xabar ko'rinmaydi (jim "hech narsa bo'lmadi" holati).
    t.classList.add('show');
    if (toast._t) clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 220);
    }, 2600);
  }

  // ----------------------------------------------------- layk (reaksiya)
  // Instagram'dagi "like" -> Telegram'dagi 👍 reaksiyasi.
  function toggleLike(id) {
    var m = findMsg(id);
    if (!m) return;
    var Api = A();
    var info = likeInfo(m);
    var liked = !info.mine;
    // Optimistik: darhol ko'rsatamiz.
    S.likes[String(id)] = { count: Math.max(0, info.count + (liked ? 1 : -1)), mine: liked };
    refreshLikeUI(id, true);
    var reaction = liked ? [new Api.ReactionEmoji({ emoticon: '👍' })] : [];
    getClient().then(function (c) {
      return c.invoke(new Api.messages.SendReaction({
        peer: S.peer,
        msgId: Number(id),
        big: false,
        addToRecent: false,
        reaction: reaction
      }));
    }).then(function (res) {
      // Serverdan kelgan aniq hisobni qo'llaymiz.
      var r = reactionsFromUpdates(res, id);
      if (r) { m.reactions = r; delete S.likes[String(id)]; }
      refreshLikeUI(id);
    }).catch(function (e) {
      // Xato bo'lsa, eski holatga qaytaramiz.
      delete S.likes[String(id)];
      refreshLikeUI(id);
      try { console.warn('[tg-comments] reaksiya xatosi:', errMsg(e)); } catch (er) {}
    });
  }

  function reactionsFromUpdates(res, id) {
    var ups = (res && res.updates) || [];
    for (var i = 0; i < ups.length; i++) {
      var u = ups[i];
      if (!u) continue;
      if (u.className === 'UpdateMessageReactions' && Number(u.msgId) === Number(id)) return u.reactions || null;
      if (u.className === 'UpdateEditMessage' || u.className === 'UpdateNewMessage') {
        var mm = u.message;
        if (mm && Number(mm.id) === Number(id) && mm.reactions) return mm.reactions || null;
      }
    }
    return null;
  }

  function refreshLikeUI(id, pop) {
    var list = listEl();
    if (!list) return;
    var row = list.querySelector('[data-mid="' + id + '"]');
    var m = findMsg(id);
    if (!row || !m) return;
    var info = likeInfo(m);
    var btn = row.querySelector('.reels-c-like-btn');
    var n = row.querySelector('.reels-c-like-n');
    if (btn) {
      if (info.mine) btn.classList.add('on'); else btn.classList.remove('on');
      btn.setAttribute('aria-pressed', info.mine ? 'true' : 'false');
      if (pop) {
        btn.classList.remove('pop');
        void btn.offsetWidth;   // animatsiyani qaytadan boshlash
        btn.classList.add('pop');
      }
    }
    if (n) n.textContent = info.count ? formatN(info.count) : '';
  }
  function initListClicks() {
    var list = listEl();
    if (!list || list.__wired) return;
    list.__wired = true;
    list.addEventListener('click', function (e) {
      var t = e.target;
      var lk = t.closest && t.closest('[data-like]');
      if (lk) {
        e.preventDefault();
        var lid = Number(lk.getAttribute('data-like')) || 0;
        if (lid) toggleLike(lid);
        return;
      }
      var vw = t.closest && t.closest('[data-view]');
      if (vw) {
        e.preventDefault();
        var vrid = vw.getAttribute('data-view');
        var wrap = list.querySelector('.reels-c-thread[data-root="' + vrid + '"] .reels-c-replies-list');
        if (wrap) {
          if (wrap.hidden) {
            wrap.hidden = false;
            vw.textContent = 'Javoblarni yashirish';
            var reps2 = (S.threads && S.threads.children && S.threads.children[String(vrid)]) || [];
            reps2.forEach(wireRow);
          } else {
            wrap.hidden = true;
            vw.textContent = (vw.getAttribute('data-n') || '') + ' ta javobni ko‘rish';
          }
        }
        return;
      }
      var rp = t.closest && t.closest('[data-reply]');
      if (rp) {
        e.preventDefault();
        var id = Number(rp.getAttribute('data-reply')) || 0;
        var src = findMsg(id);
        if (src) {
          // 2 qatlam: reply'ga reply ham root izohga bog'lanadi, lekin
          // foydalanuvchi nomiga @mention qo'yiladi.
          var rid2 = rootIdOf(src);
          setReply(rid2, senderName(src, senderIdOf(src)), replyHandleOf(id), id);
        }
        return;
      }
      var del = t.closest && t.closest('[data-del-tg]');
      if (del) {
        e.preventDefault();
        var did = Number(del.getAttribute('data-del-tg')) || 0;
        if (!did) return;
        del.classList.add('busy');
        deleteMessage(did).catch(function (er) {
          del.classList.remove('busy');
          toast('O‘chirib bo‘lmadi: ' + errMsg(er));
        });
        return;
      }
      var go = t.closest && t.closest('[data-goto]');
      if (go) {
        var gid = go.getAttribute('data-goto');
        var row = list.querySelector('[data-mid="' + gid + '"]');
        if (row) { try { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (er) {} }
      }
    });
  }

  // -------------------------------------------------------- @username modal
  function askUsername(force) {
    var m = el('usernameModal');
    if (!m) return Promise.resolve(username());
    if (!force && username()) return Promise.resolve(username());
    var inp = el('unameInput');
    var err = el('unameErr');
    if (inp) inp.value = username() || '';
    if (err) { err.hidden = true; err.textContent = ''; }
    m.hidden = false;
    if (inp) { try { inp.focus(); } catch (e) {} }
    return new Promise(function (resolve) {
      function finish() { m.hidden = true; resolve(username()); }
      function submit() {
        var v = inp ? inp.value : '';
        if (!validUsername(v)) {
          if (err) { err.hidden = false; err.textContent = '4-32 belgi, harf bilan boshlanadi (a-z, 0-9, _)'; }
          if (inp) inp.focus();
          return;
        }
        saveUsername(v);
        finish();
      }
      if (inp && !inp.__wired) {
        inp.__wired = true;
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      }
      var save = el('unameSave');
      if (save && !save.__wired) { save.__wired = true; save.addEventListener('click', submit); }
      var x = m.querySelector('[data-close-uname]');
      if (x && !x.__wired) { x.__wired = true; x.addEventListener('click', finish); }
    });
  }
  function init() {
    // `||spoiler||` izohlari bosilish bilan ochiladi.
    try { if (global.TgFormat) global.TgFormat.bindSpoilers(); } catch (e) {}
    initUI();
    var mid = meId();
    // Akkaunt aniqlanmadi - nomni ham ko'rsatmaymiz (keyingi kirishda
    // boshqa akkauntga tegishli bo'lib qolmasin).
    if (!mid) { clearLocalUsername(); return; }
    // Boshqa akkauntga o'tilgan bo'lsa - avvalgi nomni tozalaymiz.
    if (unameOwner() && unameOwner() !== mid) clearLocalUsername();
    if (username()) {
      // Eski (owner'siz) yozuvni joriy akkauntga bog'lab qo'yamiz.
      if (!unameOwner()) setLocalUsername(username(), mid);
      return;                               // nom allaqachon saqlangan
    }
    // localStorage'da yo'q, lekin serverda bo'lmasin - bo'lsa qayta so'ramaymiz.
    restoreUsername(mid).then(function (srv) {
      if (!srv && !username()) askUsername();
    });
  }

  /* ========================================================================
   * IZOH KOMPOZITORI (Telegram uslubi)
   * ------------------------------------------------------------------------
   * PHP/shablonga tegmasdan turib kompozitorni qayta tartibga solamiz:
   *   chap  -> 📎 (rasm/fayl)
   *   o'rt  -> <textarea>
   *   o'ng  -> 😊 (emoji/stiker/GIF) + 🎤/➤ (ovoz/yuborish)
   * Barcha yangi stillar faqat shu fayldan `<style>` bilan in'ektsiya
   * qilinadi (share-chat.js naqshi). Palette: faqat oq/qora.
   * ======================================================================== */
  var SVG_CLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M20.4 11.1 12 19.5a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/></svg>';
  var SVG_SMILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="9"/>'
    + '<path d="M8.5 14.2c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"/>'
    + '<path d="M9.2 9.4h.01M14.8 9.4h.01"/></svg>';

  // Aqlli takliflar uchun so'z -> emoji lug'ati (uz / en / ru).
  var EMOJI_HINTS = {
    '👋': ['salom', 'assalom', 'hello', 'hi', 'privet', 'xayr', 'bye', 'yov'],
    '🙏': ['rahmat', 'rajmat', 'thanks', 'thank', 'spasibo', 'minnatdor', 'ilov'],
    '🔥': ['olov', 'fire', 'ogon', 'issiq', 'trend', 'qiz'],
    '❤️': ['sevgi', 'sevaman', 'love', 'lyublyu', 'yurak', 'qalb', 'serdts'],
    '😂': ['kul', 'kulgi', 'haha', 'lol', 'smex', 'kulgili', 'gulash'],
    '😍': ['chiroyli', 'gozal', 'go‘zal', 'wow', 'milya', 'obra'],
    '👍': ['yaxshi', 'good', 'horosho', 'ok', 'tasdiq', 'like', 'alright'],
    '👎': ['yomon', 'bad', 'ploxo', 'dislike'],
    '😊': ['tabassum', 'smile', 'ulib', 'kulimsira'],
    '😎': ['super', 'krut', 'cool', 'qoyqoyi', 'zor'],
    '🤔': ['oylash', 'o‘ylash', 'think', 'dumay', 'qiziq', 'nimaga'],
    '😢': ['yigla', 'yig‘la', 'sad', 'grust', 'qaygu', 'qayg‘u', 'yosh'],
    '😡': ['jahl', 'angry', 'gnev', 'serdit', 'gazab', 'g‘azab'],
    '🤗': ['quchoq', 'hug', 'obniy', 'quchoqlash'],
    '🎉': ['tabrik', 'congrats', 'bayram', 'fest', 'tugilgan', 'tug‘ilgan'],
    '✅': ['tayyor', 'done', 'gotovo', 'bajarildi', 'tasdiqlandi'],
    '💯': ['yuz', '100', 'exact', 'alohida'],
    '👏': ['olqish', 'applause', 'bravo', 'molodets', 'afarin'],
    '🤝': ['kelishuv', 'deal', 'dogovor', 'hamkor', 'yordam'],
    '👀': ['qarab', 'qara', 'look', 'smotri', 'korish', 'ko‘rish'],
    '🕐': ['vaqt', 'time', 'vremya', 'soat', 'kech'],
    '💡': ['goya', 'g‘oya', 'idea', 'ideya', 'fikir', 'aqllash'],
    '🎬': ['kino', 'film', 'movie', 'video', 'kinoteatr'],
    '🍿': ['popkorn', 'popcorn', 'snack', 'kino'],
    '😴': ['uxla', 'sleep', 'son', 'uyqu', 'tong'],
    '🤯': ['mind', 'uma', 'vau', 'hayron', 'aqllash'],
    '🫡': ['salute', 'salyut', 'hurmat', 'respect'],
    '🤌': ['barmoq', 'finger', 'italyan'],
    '💪': ['kuch', 'strong', 'silu', 'gym', 'jasorat'],
    '🥰': ['mehr', 'lyubov', 'sevgi', 'love'],
    '😁': ['glum', 'g‘alaba', 'galaba', 'kul'],
    '🤣': ['kul', 'smex', 'lol', 'haha'],
    '💬': ['xabar', 'message', 'soz', 'so‘z', 'chat', 'gap'],
    '⭐': ['yulduz', 'star', 'zvezda', 'reyting'],
    '📷': ['rasm', 'photo', 'foto', 'kamera', 'camera'],
    '🎤': ['mikrofon', 'mic', 'voice', 'ovoz', 'qoshiq'],
    '🎵': ['musiqa', 'music', 'muzika', 'qoshiq'],
    '📱': ['telefon', 'phone', 'tel', 'mobil'],
    '❓': ['savol', 'question', 'vopros', 'nima'],
    '💰': ['pul', 'money', 'dengi', 'narx'],
    '🍔': ['taom', 'food', 'eda', 'ovqat', 'yemoq'],
    '☕': ['choy', 'coffee', 'kofe', 'qahva'],
    '🌙': ['oy', 'moon', 'luna', 'kecha', 'tun'],
    '☀️': ['quyosh', 'sun', 'solntse', 'kun'],
    '🏠': ['uy', 'home', 'dom', 'ketish'],
    '🚀': ['rocket', 'raketa', 'start', 'tezkor'],
    '🐶': ['it', 'dog', 'sobaqa', 'kuchuk'],
    '🐱': ['mushuk', 'cat', 'kot', 'koshka'],
    '⚽': ['futbol', 'football', 'soccer', 'top'],
    '🎁': ['sovga', 'sovg‘a', 'gift', 'podarok'],
    '🤖': ['bot', 'robot', 'avtomat']
  };

  // Picker ichidagi "kayfiyat" bo'limlari.
  var EMOJI_MOODS = {
    happy: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '🥳', '😎', '🤗', '😋', '😜'],
    love: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '🥰', '😍', '😘', '🫂'],
    sad: ['😔', '😪', '😴', '😢', '😭', '😰', '😥', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '💀', '🤡'],
    food: ['🍏', '🍎', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🍔', '🍗', '🍕', '🍣', '🍜', '🍚', '🍳', '🥞', '🍰', '🎂', '🍿', '🍩', '🍪', '☕', '🍵', '🍺'],
    work: ['💻', '⌨️', '🖥️', '📱', '📷', '📞', '📧', '📊', '📈', '📁', '📝', '✏️', '🔍', '💡', '🔧', '⚙️', '💼', '📌', '📎', '🗓️', '⏰', '🎯'],
    nature: ['🌵', '🌲', '🌳', '🌴', '🌱', '🍀', '🌹', '🌸', '🌻', '🌈', '⭐', '🌟', '☀️', '🌙', '☁️', '❄️', '🔥', '💧', '🐶', '🐱', '🦊', '🐼', '🦁', '🐸'],
    fun: ['🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎸', '🎯', '🎮', '🎲', '🎪', '🎭', '🎨', '🎡', '🎢', '🚀', '⚽', '🏀', '🎱', '🛹', '🏋️', '🧘']
  };
  var MOOD_LABELS = {
    recent: 'So‘nggi', frequent: 'Ko‘p ishlatilgan', happy: 'Kayfiyat',
    love: 'Sevgi', sad: 'Qayg‘u', food: 'Taom', work: 'Ish',
    nature: 'Tabiat', fun: 'Zavq', all: 'Hammasi'
  };

  // ------------------------------------------------------ IndexedDB keshi
  // Faqat emoji/stiker META ma'lumotlari saqlanadi (session/token yo'q).
  var IDB_NAME = 'wc_tg_comments_cache_v1';
  var IDB_STORE = 'kv';
  var IDB_BLOB_STORE = 'blob';
  var CACHE_TTL = 12 * 60 * 60 * 1000;   // 12 soat
  var idbPromise = null;
  var recentStickerDocs = [];
  var recentLoadTried = false;
  var usageList = [];
  var emojiView = { mood: 'recent', q: '' };

  function idb() {
    if (!global.indexedDB) return Promise.resolve(null);
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve) {
      try {
        var rq = indexedDB.open(IDB_NAME, 2);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (db && !db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
          if (db && !db.objectStoreNames.contains(IDB_BLOB_STORE)) db.createObjectStore(IDB_BLOB_STORE);
        };
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { resolve(null); };
        rq.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return idbPromise;
  }

  // Eslatma: yuqoridagi `cacheGet/cachePut` — xotiradagi blob URL keshi.
  // Bu yerdagilar IndexedDB uchun, shuning uchun nomlari farqlanadi.
  function idbGet(key) {
    return idb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
          rq.onsuccess = function () {
            var rec = rq.result;
            if (!rec || typeof rec !== 'object' || !('v' in rec)) { resolve(null); return; }
            if (Number(rec.ttl) > 0 && (Date.now() - Number(rec.t || 0)) > Number(rec.ttl)) { resolve(null); return; }
            resolve(rec.v);
          };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  function idbSet(key, value, ttl) {
    return idb().then(function (db) {
      if (!db) return;
      try {
        db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE)
          .put({ v: value, t: Date.now(), ttl: Number(ttl) || 0 }, key);
      } catch (e) { /* kesh ixtiyoriy */ }
    });
  }

  function persistentMediaKey(d) {
    var k = cacheKey(d);
    if (!k) return '';
    return 'media:' + k + ':' + (docMime(d) || '');
  }

  function idbBlobGet(key) {
    return idb().then(function (db) {
      if (!db || !key) return null;
      return new Promise(function (resolve) {
        try {
          var rq = db.transaction(IDB_BLOB_STORE, 'readonly').objectStore(IDB_BLOB_STORE).get(key);
          rq.onsuccess = function () {
            var rec = rq.result;
            if (!rec || typeof rec !== 'object' || !rec.blob) { resolve(null); return; }
            if (Number(rec.ttl) > 0 && (Date.now() - Number(rec.t || 0)) > Number(rec.ttl)) { resolve(null); return; }
            resolve(rec);
          };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  function idbBlobSet(key, buf, mime, ttl) {
    if (!key || !buf || !buf.length) return Promise.resolve();
    return idb().then(function (db) {
      if (!db) return;
      try {
        var blob = new Blob([buf instanceof Uint8Array ? buf : new Uint8Array(buf)],
          { type: mime || 'application/octet-stream' });
        db.transaction(IDB_BLOB_STORE, 'readwrite').objectStore(IDB_BLOB_STORE)
          .put({ blob: blob, mime: mime || '', t: Date.now(), ttl: Number(ttl) || 0 }, key);
      } catch (e) { /* kesh ixtiyoriy */ }
    });
  }

  function ownerKey() {
    return String(meId() || 'anon').replace(/[^a-zA-Z0-9_-]/g, '');
  }
  function kUsage()    { return 'usage:' + ownerKey(); }
  function kSets()     { return 'stickerSets:' + ownerKey(); }
  function kRecent()   { return 'recentStickers:' + ownerKey(); }

  function rememberUsage(type, key) {
    var list = Array.isArray(usageList) ? usageList.slice() : [];
    list = list.filter(function (x) { return !(x && x.t === type && x.k === key); });
    list.unshift({ t: type, k: String(key), at: Date.now() });
    usageList = list.slice(0, 60);
    return idbSet(kUsage(), usageList, 30 * 24 * 60 * 60 * 1000);
  }
  function usageRank(type, key) {
    for (var i = 0; i < usageList.length; i++) {
      if (usageList[i] && usageList[i].t === type && usageList[i].k === key) return usageList.length - i;
    }
    return 0;
  }

  function stickerAlt(d) {
    var alts = [];
    ((d && d.attributes) || []).forEach(function (a) {
      if (a && a.className === 'DocumentAttributeSticker' && a.alt) alts.push(String(a.alt));
    });
    return alts.join('');
  }
  function minifyStickerDocs(docs) {
    return (docs || []).slice(0, 80).map(function (d) {
      return { id: String(d.id || ''), alt: stickerAlt(d), mime: d.mimeType || '' };
    }).filter(function (x) { return x.id; });
  }
  function minifySets(sets) {
    // `accessHash` stiker to'plamini qayta ochish uchun kerak (maxfiy emas).
    return (sets || []).slice(0, 200).map(function (s) {
      return {
        id: s.id || '',
        accessHash: s.accessHash || s.access_hash || '',
        title: s.title || 'Set'
      };
    }).filter(function (x) { return x.id; });
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[‘’`]/g, "'").replace(/'/g, '').trim();
  }

  function emojiCatalog() {
    var map = {};
    var secs = (global.TgEmoji && global.TgEmoji.sections && global.TgEmoji.sections()) || [];
    secs.forEach(function (g) {
      (g.list || []).forEach(function (em) { if (!map[em]) map[em] = g.name || ''; });
    });
    function add(list) {
      (list || []).forEach(function (em) { if (!map[em]) map[em] = ''; });
    }
    Object.keys(EMOJI_HINTS).forEach(add);
    Object.keys(EMOJI_MOODS).forEach(function (k) { add(EMOJI_MOODS[k]); });
    return Object.keys(map).map(function (em) { return { em: em, group: map[em] || '' }; });
  }

  function emojiMatch(item, q) {
    var s = norm(q);
    if (!s) return true;
    if (item.em === q) return true;
    if (norm(item.group).indexOf(s) >= 0) return true;
    var hints = EMOJI_HINTS[item.em] || [];
    for (var i = 0; i < hints.length; i++) {
      var h = norm(hints[i]);
      if (h && (h.indexOf(s) >= 0 || (h.length >= 5 && s.indexOf(h) >= 0))) return true;
    }
    return false;
  }

  // -------------------------------------------------- stillar (JS ichida)
  var CSS_ID = 'wcTgCommentsComposerCss';
  function injectComposerCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.type = 'text/css';
    st.textContent = [
      '.wc-c-form.reels-comments-form{position:relative;display:flex;align-items:flex-end;gap:4px}',
      '.wc-c-form #cAttachBtn{order:0}',
      '.wc-c-form .reels-comments-input{order:1;flex:1 1 auto;min-width:0;background:#000;color:#fff;border-color:#262626}',
      '.wc-c-form .reels-comments-input:focus{border-color:#555}',
      '.wc-c-form #cEmojiBtn{order:2;width:40px;height:40px;flex:0 0 auto;border:1px solid #262626;border-radius:50%;background:#000;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none}',
      '.wc-c-form #cEmojiBtn:hover{background:#0e0e0e;border-color:#454545}',
      '.wc-c-form #commentSend{order:3}',
      '.wc-c-form #cOpenTg{order:4;margin-left:0}',
      '.wc-c-form #cAttachBtn svg,.wc-c-form #cEmojiBtn svg{width:22px;height:22px}',
      '.wc-c-form #commentSend[data-mode="send"]{background:#fff;color:#000}',
      '.wc-c-form #commentSend[data-mode="mic"],.wc-c-form #commentSend[data-mode="attach"]{background:#000;color:#fff;border:1px solid #262626}',
      '.wc-c-suggest{position:absolute;left:6px;right:6px;bottom:calc(100% + 6px);z-index:7;display:flex;align-items:center;gap:4px;padding:5px 6px;background:#0e0e0e;border:1px solid #262626;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.55)}',
      '.wc-c-suggest[hidden]{display:none}',
      '.wc-c-sug-label{flex:0 0 auto;padding:0 4px;color:#8a8a8a;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}',
      '.wc-c-sug-items{display:flex;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none}',
      '.wc-c-sug-items::-webkit-scrollbar{display:none}',
      '.wc-c-sug-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 9px;border:1px solid #262626;border-radius:15px;background:#000;color:#fff;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}',
      '.wc-c-sug-chip:hover{background:#181818;border-color:#444}',
      '.wc-c-sug-emo{font-size:17px;line-height:1}',
      '.wc-c-sug-lbl{color:#aaa;font-size:11px}',
      '.wc-c-suggest #cFmtBtn{width:auto;height:26px;padding:0 8px;margin:0;border:1px solid #262626;border-radius:8px;background:#000;color:#fff;font-size:0}',
      '.wc-c-suggest #cFmtBtn::after{content:"Aa";font-size:11px;font-weight:800;letter-spacing:.02em}',
      '.wc-c-suggest #cFmtBtn svg{display:none}',
      '#cPicker.reels-c-picker{background:#0e0e0e;border-color:#262626}',
      '#cPicker .reels-c-picker-tab.on{background:#fff!important;color:#000!important}',
      '.wc-c-search{padding:8px 10px 4px}',
      '.wc-c-search input{width:100%;box-sizing:border-box;height:36px;padding:0 14px;border:1px solid #262626;border-radius:18px;background:#000;color:#fff;font:inherit;font-size:13px;outline:none}',
      '.wc-c-search input:focus{border-color:#555}',
      '.wc-c-moods{display:flex;align-items:center;gap:4px;padding:6px 8px;overflow-x:auto;border-bottom:1px solid #262626;scrollbar-width:none}',
      '.wc-c-moods::-webkit-scrollbar{display:none}',
      '.wc-c-mood{flex:0 0 auto;height:26px;padding:0 10px;border:1px solid #262626;border-radius:13px;background:#000;color:#aaa;cursor:pointer;font:inherit;font-size:11.5px;white-space:nowrap}',
      '.wc-c-mood:hover{color:#fff;border-color:#444}',
      '.wc-c-mood.on{background:#fff;color:#000;border-color:#fff}',
      '#cPicker .wc-c-emoji-body{display:block;max-height:none;flex:1 1 auto;min-height:0;padding-bottom:8px}',
      '#cPicker .wc-c-emoji-cap{color:#8a8a8a}',
      '#cPicker .wc-c-emoji-grid{grid-template-columns:repeat(auto-fill,minmax(42px,1fr))}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ----------------------------------------------------------- kompozitor
  function prepareComposer() {
    var form = el('commentForm');
    var input = el('commentInput');
    var send = el('commentSend');
    if (!form || !input || !send) return;
    injectComposerCss();
    form.classList.add('wc-c-form');

    var attach = el('cAttachBtn');
    if (attach) {
      attach.innerHTML = SVG_CLIP;                 // 📎 chap tomonda
      attach.setAttribute('aria-label', 'Stiker, GIF, rasm');
      attach.setAttribute('title', 'Biriktirish');
    }

    var eb = el('cEmojiBtn');
    if (!eb) {
      eb = document.createElement('button');
      eb.type = 'button';
      eb.id = 'cEmojiBtn';
      eb.className = 'reels-c-tool wc-c-emoji-btn';
      eb.setAttribute('aria-label', 'Emoji, stiker, GIF');
      eb.setAttribute('title', 'Emoji');
      eb.innerHTML = SVG_SMILE;
      form.insertBefore(eb, send);                 // 😊 o'ng tomonda, ➤ oldida
    }
    if (!eb.__wcBound) {
      eb.__wcBound = true;
      eb.addEventListener('click', function (e) {
        e.preventDefault();
        openPanel('emoji');
      });
    }

    var bar = el('cSuggest');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'wc-c-suggest';
      bar.id = 'cSuggest';
      bar.hidden = true;
      var lbl = document.createElement('span');
      lbl.className = 'wc-c-sug-label';
      lbl.textContent = 'Taklif';
      var items = document.createElement('div');
      items.className = 'wc-c-sug-items';
      items.id = 'cSuggestItems';
      bar.appendChild(lbl);
      bar.appendChild(items);
      form.insertBefore(bar, form.firstChild);
    }
    // "Aa" formatlash tugmasi endi shu kontekst menyuda (kichik chip).
    // ID o'zgarmaydi, shuning uchun TgFormat.mountFmtMenu uni topishda davom etadi.
    var fmt = el('cFmtBtn');
    if (fmt && fmt.parentNode !== bar) bar.appendChild(fmt);
    initSmartSuggest();
  }

  // ------------------------------------------------------- aqlli takliflar
  var EMOTICON_RULES = [
    { re: /:-?\)|=\)/, em: '😊' },
    { re: /:-?d|=d/i, em: '😂' },
    { re: /:-?\(/, em: '😢' },
    { re: /<3/, em: '❤️' },
    { re: /:-?p/i, em: '😜' },
    { re: /;\)/, em: '😉' }
  ];

  function matchEmojis(text) {
    var t = norm(text);
    var tokens = t.split(/[^a-z0-9\u0400-\u04ff]+/).filter(function (x) { return x.length >= 3; });
    var out = [];
    EMOTICON_RULES.forEach(function (r) { if (r.re.test(String(text || ''))) out.push(r.em); });
    Object.keys(EMOJI_HINTS).forEach(function (em) {
      var hints = EMOJI_HINTS[em] || [];
      for (var i = 0; i < hints.length; i++) {
        var h = norm(hints[i]);
        if (!h || h.length < 3) continue;
        if (tokens.indexOf(h) >= 0 || (h.length >= 5 && t.indexOf(h) >= 0)) { out.push(em); return; }
      }
    });
    return out.filter(function (em, i) { return out.indexOf(em) === i; })
      .sort(function (a, b) { return usageRank('emoji', b) - usageRank('emoji', a); });
  }

  function hintLabel(em) {
    var h = EMOJI_HINTS[em];
    return (h && h[0]) || 'emoji';
  }

  function renderSuggest(items) {
    var bar = el('cSuggest');
    var host = el('cSuggestItems');
    if (!bar || !host) return;
    if (!items || !items.length) { bar.hidden = true; host.innerHTML = ''; return; }
    bar.hidden = false;
    host.innerHTML = items.map(function (it) {
      var attr = it.stickerKey
        ? ' data-sticker="' + esc(it.stickerKey) + '"'
        : ' data-emoji="' + esc(it.emoji) + '"';
      var face = it.emoji || '⭐';
      return '<button type="button" class="wc-c-sug-chip"' + attr + '>'
        + '<span class="wc-c-sug-emo">' + face + '</span>'
        + '<span class="wc-c-sug-lbl">' + esc(it.label || '') + '</span></button>';
    }).join('');
  }

  function updateSuggestions() {
    var inp = el('commentInput');
    if (!inp || !el('cSuggest')) return;
    var text = String(inp.value || '');
    if (!text.trim()) {
      var rec = ((global.TgEmoji && global.TgEmoji.recent && global.TgEmoji.recent()) || []).slice(0, 5);
      var lbl = 'so‘nggi';
      if (!rec.length) {
        var freq = emojiSection('Ko‘p ishlatilgan');
        rec = ((freq && freq.list) || []).slice(0, 5);
        lbl = 'tez-tez';
      }
      renderSuggest(rec.map(function (em) { return { emoji: em, label: lbl }; }));
      return;
    }
    var ems = matchEmojis(text);
    if (!ems.length) { renderSuggest([]); return; }
    // Stiker taklifi uchun meta bir marta yuklanadi (keyin IndexedDBdan o'qiymiz).
    if (!recentStickerDocs.length && !recentLoadTried) {
      recentLoadTried = true;
      loadRecentStickers().then(function () {
        if (el('commentInput') && el('commentInput').value === text) updateSuggestions();
      }).catch(function () {});
    }
    renderSuggest(ems.slice(0, 5).map(function (em) {
      return { emoji: em, label: hintLabel(em) };
    }));
    // Stiker taklifi: oxirgi ishlatilgan stikerlarning emoji belgisi (alt) bo'yicha.
    idbGet(kRecent()).then(function (meta) {
      if (!Array.isArray(meta) || !meta.length) return;
      var hit = null;
      for (var i = 0; i < meta.length && !hit; i++) {
        var alt = String((meta[i] && meta[i].alt) || '');
        for (var j = 0; j < ems.length; j++) {
          if (alt.indexOf(ems[j]) >= 0) { hit = meta[i]; break; }
        }
      }
      var host = el('cSuggestItems');
      if (!hit || !host || el('commentInput').value !== text) return;
      if (host.querySelector('[data-sticker]')) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wc-c-sug-chip';
      b.setAttribute('data-sticker', hit.id);
      b.innerHTML = '<span class="wc-c-sug-emo">' + esc(hit.alt || '⭐') + '</span>'
        + '<span class="wc-c-sug-lbl">stiker</span>';
      host.insertBefore(b, host.firstChild);
    }).catch(function () {});
  }

  function findStickerByKey(key) {
    for (var i = 0; i < recentStickerDocs.length; i++) {
      if (String(recentStickerDocs[i].id) === String(key)) return recentStickerDocs[i];
    }
    return null;
  }

  function sendSuggestedSticker(key) {
    function go(doc) {
      S.expandRoot = S.replyTo || 0;
      renderSuggest([]);
      rememberUsage('sticker', key);
      sendStickerDoc(doc).catch(function (e) { toast('Xatolik: ' + esc(errMsg(e))); });
    }
    var doc = findStickerByKey(key);
    if (doc) { go(doc); return; }
    // Keshda faqat meta bor bo'lsa, to'liq hujjatni Telegram'dan olamiz.
    loadRecentStickers().then(function (docs) {
      for (var i = 0; i < docs.length; i++) {
        if (String(docs[i].id) === String(key)) { go(docs[i]); return; }
      }
      toast('Stiker topilmadi');
      renderSuggest([]);
    }).catch(function () { toast('Stiker yuborilmadi'); });
  }

  function onSuggestClick(e) {
    var t = e.target;
    var chip = t && t.closest && t.closest('[data-emoji],[data-sticker]');
    if (!chip) return;
    e.preventDefault();
    var em = chip.getAttribute('data-emoji');
    if (em) {
      if (global.TgEmoji && global.TgEmoji.pushRecent) global.TgEmoji.pushRecent(em);
      rememberUsage('emoji', em);
      insertAt(em);                      // input event -> takliflar yangilanadi
      return;
    }
    var key = chip.getAttribute('data-sticker');
    if (key) sendSuggestedSticker(key);
  }

  function initSmartSuggest() {
    var inp = el('commentInput');
    var bar = el('cSuggest');
    if (!inp || !bar || bar.__wcBound) return;
    bar.__wcBound = true;
    idbGet(kUsage()).then(function (l) { usageList = Array.isArray(l) ? l : []; }).catch(function () {});
    inp.addEventListener('input', updateSuggestions);
    inp.addEventListener('focus', updateSuggestions);
    inp.addEventListener('blur', function () {
      global.setTimeout(function () {
        if (!bar.contains(document.activeElement)) renderSuggest([]);
      }, 140);
    });
    // Chip ustiga bosganda textarea fokusini yo'qotmaymiz.
    bar.addEventListener('mousedown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) e.preventDefault();
    });
    bar.addEventListener('click', onSuggestClick);
  }

  // -------------------------------------------------------- yangi 😊 picker
  function moodButtons() {
    return Object.keys(MOOD_LABELS).map(function (k) {
      return '<button type="button" class="wc-c-mood' + (k === 'recent' ? ' on' : '') + '"'
        + ' data-mood="' + k + '">' + esc(MOOD_LABELS[k]) + '</button>';
    }).join('');
  }

  function emojiSection(name) {
    var secs = (global.TgEmoji && global.TgEmoji.sections && global.TgEmoji.sections()) || [];
    for (var i = 0; i < secs.length; i++) {
      if (secs[i] && secs[i].name === name) return secs[i];
    }
    return null;
  }

  function renderEmojiView() {
    var b = pickerBody();
    if (!b) return;
    var q = emojiView.q || '';
    var list;
    if (q.trim()) {
      list = emojiCatalog().filter(function (x) { return emojiMatch(x, q); })
        .map(function (x) { return x.em; });
    } else if (emojiView.mood === 'recent') {
      list = ((global.TgEmoji && global.TgEmoji.recent && global.TgEmoji.recent()) || []).slice();
      if (!list.length) {
        var freq = emojiSection('Ko‘p ishlatilgan');
        list = ((freq && freq.list) || []).slice(0, 30);
      }
    } else if (emojiView.mood === 'frequent') {
      var f = emojiSection('Ko‘p ishlatilgan');
      list = ((f && f.list) || []).slice();
    } else if (emojiView.mood === 'all') {
      list = emojiCatalog().map(function (x) { return x.em; });
    } else {
      list = (EMOJI_MOODS[emojiView.mood] || []).slice();
    }
    list = list.filter(function (em, i) { return list.indexOf(em) === i; });
    list.sort(function (a, b) { return usageRank('emoji', b) - usageRank('emoji', a); });

    b.innerHTML = '<div class="reels-c-emoji-cap">'
      + (q.trim() ? 'Natijalar' : (MOOD_LABELS[emojiView.mood] || 'Emoji'))
      + '</div>'
      + (list.length
          ? '<div class="reels-c-emoji-grid">' + list.map(function (em) {
              return '<button type="button" class="reels-c-emoji-btn" data-e="' + esc(em) + '">' + em + '</button>';
            }).join('') + '</div>'
          : '<div class="reels-c-empty">Topilmadi</div>');

    b.onclick = function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-e]');
      if (!btn) return;
      var em = btn.getAttribute('data-e');
      if (!em) return;
      if (global.TgEmoji && global.TgEmoji.pushRecent) global.TgEmoji.pushRecent(em);
      rememberUsage('emoji', em);
      insertAt(em);
      if (emojiView.mood === 'recent' && !emojiView.q) renderEmojiView();
    };
  }

  // ============================================================ TOOLS / PICKER
  var uiReady = false;
  var stickerSets = null;
  var composerVoice = null;   // TgVoice.bindComposer natijasi (izoh kompozitori)
  var gifBot = null;
  var gifQueryId = null;
  var gifReqSeq = 0;

  function initUI() {
    if (uiReady) return;
    uiReady = true;

    // Kompozitorni Telegram uslubiga keltiramiz (📎 | textarea | 😊 + ➤).
    // `cFmtBtn` shu yerda kichik "Aa" chipga ko'chiriladi — mountFmtMenu
    // keyin chaqiriladi, shuning uchun formatlash ishlashda davom etadi.
    prepareComposer();

    // Chat kabi: kompozitorda BITTA "biriktirish" tugmasi bor. U panelni
    // ochadi, panel ichida esa Stiker / GIF / Rasm / @ tablari.
    var ab = el('cAttachBtn');
    if (ab) ab.addEventListener('click', function (e) {
      e.preventDefault();
      openPanel(S.pickerMode || 'sticker');
    });

    var tabs = el('cPickerTabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#cPickerX')) { closePicker(); return; }
      var b = e.target.closest && e.target.closest('[data-mode]');
      if (!b) return;
      switchTab(b.getAttribute('data-mode'));
    });

    /* "Aa" — matn formatlash qo'llanishi (chatdagi kabi).

       XOST (menu qaysi konteynerga qo'yiladi) ikki sahifada turlicha:
         reels.php  -> `.reels-comments-box` (modal ichidagi oqim)
         watch.php  -> `.watch-comments-wrap`  (alohida ko'rish sahifasi)
       Avval faqat `.reels-comments-box` so'ralardi - shuning uchun
       watch.php da menyu umuman MOUNT QILINMASDI (host topilmadi =>
       `mountFmtMenu` `null` qaytaradi). Ikkalasini ham so'raymiz:
       `querySelector` ro'yxatdagi birinchi mavjud elementni oladi. */
    var F = global.TgFormat;
    if (F && F.mountFmtMenu) {
      F.mountFmtMenu('#cFmtBtn', '#commentInput', '.reels-comments-box, .watch-comments-wrap');
    }

    var pf = el('cPhoto');
    if (pf) pf.addEventListener('change', function () {
      var f = pf.files && pf.files[0];
      pf.value = '';
      if (!f) return;
      pickerOpen('photo', 'Rasm yuborilmoqda…');
      sendPhoto(f).then(function () { closePicker(); }).catch(function (e) {
        pickerStatus('Xatolik: ' + esc(errMsg(e)));
      });
    });

    var rc = el('cReplyCancel');
    if (rc) rc.addEventListener('click', function (e) { e.preventDefault(); cancelReply(); });

    // Kompozitor: matn yo'q -> MIKROFON, matn bor -> YUBORISH (Telegram).
    initComposerVoice();

    initListClicks();
  }

  /**
   * Izoh kompozitorini ovozli yuborish bilan bog'lash.
   * `#commentSend` bosilsa: matn bo'lsa reels.js yuboradi, bo'lmasa yozish
   * boshlanadi. Yozilgan ovoz `TgVoice.uploadMedia` orqali Telegram'ga
   * `DocumentAttributeAudio { voice:true }` sifatida yuboriladi.
   */
  function initComposerVoice() {
    var V = global.TgVoice;
    if (!V || !V.bindComposer) return;
    var input = el('commentInput');
    var send = el('commentSend');
    var form = el('commentForm');
    if (!input || !send || !form) return;
    if (form.__voiceBound) return;
    form.__voiceBound = true;
    composerVoice = V.bindComposer({
      form: form,
      input: input,
      send: send,
      // Mikrofon TEZ bosilsa skripkaga aylanadi; skripka bosilsa rasm tanlanadi.
      file: el('cPhoto'),
      onSend: function (blob, duration) {
        sendVoice(blob, duration).catch(function (e) {
          pickerStatus('Ovozli xabar yuborilmadi: ' + esc(errMsg(e)));
        });
      },
      onError: function (msg) { toast(msg); }
    });
  }

  function pickerBox() { return el('cPicker'); }
  function panel() { return el('cPickerPanel'); }
  function pickerBody() { return el('cPickerBody'); }

  function closePicker() {
    var box = pickerBox();
    if (box) { box.hidden = true; box.removeAttribute('data-mode'); }
    var p = panel();
    if (p) p.innerHTML = '';
    var ab = el('cAttachBtn');
    if (ab) ab.setAttribute('aria-expanded', 'false');
    var eb = el('cEmojiBtn');
    if (eb) eb.setAttribute('aria-expanded', 'false');
  }

  /**
   * Panelni ochadi va `mode` tabini faollashtiradi. Chatdagi kabi bitta
   * "biriktirish" tugmasi barcha vositalarni (stiker / GIF / rasm / @)
   * shu bitta oynada ochadi.
   */
  function openPanel(mode) {
    var box = pickerBox();
    if (!box) return;
    if (box.getAttribute('data-mode') === mode && !box.hidden) { closePicker(); return; }
    S.pickerMode = mode;
    var ab = el('cAttachBtn');
    if (ab) ab.setAttribute('aria-expanded', mode !== 'emoji' ? 'true' : 'false');
    var eb = el('cEmojiBtn');
    if (eb) eb.setAttribute('aria-expanded', mode === 'emoji' ? 'true' : 'false');
    if (mode === 'sticker')  { toggleSticker();  return; }
    if (mode === 'emoji')    { toggleEmoji();    return; }
    if (mode === 'gif')      { toggleGif();      return; }
    if (mode === 'mention')  { toggleMention();  return; }
    if (mode === 'photo')    { pickPhoto();      return; }
  }

  /** Panelni ochilgan holda aynan `mode` tabini ko'rsatadi (tab bosilganda). */
  function switchTab(mode) {
    var box = pickerBox();
    if (!box) return;
    if (box.getAttribute('data-mode') === mode && !box.hidden) { renderTabs(mode); return; }
    openPanel(mode);
  }

  function renderTabs(mode) {
    var tabs = el('cPickerTabs');
    if (!tabs) return;
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-mode]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === mode);
    });
  }

  function pickPhoto() {
    var box = pickerBox();
    var f = el('cPhoto');
    if (!f) return;
    // Tab faollashtiriladi (fayl tanlangandan keyin `pickerOpen('photo', ...)`
    // panel ichida "Yuborilmoqda..." holatini ko'rsatadi).
    if (box) { box.setAttribute('data-mode', 'photo'); renderTabs('photo'); }
    try { f.click(); } catch (e) {}
  }

  function pickerOpen(mode, statusHtml) {
    var box = pickerBox();
    if (!box) return;
    box.hidden = false;
    box.setAttribute('data-mode', mode);
    renderTabs(mode);
    var p = panel();
    if (p) {
      p.classList.remove('is-sticker');
      p.innerHTML = '<div class="reels-c-picker-body" id="cPickerBody">' + (statusHtml || '') + '</div>';
    }
  }

  function pickerStatus(html) {
    var b = pickerBody();
    if (b) b.innerHTML = '<div class="reels-c-empty">' + html + '</div>';
  }

  // ----------------------------------------------------------- emoji tanlash
  //
  // Xuddi chatdagi kabi: `tg-emoji.js` guruhlar ro'yxatini beradi, biz faqat
  // chizamyiz. Emoji tanlanganda maydon yopilmaydi (bir nechta ketma-ket
  // qo'yish mumkin bo'lishi uchun) - chat moduli ham shunday qiladi.
  function toggleEmoji() {
    var box = pickerBox();
    if (!box) return;
    box.hidden = false;
    box.setAttribute('data-mode', 'emoji');
    renderTabs('emoji');
    var p = panel();
    if (!p) return;
    p.classList.remove('is-sticker');
    p.innerHTML =
        '<div class="wc-c-search">'
      +   '<input id="cEmojiSearch" type="text" autocomplete="off" spellcheck="false"'
      +     ' placeholder="Emoji qidirish (masalan: rahmat)…" aria-label="Emoji qidirish">'
      + '</div>'
      + '<div class="wc-c-moods">' + moodButtons() + '</div>'
      + '<div class="reels-c-picker-body wc-c-emoji-body" id="cPickerBody"></div>';

    emojiView.mood = 'recent';
    emojiView.q = '';

    var moods = p.querySelector('.wc-c-moods');
    if (moods) moods.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-mood]');
      if (!b) return;
      emojiView.mood = b.getAttribute('data-mood') || 'recent';
      emojiView.q = '';
      var sinp = el('cEmojiSearch');
      if (sinp) sinp.value = '';
      Array.prototype.forEach.call(moods.querySelectorAll('[data-mood]'), function (x) {
        x.classList.toggle('on', x === b);
      });
      renderEmojiView();
    });

    var sinp = el('cEmojiSearch');
    if (sinp) {
      sinp.addEventListener('input', function () {
        emojiView.q = sinp.value || '';
        renderEmojiView();
      });
      sinp.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
      });
      try { sinp.focus(); } catch (e2) {}
    }
    renderEmojiView();
  }

  // ---------------------------------------------------------- stiker tanlash
  // O'rnatilgan to'plamlar + Telegram bo'ylab eng ko'p ishlatilgan (featured)
  // + yaqinda ishlatilgan stikerlar.
  function loadStickerCollections() {
    var Api = A();
    return getClient().then(function (c) {
      var installed = c.invoke(new Api.messages.GetAllStickers({ hash: 0 }))
        .then(function (res) { return res.sets || []; })
        .catch(function () { return []; });
      var featured = c.invoke(new Api.messages.GetFeaturedStickers({ hash: 0 }))
        .then(function (res) {
          return (res.sets || []).map(function (x) { return (x && x.set) ? x.set : x; })
            .filter(function (s) { return s && s.id; });
        })
        .catch(function () { return []; });
      return Promise.all([installed, featured]);
    }).then(function (r) {
      var installed = (r[0] || []).filter(function (s) { return s && s.id; });
      var featured = (r[1] || []).filter(function (s) { return s && s.id; });
      // Takror bo'lmasin: featured'da bor setlar o'rnatilganlar ro'yxatidan chiqadi.
      var seen = {};
      featured.forEach(function (s) { seen[String(s.id)] = true; });
      installed = installed.filter(function (s) { return !seen[String(s.id)]; });
      return featured.concat(installed);
    });
  }

  function stickerSetsPromise() {
    if (stickerSets) return Promise.resolve(stickerSets);
    return loadStickerCollections().then(function (sets) {
      stickerSets = sets;
      // To'liq Document obyektlari keshlanmaydi: `fileReference` eskiradi.
      // To'plamlar ro'yxati (id/accessHash/nom) esa oflayn qidiruv uchun.
      idbSet(kSets(), minifySets(sets), CACHE_TTL);
      return sets;
    }).catch(function () {
      return idbGet(kSets()).then(function (cached) {
        stickerSets = Array.isArray(cached) ? cached : [];
        return stickerSets;
      });
    });
  }

  function loadRecentStickers() {
    var Api = A();
    return getClient().then(function (c) {
      return c.invoke(new Api.messages.GetRecentStickers({ hash: 0 }));
    }).then(function (res) {
      var docs = (res.stickers || []).filter(function (d) { return d && d.className === 'Document'; });
      recentStickerDocs = docs;
      // Aqlli taklif faqat emoji belgisi (alt) + ID bilan ishlaydi; katta
      // Document obyektlarini IndexedDB'ga yozmaymiz.
      idbSet(kRecent(), minifyStickerDocs(docs), CACHE_TTL);
      return docs;
    }).catch(function () { return []; });
  }

  function toggleSticker() {
    var box = pickerBox();
    if (!box) return;
    box.hidden = false;
    box.setAttribute('data-mode', 'sticker');
    renderTabs('sticker');
    var p = panel();
    if (!p) return;
    // To'plamlar 200+ bo'lishi mumkin -> qidiruv maydoni + ko'p qatorli
    // (vertikal scroll) ro'yxat (chatdagi kabi).
    p.classList.add('is-sticker');
    p.innerHTML =
        '<div class="reels-c-sticker-head">'
      +   '<div class="reels-c-sticker-search">'
      +     '<input id="cStickerSearch" type="text" autocomplete="off" spellcheck="false"'
      +       ' placeholder="To‘plam qidirish (masalan: Duck)…" aria-label="Stiker to‘plamlarini qidirish">'
      +     '<span class="reels-c-sticker-count" id="cStickerCount"></span>'
      +   '</div>'
      + '</div>'
      + '<div class="reels-c-sticker-sets" id="cStickerSets"></div>'
      + '<div class="reels-c-picker-body" id="cPickerBody"><div class="reels-c-empty"><span class="spinner"></span></div></div>';

    var wrap = el('cStickerSets');
    var sinp = el('cStickerSearch');
    var scnt = el('cStickerCount');
    var items = [];

    // Tugmalar: avval "So'nggi", keyin featured + o'rnatilgan to'plamlar.
    function paint(q) {
      if (!wrap) return 0;
      q = String(q || '').trim().toLowerCase();
      var html = '', shown = 0;
      items.forEach(function (it, i) {
        var title = it.title || 'Set';
        if (q && title.toLowerCase().indexOf(q) < 0) return;
        shown++;
        html += '<button type="button" class="reels-c-sticker-set" data-i="' + i + '" title="' + esc(title) + '">'
              + esc(title) + '</button>';
      });
      wrap.innerHTML = shown ? html : '<div class="reels-c-sticker-none">Topilmadi</div>';
      if (scnt) scnt.textContent = items.length ? (shown + ' / ' + items.length) : '';
      wrap.scrollTop = 0;
      if (q && shown === 1) {
        var only = wrap.querySelector('[data-i]');
        if (only) only.click();
      }
      return shown;
    }

    if (sinp) {
      var tmr = null;
      sinp.addEventListener('input', function () {
        if (tmr) clearTimeout(tmr);
        var v = sinp.value;
        tmr = setTimeout(function () { paint(v); }, 130);
      });
      sinp.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var first = wrap && wrap.querySelector('[data-i]');
        if (first) first.click();
      });
    }

    if (wrap) {
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-i]');
        if (!b) return;
        var kids = wrap.querySelectorAll('.reels-c-sticker-set');
        for (var i = 0; i < kids.length; i++) kids[i].classList.remove('on');
        b.classList.add('on');
        var it = items[Number(b.getAttribute('data-i'))];
        if (!it) return;
        if (it.recent) renderStickerDocs(it.recent);
        else loadStickerSet(it.set);
      });
    }

    Promise.all([stickerSetsPromise(), loadRecentStickers()]).then(function (r) {
      var sets = r[0] || [], recent = r[1] || [];
      if (!wrap) return;
      if (!sets.length && !recent.length) { pickerStatus('Stiker topilmadi'); return; }

      if (recent.length) items.push({ title: 'So‘nggi', recent: recent });
      sets.forEach(function (s) { items.push({ title: s.title || 'Set', set: s }); });

      var shown = paint(sinp ? sinp.value : '');
      if (shown !== 1) {
        var first = wrap.querySelector('.reels-c-sticker-set');
        if (first) first.classList.add('on');
        if (items[0] && items[0].recent) renderStickerDocs(items[0].recent);
        else if (items[0]) loadStickerSet(items[0].set);
      }
    }).catch(function (e) {
      pickerStatus('Xatolik: ' + esc(errMsg(e)));
    });
  }

  function loadStickerSet(set) {
    if (!set) return;
    var Api = A();
    pickerStatus('<span class="spinner"></span>');
    getClient().then(function (c) {
      return c.invoke(new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetID({ id: set.id, accessHash: set.accessHash }),
        hash: 0
      }));
    }).then(function (res) {
      var docs = (res.documents || []).filter(function (d) { return d && d.className === 'Document'; });
      renderStickerDocs(docs);
    }).catch(function (e) {
      pickerStatus('Xatolik: ' + esc(errMsg(e)));
    });
  }

  function renderStickerDocs(docs) {
    var b = pickerBody();
    if (!b) return;
    if (!docs.length) { pickerStatus('Bo‘sh to‘plam'); return; }
    var items = docs.map(function (d) {
      return docDescriptor(d) || { kind: 'sticker', mime: d.mimeType || '', media: d };
    });
    b.innerHTML = items.map(function (d, i) {
      return '<button type="button" class="reels-c-sticker-item" data-i="' + i + '">'
        + mediaInnerHtml(d) + '</button>';
    }).join('');
    items.forEach(function (d, i) {
      var btn = b.querySelector('[data-i="' + i + '"]');
      if (!btn) return;
      var node = btn.querySelector('img,video,.reels-tgs');
      if (node) downloadInto(node, d);
    });
    b.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('[data-i]');
      if (!btn) return;
      var d = docs[Number(btn.getAttribute('data-i'))];
      if (!d) return;
      pickerStatus('<span class="spinner"></span>');
      sendStickerDoc(d).then(function () { closePicker(); })
        .catch(function (er) { pickerStatus('Xatolik: ' + esc(errMsg(er))); });
    };
  }

  // ------------------------------------------------------------- GIF tanlash
  function loadSavedGifs() {
    var Api = A();
    return getClient().then(function (c) {
      return c.invoke(new Api.messages.GetSavedGifs({ hash: 0 }));
    }).then(function (res) {
      return (res.gifs || []).filter(function (d) { return d && d.className === 'Document'; });
    }).catch(function () { return []; });
  }

  // Telegram bo'ylab eng ko'p ishlatilgan GIF'lar: `@gif` inline botiga
  // BO'SH so'rov yuboriladi — Telegram trending ro'yxatini qaytaradi.
  function loadTrendingGifs() {
    var Api = A();
    return getClient().then(function (c) {
      var botP = gifBot
        ? Promise.resolve(gifBot)
        : c.getInputEntity('@gif').then(function (b) { gifBot = b; return b; });
      return botP.then(function (bot) {
        return c.invoke(new Api.messages.GetInlineBotResults({
          bot: bot, peer: S.peer, query: '', offset: ''
        }));
      });
    }).then(function (res) {
      return { results: res.results || [], queryId: res.queryId };
    });
  }

  function renderGifDocsInto(container, docs) {
    if (!container || !docs.length) return;
    var items = docs.map(function (d) {
      return docDescriptor(d) || { kind: 'gif', mime: d.mimeType || 'video/mp4', media: d };
    });
    container.innerHTML = items.map(function (d, i) {
      return '<button type="button" class="reels-c-gif-item" data-doc="' + i + '"' + ratioStyle(d) + '>'
        + mediaInnerHtml(d) + '</button>';
    }).join('');
    items.forEach(function (d, i) {
      var btn = container.querySelector('[data-doc="' + i + '"]');
      if (!btn) return;
      var node = btn.querySelector('img,video,.reels-tgs');
      if (node) downloadInto(node, d);
    });
    container.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('[data-doc]');
      if (!btn) return;
      var d = docs[Number(btn.getAttribute('data-doc'))];
      if (!d) return;
      pickerStatus('<span class="spinner"></span>');
      sendGifDoc(d).then(function () { closePicker(); })
        .catch(function (er) { pickerStatus('Xatolik: ' + esc(errMsg(er))); });
    };
  }

  // GIF oynasining boshlang'ich holati: trending + saqlanganlar.
  function gifHome() {
    gifReqSeq++;   // kutilayotgan qidiruv natijalarini bekor qilamiz
    var b = pickerBody();
    if (!b) return;
    b.innerHTML = '<div class="reels-c-gif-sec" id="cGifTrend"><div class="reels-c-empty"><span class="spinner"></span></div></div>'
      + '<div class="reels-c-gif-sec" id="cGifSaved"></div>';

    // 1) Telegram bo'ylab eng ko'p ishlatilgan (trending) — qidiruvsiz ko'rinadi.
    loadTrendingGifs().then(function (r) {
      var box = el('cGifTrend');
      if (!box) return;
      if (!r.results.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="reels-c-gif-cap">Ko‘p ishlatilgan</div>'
        + '<div class="reels-c-gif-grid" id="cGifTrendGrid"></div>';
      renderGifInlineInto(el('cGifTrendGrid'), r.results, r.queryId);
    }).catch(function () {
      var box = el('cGifTrend');
      if (box) box.innerHTML = '';
    });

    // 2) Foydalanuvchining saqlangan GIF'lari.
    loadSavedGifs().then(function (docs) {
      var box = el('cGifSaved');
      if (!box || !docs.length) return;
      box.innerHTML = '<div class="reels-c-gif-cap">Saqlangan</div>'
        + '<div class="reels-c-gif-grid" id="cGifSavedGrid"></div>';
      renderGifDocsInto(el('cGifSavedGrid'), docs.slice(0, 24));
    }).catch(function () {});
  }

  function toggleGif() {
    var box = pickerBox();
    if (!box) return;
    box.hidden = false;
    box.setAttribute('data-mode', 'gif');
    renderTabs('gif');
    var p = panel();
    if (!p) return;
    p.classList.remove('is-sticker');
    p.innerHTML = '<div class="reels-c-picker-head">GIF</div>'
      + '<div class="reels-c-gif-search">'
      + '<input id="cGifInput" type="text" placeholder="Qidirish (masalan: cat)…" autocomplete="off"></div>'
      + '<div class="reels-c-picker-body reels-c-gif-body" id="cPickerBody"></div>';
    var inp = el('cGifInput');
    if (inp) {
      try { inp.focus(); } catch (e) {}
      // Har bir harf yozilganda qidiradi (debounce bilan — serverga zarba bermaslik uchun).
      var tmr = null;
      inp.addEventListener('input', function () {
        var q = inp.value.trim();
        if (tmr) clearTimeout(tmr);
        tmr = setTimeout(function () { gifSearch(q); }, 280);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (tmr) clearTimeout(tmr);
          gifSearch(inp.value.trim());
        }
      });
    }
    gifHome();
  }

  // ------------------------------------------------------ @ ta belgilash
  function insertAt(txt) {
    var inp = el('commentInput');
    if (!inp) return;
    var s = inp.selectionStart;
    if (s == null) s = inp.value.length;
    var e2 = inp.selectionEnd;
    if (e2 == null) e2 = s;
    inp.value = inp.value.slice(0, s) + txt + inp.value.slice(e2);
    var pos = s + txt.length;
    try { inp.focus(); inp.setSelectionRange(pos, pos); } catch (er) {}
  }

  function toggleMention() {
    var box = pickerBox();
    if (!box) return;
    box.hidden = false;
    box.setAttribute('data-mode', 'mention');
    renderTabs('mention');
    var p = panel();
    if (!p) return;
    p.classList.remove('is-sticker');
    var list = [];
    for (var k in S.users) {
      var u = S.users[k];
      var un = (S.names[k] || u.username || '').replace(/^@/, '');
      var nm = [u.firstName, u.lastName].filter(Boolean).join(' ') || un || ('#' + k);
      list.push({ name: nm, username: un });
    }
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    p.innerHTML = '<div class="reels-c-picker-head">Belgilash (@)</div>'
      + '<div class="reels-c-picker-body reels-c-mentions" id="cPickerBody">'
      + (list.length
          ? list.map(function (x, i) {
              return '<button type="button" class="reels-c-mention" data-i="' + i + '">'
                + '<span class="reels-c-mention-nm">' + esc(x.name) + '</span>'
                + (x.username ? '<span class="reels-c-mention-un">@' + esc(x.username) + '</span>' : '<span class="reels-c-mention-un">—</span>')
                + '</button>';
            }).join('')
          : '<div class="reels-c-empty">Hozircha foydalanuvchi yo‘q</div>')
      + '</div>';
    var b = pickerBody();
    if (b) b.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('[data-i]');
      if (!btn) return;
      var x = list[Number(btn.getAttribute('data-i'))];
      if (x && x.username) insertAt('@' + x.username + ' ');
      closePicker();
    };
  }

  function gifSearch(q) {
    q = (q || '').trim();
    if (!q) { gifHome(); return; }
    var Api = A();
    var myId = ++gifReqSeq;
    var b0 = pickerBody();
    if (b0) b0.innerHTML = '<div class="reels-c-empty"><span class="spinner"></span></div>';
    getClient().then(function (c) {
      var botP = gifBot
        ? Promise.resolve(gifBot)
        : c.getInputEntity('@gif').then(function (bt) { gifBot = bt; return bt; });
      return botP.then(function (bot) {
        return c.invoke(new Api.messages.GetInlineBotResults({
          bot: bot, peer: S.peer, query: q, offset: ''
        }));
      });
    }).then(function (res) {
      if (myId !== gifReqSeq) return;   // eski so'rov javobi — tashlaymiz
      var b = pickerBody();
      if (!b) return;
      var results = res.results || [];
      gifQueryId = res.queryId;
      b.innerHTML = '<div class="reels-c-gif-cap">Natijalar: ' + esc(q) + '</div>'
        + (results.length
            ? '<div class="reels-c-gif-grid" id="cGifGrid"></div>'
            : '<div class="reels-c-empty">Natija topilmadi</div>');
      if (results.length) renderGifInlineInto(el('cGifGrid'), results, res.queryId);
    }).catch(function (e) {
      if (myId !== gifReqSeq) return;
      pickerStatus('Xatolik: ' + esc(errMsg(e)));
    });
  }

  function renderGifInlineInto(container, results, queryId) {
    if (!container) return;
    var items = results.map(function (r) {
      return (r && r.document) ? docDescriptor(r.document) : null;
    });
    container.innerHTML = results.map(function (r, i) {
      var d = items[i];
      return '<button type="button" class="reels-c-gif-item" data-i="' + i + '"' + ratioStyle(d) + '>'
        + mediaInnerHtml(d) + '</button>';
    }).join('');
    results.forEach(function (r, i) {
      var btn = container.querySelector('[data-i="' + i + '"]');
      var d = items[i];
      if (!btn || !d) return;
      var node = btn.querySelector('img,video,.reels-tgs');
      if (node) downloadInto(node, d);
    });
    container.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('[data-i]');
      if (!btn) return;
      var r = results[Number(btn.getAttribute('data-i'))];
      if (r) sendGifResult(r, queryId);
    };
  }

  function sendGifResult(result, queryId) {
    var Api = A();
    S.expandRoot = S.replyTo || 0;
    pickerStatus('<span class="spinner"></span>');
    getClient().then(function (c) {
      return c.invoke(new Api.messages.SendInlineBotResult({
        peer: S.peer,
        queryId: queryId || gifQueryId,
        id: result.id,
        randomId: randLong(),
        replyTo: replyObj(S.topicId, S.replyTo)
      }));
    }).then(function () { finishReply(); bumpCount(S.topicId, 1); return reload(); })
      .then(function () { closePicker(); })
      .catch(function (e) { pickerStatus('Xatolik: ' + esc(errMsg(e))); });
  }

  global.TGComments = {
    enabled: enabled,
    open: open,
    close: close,
    sendText: sendText,
    sendPhoto: sendPhoto,
    sendVoice: sendVoice,
    reload: reload,
    username: username,
    askUsername: askUsername,
    // Izohlar soni - reels yon paneldagi raqam uchun (oyna ochilmasdan).
    commentCount: commentCount,
    count: function () { return S.count; },
    _state: S
  };

  // ----------------------------------------------------------------------
  // Umumiy media to'plami (TgMedia) - chat moduli (tg-chat.js) shu orqali
  // izohlardagi bilan AYNAN bir xil yuklash/ko'rsatish oqimidan foydalanadi
  // (thumbnail -> to'liq fayl, Lottie .tgs, lightbox, lazy observer).
  // ----------------------------------------------------------------------
  global.TgMedia = {
    client: getClient,
    api: A,
    bundle: function () { return T() && T().bundle(); },
    me: function () { return (T() && T().me) ? T().me() : null; },
    enabled: enabled,
    mediaDescriptor: mediaDescriptor,
    mediaHtml: mediaHtml,
    wireMedia: wireMedia,
    docDescriptor: docDescriptor,
    docMime: docMime,
    mediaTag: mediaTag,
    mediaInnerHtml: mediaInnerHtml,
    ratioStyle: ratioStyle,
    dimAttrs: dimAttrs,
    blobUrl: blobUrl,
    readAll: readAll,
    resolveLoc: resolveLoc,
    scheduleMediaLoad: scheduleMediaLoad,
    downloadInto: downloadInto,
    attachZoom: attachZoom,
    esc: esc,
    relTime: relTime,
    randLong: randLong,
    errMsg: errMsg,
    loadNames: loadNames,
    username: username,
    saveUsername: saveUsername,
    currentUserPhoto: currentUserPhoto,
    avatarHtml: avatarHtml,
    messageText: messageText,
    senderIdOf: senderIdOf
  };

  // Sahifa yuklanganda username so'raladi (agar tanlanmagan bo'lsa).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
