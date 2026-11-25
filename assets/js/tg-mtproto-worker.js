/*!
 * tg-mtproto-worker.js — minimal MTProto klientni Dedicated Web Worker'da
 * ============================================================================
 *
 * NIMA UCHUN:
 *   `tg-mtproto.js` AES-256-IGE/CTR shifrlash, SHA-256 va WebSocket oqimini
 *   bajaradi. Ilgari bu ish ASOSIY oqimda (main thread) ketardi: katta
 *   bo'lakni ochish paytida UI/animatsiya bir necha o'n ms "qotardi".
 *   Endi klient alohida Worker'da yashaydi:
 *     • WebSocket va shifrlash asosiy oqimdan tashqarida;
 *     • sahifa qotmaydi, scroll/animatsiya silliq qoladi;
 *     • bir nechta so'rov parallel ketganda ham UI javob beradi.
 *
 * MUHIM: bu Service Worker EMAS. Brauzer Service Worker'ni bo'sh turganda
 *   o'chirib yuboradi — WebSocket uziladi. Dedicated Worker esa sahifa
 *   yopilmaguncha yashaydi. Shuning uchun MTProto aynan shu yerda.
 *
 * PROTOKOL (sahifa <-> worker):
 *   init   { opts }                    -> ready { dcId, keyId }
 *   call   { id, method, args }        -> done { id, result } | fail { id, error }
 *   close  {}                          -> worker o'zi yopiladi
 *   worker -> open { dc }              (shu DC'ga WebSocket ochildi)
 *   worker -> fatal { error }          (import/init halokatli xatosi)
 *
 * XAVFSIZLIK: auth_key worker'ga faqat `postMessage` orqali bir marta
 *   uzatiladi; u hech qayerga yozilmaydi va sahifa yopilganda worker bilan
 *   birga yo'q bo'ladi. Worker boshqa origin'dagi skriptlarni yuklamaydi.
 *
 * O'CHIRISH: localStorage.setItem('wc_mtproto_worker', '0') — sahifa yana
 *   eski (main thread) yo'lga qaytadi.
 * ============================================================================
 */
'use strict';

(function () {
    var TgFast = null;
    var client = null;
    var closed = false;
    var openDcs = Object.create(null);

    function errText(e) {
        return String((e && (e.errorMessage || e.message)) || e || 'xato');
    }

    /**
     * `tg-mtproto.js` ni worker ichiga yuklaymiz.
     *
     * Versiya `?p=<filemtime>` orqali beriladi: `.htaccess` JS fayllarni
     * `immutable` bilan keshlaydi, shuning uchun versiyasiz import eski
     * nusxani olib qolishi mumkin edi.
     */
    function versionedScript(name) {
        var v = '';
        try {
            v = new URL(self.location.href).searchParams.get('p') || '';
        } catch (e) { v = ''; }
        return name + (v ? '?v=' + encodeURIComponent(v) : '');
    }

    try {
        importScripts(versionedScript('tg-mtproto.js'));
        TgFast = self.TgFast;
        if (!TgFast || typeof TgFast.createClient !== 'function') {
            throw new Error('TgFast topilmadi');
        }
    } catch (e) {
        self.postMessage({ type: 'fatal', error: 'importScripts: ' + errText(e) });
        return;
    }

    function noteOpen(dc) {
        var n = Number(dc) || 0;
        if (!(n > 0) || openDcs[n]) return;
        openDcs[n] = 1;
        self.postMessage({ type: 'open', dc: n });
    }

    /**
     * Uint8Array ni transferable qilib qadoqlaymiz.
     *
     * Agar u butun buffer egasi bo'lsa — nusxa olmasdan `transfer` qilamiz
     * (512 KB bo'lak uchun bu sezilarli). Aks holda kichik nusxa olamiz:
     * buffer'ning boshqa qismlari ham detach bo'lib qolmasligi kerak.
     */
    function packBytes(v) {
        if (!v || !v.length) {
            var empty = new Uint8Array(0);
            return { bytes: empty, transfer: [empty.buffer] };
        }
        var u8 = v instanceof Uint8Array ? v : new Uint8Array(v);
        if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
            return { bytes: u8, transfer: [u8.buffer] };
        }
        var copy = new Uint8Array(u8.length);
        copy.set(u8);
        return { bytes: copy, transfer: [copy.buffer] };
    }

    function finish(id, result) {
        if (result && result.__bytes) {
            var packed = packBytes(result.__bytes);
            self.postMessage({ type: 'done', id: id, result: packed.bytes }, packed.transfer);
            return;
        }
        self.postMessage({ type: 'done', id: id, result: result });
    }

    function fail(id, e) {
        self.postMessage({ type: 'fail', id: id, error: errText(e) });
    }

    function handleCall(d) {
        var id = d.id;
        var a = d.args || {};
        var p;

        if (!client) {
            fail(id, 'MTProto klient tayyor emas');
            return;
        }

        try {
            switch (d.method) {
                case 'warm':
                    p = client.warm(a.dc || undefined).then(function () {
                        noteOpen(a.dc || (client.session && client.session.dcId));
                        return true;
                    });
                    break;

                case 'getFile':
                    p = client.getFile(a.loc, a.off, a.limit).then(function (b) {
                        noteOpen(a.loc && a.loc.dcId);
                        return { __bytes: b };
                    });
                    break;

                case 'readRange':
                    p = client.readRange(a.loc, a.off, a.length, a.opts || {}).then(function (b) {
                        noteOpen(a.loc && a.loc.dcId);
                        return { __bytes: b };
                    });
                    break;

                case 'keepAlive':
                    p = client.keepAlive({ timeout: Number(a.timeout) || 8000 });
                    break;

                case 'setDcKey':
                    p = Promise.resolve(client.setDcKey(a.dc, a.key));
                    break;

                case 'dropDcKey':
                    p = Promise.resolve(client.dropDcKey(a.dc));
                    break;

                case 'hasDcKey':
                    p = Promise.resolve(client.hasDcKey(a.dc));
                    break;

                case 'isOpen':
                    p = Promise.resolve(client.isOpen(a.dc));
                    break;

                default:
                    fail(id, 'Noma\'lum metod: ' + String(d.method));
                    return;
            }
        } catch (e) {
            fail(id, e);
            return;
        }

        if (p && typeof p.then === 'function') {
            p.then(function (res) { finish(id, res); }, function (e) { fail(id, e); });
        } else {
            finish(id, p);
        }
    }

    self.onmessage = function (ev) {
        var d = ev.data || {};

        if (d.type === 'init') {
            if (client) {
                self.postMessage({
                    type: 'ready',
                    dcId: Number(client.session && client.session.dcId) || 0,
                    keyId: String(client.keyId || '')
                });
                return;
            }
            try {
                client = TgFast.createClient(d.opts || {});
                self.postMessage({
                    type: 'ready',
                    dcId: Number(client.session && client.session.dcId) || 0,
                    keyId: String(client.keyId || '')
                });
            } catch (e) {
                self.postMessage({ type: 'fatal', error: 'createClient: ' + errText(e) });
            }
            return;
        }

        if (d.type === 'close') {
            closed = true;
            try { if (client && client.close) client.close(); } catch (e) { /* jim */ }
            try { self.close(); } catch (e) { /* jim */ }
            return;
        }

        if (closed) return;
        if (d.type === 'call') handleCall(d);
    };
})();
