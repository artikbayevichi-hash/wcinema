/* ==========================================================================
 * tg-chat.js - W CINEMA chat (Instagram/Telegram uslubida)
 * --------------------------------------------------------------------------
 * Xabarlar serverda SAQLANMAYDI:
 *   - 4 umumiy xona (Hammaga/Kino/Anime/Multfilm) - Telegram forum-guruhdagi
 *     MAVZULARDA yashaydi (izohlar bilan aynan bir xil infratuzilma).
 *   - Shaxsiy chatlar - foydalanuvchilar o'rtasidagi Telegram DM (MTProto).
 *
 * Media (rasm/stiker/GIF) izohlardagi bilan bir xil `window.TgMedia`
 * to'plami orqali yuklanadi va ko'rsatiladi.
 * ========================================================================== */
(function (global) {
  'use strict';

  var BASE     = (global.APP && global.APP.base) || '';
  var CHAT     = (global.APP && global.APP.tgCommentsChat) || '';
  var CHAT_URL = (global.APP && global.APP.tgCommentsUrl) || '';

  var C = {
    rooms: [],
    contacts: [],
    users: {},        // tg id -> User
    names: {},        // tg id -> @username (sayt)
    me: null,
    active: null,     // { type, room|peer, peerEntity, topicId, title }
    roomPeer: null,
    gifBot: null,
    pickerMode: '',
    openedPeerId: 0,
    dmLastId: 0,
    dmPoll: null,
    dmTypingTmr: null
  };

  // ----------------------------------------------------------- yordamchilar
  function M() { return global.TgMedia; }
  function T() { return global.TgStream; }
  function Api() { var b = T() && T().bundle(); return b ? b.Api : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  function el(id) { return document.getElementById(id); }
  function baseUrl(p) { if (!BASE) return p; return BASE.replace(/\/$/, '') + '/' + p.replace(/^\//, ''); }
  function getClient() { return T().client(); }
  function errMsg(e) { var m = M(); if (m) return m.errMsg(e); return String(e && (e.errorMessage || e.message) || e); }
  function fetchJson(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }); }

  function meRaw() {
    try { return localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) { return ''; }
  }
  function withMe(params) {
    var raw = meRaw();
    if (raw) params.set('tg_me', raw);
    return params;
  }

  // ------------------------------------------------- shaxsiy xabarlar (server)
  // DM endi SAYT serverida saqlanadi (api/dm.php) - brauzerdagi Telegram DM
  // emas. Shu sabab qabul qiluvchi xabarni HAR DOIM oladi (serverda turadi).
  function dmGet(params) {
    return fetchJson(baseUrl('api/dm.php?' + withMe(new URLSearchParams(params)).toString()), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin'
    });
  }
  function dmPost(params) {
    return fetchJson(baseUrl('api/dm.php'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: withMe(new URLSearchParams(params)).toString(),
      credentials: 'same-origin'
    });
  }
  // Yon paneldagi / pastki paneldagi "Chat" belgisini yangilaydi.
  function updateChatBadge(n) {
    n = Number(n) || 0;
    var ids = ['igChatBadge', 'igChatBadgeM'];
    for (var i = 0; i < ids.length; i++) {
      var b = el(ids[i]);
      if (!b) continue;
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = !(n > 0);
    }
  }

  function roomEmoji(key) {
    return ({ general: '💬', kino: '🎬', anime: '✨', multfilm: '🧸' })[key] || '💬';
  }

  // ============================================================ UMUMIY XONALAR
  function loadRooms() {
    var box = el('chatRooms');
    if (!box) return;
    fetchJson(baseUrl('api/chat.php?action=rooms'), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin'
    }).then(function (d) {
      C.rooms = (d && d.rooms) || [];
      renderRooms();
    }).catch(function () {
      box.innerHTML = '<div class="chat-empty">Xonalarni yuklab bo\'lmadi</div>';
    });
  }

  function renderRooms() {
    var box = el('chatRooms');
    if (!box) return;
    if (!C.rooms.length) { box.innerHTML = '<div class="chat-empty">Xonalar yo\'q</div>'; return; }
    box.innerHTML = C.rooms.map(function (r) {
      var ready = r.topic_id ? '' : ' chat-room-off';
      return '<button type="button" class="chat-room' + ready + '" data-room="' + esc(r.key) + '">'
        + '<span class="chat-room-ico">' + roomEmoji(r.key) + '</span>'
        + '<span class="chat-room-ttl">' + esc(r.title) + '</span>'
        + '</button>';
    }).join('');
    box.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-room]');
      if (!b) return;
      var key = b.getAttribute('data-room');
      var room = null;
      for (var i = 0; i < C.rooms.length; i++) { if (C.rooms[i].key === key) { room = C.rooms[i]; break; } }
      if (room) openRoom(room);
    };
  }

  // ============================================================ KONTAKTLAR
  /** Suhbatlar ro'yxati: server DM (oxirgi xabar + o'qilmagan) va kontaktlar. */
  function loadContacts() {
    var box = el('chatContacts');
    if (!box) return;
    dmGet({ action: 'threads' }).then(function (d) {
      if (d && Array.isArray(d.threads)) C.contacts = d.threads;
      else if (d && d.contacts) C.contacts = d.contacts;
      else C.contacts = [];
      renderContacts();
      if (d && typeof d.unread === 'number') updateChatBadge(d.unread);
    }).catch(function () {
      box.innerHTML = '<div class="chat-empty">Xabarlarni yuklab bo\'lmadi</div>';
    });
  }

  /** Ro'yxat uchun qisqa ko'rinish matni. */
  function dmPreviewText(last) {
    if (!last) return '';
    var t = last.body || '';
    if (!t) {
      if (last.kind === 'photo') t = '📷 Rasm';
      else if (last.kind === 'voice') t = '🎤 Ovozli xabar';
    }
    return (last.mine ? 'Siz: ' : '') + t;
  }

  function renderContacts() {
    var box = el('chatContacts');
    if (!box) return;
    if (!C.contacts.length) {
      box.innerHTML = '<div class="chat-empty">Hozircha shaxsiy chat yo\'q.<br>'
        + 'Boshqa profilga kirib “Xabar” tugmasini bosing yoki kuzatib boring.</div>';
      return;
    }
    box.innerHTML = C.contacts.map(function (u) {
      var name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
      var av = u.avatar
        ? '<img src="' + esc(u.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
        : '<span class="chat-cb-ph">' + esc((u.first_name || '?').charAt(0).toUpperCase()) + '</span>';
      var unread = Number(u.unread || 0);
      var prev = u.last ? dmPreviewText(u.last) : (u.username ? '@' + u.username : 'Xabar yozish');
      var right = unread
        ? '<span class="chat-badge">' + (unread > 99 ? '99+' : unread) + '</span>'
        : (u.last && u.last.ts ? '<span class="chat-when">' + esc(M().relTime(u.last.ts)) + '</span>' : '');
      return '<button type="button" class="chat-contact' + (unread ? ' has-unread' : '') + '" data-peer="' + u.id + '">'
        + '<span class="chat-cav">' + av + '</span>'
        + '<span class="chat-cmain"><b>' + esc(name) + '</b>'
        + '<span class="chat-prev">' + esc(prev) + '</span></span>'
        + right
        + '</button>';
    }).join('');
    box.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-peer]');
      if (!b) return;
      var pid = Number(b.getAttribute('data-peer')) || 0;
      var c = null;
      for (var i = 0; i < C.contacts.length; i++) { if (Number(C.contacts[i].id) === pid) { c = C.contacts[i]; break; } }
      if (c) openDM(c);
    };
  }

  // ============================================================ OYNALARNI ALMASHTIRISH
  /**
   * Chat oynasini ochadi. Ro'yxat (sarlavha + kategoriyalar + "Xabarlar")
   * umuman yashiriladi, faqat tanlangan suhbat ko'rinadi.
   * Teskari harakat: `closeChat()` (Orqaga / `goBack()`).
   *
   * @param {string} title - suhbat sarlavhasi
   * @param {string} tgUrl  - (ixtiyoriy) "Telegram'da ochish" havolasi
   */
  function openChat(title, tgUrl) {
    var lv = el('chatListView'), th = el('chatThread');
    if (lv) lv.hidden = true;
    if (th) th.hidden = false;
    var t = el('chatTitle'); if (t) t.textContent = title || '';
    var a = el('chatOpenTg');
    if (a) { if (tgUrl) { a.href = tgUrl; a.hidden = false; } else { a.hidden = true; } }
    var feed = el('chatFeed'); if (feed) feed.innerHTML = '<div class="chat-status"><span class="spinner"></span></div>';
    if (C.voice) C.voice.close();
    closeSharePlayer();
    closePicker();
    setComposerLocked(!!C.locked, C.lockedReason || '');
  }

  /**
   * Chat oynasini yopadi (Orqaga): suhbat `display:none` bo'ladi,
   * umumiy chatlar ro'yxati va kategoriyalar qayta aktiv ko'rinadi.
   */
  function closeChat() {
    // Yozib turilayotgan ovozni to'xtatamiz (mikrofon yoniq qolmasin).
    if (C.voice) C.voice.close();
    closeSharePlayer();
    closePicker();                        // emoji/stiker/GIF paneli ham yopiladi
    try { toggleFmt(false); } catch (e) {} // formatlash menyusi yopiladi
    if (C.active && C.active.type === 'dm') { stopDmPoll(); loadContacts(); }
    C.active = null;
    C.locked = false; C.lockedReason = '';
    var lv = el('chatListView'), th = el('chatThread');
    if (th) th.hidden = true;
    if (lv) lv.hidden = false;
    var url = location.pathname + location.search.replace(/[?&]u=\d+/, '').replace(/^\?$/, '');
    try { history.replaceState({}, '', url); } catch (e) {}
  }

  /** "Orqaga" (<) tugmasi va/yoki Escape: ochiq suhbatni yopadi. */
  function goBack(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    closeChat();
  }

  /**
   * Bloklangan foydalanuvchiga xabar yuborib bo'lmaydi — kompozitor butunlay
   * o'chiriladi va sabab ko'rsatiladi.
   */
  function setComposerLocked(locked, reason) {
    C.locked = !!locked;
    C.lockedReason = reason || '';
    var inp = el('chatInput'), snd = el('chatSend'), att = el('chatAttachBtn');
    if (inp) {
      inp.disabled = C.locked;
      inp.placeholder = C.locked ? 'Xabar yuborish taqiqlangan' : 'Xabar yozing…';
    }
    if (snd) {
      snd.disabled = C.locked;
      snd.setAttribute('aria-disabled', C.locked ? 'true' : 'false');
    }
    if (att) att.disabled = C.locked;
    var form = el('chatComposer');
    if (form) form.classList.toggle('is-locked', C.locked);
  }

  // ============================================================ XONANI OCHISH
  function openRoom(room) {
    C.active = { type: 'room', room: room, topicId: room.topic_id ? Number(room.topic_id) : 0, title: room.title };
    C.locked = false; C.lockedReason = '';
    stopDmPoll();
    openChat(room.title, room.url || '');
    if (!CHAT) { status('Chat sozlanmagan'); return; }
    if (!room.topic_id) { status('Bu xona hozircha tayyor emas'); return; }
    ensureRoomPeer().then(function () { return joinChat(); })
      .then(function () { return readRoom(); })
      .catch(function (e) { status('Yuklab bo\'lmadi: ' + esc(errMsg(e))); });
  }

  function ensureRoomPeer() {
    if (C.roomPeer) return Promise.resolve(C.roomPeer);
    return getClient().then(function (c) {
      return c.getInputEntity(CHAT);
    }).then(function (p) { C.roomPeer = p; return p; });
  }

  function toInputChannel(peer) {
    var A = Api();
    if (peer && peer.className === 'InputPeerChannel') {
      return new A.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash });
    }
    return peer;
  }

  function joinChat() {
    return ensureRoomPeer().then(function (peer) {
      var A = Api();
      return getClient().then(function (c) {
        return c.invoke(new A.channels.JoinChannel({ channel: toInputChannel(peer) }));
      }).catch(function () { return null; });
    });
  }

  // ============================================================ DM OCHISH
  function openDM(contact) {
    C.active = { type: 'dm', peer: contact, peerEntity: null, title: contactName(contact) };
    C.dmLastId = 0;
    stopDmPoll();
    // Blok bo'lsa kompozitor o'chadi (server ham blokni tekshiradi).
    var blocked = !!contact.blocked;
    C.locked = blocked;
    C.lockedReason = blocked
      ? (contact.i_blocked ? 'Siz bu foydalanuvchini bloklagansiz' : 'Bu foydalanuvchi sizni bloklagan')
      : '';
    openChat(contactName(contact), '');
    if (blocked) {
      var feed = el('chatFeed');
      if (feed) {
        feed.innerHTML = '<div class="chat-locked-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
          + '<rect x="4" y="10" width="16" height="10" rx="2"></rect>'
          + '<path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>'
          + '<span>' + esc(C.lockedReason) + ' — bu chatga xabar yuborish taqiqlangan.</span></div>';
      }
      return;
    }
    loadDM().then(function () { startDmPoll(); });
  }

  function contactName(u) {
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : 'Chat');
  }

  // ============================================================ O'QISH
  function status(html) {
    var feed = el('chatFeed');
    if (feed) feed.innerHTML = '<div class="chat-status">' + html + '</div>';
  }

  function readRoom() {
    var A = Api();
    var a = C.active;
    return getClient().then(function (c) {
      return c.invoke(new A.messages.GetReplies({
        peer: C.roomPeer, msgId: a.topicId, offsetId: 0, offsetDate: 0,
        addOffset: 0, limit: 60, maxId: 0, minId: 0, hash: 0
      }));
    }).then(function (res) { renderResult(res); });
  }

  /** Faol suhbatni qayta yuklaydi (xona - Telegram, DM - server). */
  function reloadActive() {
    if (!C.active) return;
    if (C.active.type === 'room') return readRoom().catch(function () {});
    return loadDM();
  }

  // ============================================================ SHAXSIY XABAR
  // Server DM uchun render + yuborish + poll. Telegram MTProto ishlatilmaydi.
  function dmFeed() { return el('chatFeed'); }

  function peerAvatarHtml() {
    var p = C.active && C.active.peer;
    if (!p) return '<div class="reels-c-av">?</div>';
    if (p.avatar) {
      return '<img class="reels-c-av" src="' + esc(p.avatar) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">';
    }
    return '<div class="reels-c-av">' + esc((p.first_name || '?').charAt(0).toUpperCase()) + '</div>';
  }

  function dmMediaHtml(m) {
    if (m.kind === 'photo' && m.media_url) {
      return '<div class="chat-dm-media"><img src="' + esc(m.media_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>';
    }
    if (m.kind === 'voice' && m.media_url) {
      return '<div class="chat-dm-media chat-dm-voice"><audio controls preload="metadata" src="' + esc(m.media_url) + '"></audio></div>';
    }
    if (m.kind === 'video') {
      return sharedVideoHtml(m);
    }
    return '';
  }

  /** mm:ss / h:mm:ss ko'rinishidagi davomiylik. */
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    if (!sec) return '';
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = (h && m < 10) ? '0' + m : String(m);
    var ss = s < 10 ? '0' + s : String(s);
    return (h ? h + ':' + mm : String(m)) + ':' + ss;
  }

  /**
   * Chatga ulashilgan video (reel/kino) kartasi: poster + "play" tugmasi.
   * Bosilganda video chat ichida (Telegram orqali) yoki yangi oynada ochiladi.
   */
  function sharedVideoHtml(m) {
    var ref = m.ref || null;
    var poster = m.media_url ? esc(m.media_url) : '';
    var dur = fmtDur(m.duration);
    // Oqim ma'lumotini DOM'ga saqlaymiz (keyin bosilganda ishlatiladi).
    var refObj = { poster: m.media_url || '' };
    if (ref) { for (var k in ref) { if (Object.prototype.hasOwnProperty.call(ref, k)) refObj[k] = ref[k]; } }
    var hasPlay = !!ref;
    return '<div class="chat-share' + (hasPlay ? '' : ' no-play') + '"'
      + ' data-ref="' + esc(JSON.stringify(refObj)) + '">'
      + '<button type="button" class="chat-share-thumb" aria-label="Videoni ochish">'
      +   (poster
            ? '<img src="' + poster + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '<span class="chat-share-ph">🎬</span>')
      +   (hasPlay
            ? '<span class="chat-share-play" aria-hidden="true">'
              + '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>'
            : '')
      +   (dur ? '<span class="chat-share-dur">' + dur + '</span>' : '')
      + '</button>'
      + '</div>';
  }

  /** Ulashilgan videoni chat ichida ochadi (overlay + TgStream yoki <video>). */
  function openSharePlayer(ref) {
    if (!ref) return;
    var existing = document.querySelector('.chat-player');
    if (existing) existing.remove();
    try { if (T() && T().stop) T().stop(); } catch (e) {}

    var overlay = document.createElement('div');
    overlay.className = 'chat-player';
    overlay.innerHTML = '<button type="button" class="chat-player-close" aria-label="Yopish">&#10005;</button>'
      + '<div class="chat-player-box"></div>';
    document.body.appendChild(overlay);
    var box = overlay.querySelector('.chat-player-box');

    function close() {
      try { if (T() && T().stop) T().stop(); } catch (e) {}
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.chat-player-close').onclick = close;
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    var type = ref.type || '';
    if (type === 'telegram' && T() && typeof T().mount === 'function' && ref.channel && ref.post) {
      T().mount(box, {
        channel: ref.channel,
        post:    Number(ref.post) || 0,
        url:     ref.url || '',
        deep:    ref.deep || '',
        poster:  ref.poster || ''
      });
      return;
    }
    if ((type === 'direct' || type === 'file') && ref.url) {
      box.innerHTML = '<video src="' + esc(ref.url) + '" controls autoplay playsinline></video>';
      return;
    }
    if (type === 'embed' && ref.url) {
      box.innerHTML = '<iframe src="' + esc(ref.url) + '" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>';
      return;
    }
    if (ref.link) {
      try { window.open(ref.link, '_blank'); } catch (e) {}
      close();
      return;
    }
    box.innerHTML = '<div class="chat-player-msg">Videoni ochib bo\u{2018}lmadi</div>';
  }

  /** Ochiq share-pleerni yopadi va Telegram oqimini to'xtatadi. */
  function closeSharePlayer() {
    var ov = document.querySelector('.chat-player');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    try { if (T() && typeof T().stop === 'function') T().stop(); } catch (e) {}
  }

  function dmRowHtml(m) {
    var mine = !!m.mine;
    var when = M().relTime(m.ts);
    var media = dmMediaHtml(m);
    var text = m.body
      ? '<div class="chat-bub"><div class="chat-txt">' + esc(m.body) + '</div>'
        + '<span class="chat-time">' + when + '</span></div>'
      : '';
    var timeOnly = (!m.body && media) ? '<span class="chat-time chat-time-free">' + when + '</span>' : '';
    if (!media && !text) {
      text = '<div class="chat-bub"><div class="chat-txt chat-txt-empty">—</div><span class="chat-time">' + when + '</span></div>';
    }
    var av = mine ? '' : '<div class="chat-avw">' + peerAvatarHtml() + '</div>';
    return '<div class="chat-row' + (mine ? ' mine' : '') + '" data-mid="' + esc(String(m.id)) + '">'
      + av + '<div class="chat-col">' + media + text + timeOnly + '</div></div>';
  }

  function drawDmFeed(msgs) {
    var feed = el('chatFeed');
    if (!feed) return;
    if (!msgs.length) {
      feed.innerHTML = '<div class="chat-status">Hozircha xabar yo\'q. Birinchi bo\'lib yozing 👋</div>';
      return;
    }
    feed.innerHTML = msgs.map(dmRowHtml).join('');
    scrollBottom(true);
  }

  function appendDmMessage(m) {
    var feed = el('chatFeed');
    if (!feed) return;
    if (feed.querySelector('[data-mid="' + String(m.id) + '"]')) return;
    var empty = feed.querySelector('.chat-status');
    if (empty) feed.innerHTML = '';
    feed.insertAdjacentHTML('beforeend', dmRowHtml(m));
    scrollBottom(true);
  }

  function replaceDmRow(tmpId, real) {
    var feed = el('chatFeed');
    if (!feed || !real) return;
    var row = feed.querySelector('[data-mid="' + String(tmpId) + '"]');
    if (row) row.outerHTML = dmRowHtml(real);
  }

  function removeDmRow(id) {
    var feed = el('chatFeed');
    if (!feed) return;
    var row = feed.querySelector('[data-mid="' + String(id) + '"]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  function loadDM() {
    var a = C.active;
    if (!a || a.type !== 'dm') return Promise.resolve();
    var peerId = Number(a.peer.id);
    dmGet({ action: 'messages', peer_id: peerId }).then(function (d) {
      if (!C.active || C.active.type !== 'dm' || Number(C.active.peer.id) !== peerId) return;
      var msgs = (d && d.messages) || [];
      C.dmLastId = msgs.length ? Number(msgs[msgs.length - 1].id) : 0;
      drawDmFeed(msgs);
      markDmRead();
      setTypingIndicator(!!(d && d.typing));
    }).catch(function (e) {
      status('Xabarlarni yuklab bo\'lmadi: ' + esc(errMsg(e)));
    });
    return Promise.resolve();
  }

  function markDmRead() {
    var a = C.active;
    if (!a || a.type !== 'dm') return;
    dmPost({ action: 'read', peer_id: a.peer.id }).then(function (d) {
      if (d && typeof d.unread === 'number') updateChatBadge(d.unread);
    }).catch(function () {});
  }

  function sendDmText(text) {
    var a = C.active;
    if (!a || a.type !== 'dm' || guardSend()) return Promise.resolve(false);
    var tmpId = 'local-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    var clientId = 'c' + Date.now() + Math.floor(Math.random() * 1e6);
    appendDmMessage({ id: tmpId, body: text, kind: 'text', mine: true, ts: Math.floor(Date.now() / 1000) });
    return dmPost({ action: 'send', peer_id: a.peer.id, body: text, client_id: clientId })
      .then(function (d) {
        if (!d || d.success === false || !d.message) throw new Error((d && d.message) || 'Yuborilmadi');
        replaceDmRow(tmpId, d.message);
        C.dmLastId = Math.max(C.dmLastId, Number(d.message.id) || 0);
        return true;
      }).catch(function (e) {
        removeDmRow(tmpId);
        toast('Yuborilmadi: ' + (e && e.message ? e.message : errMsg(e)));
        return false;
      });
  }

  // Ovozli xabar kengaytmasini brauzer yozgan formatga qarab tanlaymiz.
  // Chrome (audio/webm), Firefox (audio/ogg), ba'zan audio/mp4 chiqaradi;
  // noto'g'ri kengaytma server tomonda faylni rad etishiga olib kelardi.
  function voiceFileName(file, mime) {
    var t = String(mime || (file && file.type) || '').toLowerCase();
    if (t.indexOf('ogg') >= 0) return 'voice.ogg';
    if (t.indexOf('mpeg') >= 0 || t.indexOf('mp3') >= 0) return 'voice.mp3';
    if (t.indexOf('mp4') >= 0 || t.indexOf('m4a') >= 0 || t.indexOf('aac') >= 0) return 'voice.m4a';
    if (t.indexOf('wav') >= 0) return 'voice.wav';
    return 'voice.webm';
  }

  function sendDmMedia(file, kind, duration, mime) {
    var a = C.active;
    if (!a || a.type !== 'dm' || guardSend() || !file) return Promise.resolve(false);
    var fd = new FormData();
    fd.append('peer_id', a.peer.id);
    fd.append('action', 'send_media');
    fd.append('kind', kind);
    if (duration) fd.append('duration', String(duration));
    fd.append('file', file, kind === 'voice' ? voiceFileName(file, mime) : (file.name || 'photo.jpg'));
    var raw = meRaw();
    if (raw) fd.append('tg_me', raw);
    return fetch(baseUrl('api/dm.php'), {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.success === false || !d.message) throw new Error((d && d.message) || 'Yuborilmadi');
      appendDmMessage(d.message);
      C.dmLastId = Math.max(C.dmLastId, Number(d.message.id) || 0);
      return true;
    }).catch(function (e) {
      toast('Yuborilmadi: ' + (e && e.message ? e.message : errMsg(e)));
      return false;
    });
  }

  // --- Polling: ochiq suhbatda yangi xabarlarni 3 sekundda oladi ---
  function startDmPoll() {
    stopDmPoll();
    C.dmPoll = setInterval(dmPollTick, 3000);
  }
  function stopDmPoll() {
    if (C.dmPoll) { clearInterval(C.dmPoll); C.dmPoll = null; }
    setTypingIndicator(false);
  }
  function dmPollTick() {
    var a = C.active;
    if (!a || a.type !== 'dm') return;
    var peerId = Number(a.peer.id);
    var after = C.dmLastId;
    dmGet({ action: 'messages', peer_id: peerId, after_id: after }).then(function (d) {
      if (!C.active || C.active.type !== 'dm' || Number(C.active.peer.id) !== peerId) return;
      var msgs = (d && d.messages) || [];
      var hasNew = false;
      msgs.forEach(function (m) {
        if (Number(m.id) > C.dmLastId) {
          C.dmLastId = Number(m.id);
          appendDmMessage(m);
          hasNew = true;
        }
      });
      if (hasNew) markDmRead();
      setTypingIndicator(!!(d && d.typing));
    }).catch(function () {});
  }

  function setTypingIndicator(on) {
    var t = el('chatTitle');
    if (!t || !C.active || C.active.type !== 'dm') return;
    t.textContent = on ? (contactName(C.active.peer) + ' · yozmoqda…') : contactName(C.active.peer);
  }

  // Foydalanuvchi yozayotganda "yozmoqda..." yuboramiz (throttle).
  var typeSentAt = 0;
  function notifyTyping() {
    var a = C.active;
    if (!a || a.type !== 'dm' || guardSend()) return;
    var now = Date.now();
    if (now - typeSentAt < 2500) return;
    typeSentAt = now;
    dmPost({ action: 'typing', peer_id: a.peer.id }).catch(function () {});
  }

  function collectUsers(res) {
    var users = res && res.users || [];
    users.forEach(function (u) { if (u && u.id) C.users[String(u.id)] = u; });
  }

  function renderResult(res) {
    collectUsers(res);
    if (T() && T().me) { try { C.me = T().me(); } catch (e) {} }
    // DIQQAT: `MessageService` (mavzu yaratildi, xabar o'chirildi, ...)
    // xabarlar orasida "—" qatorlari ko'rinib turardi - ularni tashlaymiz.
    var msgs = (res && res.messages || []).filter(function (m) {
      return m && m.className === 'Message';
    });
    msgs.sort(function (a, b) { return Number(a.id) - Number(b.id); });
    var ids = msgs.map(function (m) { return M().senderIdOf(m); }).filter(Boolean);
    var names = M().loadNames(ids);
    if (names && names.then) {
      names.then(function () { mergeNames(); drawFeed(msgs); });
    } else {
      mergeNames();
      drawFeed(msgs);
    }
  }

  // TgMedia.loadNames() nomlarni izohlar modulining holatiga yozadi - shu
  // sababli ularni chat holatiga ko'chiramiz.
  function mergeNames() {
    var st = global.TGComments && global.TGComments._state;
    if (st && st.names) {
      for (var k in st.names) { if (st.names[k]) C.names[k] = st.names[k]; }
    }
  }

  function drawFeed(msgs) {
    var feed = el('chatFeed');
    if (!feed) return;
    if (!msgs.length) {
      feed.innerHTML = '<div class="chat-status">Hozircha xabar yo\'q. Birinchi bo\'lib yozing 👋</div>';
      return;
    }
    feed.innerHTML = msgs.map(rowHtml).join('');
    // Media elementlarini ulaymiz (izohlardagi bir xil oqim).
    msgs.forEach(function (m) {
      var d = M().mediaDescriptor(m);
      if (!d) return;
      var row = feed.querySelector('[data-mid="' + m.id + '"]');
      if (row) { try { M().wireMedia(row, m, d); } catch (e) {} }
    });
    scrollBottom(true);
    feed.__msgs = msgs;
  }

  function rowHtml(m) {
    var mine = isMine(m);
    var sid = M().senderIdOf(m);
    var u = sid ? C.users[String(sid)] : null;
    var uname = (C.names && C.names[String(sid)]) || (u && u.username) || '';
    uname = uname ? String(uname).replace(/^@/, '') : '';
    var name = u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : (uname || 'Foydalanuvchi');
    var d = M().mediaDescriptor(m);
    var when = M().relTime(m.date);
    // Reels izohlaridagi kabi: media (rasm/GIF/stiker) KO'K BUBBLE ichida
    // emas, o'z-o'zidan chiqadi - shuning uchun orqa foni bo'lmaydi.
    var media = d ? '<div class="chat-media">' + M().mediaHtml(d) + '</div>' : '';
    var text = m.message
      ? '<div class="chat-bub"><div class="chat-txt">' + M().messageText(m) + '</div>'
        + '<span class="chat-time">' + when + '</span></div>'
      : '';
    // Faqat media bo'lsa - vaqt alohida, foni yo'q satrda.
    var timeOnly = (!m.message && d) ? '<span class="chat-time chat-time-free">' + when + '</span>' : '';
    if (!media && !text) text = '<div class="chat-bub"><div class="chat-txt chat-txt-empty">—</div>'
      + '<span class="chat-time">' + when + '</span></div>';

    var showWho = !mine && C.active && C.active.type === 'room';
    var av = (!mine && sid) ? M().avatarHtml(sid, name) : '';
    return '<div class="chat-row' + (mine ? ' mine' : '') + '" data-mid="' + m.id + '">'
      + (mine ? '' : '<div class="chat-avw">' + av + '</div>')
      + '<div class="chat-col">'
      + (showWho ? '<div class="chat-who">' + esc(uname ? '@' + uname : name) + '</div>' : '')
      + media + text + timeOnly
      + '</div></div>';
  }

  function isMine(m) {
    var sid = M().senderIdOf(m);
    var myId = (C.me && C.me.id) ? String(C.me.id) : '';
    return !!(sid && myId && String(sid) === myId);
  }

  function scrollBottom(force) {
    var feed = el('chatFeed');
    if (!feed) return;
    try { feed.scrollTop = feed.scrollHeight; } catch (e) {}
  }

  // ============================================================ YUBORISH
  /**
   * Bloklangan DM'da yuborishni to'xtatadi. Xona (room) doim ochiq.
   * @return {boolean} true bo'lsa yuborish rad etildi
   */
  function guardSend() {
    if (!C.active) return true;
    if (C.active.type !== 'dm' || !C.locked) return false;
    toast(C.lockedReason || 'Xabar yuborish taqiqlangan');
    return true;
  }

  function replyTo(topicId) {
    var A = Api();
    return new A.InputReplyToMessage({ replyToMsgId: Number(topicId), topMsgId: Number(topicId) });
  }

  /**
   * Yozilgan matnni yuborishga tayyorlaydi: `TgFormat` markup belgilarini
   * (`**qalin**`, `*kursiv*`, `>sitata`, `kod`, `[nom](havola)`) olib
   * tashlab, ularning o'rniga Telegram `entities` qo'yadi.
   * @return {{text: string, entities: Array|null}}
   */
  function composeText(text) {
    var F = global.TgFormat;
    if (!F || !F.parse) return { text: text, entities: null };
    var p = F.parse(text);
    var A = Api();
    var ents = [];
    (p.entities || []).forEach(function (e) {
      var Ctor = A && A[e._];
      if (typeof Ctor !== 'function') return;
      try { ents.push(new Ctor(e)); } catch (err) { /* noto'g'ri maydon */ }
    });
    return { text: p.text, entities: ents.length ? ents : null };
  }

  function sendText(text) {
    text = (text || '').trim();
    if (!text || !C.active || guardSend()) return Promise.resolve(false);
    // Shaxsiy chat - server orqali (qabul qiluvchiga kafolatlangan yetib boradi).
    if (C.active.type === 'dm') return sendDmText(text);
    var A = Api();
    var a = C.active;
    var c = composeText(text);
    return getClient().then(function (cl) {
      var base = { peer: a.peerEntity || C.roomPeer, message: c.text, randomId: M().randLong() };
      if (c.entities) base.entities = c.entities;
      if (a.type === 'room') base.replyTo = replyTo(a.topicId);
      return cl.invoke(new A.messages.SendMessage(base));
    }).then(afterSend).catch(function (e) { toast('Yuborilmadi: ' + errMsg(e)); });
  }

  function sendMedia(media, caption) {
    var A = Api();
    var a = C.active;
    if (!a || guardSend()) return Promise.resolve(false);
    var c = composeText(caption || '');
    return getClient().then(function (cl) {
      var base = { peer: a.peerEntity || C.roomPeer, media: media, message: c.text, randomId: M().randLong() };
      if (c.entities) base.entities = c.entities;
      if (a.type === 'room') base.replyTo = replyTo(a.topicId);
      return cl.invoke(new A.messages.SendMedia(base));
    });
  }

  function sendPhoto(file) {
    if (!file || !C.active || guardSend()) return Promise.resolve(false);
    if (C.active.type === 'dm') return sendDmMedia(file, 'photo', 0);
    var A = Api();
    return getClient().then(function (c) {
      return c.uploadFile({ file: file, workers: 1 });
    }).then(function (uploaded) {
      return sendMedia(new A.InputMediaUploadedPhoto({ file: uploaded }), '');
    }).then(afterSend).catch(function (e) { toast('Rasm yuborilmadi: ' + errMsg(e)); });
  }

  function sendStickerDoc(doc) {
    if (!doc || !C.active || guardSend()) return Promise.resolve(false);
    if (C.active.type === 'dm') { toast('Shaxsiy chatda stiker hozircha mavjud emas'); return Promise.resolve(false); }
    var A = Api();
    var inputDoc = new A.InputDocument({
      id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference
    });
    return sendMedia(new A.InputMediaDocument({ id: inputDoc }), '')
      .then(afterSend).catch(function (e) { toast('Stiker yuborilmadi: ' + errMsg(e)); });
  }

  // Ovozli xabar: `tg-voice.js` yozib beradi, bu yerda Telegram'ga yuklanadi
  // (`DocumentAttributeAudio { voice: true }` -> Telegram'dagi "ovozli xabar").
  function sendVoice(blob, duration, mime) {
    if (!blob || !C.active || guardSend()) return Promise.resolve(false);
    if (C.active.type === 'dm') return sendDmMedia(blob, 'voice', duration, mime);
    var V = global.TgVoice;
    if (!V) { toast('Ovoz moduli topilmadi'); return Promise.resolve(false); }
    return V.uploadMedia(blob, duration).then(function (media) {
      return sendMedia(media, '');
    }).then(afterSend).catch(function (e) { toast('Ovozli xabar yuborilmadi: ' + errMsg(e)); });
  }

  function sentFromUpdates(res) {
    var ups = (res && res.updates) || [];
    for (var i = 0; i < ups.length; i++) {
      var u = ups[i];
      if (!u) continue;
      if (u.className === 'UpdateNewMessage' || u.className === 'UpdateNewChannelMessage') {
        var mm = u.message;
        // Faqat haqiqiy xabar ("MessageService" emas) - aks holda "—" qator.
        if (mm && mm.className === 'Message') return mm;
      }
    }
    return null;
  }

  function afterSend(res) {
    collectUsers(res);
    if (T() && T().me) { try { C.me = T().me(); } catch (e) {} }
    var m = sentFromUpdates(res);
    var feed = el('chatFeed');
    if (m && feed) {
      var empty = feed.querySelector('.chat-status');
      if (empty) feed.innerHTML = '';
      feed.insertAdjacentHTML('beforeend', rowHtml(m));
      var row = feed.querySelector('[data-mid="' + m.id + '"]');
      var d = M().mediaDescriptor(m);
      if (row && d) { try { M().wireMedia(row, m, d); } catch (e) {} }
      scrollBottom(true);
    } else {
      reloadActive();
    }
    return true;
  }

  function toast(msg) {
    var t = el('chatToast');
    if (!t) { try { console.warn('[tg-chat]', msg); } catch (e) {} return; }
    t.textContent = msg;
    t.hidden = false;
    if (toast._t) clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2800);
  }

  // ============================================================ PICKER PANEL
  // Telegram Desktop kabi: kompozitorda BITTA tugma, panel ichida
  // 4 ta bo'lim: Emoji | Stiker | GIF | Rasm.
  function picker() { return el('chatPicker'); }

  var TABS = [
    { key: 'emoji',   label: '😀',   title: 'Emoji' },
    { key: 'sticker', label: 'Stiker', title: 'Stikerlar' },
    { key: 'gif',     label: 'GIF',  title: 'GIF' },
    { key: 'photo',   label: '📷',   title: 'Rasm' }
  ];

  /**
   * Faol suhbat uchun mavjud picker bo'limlari. Shaxsiy chat SERVER orqali
   * ishlagani uchun stiker/GIF (Telegram) mavjud emas - faqat emoji va rasm.
   */
  function pickerTabs() {
    if (C.active && C.active.type === 'dm') {
      return TABS.filter(function (t) { return t.key === 'emoji' || t.key === 'photo'; });
    }
    return TABS;
  }

  function closePicker() {
    var p = picker();
    if (p) { p.hidden = true; p.innerHTML = ''; }
    C.pickerMode = '';
    var ab = el('chatAttachBtn');
    if (ab) ab.setAttribute('aria-expanded', 'false');
  }

  function pickerBody() { return el('chatPickerBody'); }

  function pickerStatus(html) {
    var b = pickerBody();
    if (b) b.innerHTML = '<div class="chat-empty">' + html + '</div>';
  }

  /** Panel skeletini bir marta quradi va `tab` bo'limini ochadi. */
  function openPanel(tab) {
    var p = picker();
    if (!p) return;
    if (!p.hidden && C.pickerMode === tab) { closePicker(); return; }
    p.hidden = false;
    C.pickerMode = tab;
    var ab = el('chatAttachBtn');
    if (ab) ab.setAttribute('aria-expanded', 'true');
    var tabsHtml = pickerTabs().map(function (t) {
      return '<button type="button" class="chat-picker-tab" data-tab="' + t.key + '" title="' + t.title + '">' + t.label + '</button>';
    }).join('');
    p.innerHTML =
      '<div class="chat-picker-tabs" id="chatPickerTabs">'
      + tabsHtml
      + '<button type="button" class="chat-picker-x" id="chatPickerX" aria-label="Yopish">&times;</button>'
      + '</div>'
      + '<div class="chat-picker-body" id="chatPickerBody"></div>';
    var tabs = el('chatPickerTabs');
    if (tabs) tabs.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-tab]');
      if (!b) return;
      var k = b.getAttribute('data-tab');
      if (k === 'photo') { pickPhoto(); return; }
      switchTab(k);
    };
    var x = el('chatPickerX');
    if (x) x.onclick = closePicker;
    switchTab(tab);
  }

  function switchTab(tab) {
    var allowed = pickerTabs().some(function (o) { return o.key === tab; }) ? tab : 'emoji';
    var t = allowed;
    C.pickerMode = t;
    var p = picker();
    if (p) {
      p.hidden = false;
      Array.prototype.forEach.call(p.querySelectorAll('.chat-picker-tab'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-tab') === t);
      });
    }
    if (t === 'emoji')   renderEmojiPanel();
    if (t === 'sticker') renderStickerPanel();
    if (t === 'gif')     renderGifPanel();
  }

  /** Stiker panelidan keyin boshqa tabga o'tilganda `is-sticker` qolmasin. */
  function clearStickerMode() {
    var b = pickerBody();
    if (b) b.classList.remove('is-sticker');
  }

  // --------------------------------------------------------------- 1) EMOJI
  function renderEmojiPanel() {
    var b = pickerBody();
    if (!b) return;
    clearStickerMode();
    var secs = (global.TgEmoji && TgEmoji.sections()) || [];
    b.innerHTML = secs.map(function (g, gi) {
      var key = g.name === 'So‘nggi' ? 'recent' : 'g' + gi;
      return '<div class="chat-emoji-sec" data-sec="' + key + '">'
        + '<div class="chat-emoji-cap">' + esc(g.name) + '</div>'
        + '<div class="chat-emoji-grid">'
        + g.list.map(function (e) {
            return '<button type="button" class="chat-emoji" data-e="' + esc(e) + '">' + e + '</button>';
          }).join('')
        + '</div></div>';
    }).join('');
    b.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('.chat-emoji');
      if (!btn) return;
      var em = btn.getAttribute('data-e') || '';
      if (!em) return;
      if (global.TgEmoji) TgEmoji.pushRecent(em);
      insertAtCursor(em);
      syncRecentEmoji();
    };
  }

  /** Emojidan keyin "So'nggi" qismini yangilaydi (944 ta emoji qayta
      chizilmasligi uchun faqat o'sha bo'limni yangilaymiz). */
  function syncRecentEmoji() {
    var b = pickerBody();
    if (!b || !global.TgEmoji) return;
    var rec = TgEmoji.recent() || [];
    if (!rec.length) return;
    var wrap = b.querySelector('[data-sec="recent"]');
    var html = rec.map(function (e) {
      return '<button type="button" class="chat-emoji" data-e="' + esc(e) + '">' + e + '</button>';
    }).join('');
    if (!wrap) {
      // "So'nggi" bo'limi birinchi marta paydo bo'lyapti - panelni qayta
      // chizamiz, lekin scroll joyini saqlab qolamiz.
      var top = b.scrollTop;
      renderEmojiPanel();
      var nb = pickerBody();
      if (nb) nb.scrollTop = top;
      return;
    }
    var grid = wrap.querySelector('.chat-emoji-grid');
    if (grid) grid.innerHTML = html;
  }

  /** Emojini yozish maydoniga kursor joyidan qo'yadi. */
  function insertAtCursor(text) {
    var inp = el('chatInput');
    if (!inp) return;
    inp.focus();
    var s = inp.selectionStart, e = inp.selectionEnd;
    var v = inp.value || '';
    if (typeof s !== 'number') { s = v.length; e = v.length; }
    inp.value = v.slice(0, s) + text + v.slice(e);
    var pos = s + text.length;
    try { inp.setSelectionRange(pos, pos); } catch (err) {}
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // -------------------------------------------------------------- 2) STIKER
  // To'plamlar soni juda ko'p (o'nlablab, hattoki 200+). Bitta qatorli
  // gorizontal lenta ularni amalda topib bo'lmaydi, shuning uchun:
  //   * qidiruv maydoni (nom bo'yicha filtr);
  //   * to'plamlar bir necha qatorga O'TADI va vertikal scroll qilinadi;
  //   * nechta topilganini ko'rsatuvchi hisob.
  var stickerSetsCache = null;

  function renderStickerPanel() {
    var b = pickerBody();
    if (!b) return;
    // Qidiruv + to'plamlar qatori DOIM ko'rinib tursin, faqat stikerlar
    // grid'i scroll qilinsin (ichki scroll qo'shilib ketmasligi uchun
    // tashqi konteyner skrolga yopiladi).
    b.classList.add('is-sticker');
    b.innerHTML =
        '<div class="chat-sticker-head">'
      +   '<div class="chat-sticker-search">'
      +     '<input id="chatStickerSearch" type="text" autocomplete="off" spellcheck="false"'
      +       ' placeholder="To‘plam qidirish (masalan: Duck)…" aria-label="Stiker to‘plamlarini qidirish">'
      +     '<span class="chat-sticker-count" id="chatStickerCount"></span>'
      +   '</div>'
      + '</div>'
      + '<div class="chat-sticker-sets" id="chatStickerSets"></div>'
      + '<div class="chat-sticker-body" id="chatStickerBody"><div class="chat-empty"><span class="spinner"></span></div></div>';

    var wrap = el('chatStickerSets');
    var inp  = el('chatStickerSearch');
    var cnt  = el('chatStickerCount');

    function paint(q) {
      if (!wrap) return;
      q = String(q || '').trim().toLowerCase();
      var html = '', shown = 0;
      (stickerSetsCache || []).forEach(function (s, i) {
        var title = s.title || 'Set';
        // Qidiruv: to'plam nomi va "so'nggi" belgisi.
        if (q && title.toLowerCase().indexOf(q) < 0) return;
        shown++;
        html += '<button type="button" class="chat-sticker-set" data-i="' + i + '" title="' + esc(title) + '">'
              + esc(title) + '</button>';
      });
      wrap.innerHTML = shown ? html : '<div class="chat-sticker-none">Topilmadi</div>';
      if (cnt) cnt.textContent = (stickerSetsCache || []).length
        ? (shown + ' / ' + stickerSetsCache.length) : '';
      wrap.scrollTop = 0;
      // Qidiruvda faqat bitta moslik qoldi - uni darhol ochamiz.
      if (q && shown === 1) {
        var only = wrap.querySelector('[data-i]');
        if (only) only.click();     // `on` belgisi ham shu yerda qo'yiladi
      }
      return shown;
    }

    if (inp) {
      var tmr = null;
      inp.addEventListener('input', function () {
        if (tmr) clearTimeout(tmr);
        var v = inp.value;
        tmr = setTimeout(function () { paint(v); }, 130);
      });
      inp.addEventListener('keydown', function (e) {
        // Escape -> panelni yopish (Telegramdagidek), Enter -> birinchi moslik.
        if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var first = wrap && wrap.querySelector('[data-i]');
        if (first) first.click();
      });
    }

    if (wrap) {
      wrap.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-i]');
        if (!btn) return;
        Array.prototype.forEach.call(wrap.querySelectorAll('.chat-sticker-set'), function (x) { x.classList.remove('on'); });
        btn.classList.add('on');
        loadStickerSet(stickerSetsCache[Number(btn.getAttribute('data-i'))]);
      });
    }

    var done = stickerSetsCache ? Promise.resolve(stickerSetsCache) : loadStickerCollections();
    done.then(function (sets) {
      if (C.pickerMode !== 'sticker') return;
      stickerSetsCache = sets;
      if (!sets.length) { pickerStatus('Stiker topilmadi'); return; }
      var shown = paint(inp ? inp.value : '');
      if (shown !== 1) {
        var first = wrap && wrap.querySelector('[data-i]');
        if (first) { first.classList.add('on'); loadStickerSet(sets[Number(first.getAttribute('data-i'))]); }
      }
    }).catch(function (e) {
      if (C.pickerMode !== 'sticker') return;
      // Xatoni faqat stiker maydoniga yozamiz - to'plamlar qatori joyida qoladi.
      var sb = stickerBody();
      if (sb) sb.innerHTML = '<div class="chat-empty">Xatolik: ' + esc(errMsg(e)) + '</div>';
    });
  }

  function stickerBody() { return el('chatStickerBody'); }

  function loadStickerCollections() {
    var A = Api();
    return getClient().then(function (c) {
      // `hash: 0` - Telegram har o'zgarishda yangilagan hash'ni qaytaradi;
      // biz har safar to'liq ro'yxatni olamiz (chatlarda "ko'p" stiker kerak).
      var installed = c.invoke(new A.messages.GetAllStickers({ hash: 0 }))
        .then(function (res) { return res.sets || []; }).catch(function () { return []; });
      var recent = c.invoke(new A.messages.GetRecentStickers({ hash: 0 }))
        .then(function (res) { return (res.stickers || []).filter(function (d) { return d && d.className === 'Document'; }); })
        .catch(function () { return []; });
      var featured = c.invoke(new A.messages.GetFeaturedStickers({ hash: 0 }))
        .then(function (res) { return res.sets || []; }).catch(function () { return []; });
      return Promise.all([installed, recent, featured]);
    }).then(function (r) {
      var out = [];
      var seen = {};
      function add(title, set) {
        if (!set || !set.id || seen[String(set.id)]) return;
        seen[String(set.id)] = 1;
        out.push({ title: title || 'Set', set: set });
      }
      if (r[1] && r[1].length) out.push({ title: 'So‘nggi', recent: r[1] });
      (r[0] || []).forEach(function (s) { add(s && s.title, s); });
      (r[2] || []).forEach(function (s) { add(s && s.title, s); });
      return out;
    });
  }

  function loadStickerSet(item) {
    if (!item) return;
    var A = Api();
    if (item.recent) { renderStickerDocs(item.recent); return; }
    var b = stickerBody();
    if (b) b.innerHTML = '<div class="chat-empty"><span class="spinner"></span></div>';
    getClient().then(function (c) {
      return c.invoke(new A.messages.GetStickerSet({
        stickerset: new A.InputStickerSetID({ id: item.set.id, accessHash: item.set.accessHash }), hash: 0
      }));
    }).then(function (res) {
      if (C.pickerMode !== 'sticker') return;
      renderStickerDocs((res.documents || []).filter(function (d) { return d && d.className === 'Document'; }));
    }).catch(function (e) {
      if (C.pickerMode !== 'sticker') return;
      var sb = stickerBody();
      if (sb) sb.innerHTML = '<div class="chat-empty">Xatolik: ' + esc(errMsg(e)) + '</div>';
    });
  }

  function renderStickerDocs(docs) {
    var b = stickerBody();
    if (!b) return;
    if (!docs.length) { b.innerHTML = '<div class="chat-empty">Bo‘sh to‘plam</div>'; return; }
    var items = docs.map(function (d) { return M().docDescriptor(d) || { kind: 'sticker', mime: d.mimeType || '', media: d }; });
    b.innerHTML = '<div class="chat-sticker-grid">' + items.map(function (d, i) {
      return '<button type="button" class="chat-sticker-item" data-i="' + i + '">' + M().mediaInnerHtml(d) + '</button>';
    }).join('') + '</div>';
    items.forEach(function (d, i) {
      var btn = b.querySelector('[data-i="' + i + '"]');
      if (!btn) return;
      var node = btn.querySelector('img,video,.reels-tgs');
      if (node) M().downloadInto(node, d);
    });
    b.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('[data-i]');
      if (!btn) return;
      var d = docs[Number(btn.getAttribute('data-i'))];
      if (!d) return;
      sendStickerDoc(d).then(function () { closePicker(); });
    };
  }

  // ------------------------------------------------------------------ 3) GIF
  function renderGifPanel() {
    var b = pickerBody();
    if (!b) return;
    clearStickerMode();
    b.innerHTML = '<div class="chat-gif-search"><input id="chatGifQuery" type="text" placeholder="GIF qidirish…" autocomplete="off"></div>'
      + '<div class="chat-gif-body" id="chatGifBody"><div class="chat-empty"><span class="spinner"></span></div></div>';
    var inp = el('chatGifQuery');
    var seq = 0, timer = null;
    function run(q) {
      var my = ++seq;
      var gb = el('chatGifBody');
      if (gb) gb.innerHTML = '<div class="chat-empty"><span class="spinner"></span></div>';
      gifQuery(q).then(function (res) {
        if (my !== seq || C.pickerMode !== 'gif') return;
        var results = (res && res.results) || [];
        var gb2 = el('chatGifBody');
        if (!gb2) return;
        if (!results.length) { gb2.innerHTML = '<div class="chat-empty">Natija topilmadi</div>'; return; }
        var items = results.map(function (r) { return r && r.document ? M().docDescriptor(r.document) : null; });
        gb2.innerHTML = '<div class="chat-gif-grid">' + results.map(function (r, i) {
          var d = items[i];
          return '<button type="button" class="chat-gif-item" data-i="' + i + '"' + (d ? M().ratioStyle(d) : '') + '>'
            + (d ? M().mediaInnerHtml(d) : '') + '</button>';
        }).join('') + '</div>';
        results.forEach(function (r, i) {
          var btn = gb2.querySelector('[data-i="' + i + '"]');
          var d = items[i];
          if (!btn || !d) return;
          var node = btn.querySelector('img,video,.reels-tgs');
          if (node) M().downloadInto(node, d);
        });
        gb2.onclick = function (e) {
          var btn = e.target.closest && e.target.closest('[data-i]');
          if (!btn) return;
          sendGifResult(results[Number(btn.getAttribute('data-i'))], res.queryId);
        };
      }).catch(function (er) {
        if (my !== seq) return;
        // Xatoni faqat natija maydoniga yozamiz - qidiruv maydoni joyida qoladi.
        var gb3 = el('chatGifBody');
        if (gb3) gb3.innerHTML = '<div class="chat-empty">Xatolik: ' + esc(errMsg(er)) + '</div>';
      });
    }
    if (inp) {
      inp.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { run(inp.value.trim()); }, 320);
      });
    }
    run('');
  }

  // ---------------------------------------------------------------- 4) RASM
  function pickPhoto() {
    var pf = el('chatPhoto');
    if (!pf) return;
    pf.click();
  }

  function gifQuery(q) {
    var A = Api();
    var a = C.active;
    return getClient().then(function (c) {
      var botP = C.gifBot ? Promise.resolve(C.gifBot) : c.getInputEntity('@gif').then(function (b) { C.gifBot = b; return b; });
      return botP.then(function (bot) {
        return c.invoke(new A.messages.GetInlineBotResults({
          bot: bot, peer: a.peerEntity || C.roomPeer, query: q || '', offset: ''
        }));
      });
    });
  }

  function sendGifResult(result, queryId) {
    if (!result || !C.active) return;
    if (C.active.type === 'dm') { toast('Shaxsiy chatda GIF hozircha mavjud emas'); return; }
    var A = Api();
    var a = C.active;
    var gb = el('chatGifBody');
    if (gb) gb.innerHTML = '<div class="chat-empty"><span class="spinner"></span></div>';
    getClient().then(function (c) {
      var base = { peer: a.peerEntity || C.roomPeer, queryId: queryId, id: result.id, randomId: M().randLong() };
      if (a.type === 'room') base.replyTo = replyTo(a.topicId);
      return c.invoke(new A.messages.SendInlineBotResult(base));
    }).then(function (res) { closePicker(); afterSend(res); })
      .catch(function (e) {
        var b2 = el('chatGifBody');
        if (b2) b2.innerHTML = '<div class="chat-empty">Xatolik: ' + esc(errMsg(e)) + '</div>';
      });
  }

  // ============================================================ UI ULASH
  function initUI() {
    var feed = el('chatFeed');
    var thread = el('chatThread');

    var back = el('chatBack');
    if (back) back.addEventListener('click', goBack);

    // Chatga ulashilgan video kartasi bosilganda — O'SHA kino to'liq
    // qismlari bilan ochiladi (`watch.php?c=ID&e=EPISODE`). Katalogdagi
    // kontent uchun ref.id > 0 bo'ladi; eskirgan/oqimsiz kartalarda eski
    // overlay oynasi (openSharePlayer) qoladi.
    if (feed) feed.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('.chat-share');
      if (!card) return;
      if (card.classList.contains('no-play')) {
        // Oqim yo'q - oddiy matn/silka sifatida qoldiriladi.
        return;
      }
      var ref = null;
      try { ref = JSON.parse(card.getAttribute('data-ref') || 'null'); } catch (err) { ref = null; }
      var cid = ref ? (Number(ref.id) || 0) : 0;
      if (cid > 0) {
        var u = BASE + '/watch.php?c=' + encodeURIComponent(cid);
        if (Number(ref.episode) > 0) u += '&e=' + encodeURIComponent(ref.episode);
        try { location.assign(u); } catch (err2) { try { window.open(u, '_blank'); } catch (err3) {} }
        return;
      }
      openSharePlayer(ref);
    });

    var form = el('chatComposer');
    var input = el('chatInput');
    if (form && input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })); }
      });
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(120, input.scrollHeight) + 'px';
        notifyTyping();
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var t = input.value;
        if (!t.trim()) return;
        input.value = '';
        input.style.height = 'auto';
        sendText(t);
      });
    }

    // Telegram uslubida: bitta tugma -> 4 bo'limli panel.
    var ab = el('chatAttachBtn');
    if (ab) ab.addEventListener('click', function (e) {
      e.preventDefault();
      openPanel(C.pickerMode || 'emoji');
    });

    var pf = el('chatPhoto');
    if (pf) pf.addEventListener('change', function () {
      var f = pf.files && pf.files[0];
      pf.value = '';
      if (!f) return;
      var pb = pickerBody();
      if (pb) pb.innerHTML = '<div class="chat-empty"><span class="spinner"></span> Rasmingiz yuborilmoqda…</div>';
      sendPhoto(f);
    });

    // Klaviatura: Ctrl/Cmd+K - panel, Esc - yopish (Telegramdagidek).
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k') {
        e.preventDefault();
        openPanel(C.pickerMode || 'emoji');
        return;
      }
      if (e.key !== 'Escape') return;
      if (C.voice && C.voice.isRecording()) { C.voice.cancel(); return; }
      if (toggleFmt(false)) return;               // formatlash menyusi
      var p = picker();
      if (p && !p.hidden) { closePicker(); return; }
      // Suhbat ochiq, boshqa panel yo'q — Orqaga (Telegramdagidek).
      if (thread && !thread.hidden) { goBack(); }
    });

    initFmtMenu(input);
    initComposerVoice();
  }

  // ======================================================== FORMATLASH MENYUSI
  var fmtCtl = null;

  /**
   * "Aa" tugmasi: matn formatlash qo'llanishini ochadi. Satr bosilsa
   * shu belgilar matn maydoniga qo'yiladi (kursor tanlangan matn ustida
   * bo'lsa, o'sha qismga o'raladi).
   *
   * Menyuning HTML'i va mantiqi `tg-format.js` da (`TgFormat.mountFmtMenu`),
   * chunki reels izohlari (`reels.php`) ham xuddi shuni ishlatadi.
   */
  function initFmtMenu(input) {
    var F = global.TgFormat;
    if (!F || !F.mountFmtMenu) return null;
    fmtCtl = F.mountFmtMenu('#chatFmtBtn', input || '#chatInput', '#chatThread');
    return fmtCtl;
  }

  /** Menyuni ochish/yopish. `false` berilsa va menyu ochiq bo'lsa `true`
   *  qaytaradi (Esc/panel ochilishidan oldin tekshirish uchun). */
  function toggleFmt(show) {
    if (!fmtCtl) return false;
    return fmtCtl.toggle(show);
  }

  /**
   * Kompozitorni Telegram uslubida bog'lash: matn yo'q -> MIKROFON,
   * matn bor -> YUBORISH. Mikrofon bosilsa ovoz yoziladi va
   * `sendVoice()` orqali Telegram'ga yuboriladi.
   */
  function initComposerVoice() {
    var V = global.TgVoice;
    if (!V || !V.bindComposer) return;
    var form = el('chatComposer');
    var input = el('chatInput');
    var send = el('chatSend');
    if (!form || !input || !send) return;
    if (form.__voiceBound) return;
    form.__voiceBound = true;
    C.voice = V.bindComposer({
      form: form,
      input: input,
      send: send,
      // Mikrofon TEZ bosilsa skripkaga aylanadi; skripka bosilsa rasm tanlanadi.
      file: el('chatPhoto'),
      onSend: function (blob, duration, mime) { sendVoice(blob, duration, mime); },
      onError: function (msg) { toast(msg); }
    });
  }

  // ============================================================ ISHGA TUSHISH
  function bootstrap() {
    if (!M()) { try { console.warn('[tg-chat] TgMedia topilmadi'); } catch (e) {} }
    if (T() && T().me) { try { C.me = T().me(); } catch (e) {} }
    // `||spoiler||` matnlari bosilish bilan ochiladi.
    try { if (global.TgFormat) global.TgFormat.bindSpoilers(); } catch (e) {}
    initUI();
    loadRooms();
    loadContacts();
    // Ro'yxat ochiq turganda yangi suhbat/xabarlarni vaqti-vaqti bilan
    // yangilab turamiz (ochiq suhbat bo'lsa uni dmPollTick yangilaydi).
    setInterval(function () { if (!C.active) loadContacts(); }, 15000);

    // profile.php "Xabar" tugmasi: chat.php?u=ID
    var u = 0;
    try { u = Number(new URLSearchParams(location.search).get('u')) || 0; } catch (e) {}
    if (u > 0) openFromQuery(u);
  }

  function openFromQuery(peerId) {
    // Avval `peer` — bu ro'yxatga qo'shmaydi, balki blok holatini ham qaytaradi.
    fetchJson(baseUrl('api/chat.php?' + withMe(
      new URLSearchParams({ action: 'peer', peer_id: peerId })).toString()),
      { credentials: 'same-origin' }
    ).then(function (d) {
      var peer = d && d.peer;
      if (!peer) throw new Error((d && d.message) || 'Foydalanuvchi topilmadi');
      openDM(peer);
      // Bloklash/oqish almashuvi hech bo'lmasa ro'yxatga qo'shiladi.
      if (!peer.blocked) {
        fetchJson(baseUrl('api/chat.php'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: withMe(new URLSearchParams({ action: 'add_contact', peer_id: peerId })).toString(),
          credentials: 'same-origin'
        }).catch(function () {});
      }
    }).catch(function (e) { toast('Chat ochilmadi: ' + errMsg(e)); });
  }

  global.TGChat = {
    openChat: openChat,
    closeChat: closeChat,
    goBack: goBack,
    reload: function () { loadRooms(); loadContacts(); },
    openRoom: openRoom,
    openDM: openDM,
    _state: C
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
