/* ==========================================================================
   upload-page.js — kontent yuklash sahifasi (bosqichli, Instagram uslubi)
   --------------------------------------------------------------------------
   Bosqichlar:
     1) Format + fayl      — format kartalari va fayl tanlash
     2) Ko'rish             — preview va muqova (cover) kadrini tanlash
     3) Tavsif              — sarlavha, izoh, film bilan bog'lash
     4) Joylashtirish       — ko'rib chiqish + nashr

   QORALAMA: matn/meta localStorage'ga avtosaxlanadi; fayl va muqova
   tiklanmaydi (brauzer ularni saqlay olmaydi) — UI da tushuntiriladi.

   TEZKOR YUKLASH (2 bosqichli server oqimi):
     · Fayl tanlanganda darhol `api/upload.php?stage=media` ga yuboriladi
       va serverdagi "staging" papkasiga saqlanadi (token qaytariladi).
     · 2- va 3-bosqichda foydalanuvchi caption yozadi — shu vaqt ichida
       baytlar yo'ladi (foydalanuvchi yuklashni KUTMAYDIGAN bo'ladi).
     · 4-bosqichda faqat metadata yuboriladi (`stage=publish`) va server
       faylni Telegram kanalga joylaydi.

   THUMBNAIL — klientda yaratiladi (serverda ffmpeg yo'q):
     video → <video> dan kadr ajratilib canvas'ga chiziladi;
     image → o'z rasmi.
   ========================================================================== */
