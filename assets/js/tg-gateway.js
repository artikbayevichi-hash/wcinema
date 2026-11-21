/* ============================================================================
   assets/js/tg-gateway.js — server-side MTProto gateway mijozi (prototip)

   NIMA QILADI:
     `TG_GATEWAY_MODE=primary` bo'lsa, private/Telegram post uchun avval
     serverdagi gateway'dan chipta so'raydi va `<video>` ni oddiy HTTP
     manzilga ulaydi. Gateway ishlamasa — `onFail()` chaqiriladi va
     `watch.js` odatdagi brauzer-MTProto yo'liga qaytadi.

   SOZLAMA (watch.php HTML ichida):
     window.__WCGW = { enabled:true, mode:'primary', url:'api/tg-gateway.php' };

   MUHIM: bu fayl hech qanday yangi tarmoq yo'lini O'ZI ochmaydi. Gateway
   o'chiq bo'lsa, u shunchaki `false` qaytaradi va sahifa avvalgidek ishlaydi.
   ============================================================================ */
(function (global) {
  'use strict';

  function cfg() {
    var c = global.__WCGW;
    return (c && typeof c === 'object') ? c : null;
  }

  function primary() {
    var c = cfg();
    return !!(c && c.enabled && String(c.mode || '') === 'primary');
  }

  function baseUrl() {
    var c = cfg();
    return (c && c.url) ? String(c.url) : 'api/tg-gateway.php';
  }

  function streamUrl(ticket) {
    return baseUrl() + '?t=' + encodeURIComponent(String(ticket || ''));
  }

  /**
   * Chipta so'rash.
   * @returns {Promise<{ticket:string,size:number,mime:string,dur:number,exp:number}>}
   */
  function ticket(pb) {
    var c = cfg();
    if (!c || !c.enabled) {
      return Promise.reject(new Error('Gateway o\'chirilgan'));
    }
    var q = [];
    if (pb && pb.channel && Number(pb.post) > 0) {
      q.push('channel=' + encodeURIComponent(String(pb.channel)));
      q.push('post=' + encodeURIComponent(String(Number(pb.post))));
    } else if (pb && pb.url) {
      q.push('url=' + encodeURIComponent(String(pb.url)));
    } else {
      return Promise.reject(new Error('Kanal/post yo\'q'));
    }
    q.push('action=ticket');

    var ctl = null;
    var timer = null;
    try {
      if (typeof global.AbortController === 'function') {
        ctl = new global.AbortController();
        timer = global.setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 15000);
      }
    } catch (e) {}

    return fetch(baseUrl() + '?' + q.join('&'), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok || !j || !j.ok || !j.ticket) {
          throw new Error((j && j.error) ? j.error : ('Gateway HTTP ' + r.status));
        }
        return j;
      });
    }).finally(function () {
      if (timer) { try { global.clearTimeout(timer); } catch (e) {} }
    });
  }

  /**
   * Gateway orqali pleyer mount qilish.
   *
   * @param {HTMLElement} host
   * @param {Object} pb        playback (channel, post, url, poster)
   * @param {number} generation
   * @param {Function} onFail  xato bo'lsa — oddiy yo'lga qaytish
   * @param {Function} onReady video tayyor bo'lganda
   * @returns {boolean}        true — gateway urinishi boshlandi
   */
  function mount(host, pb, generation, onFail, onReady) {
    if (!primary() || !host) return false;
    var failed = false;
    function fail(err) {
      if (failed) return;
      failed = true;
      try { if (global.console && console.warn) console.warn('[WCGateway]', err && err.message ? err.message : err); } catch (e) {}
      try { if (typeof onFail === 'function') onFail(err); } catch (e) {}
    }

    host.innerHTML = '<div class="player-wrap no-video"><div class="nv-msg">Server oqimi tayyorlanmoqda…</div></div>';

    ticket(pb).then(function (j) {
      var url = streamUrl(j.ticket);
      var video = null;
      try {
        if (global.UzPlayer && typeof global.UzPlayer.mount === 'function') {
          global.UzPlayer.mount(host, { type: 'direct', src: url, poster: pb.poster || '' });
          video = host.querySelector('video');
        } else {
          var poster = pb.poster ? ' poster="' + String(pb.poster).replace(/"/g, '&quot;') + '"' : '';
          host.innerHTML = '<div class="player-wrap has-video-container">'
            + '<video playsinline preload="auto" autoplay' + poster + '></video></div>';
          video = host.querySelector('video');
          if (video) video.src = url;
        }
      } catch (e) {
        fail(e);
        return;
      }
      if (!video) {
        fail(new Error('Video elementi yaratilmadi'));
        return;
      }
      video.setAttribute('data-wc-gateway', '1');
      video.addEventListener('error', function () {
        fail(new Error('Gateway oqimi xato berdi'));
      }, { once: true });
      if (typeof onReady === 'function') {
        try { onReady(video); } catch (e) {}
      }
    }).catch(fail);

    return true;
  }

  global.WCGateway = {
    enabled: function () { var c = cfg(); return !!(c && c.enabled); },
    primary: primary,
    ticket: ticket,
    streamUrl: streamUrl,
    mount: mount
  };
})(window);
