/* ==========================================================================
   W CINEMA - TV rejimi (10-foot UI)
   --------------------------------------------------------------------------
   Televizor pulti (D-pad) bilan boshqarish uchun "spatial navigation".
   Rejim `html.tv` klassi orqali yoqiladi (includes/nav.php aniqlaydi).

   Tugmalar:
     ← → ↑ ↓   fokusni geometrik eng yaqin elementga suradi
     Enter      fokusdagi elementni bosadi (brauzer o'zi bajaradi)
     Back/Esc   ochiq modalni yopadi
   ========================================================================== */
(function () {
    'use strict';

    var html = document.documentElement;

    function isTV() { return html.classList.contains('tv'); }

    // Reels sahifasida o'z (vertikal swipe) navigatsiyasi bor - tegmimiz.
    function isReels() {
        return document.body && document.body.classList.contains('reels-body');
    }

    // ------------------------------------------------------------------
    // Fokuslanadigan elementlar
    // ------------------------------------------------------------------
    var SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])';

    function visible(el) {
        if (el.closest('[hidden]')) return false;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        var r = el.getBoundingClientRect();
        return r.width > 6 && r.height > 6;
    }

    function allFocusables() {
        return Array.prototype.filter.call(document.querySelectorAll(SEL), function (el) {
            if (el.tabIndex === -1) return false;
            if (el.hasAttribute('data-tv-skip')) return false;
            return visible(el);
        });
    }

    // Ochiq modal bo'lsa - fokus faqat uning ichida.
    function scopeList() {
        var modals = [document.getElementById('modal'), document.getElementById('trimModal')];
        for (var i = 0; i < modals.length; i++) {
            var m = modals[i];
            if (m && !m.hidden) {
                var inside = allFocusables().filter(function (el) { return m.contains(el); });
                if (inside.length) return inside;
            }
        }
        return allFocusables();
    }

    // ------------------------------------------------------------------
    // Geometrik "eng yaqin" qidiruv
    // ------------------------------------------------------------------
    function focusEl(el) {
        if (!el) return;
        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
        try { el.scrollIntoView({ block: 'nearest', inline: 'center' }); }
        catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    }

    function move(dir) {
        var all = scopeList();
        if (!all.length) return;
        var cur = document.activeElement;
        if (!cur || all.indexOf(cur) === -1) { focusEl(all[0]); return; }

        var cr = cur.getBoundingClientRect();
        var cx = cr.left + cr.width / 2;
        var cy = cr.top + cr.height / 2;
        var best = null, bestScore = Infinity;

        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el === cur) continue;
            var r = el.getBoundingClientRect();
            var x = r.left + r.width / 2;
            var y = r.top + r.height / 2;
            var dx = x - cx, dy = y - cy, primary, secondary;

            if (dir === 'left')       { if (dx > -4) continue; primary = -dx; secondary = Math.abs(dy); }
            else if (dir === 'right') { if (dx <  4) continue; primary =  dx; secondary = Math.abs(dy); }
            else if (dir === 'up')    { if (dy > -4) continue; primary = -dy; secondary = Math.abs(dx); }
            else                      { if (dy <  4) continue; primary =  dy; secondary = Math.abs(dx); }

            // Asosiy o'q masofasi + kesishuvchi o'qdan og'ish (2.5x) -> qatordagi
            // eng mos element tanlanadi.
            var score = primary + secondary * 2.5;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        if (best) focusEl(best);
    }

    // ------------------------------------------------------------------
    // Klaviatura / pult
    // ------------------------------------------------------------------
    function onKey(e) {
        if (!isTV() || isReels()) return;
        var t = e.target || {};
        var tag = (t.tagName || '').toUpperCase();
        var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        var k = e.key;
        var modal = document.getElementById('modal');
        var modalOpen = modal && !modal.hidden;

        // "Orqaga" tugmalari
        var back = (k === 'Backspace' || k === 'XF86Back' || k === 'GoBack' || k === 'BrowserBack');
        if (back && modalOpen) {
            e.preventDefault();
            var close = modal.querySelector('[data-close]');
            if (close) close.click();
            return;
        }

        if (typing) {
            if (k === 'Escape') { try { t.blur(); } catch (err) {} }
            return;
        }
        // Video fokusda bo'lsa - o'z boshqaruvini ishlatadi
        if (tag === 'VIDEO') return;

        var dir = k === 'ArrowLeft' ? 'left'
                : k === 'ArrowRight' ? 'right'
                : k === 'ArrowUp' ? 'up'
                : k === 'ArrowDown' ? 'down' : null;
        if (!dir) return;
        e.preventDefault();
        move(dir);
    }

    document.addEventListener('keydown', onKey, true);

    // Modal ochilganda fokusni unga olib kirish
    document.addEventListener('wc:modalOpen', function () {
        setTimeout(function () {
            var modal = document.getElementById('modal');
            if (!modal || modal.hidden) return;
            var list = scopeList();
            if (list.length) focusEl(list[0]);
        }, 40);
    });

    // Boshlanishida fokus qayergadir qo'yiladi (pult darhol ishlashi uchun)
    document.addEventListener('DOMContentLoaded', function () {
        if (!isTV() || isReels()) return;
        setTimeout(function () {
            var el = document.querySelector('#igSide .ig-item.active')
                  || document.querySelector('#igSide .ig-item')
                  || document.querySelector('.card');
            focusEl(el);
        }, 250);
    });
})();
