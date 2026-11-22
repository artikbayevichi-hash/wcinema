/* ============================================================================
 * feedback.js — chap panel / sozlamalar / telefondagi "Taklif yoki shikoyat"
 * tugmalari ochadigan oyna.
 *
 * Yuborish api/feedback.php ga POST qilinadi. Muvaffaqiyatdan keyin foydalanuvchi
 * "Murojaatlarim" sahifasiga o'tishi mumkin; admin javob yozganda esa
 * notifications jadvaliga yozilgan bildirishnoma qo'ng'iroqchada ko'rinadi.
 * ==========================================================================*/
(function () {
  'use strict';

  var dlg    = document.getElementById('feedbackDialog');
  if (!dlg) return;
  var panel  = dlg.querySelector('.feedback-panel');
  var form   = document.getElementById('feedbackForm');
  var input  = document.getElementById('feedbackMessage');
  var counter= document.getElementById('feedbackCount');
  var status = document.getElementById('feedbackStatus');
  var sendBt = document.getElementById('feedbackSend');
  var opener = null;

  function me() {
    try { return localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) { return ''; }
  }
  function say(text, bad) {
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('is-error', !!bad);
    status.classList.toggle('is-ok', !!text && !bad);
  }
  function open(e) {
    if (e) e.preventDefault();
    opener = e && e.currentTarget ? e.currentTarget : null;
    // Sozlamalar paneli ustida ochilsa, uni yopamiz (ikki oyna ustma-ust tushmasin).
    var setClose = document.getElementById('igSetClose');
    if (setClose && dlg.closest('body') && document.getElementById('igSettings')
        && !document.getElementById('igSettings').hidden) {
      setClose.click();
    }
    dlg.hidden = false;
    say('');
    try { document.body.style.overflow = 'hidden'; } catch (err) {}
    setTimeout(function () { if (input) input.focus(); }, 0);
  }
  function close() {
    if (dlg.hidden) return;
    dlg.hidden = true;
    try { document.body.style.overflow = ''; } catch (err) {}
    if (opener && typeof opener.focus === 'function') opener.focus();
    opener = null;
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest && e.target.closest('[data-feedback-open]');
    if (trigger) { open({ preventDefault: function () {}, currentTarget: trigger }); return; }
    if (e.target.closest && e.target.closest('[data-feedback-close]')) close();
  });
  document.addEventListener('keydown', function (e) {
    if (dlg.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab' || !panel) return;
    var items = Array.prototype.slice.call(
      panel.querySelectorAll('button, a[href], textarea, input:not([type=hidden])')
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  if (input) {
    input.addEventListener('input', function () {
      if (counter) counter.textContent = String(input.value.length);
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = (input ? input.value : '').trim();
      if (msg.length < 5) { say('Matn kamida 5 belgi bo‘lishi kerak', true); return; }
      var picked = form.querySelector('input[name="feedbackType"]:checked');
      var body = new URLSearchParams({
        action: 'send',
        type: picked ? picked.value : 'suggestion',
        message: msg
      });
      var m = me();
      if (m) body.set('tg_me', m);

      if (sendBt) { sendBt.disabled = true; }
      say('Yuborilyapti…', false);
      fetch('api/feedback.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: body.toString()
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return { ok: r.ok, d: d };
        });
      }).then(function (res) {
        if (!res.ok || !res.d.success) {
          say(res.d.message || 'Yuborilmadi, keyinroq qayta urinib ko‘ring', true);
          return;
        }
        say('Rahmat! Xabaringiz yuborildi. Admin javob yozganda bildirishnoma olasiz.', false);
        if (input) input.value = '';
        if (counter) counter.textContent = '0';
        setTimeout(close, 1800);
      }).catch(function () {
        say('Tarmoq xatosi — keyinroq qayta urinib ko‘ring', true);
      }).then(function () {
        if (sendBt) sendBt.disabled = false;
      });
    });
  }
})();