(function () {
    'use strict';

    var form = document.getElementById('upForm');
    if (!form) return;                       // kanal sozlanmagan

    // --------------------------------------------------------------- config
    var FORMAT = {
        reel:  { label: 'Reels',      icon: '\u{1F4E5}', ratio: '9:16', maxMb: 50,  multiple: false, maxItems: 1,  kind: 'video' },
        post:  { label: 'Rasm post',  icon: '\u{1F5BC}', ratio: '1:1',  maxMb: 12,  multiple: true,  maxItems: 10, kind: 'image' },
        video: { label: 'Uzun video', icon: '\u{1F4FA}', ratio: '16:9', maxMb: 200, multiple: false, maxItems: 1,  kind: 'video' }
    };
    var ACCEPT = {
        video: 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov',
        image: 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif'
    };
    var STEP_TITLES = { 1: 'Keyingi', 2: 'Keyingi', 3: 'Keyingi', 4: 'Joylashtirish' };

    // ----------------------------------------------------------------- refs
    var drop    = document.getElementById('upDrop');
    var fileEl  = document.getElementById('upFile');
    var title   = document.getElementById('upTitle');
    var desc    = document.getElementById('upDesc');
    var search  = document.getElementById('srcSearch');
    var results = document.getElementById('srcResults');
    var chip    = document.getElementById('srcChip');
    var cidEl   = document.getElementById('upContentId');
    var msg     = document.getElementById('upMsg');
    var prog    = document.getElementById('upProgress');
    var bar     = document.getElementById('upBar');
    var progTxt = document.getElementById('upProgText');
    var strip   = document.getElementById('upStrip');
    var info    = document.getElementById('upFiles');
    var thumbBox = document.getElementById('upThumb');
    var thumbImg = document.getElementById('upThumbImg');
    var thumbAsp = document.getElementById('upThumbFrame');
    var thumbSeek = document.getElementById('upThumbSeek');
    var thumbVal = document.getElementById('upThumbVal');
    var thumbRe  = document.getElementById('upThumbRe');
    var thumbTime = document.getElementById('upThumbTime');
    var stageBox = document.getElementById('upStage');
    var stageBar = document.getElementById('upStageBar');
    var stageTxt = document.getElementById('upStageText');
    var review   = document.getElementById('upReview');
    var nextBtn  = document.getElementById('upNext');
    var backBtn  = document.getElementById('upBack');
    var stepEls  = document.querySelectorAll('#upSteps .up-step');
    var panels   = document.querySelectorAll('.up-panel');
    var draftNote = document.getElementById('upDraftNote');
    var draftText = document.getElementById('upDraftText');
    var suggest  = document.getElementById('upSuggest');

    var esc = function (s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    var fmtMb = function (b) { return (Number(b || 0) / 1048576).toFixed(1) + ' MB'; };
    var fmtTime = function (s) {
        s = Math.max(0, Math.floor(Number(s) || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };

    var state = {
        step: 1,
        format: 'reel',
        files: [],
        poster: null,        // Blob (video kadr)
        posterUrl: null,     // ObjectURL (preview)
        width: 0,
        height: 0,
        duration: 0,
        videoUrl: null,
        picked: null,
        // ---- bosqichli yuklash holati ----
        upload: { xhr: null, token: '', pct: 0, done: false, error: '', size: 0 }
    };

    function showMsg(t, kind) {
        if (!msg) return;
        msg.hidden = false;
        msg.textContent = t;
        msg.className = 'up-msg ' + (kind || '');
    }
    function clearMsg() { if (msg) { msg.hidden = true; msg.textContent = ''; } }

    // =====================================================================
    //  0a) QORALAMA (faqat matn / meta — fayl tiklanmaydi)
    // =====================================================================
    var DRAFT_KEY = 'wc_upload_draft_v1';
    var draftTimer = null;
    var published = false;

    function draftKey() {
        var owner = 'anon';
        try {
            if (window.WCLib && typeof WCLib.owner === 'function') owner = WCLib.owner();
        } catch (e) {}
        return DRAFT_KEY + ':' + owner;
    }
    function draftRead() {
        try { return JSON.parse(localStorage.getItem(draftKey()) || 'null') || null; }
        catch (e) { return null; }
    }
    function draftShow(text) {
        if (!draftNote) return;
        draftNote.hidden = false;
        if (draftText && text) draftText.textContent = text;
    }
    function draftWrite() {
        var d = {
            format: state.format,
            title: (title && title.value) || '',
            desc: (desc && desc.value) || '',
            contentId: (cidEl && cidEl.value) || '',
            picked: state.picked ? {
                id: state.picked.id,
                title: state.picked.title || '',
                category: state.picked.category || ''
            } : null,
            at: Date.now()
        };
        if (!d.title && !d.desc && !d.contentId && !d.picked) {
            try { localStorage.removeItem(draftKey()); } catch (e) {}
            return;
        }
        try { localStorage.setItem(draftKey(), JSON.stringify(d)); } catch (e) {}
        draftShow('Qoralama saqlandi: matn va ma’lumotlar tiklanadi. Fayl hamda muqova saqlanmaydi — ularni qayta tanlash kerak.');
    }
    function draftSchedule() {
        if (draftTimer) clearTimeout(draftTimer);
        draftTimer = setTimeout(function () { draftTimer = null; draftWrite(); }, 350);
    }
    function draftClear() {
        if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
        try { localStorage.removeItem(draftKey()); } catch (e) {}
    }
    function draftRestore() {
        var d = draftRead();
        if (!d) return;
        if (FORMAT[d.format]) {
            state.format = d.format;
            document.querySelectorAll('.up-format').forEach(function (b) {
                b.setAttribute('aria-pressed', b.dataset.format === state.format ? 'true' : 'false');
            });
            if (fileEl) {
                fileEl.setAttribute('accept', ACCEPT[FORMAT[state.format].kind]);
                fileEl.multiple = FORMAT[state.format].multiple;
            }
        }
        if (title) title.value = d.title || '';
        if (desc) desc.value = d.desc || '';
        if (cidEl) cidEl.value = d.contentId || '';
        if (d.picked && d.picked.id) {
            state.picked = d.picked;
            paintChip(d.picked);
        }
        draftShow('Qoralama tiklandi: sarlavha, izoh va bog‘langan film qaytarildi. Faylni qayta tanlang (fayl saqlanmaydi).');
    }

    // =====================================================================
    //  0) BOSQICHLAR
    // =====================================================================
    function paintSteps() {
        stepEls.forEach(function (el) {
            var n = parseInt(el.dataset.step, 10) || 0;
            el.classList.toggle('is-active', n === state.step);
            el.classList.toggle('is-done', n < state.step);
        });
        panels.forEach(function (p) {
            p.hidden = (parseInt(p.dataset.panel, 10) || 0) !== state.step;
        });
        if (backBtn) backBtn.hidden = state.step === 1;
        if (nextBtn) {
            nextBtn.textContent = STEP_TITLES[state.step] || 'Keyingi';
            nextBtn.disabled = false;
        }
        if (state.step === 4) paintReview();
        // Sahifa yuqoriga — har bosqich boshida.
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    }

    function goStep(n) {
        state.step = Math.max(1, Math.min(4, n));
        paintSteps();
    }

    // =====================================================================
    //  1) FORMAT
    // =====================================================================
    document.querySelectorAll('.up-format').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = btn.dataset.format;
            if (!FORMAT[id] || id === state.format) return;
            state.format = id;
            document.querySelectorAll('.up-format').forEach(function (b) {
                b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            fileEl.setAttribute('accept', ACCEPT[FORMAT[id].kind]);
            fileEl.multiple = FORMAT[id].multiple;
            resetMedia();
            paintDrop();
            draftSchedule();
        });
    });

    function paintDrop() {
        if (!drop) return;
        var f = FORMAT[state.format];
        var iconEl  = drop.querySelector('.up-drop-icon');
        var textEl  = drop.querySelector('.up-drop-text');
        var hintEl  = drop.querySelector('.up-drop-hint');
        if (state.files.length) return;
        if (iconEl) iconEl.textContent = f.icon;
        if (textEl) textEl.textContent = f.kind === 'image'
            ? 'Rasm tanlang' + (f.multiple ? ' (bir nechta mumkin)' : '')
            : 'Videoni tanlang yoki shu yerga tashlang';
        if (hintEl) hintEl.textContent = (f.kind === 'image'
            ? 'JPG · PNG · WEBP · GIF'
            : 'MP4 · WEBM · MOV') + ' — ' + f.maxMb + ' MB gacha'
            + (f.multiple ? ', ' + f.maxItems + ' tagacha' : '');
    }

    // =====================================================================
    //  2) FAYLLAR
    // =====================================================================
    function resetMedia() {
        state.files = [];
        state.poster = null;
        state.width = 0;
        state.height = 0;
        state.duration = 0;
        if (state.videoUrl) { URL.revokeObjectURL(state.videoUrl); state.videoUrl = null; }
        if (state.posterUrl) { URL.revokeObjectURL(state.posterUrl); state.posterUrl = null; }
        if (fileEl) fileEl.value = '';
        if (thumbBox) thumbBox.hidden = true;
        if (strip) strip.innerHTML = '';
        if (info) info.hidden = true;
        if (drop) drop.classList.remove('has');
        uploadReset();
        paintDrop();
    }

    // Yangi tanlangan fayllarni qabul qiladi.
    //   · Ko'p rasmli rejimda (`append`) avvalgi tanlovga QO'SHILADI.
    //   · Boshqa hollarda oldingi tanlov almashtiriladi.
    function setFiles(list, append) {
        var f = FORMAT[state.format];
        var arr = Array.prototype.slice.call(list || []);

        if (!arr.length) return;

        if (!f.multiple) arr = arr.slice(0, 1);

        // Almashtirish rejimida eski tanlov va resurslar tozalanadi.
        if (!f.multiple || !append) resetMedia();

        var added = 0;
        for (var i = 0; i < arr.length; i++) {
            var file = arr[i];
            var isImg = /^image\//.test(file.type)
                || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
            var isVid = /^video\//.test(file.type)
                || /\.(mp4|webm|mov)$/i.test(file.name);

            if (f.kind === 'image' && !isImg) {
                showMsg('✕ Faqat rasm (JPG / PNG / WEBP / GIF) qabul qilinadi', 'err');
                continue;
            }
            if (f.kind === 'video' && !isVid) {
                showMsg('✕ Faqat video (MP4 / WEBM / MOV) qabul qilinadi', 'err');
                continue;
            }
            if (file.size > f.maxMb * 1048576) {
                showMsg('✕ «' + file.name + '» ' + f.maxMb + ' MB dan katta', 'err');
                continue;
            }
            if (file.size === 0) {
                showMsg('✕ «' + file.name + '» bo‘sh fayl', 'err');
                continue;
            }

            // Takroriy faylni qo'shmaymiz (nom + hajm + o'zgargan vaqt).
            var dup = state.files.some(function (x) {
                return x.name === file.name && x.size === file.size
                    && x.lastModified === file.lastModified;
            });
            if (dup) continue;

            if (state.files.length >= f.maxItems) {
                showMsg('✕ Ko‘pi bilan ' + f.maxItems + ' ta fayl mumkin', 'err');
                break;
            }
            state.files.push(file);
            added++;
        }

        if (!state.files.length || !added) return;

        clearMsg();
        paintFiles();
        if (state.format === 'post') {
            buildStrip();
            hideThumb();
        } else {
            if (strip) strip.innerHTML = '';
            buildThumb(state.files[0]);
        }
        // Fayl darhol serverga yuboriladi — foydalanuvchi caption yozayotgan
        // paytda baytlar yo'ladi.
        startUpload();
    }

    function paintFiles() {
        if (!info || !drop) return;
        var f = FORMAT[state.format];
        var first = state.files[0];
        drop.classList.add('has');
        var iconEl = drop.querySelector('.up-drop-icon');
        var textEl = drop.querySelector('.up-drop-text');
        var hintEl = drop.querySelector('.up-drop-hint');
        if (iconEl) iconEl.textContent = '\u2714';
        if (state.files.length > 1) {
            if (textEl) textEl.textContent = state.files.length + ' ta rasm tanlandi';
            if (hintEl) hintEl.textContent = 'Birinchi rasm — asosiy (preview)';
        } else {
            if (textEl) textEl.textContent = first.name;
            if (hintEl) hintEl.textContent = fmtMb(first.size)
                + (state.width ? ' · ' + state.width + '×' + state.height : '')
                + (state.duration ? ' · ' + fmtTime(state.duration) : '')
                + ' · yuborishga tayyor';
        }
        info.hidden = false;
        var total = state.files.reduce(function (a, b) { return a + b.size; }, 0);
        info.innerHTML = state.files.length + ' ta fayl · jami <b>' + fmtMb(total) + '</b>'
            + ' · format <b>' + f.label + '</b>';
    }

    // --------------------------------------------- galereya (carousel) ko'rinishi
    function buildStrip() {
        if (!strip) return;
        strip.querySelectorAll('.up-strip-item').forEach(function (it) {
            if (it.dataset.url) URL.revokeObjectURL(it.dataset.url);
        });
        strip.innerHTML = '';
        state.files.forEach(function (file, i) {
            var url = URL.createObjectURL(file);
            var item = document.createElement('div');
            item.className = 'up-strip-item' + (i === 0 ? ' is-main' : '');
            // Galereya tartibi: birinchi rasm asosiy (preview) hisoblanadi.
            // Tartib o'zgarganda fayllar qayta yuboriladi (mavjud mexanizm).
            var move = state.files.length > 1
                ? '<span class="up-strip-controls">'
                    + '<button type="button" class="up-strip-move" data-dir="-1" title="Chapga surish"'
                    + (i === 0 ? ' disabled' : '') + '>&#8249;</button>'
                    + '<button type="button" class="up-strip-move" data-dir="1" title="O‘ngga surish"'
                    + (i === state.files.length - 1 ? ' disabled' : '') + '>&#8250;</button>'
                    + '</span>'
                : '';
            item.innerHTML =
                '<img src="' + esc(url) + '" alt="">' +
                (i === 0 ? '<span class="up-strip-badge">ASOSIY</span>' : '') +
                move +
                (state.files.length > 1
                    ? '<button type="button" class="up-strip-x" title="Olib tashlash"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
                    : '');
            strip.appendChild(item);
            item.dataset.url = url;
            var x = item.querySelector('.up-strip-x');
            if (x) {
                x.addEventListener('click', function () {
                    var idx = state.files.indexOf(file);
                    if (idx < 0) return;
                    URL.revokeObjectURL(url);
                    state.files.splice(idx, 1);
                    if (!state.files.length) { resetMedia(); return; }
                    buildStrip();
                    paintFiles();
                    startUpload();          // fayl o'zgargani — qayta yuklaymiz
                });
            }
            item.querySelectorAll('.up-strip-move').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var from = state.files.indexOf(file);
                    var to = from + (Number(btn.dataset.dir) || 0);
                    if (from < 0 || to < 0 || to >= state.files.length) return;
                    var moved = state.files.splice(from, 1)[0];
                    state.files.splice(to, 0, moved);
                    buildStrip();
                    paintFiles();
                    startUpload();          // yangi tartib serverga qayta yuboriladi
                });
            });
        });
    }

    // =====================================================================
    //  3) THUMBNAIL (canvas)
    // =====================================================================
    function showThumb(src) {
        if (!thumbBox) return;
        if (state.posterUrl) { URL.revokeObjectURL(state.posterUrl); state.posterUrl = null; }
        state.posterUrl = src;
        thumbBox.hidden = false;
        if (thumbImg) thumbImg.src = src;
        if (thumbAsp) thumbAsp.dataset.aspect = FORMAT[state.format].ratio;
    }
    function hideThumb() { if (thumbBox) thumbBox.hidden = true; }

    function buildThumb(file) {
        var url = URL.createObjectURL(file);
        state.videoUrl = url;
        var v = document.createElement('video');
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        v.src = url;
        try { v.load(); } catch (e) { /* brauzer avtomatik yuklaydi */ }

        v.onloadedmetadata = function () {
            state.width = v.videoWidth || 0;
            state.height = v.videoHeight || 0;
            state.duration = Math.round(v.duration || 0);
            var sliderOk = state.duration > 5;
            if (thumbSeek) {
                thumbSeek.disabled = !sliderOk;
                thumbSeek.hidden = !sliderOk;
                thumbSeek.max = Math.max(0, state.duration - 1);
                thumbSeek.value = Math.min(1, Math.max(0, state.duration * 0.1));
            }
            if (thumbTime) thumbTime.hidden = !sliderOk;
            paintFiles();
            var t = (thumbSeek && !thumbSeek.hidden)
                ? Number(thumbSeek.value)
                : Math.min(1, state.duration * 0.1);
            seekAndDraw(v, t);
        };
        v.onerror = function () {
            // Kodlashni ko'ra olmadi — server tomondagi fallback ishlaydi.
            hideThumb();
        };
    }

    function seekAndDraw(video, t) {
        var done = false;
        var t0 = Math.max(0, Math.min(t || 0, Math.max(0, (video.duration || 0) - 0.1)));

        var finish = function () {
            if (done) return;
            if (!video.videoWidth || video.readyState < 2) return;
            done = true;
            drawFrame(video);
        };
        ['seeked', 'loadeddata', 'canplay'].forEach(function (ev) {
            video.addEventListener(ev, finish);
        });

        if (thumbVal) thumbVal.textContent = fmtTime(t0);
        try {
            video.currentTime = t0 < 0.05 ? 0.04 : t0;
        } catch (e) {
            finish();
        }

        window.setTimeout(finish, 350);
        window.setTimeout(finish, 1200);
        window.setTimeout(function () {
            if (!done) { done = true; hideThumb(); }
        }, 6000);
    }

    function drawFrame(video) {
        var vw = video.videoWidth || 1280;
        var vh = video.videoHeight || 720;

        var SIZE = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1280, 720] };
        var box = SIZE[FORMAT[state.format].ratio] || SIZE['16:9'];
        var tw = box[0], th = box[1];

        var scale = Math.max(tw / vw, th / vh);
        var cw = vw * scale;
        var chh = vh * scale;
        var sx = (vw - cw) / 2;
        var sy = (vh - chh) / 2;

        var c = document.createElement('canvas');
        c.width = tw;
        c.height = th;
        var ctx = c.getContext('2d');
        try {
            ctx.drawImage(video, sx, sy, cw, chh, 0, 0, tw, th);
        } catch (e) {
            hideThumb();
            return;
        }

        if (c.toBlob) {
            c.toBlob(function (blob) {
                if (!blob) { hideThumb(); return; }
                state.poster = blob;
                showThumb(URL.createObjectURL(blob));
            }, 'image/jpeg', 0.82);
        } else {
            hideThumb();
        }
    }

    function capture(video, t) {
        seekAndDraw(video, t);
    }

    if (thumbSeek) {
        var onSeekInput = function () {
            if (thumbVal) thumbVal.textContent = fmtTime(thumbSeek.value);
        };
        var onSeekChange = function () {
            if (!state.videoUrl) return;
            var v = document.createElement('video');
            v.preload = 'auto';
            v.muted = true;
            v.playsInline = true;
            v.src = state.videoUrl;
            v.onloadeddata = function () { capture(v, Number(thumbSeek.value)); };
            v.onerror = function () { hideThumb(); };
        };
        thumbSeek.addEventListener('input', onSeekInput);
        thumbSeek.addEventListener('change', onSeekChange);
    }
    if (thumbRe) {
        thumbRe.addEventListener('click', function () {
            if (state.files[0] && FORMAT[state.format].kind === 'video') {
                buildThumb(state.files[0]);
            }
        });
    }

    // ------------------------------------------------------- fayl tanlash
    if (drop) {
        drop.addEventListener('click', function () { fileEl.click(); });
        drop.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            fileEl.click();
        });
    }
    if (fileEl) fileEl.addEventListener('change', function () {
        setFiles(this.files, true);
        this.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
        if (drop) drop.addEventListener(ev, function (e) {
            e.preventDefault(); drop.classList.add('over');
        });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
        if (drop) drop.addEventListener(ev, function (e) {
            e.preventDefault(); drop.classList.remove('over');
        });
    });
    if (drop) {
        drop.addEventListener('drop', function (e) {
            var dt = e.dataTransfer;
            if (dt && dt.files) setFiles(dt.files, true);
        });
    }

    // =====================================================================
    //  4) BOSQICHLI YUKLASH (stage=media → stage=publish)
    // =====================================================================
    function uploadReset() {
        if (state.upload.xhr) {
            try { state.upload.xhr.abort(); } catch (e) {}
        }
        state.upload.xhr = null;
        state.upload.token = '';
        state.upload.pct = 0;
        state.upload.done = false;
        state.upload.error = '';
        state.upload.size = 0;
        if (stageBox) {
            stageBox.hidden = true;
            stageBox.classList.remove('is-done', 'is-err');
        }
        if (stageBar) stageBar.style.width = '0%';
    }

    function stagePaint(text, cls) {
        if (!stageBox) return;
        stageBox.hidden = false;
        stageBox.classList.remove('is-done', 'is-err');
        if (cls) stageBox.classList.add(cls);
        if (stageTxt) stageTxt.textContent = text;
    }

    /** Faylni serverga yuboradi (staging) — foydalanuvchi yozayotgan paytda. */
    function startUpload() {
        if (!state.files.length) return;
        uploadReset();

        var fd = new FormData();
        fd.append('format', state.format);
        state.files.forEach(function (file) { fd.append('media[]', file); });
        if (state.width)  fd.append('width', state.width);
        if (state.height) fd.append('height', state.height);
        if (state.duration) fd.append('duration', state.duration);
        // MTProto (brauzer) foydalanuvchilarida PHP sessiyasi yo'q — server
        // foydalanuvchini `tg_me` orqali aniqlaydi. Bu bosqichda ham kerak.
        try {
            var me = localStorage.getItem('wc_tg_me_v1');
            if (me) fd.append('tg_me', me);
        } catch (e) { /* localStorage yo'q */ }

        var total = state.files.reduce(function (a, b) { return a + b.size; }, 0);
        var xhr = new XMLHttpRequest();
        state.upload.xhr = xhr;
        xhr.open('POST', 'api/upload.php?stage=media');

        stagePaint('Fayl serverga yuborilmoqda… 0%');

        xhr.upload.onprogress = function (e) {
            if (!e.lengthComputable) return;
            var p = Math.min(100, e.loaded / e.total * 100);
            state.upload.pct = p;
            if (stageBar) stageBar.style.width = p.toFixed(0) + '%';
            if (stageTxt) {
                stageTxt.textContent = 'Fayl serverga yuborilmoqda… ' + p.toFixed(0) + '% · '
                    + fmtMb(e.loaded) + ' / ' + fmtMb(e.total);
            }
        };

        xhr.onload = function () {
            var d = {};
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            state.upload.xhr = null;
            if (xhr.status >= 200 && xhr.status < 300 && d.success && d.token) {
                state.upload.token = d.token;
                state.upload.done = true;
                state.upload.size = d.size || total;
                if (stageBar) stageBar.style.width = '100%';
                stagePaint('✓ Fayl tayyor — endi sizga faqat "Joylashtirish" qoladi', 'is-done');
            } else {
                state.upload.error = d.message || ('Xato ' + xhr.status);
                stagePaint('✕ ' + state.upload.error, 'is-err');
            }
        };
        xhr.onerror = function () {
            state.upload.xhr = null;
            state.upload.error = 'Ulanish xatosi';
            stagePaint('✕ Ulanish xatosi — faylni qayta tanlang', 'is-err');
        };
        xhr.onabort = function () { state.upload.xhr = null; };

        xhr.send(fd);
    }

    /** 4-bosqich uchun: nima nashr qilinayotganini ko'rsatadi. */
    function paintReview() {
        if (!review) return;
        var f = FORMAT[state.format];
        var thumb = state.posterUrl
            ? '<img src="' + esc(state.posterUrl) + '" alt="">'
            : (state.files[0] && /^image\//.test(state.files[0].type)
                ? '<img src="' + esc(URL.createObjectURL(state.files[0])) + '" alt="">'
                : '<span style="display:grid;place-items:center;height:100%;font-size:24px">'
                  + f.icon + '</span>');

        var meta = [];
        meta.push(f.label + ' · ' + f.ratio);
        if (state.files.length) {
            var total = state.files.reduce(function (a, b) { return a + b.size; }, 0);
            meta.push(fmtMb(total));
        }
        if (state.duration) meta.push(fmtTime(state.duration));
        if (state.upload.done) {
            meta.push(state.upload.error ? '✕ ' + state.upload.error : '✓ Fayl tayyor');
        } else if (state.upload.pct) {
            meta.push('Yuklanmoqda… ' + Math.round(state.upload.pct) + '%');
        }
        if (state.picked) meta.push('🎬 ' + state.picked.title);

        review.innerHTML =
            '<span class="up-review-thumb">' + thumb + '</span>'
            + '<span class="up-review-body">'
            + '<span class="up-review-title">' + esc((title && title.value) || (state.files[0] && state.files[0].name) || 'Reels') + '</span>'
            + '<span class="up-review-meta">' + esc(meta.join(' · ')) + '</span>'
            + '</span>';
    }

    /** Faylni Telegram kanalga yuborish + reels yozuvini yaratish. */
    function publish() {
        if (!state.upload.done) {
            showMsg('✕ Fayl hali yuklanmagan. Biroz kutib turing yoki qayta tanlang.', 'err');
            return;
        }
        if (!state.upload.token) {
            showMsg('✕ Yuklash sessiyasi topilmadi. Faylni qayta tanlang.', 'err');
            return;
        }

        var fd = new FormData();
        fd.append('token', state.upload.token);
        fd.append('title', title ? title.value : '');
        fd.append('description', desc ? desc.value : '');
        fd.append('content_id', cidEl ? cidEl.value : '');
        if (state.width)  fd.append('width', state.width);
        if (state.height) fd.append('height', state.height);
        if (state.duration) fd.append('duration', state.duration);
        if (state.poster) {
            var ext = state.poster.type === 'image/png' ? 'png' : 'jpg';
            fd.append('poster', state.poster, 'poster.' + ext);
        }
        try {
            var me = localStorage.getItem('wc_tg_me_v1');
            if (me) fd.append('tg_me', me);
        } catch (e) { /* localStorage yo'q */ }

        if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Yuborilmoqda…'; }
        if (prog) {
            prog.hidden = false;
            var pb = prog.querySelector('.up-progress-bar');
            if (pb) pb.classList.add('is-indeterminate');
        }
        if (progTxt) progTxt.textContent = 'Telegram kanalga yuborilmoqda…';

        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'api/upload.php?stage=publish');

        xhr.onload = function () {
            var d = {};
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            if (xhr.status >= 200 && xhr.status < 300 && d.success) {
                if (progTxt) progTxt.textContent = '100%';
                showMsg((d.carousel ? '✓ Galereya joylandi! ' : '✓ ')
                    + (d.message || 'Joylandi!'), 'ok');
                published = true;
                draftClear();
                if (draftText) draftText.textContent = 'Joylashtirildi — qoralama o‘chirildi.';
                if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = '✓ Yuborildi'; }
                setTimeout(function () {
                    location.href = state.format === 'post' ? 'profile.php' : 'reels.php';
                }, 1400);
            } else {
                if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Joylashtirish'; }
                var pb = prog && prog.querySelector('.up-progress-bar');
                if (pb) pb.classList.remove('is-indeterminate');
                if (prog) prog.hidden = true;
                showMsg('✕ ' + (d.message || ('Xato ' + xhr.status)), 'err');
            }
        };
        xhr.onerror = function () {
            if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Joylashtirish'; }
            showMsg('✕ Ulanish xatosi. Internetni tekshirib, qayta urinib ko‘ring.', 'err');
        };
        xhr.ontimeout = function () {
            if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Joylashtirish'; }
            showMsg('✕ Vaqt o‘tib ketdi. Qayta urinib ko‘ring.', 'err');
        };

        xhr.send(fd);
    }

    // =====================================================================
    //  5) KONTENT QIDIRUVI (film bilan bog'lash)
    // =====================================================================
    var timer = null;

    function clearPick() {
        state.picked = null;
        if (cidEl) cidEl.value = '';
        if (chip) { chip.hidden = true; chip.innerHTML = ''; }
        draftSchedule();
    }
    // Chip'ni alohida bo'yash — qoralama tiklaganda ham ishlatiladi.
    function paintChip(item) {
        if (!chip) return;
        chip.hidden = false;
        chip.innerHTML = '\u{1F3AC} ' + esc(item.title)
            + (item.category ? ' · ' + esc(item.category) : '')
            + ' <button type="button" title="Olib tashlash"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
        var b = chip.querySelector('button');
        if (b) b.addEventListener('click', function () {
            clearPick();
            if (search) search.value = '';
            if (search) search.focus();
            draftSchedule();
        });
    }
    function pick(item) {
        state.picked = item;
        if (cidEl) cidEl.value = item.id;
        if (results) results.hidden = true;
        if (title && !title.value.trim()) title.value = item.title || '';
        paintChip(item);
        draftSchedule();
    }
    async function doSearch(q) {
        if (!results) return;
        results.hidden = false;
        results.innerHTML = '<div class="empty">Qidirilmoqda…</div>';
        try {
            var res = await fetch('api/catalog.php?q=' + encodeURIComponent(q) + '&per_page=8', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin'
            });
            var d = await res.json();
            var items = (d && d.items) || [];
            if (!items.length) {
                results.innerHTML = '<div class="empty">Topilmadi — bo‘sh qoldirsangiz ham bo‘ladi</div>';
                return;
            }
            results.innerHTML = items.map(function (it, i) {
                return '<button type="button" data-i="' + i + '">'
                    + (it.poster ? '<img src="' + esc(it.poster) + '" alt="">' : '<img alt="">')
                    + '<span><span class="t">' + esc(it.title) + '</span>'
                    + '<span class="s">#' + it.id
                    + (it.category ? ' · ' + esc(it.category) : '')
                    + (it.year ? ' · ' + it.year : '') + '</span></span></button>';
            }).join('');
            results.querySelectorAll('button[data-i]').forEach(function (b) {
                b.addEventListener('click', function () { pick(items[Number(b.dataset.i)]); });
            });
        } catch (e) {
            results.innerHTML = '<div class="empty">Qidiruvda xatolik</div>';
        }
    }
    if (search) {
        search.addEventListener('input', function () {
            clearTimeout(timer);
            var q = search.value.trim();
            if (q.length < 1) { if (results) results.hidden = true; return; }
            timer = setTimeout(function () { doSearch(q); }, 250);
        });
        search.addEventListener('focus', function () {
            if (search.value.trim().length >= 1 && !state.picked) doSearch(search.value.trim());
        });
    }
    document.addEventListener('click', function (e) {
        if (results && !e.target.closest('#srcPick')) results.hidden = true;
    });

    // =====================================================================
    //  5a) #TEG / @MENTION TAKLIFLARI
    // =====================================================================
    // Teglar oddiy matn; foydalanuvchi qidiruvi mavjud `api/search.php`
    // (profiles) orqali. Hech qanday HTML server javobidan qo'yilmaydi —
    // faqat textContent, username esa qat'iy whitelist bilan tekshiriladi.
    var TAGS = ['#kino', '#anime', '#multfilm', '#reels', '#tavsiya',
                '#trend', '#uzbekcha', '#dramma', '#komediya', '#fantastika'];
    var sugItems = [], sugIndex = -1, sugTimer = null, sugSeq = 0;

    function hideSuggest() {
        if (suggest) { suggest.hidden = true; suggest.innerHTML = ''; }
        sugItems = []; sugIndex = -1;
    }
    function sugHighlight(i) {
        sugIndex = Math.max(0, Math.min(i, sugItems.length - 1));
        if (!suggest) return;
        Array.prototype.forEach.call(suggest.querySelectorAll('button'), function (b, n) {
            b.classList.toggle('is-on', n === sugIndex);
        });
    }
    function sugRender(kind) {
        if (!suggest) return;
        suggest.innerHTML = '';
        if (!sugItems.length) {
            var none = document.createElement('div');
            none.className = 'up-suggest-hint';
            none.textContent = kind === '@' ? 'Foydalanuvchi topilmadi' : 'Teg topilmadi';
            suggest.appendChild(none);
            suggest.hidden = false;
            return;
        }
        sugItems.forEach(function (it, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'option');
            var main = document.createElement('span');
            main.className = 'us-tag';
            main.textContent = it.label;
            b.appendChild(main);
            if (it.sub) {
                var sub = document.createElement('span');
                sub.className = 'us-sub';
                sub.textContent = it.sub;
                b.appendChild(sub);
            }
            // Klaviatura bilan tanlaganda karet o'rnini yo'qotmaymiz.
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () { sugApply(i); });
            suggest.appendChild(b);
        });
        suggest.hidden = false;
        sugHighlight(0);
    }
    function tokenAtCaret() {
        if (!desc) return null;
        var pos = desc.selectionStart;
        var before = desc.value.slice(0, pos);
        var m = /([#@])([^\s#@]{0,32})$/.exec(before);
        if (!m) return null;
        var q = m[2];
        if (m[1] === '@' && !/^[\p{L}\p{N}_]*$/u.test(q)) return null;
        return { kind: m[1], q: q, start: pos - m[0].length };
    }
    function sugApply(i) {
        var it = sugItems[i];
        if (!it || !desc) return;
        var t = tokenAtCaret();
        var start = t ? t.start : desc.selectionStart;
        var v = desc.value;
        var end = desc.selectionEnd;
        var text = it.label + ' ';
        desc.value = v.slice(0, start) + text + v.slice(end);
        var pos = start + text.length;
        try { desc.setSelectionRange(pos, pos); } catch (e) {}
        hideSuggest();
        desc.focus();
        draftSchedule();
    }
    function sugUpdate() {
        var t = tokenAtCaret();
        if (!t) { hideSuggest(); return; }
        var q = t.q.toLocaleLowerCase();
        if (t.kind === '#') {
            sugItems = TAGS.filter(function (tag) {
                return tag.toLocaleLowerCase().indexOf(q) >= 0;
            }).slice(0, 8).map(function (tag) { return { label: tag, sub: 'teg' }; });
            sugRender('#');
            return;
        }
        var bare = t.q;
        if (bare.length < 2) { hideSuggest(); return; }
        var seq = ++sugSeq;
        if (sugTimer) clearTimeout(sugTimer);
        sugTimer = setTimeout(function () {
            fetch('api/search.php?q=' + encodeURIComponent(bare) + '&limit=8', {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (r) { return r.ok ? r.json() : null; })
              .then(function (d) {
                  if (seq !== sugSeq) return;
                  var rows = (d && d.profiles) || [];
                  sugItems = [];
                  rows.forEach(function (p) {
                      var u = String(p.username || '').replace(/^@/, '');
                      if (!/^[A-Za-z0-9_]{2,32}$/.test(u)) return;
                      var name = [p.first_name, p.last_name].filter(Boolean).join(' ');
                      sugItems.push({ label: '@' + u, sub: name.slice(0, 24) });
                  });
                  sugRender('@');
              }).catch(function () { if (seq === sugSeq) { sugItems = []; sugRender('@'); } });
        }, 220);
    }
    if (desc) {
        desc.addEventListener('input', function () { draftSchedule(); sugUpdate(); });
        desc.addEventListener('click', sugUpdate);
        desc.addEventListener('keydown', function (e) {
            if (!suggest || suggest.hidden) return;
            if (e.key === 'Escape') { hideSuggest(); e.preventDefault(); }
            else if (e.key === 'ArrowDown') { sugHighlight(sugIndex + 1); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { sugHighlight(sugIndex - 1); e.preventDefault(); }
            else if (e.key === 'Enter' && sugItems.length) { sugApply(sugIndex >= 0 ? sugIndex : 0); e.preventDefault(); }
        });
    }
    document.addEventListener('click', function (e) {
        if (suggest && !e.target.closest('#upSuggest') && e.target !== desc) hideSuggest();
    });
    if (title) title.addEventListener('input', draftSchedule);
    window.addEventListener('pagehide', function () {
        if (!published && ((title && title.value) || (desc && desc.value) || (cidEl && cidEl.value))) draftWrite();
    });

    // =====================================================================
    //  6) AMAL TUGMASI (Keyingi / Orqaga)
    // =====================================================================
    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            clearMsg();
            if (state.step === 1) {
                if (!state.files.length) {
                    showMsg('✕ Avval fayl tanlang', 'err');
                    return;
                }
                if (state.upload.error) {
                    showMsg('✕ ' + state.upload.error + ' — faylni qayta tanlang', 'err');
                    return;
                }
                goStep(2);
                return;
            }
            if (state.step === 2) { goStep(3); return; }
            if (state.step === 3) { goStep(4); return; }
            publish();
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            if (state.step > 1) goStep(state.step - 1);
        });
    }

    draftRestore();
    paintDrop();
    paintSteps();
})();
