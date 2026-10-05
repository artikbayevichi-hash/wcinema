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
    byId: {},
    meId: null,
    replyTo: 0,
    replyName: '',
    expandRoot: 0,     // javob yuborilgach ochiladigan thread
    loading: false,
    count: -1,         // joriy mavzudagi izohlar soni (Telegram'dan)
    likes: {},         // optimistik layk holati: { [msgId]: {count, mine} }
    threads: null      // root izoh -> javoblar guruhi
  };

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

  function currentUserPhoto() {
    try { return localStorage.getItem('wc_tg_photo_v1') || ''; } catch (e) { return ''; }
  }

  // ------------------------------------------------------- @username (nom)
  var UNAME_KEY = 'wc_tg_username_v1';
  function username() {
    try { return String(localStorage.getItem(UNAME_KEY) || '').replace(/^@/, ''); } catch (e) { return ''; }
  }
  function validUsername(u) {
    return /^[a-z][a-z0-9_]{3,31}$/.test(String(u || '').toLowerCase());
  }
  function saveUsername(u) {
    u = String(u || '').replace(/^@/, '').trim().toLowerCase();
    if (!validUsername(u)) return false;
    try { localStorage.setItem(UNAME_KEY, u); } catch (e) {}
    var me = T() && T().me ? T().me() : null;
    if (me && me.id) {
      fetchJson(baseUrl('api/tg-name.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'tg_me=' + encodeURIComponent(JSON.stringify({ id: me.id, username: me.username || '' }))
          + '&username=' + encodeURIComponent(u)
      }).catch(function () {});
    }
    return true;
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
  function ensureTopic(reel) {
    return fetchJson(baseUrl('api/reel-topic.php?id=' + encodeURIComponent(reel.id) + '&_=' + Date.now()))
      .then(function (d) {
        if (d && d.disabled) return { disabled: true };
        if (d && d.topic_id) return d;
        // Mavzu yo'q - bot orqali ochamiz.
        return fetchJson(baseUrl('api/reel-topic.php'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'id=' + encodeURIComponent(reel.id)
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
        throw new Error((d && d.message) || 'Izohlar mavzusi ochilmadi');
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
  }

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
    var photo = (String(authorId) === mineId) ? currentUserPhoto() : '';
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
    return getClient().then(function (client) {
      return readAll(client, job.loc, job.dcId, job.size);
    }).then(function (buf) {
      if (!buf || !buf.length) throw new Error('bo‘sh fayl');
      var url = blobUrl(buf, mime);
      cachePut(key, url);
      node.src = url; afterLoaded(node);
      return url;
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
    lb.innerHTML = '<button type="button" class="reels-lb-x" aria-label="Yopish">✕</button>'
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

  function tgOpenBlock(msg) {
    var url = S.url || topicUrl(S.topicId);
    var link = url
      ? '<a class="reels-c-open-tg" href="' + esc(url) + '" target="_blank" rel="noopener">Suhbatni ochish</a>'
      : '';
    return esc(msg || '') + link;
  }

  function reload() {
    if (!S.topicId) return Promise.resolve();
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
        return msgs;
      });
    });
  }

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
    return sendRaw(payload).then(function () {
      reportNotify('comment', c.text);
      clearReply();
      bumpCount(S.topicId, 1);
      return reload();
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
    if (toast._t) clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
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
    var me = T() && T().me ? T().me() : null;
    if (me && me.id && !username()) askUsername();
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

    // "Aa" — matn formatlash qo'llanishi (chatdagi kabi).
    var F = global.TgFormat;
    if (F && F.mountFmtMenu) F.mountFmtMenu('#cFmtBtn', '#commentInput', '.reels-comments-box');

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
    if (ab) ab.setAttribute('aria-expanded', 'true');
    if (mode === 'sticker')  { toggleSticker();  return; }
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
    if (p) p.innerHTML = '<div class="reels-c-picker-body" id="cPickerBody">' + (statusHtml || '') + '</div>';
  }

  function pickerStatus(html) {
    var b = pickerBody();
    if (b) b.innerHTML = '<div class="reels-c-empty">' + html + '</div>';
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
      return sets;
    });
  }

  function loadRecentStickers() {
    var Api = A();
    return getClient().then(function (c) {
      return c.invoke(new Api.messages.GetRecentStickers({ hash: 0 }));
    }).then(function (res) {
      return (res.stickers || []).filter(function (d) { return d && d.className === 'Document'; });
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
    p.innerHTML = '<div class="reels-c-picker-head">Stikerlar</div>'
      + '<div class="reels-c-sticker-sets" id="cStickerSets"></div>'
      + '<div class="reels-c-picker-body" id="cPickerBody"><div class="reels-c-empty"><span class="spinner"></span></div></div>';

    Promise.all([stickerSetsPromise(), loadRecentStickers()]).then(function (r) {
      var sets = r[0] || [], recent = r[1] || [];
      var wrap = el('cStickerSets');
      if (!wrap) return;
      if (!sets.length && !recent.length) { pickerStatus('Stiker topilmadi'); return; }

      // Tugmalar: avval "So'nggi", keyin featured + o'rnatilgan to'plamlar.
      var items = [];
      if (recent.length) items.push({ title: 'So‘nggi', recent: recent });
      sets.forEach(function (s) { items.push({ title: s.title || 'Set', set: s }); });

      wrap.innerHTML = items.map(function (it, i) {
        return '<button type="button" class="reels-c-sticker-set" data-i="' + i + '">'
          + esc(it.title) + '</button>';
      }).join('');
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

      var first = wrap.querySelector('.reels-c-sticker-set');
      if (first) first.classList.add('on');
      if (items[0] && items[0].recent) renderStickerDocs(items[0].recent);
      else if (items[0]) loadStickerSet(items[0].set);
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
