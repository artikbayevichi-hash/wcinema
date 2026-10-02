/* ============================================================
   js/player.js — Telegram Desktop–style video player
   Controls: vol+slider | ... | gear/pip/fs
   Seek bar: time | seek | -remaining
   Center play button overlay when paused.
   ============================================================ */

window.ROOT_URL = window.ROOT_URL || (window.APP && window.APP.base) || '/tele_uzdub';

(function () {
    'use strict';

    var ICONS = {
        play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15L20 12z"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
        volOn: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9v6h3.5L12 17.5v-11L7.5 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9.5a4 4 0 0 1 0 5"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17.5 7.5a7 7 0 0 1 0 9"/></svg>',
        volMute: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9v6h3.5L12 17.5v-11L7.5 9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9.5l4 5M19.5 9.5l-4 5"/></svg>',
        pip: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="11.5" y="12" width="7" height="5" rx="1.5" fill="currentColor"/></svg>',
        fs: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 3h6v6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 21H3v-6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 10l5-5"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 14l-5 5"/></svg>',
        fsExit: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 14h6v6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 10h-6V4"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 10l7-7"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 21l7-7"/></svg>',
        gear: '<svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96a7.72 7.72 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84c-.25 0-.43.17-.47.41l-.36 2.54c-.59.24-1.12.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.32-.09.65-.09.98s.03.66.09.98L2.86 13.6a.499.499 0 0 0 .12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.22.41.47.41h3.84c.25 0 .43-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
        cc: '<svg viewBox="0 0 24 24"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM8.5 14.8c-2.9 0-2.9-5.6 0-5.6 1.3 0 2.1.6 2.7 1.4l-1.5 1c-.3-.5-.6-.8-1.2-.8-.9 0-.9 2.4 0 2.4.6 0 .9-.3 1.2-.8l1.5 1c-.6.8-1.4 1.4-2.7 1.4zm7 0c-2.9 0-2.9-5.6 0-5.6 1.3 0 2.1.6 2.7 1.4l-1.5 1c-.3-.5-.6-.8-1.2-.8-.9 0-.9 2.4 0 2.4.6 0 .9-.3 1.2-.8l1.5 1c-.6.8-1.4 1.4-2.7 1.4z"/></svg>',
        replay: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>'
    };

    function parseConfig(root) {
        try {
            return JSON.parse(root.dataset.udpConfig || '{}');
        } catch (e) {
            return {};
        }
    }

    function fmtTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        sec = Math.floor(sec);
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        var mm = m < 10 ? '0' + m : '' + m;
        var ss = s < 10 ? '0' + s : '' + s;
        return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
    }

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    function initPlayer(root) {
        var video = root.querySelector('video');
        if (!video) return;

        var cfg = parseConfig(root);
        var S = cfg.strings || {};
        var isHls = !!(video.dataset.hls || video.dataset.hlsPending);
        var hls = null;

        root.classList.add('udp-init');

        /* ================= UI ================= */
        // Buffering
        var buffering = el('div', 'udp-buffering');
        buffering.appendChild(el('div', 'udp-spinner'));
        // "Video tayyorlanmoqda…" yozuvi — pollPending va login xolatlari
        // shu yerga yoziladi. (Asl uzdub faylida deklaratsiya yo'q edi — bug.)
        var bufferingLabel = el('div', 'udp-buffering-label');
        buffering.appendChild(bufferingLabel);
        var loaderImg = el('img', 'udp-loading-img');
        loaderImg.src = window.ROOT_URL + '/assets/loading-infinity.gif';
        loaderImg.alt = '';
        loaderImg.onload = function () {
            root.classList.add('udp-img-ready');
        };
        loaderImg.onerror = function () {
            loaderImg.remove();
        };
        buffering.appendChild(loaderImg);
        root.appendChild(buffering);

        // Title bar
        var titlebar = el('div', 'udp-titlebar');
        if (cfg.title) {
            titlebar.appendChild(el('div', 'udp-titlebar-title', cfg.title));
        }
        if (cfg.next) {
            var nextBtn = el('a', 'udp-titlebar-next', '&#9654; ' + (cfg.next.label || S.next_ep || 'Keyingi qism'));
            nextBtn.href = cfg.next.href;
            titlebar.appendChild(nextBtn);
        }
        root.appendChild(titlebar);

        // Skip intro
        var skipWrap = el('div', 'udp-skip');
        skipWrap.hidden = true;
        var skipBtn = el('button', 'udp-skip-btn', '&#9197; ' + (S.skip_intro || 'Intro\u2019ni o\u2019tkazib yuborish'));
        skipBtn.type = 'button';
        skipWrap.appendChild(skipBtn);
        root.appendChild(skipWrap);

        // Resume overlay
        var resumeOv = el('div', 'udp-resume');
        resumeOv.hidden = true;
        var resumeBox = el('div', 'udp-resume-box');
        resumeBox.appendChild(el('div', 'udp-resume-title', S.resume_title || 'Davom etasizmi?'));
        var resumeSub = el('div', 'udp-resume-sub', '');
        resumeBox.appendChild(resumeSub);
        var resumeBtns = el('div', 'udp-resume-btns');
        var resumeCont = el('button', 'udp-resume-continue', '&#9654; ' + (S.resume_continue || 'Davom etish'));
        resumeCont.type = 'button';
        var resumeRestart = el('button', 'udp-resume-restart', '&#8635; ' + (S.resume_restart || 'Boshidan'));
        resumeRestart.type = 'button';
        resumeBtns.appendChild(resumeCont);
        resumeBtns.appendChild(resumeRestart);
        resumeBox.appendChild(resumeBtns);
        resumeOv.appendChild(resumeBox);
        root.appendChild(resumeOv);

        // Error overlay
        var errOv = el('div', 'udp-error');
        errOv.hidden = true;
        errOv.appendChild(el('div', 'udp-error-icon', '&#9888;'));
        errOv.appendChild(el('div', 'udp-error-title', S.error_title || 'Video yuklanmadi'));
        errOv.appendChild(el('div', 'udp-error-sub', S.error_sub || 'Internet yoki server holatini tekshiring'));
        var retryBtn = el('button', 'udp-btn-retry', '&#10227; ' + (S.retry || 'Qayta urinish'));
        retryBtn.type = 'button';
        errOv.appendChild(retryBtn);
        root.appendChild(errOv);

        // Ended overlay
        var endedOv = el('div', 'udp-ended');
        endedOv.hidden = true;
        endedOv.appendChild(el('div', 'udp-ended-icon', '&#127916;'));
        endedOv.appendChild(el('div', 'udp-ended-title', S.ended_title || 'Video tugadi'));
        var endedBtns = el('div', 'udp-ended-btns');
        var replayBtn = el('button', 'udp-btn-replay', ICONS.replay + ' ' + (S.replay || 'Qayta ko\u2018rish'));
        replayBtn.type = 'button';
        endedBtns.appendChild(replayBtn);
        if (cfg.next) {
            var nextBtn2 = el('a', 'udp-btn-next-ep', '&#9654; ' + (cfg.next.label || S.next_ep || 'Keyingi qism'));
            nextBtn2.href = cfg.next.href;
            endedBtns.appendChild(nextBtn2);
        }
        endedOv.appendChild(endedBtns);
        root.appendChild(endedOv);

        /* ===== CONTROLS ===== */
        var controls = el('div', 'udp-controls');

        /* --- ROW 1: icons --- */
        var row1 = el('div', 'udp-controls-row1');

        // Row1 LEFT: Volume
        var row1Left = el('div', 'udp-controls-row1-left');
        var volWrap = el('div', 'udp-volume');
        var muteBtn = el('button', 'udp-btn udp-mute', ICONS.volOn);
        muteBtn.type = 'button';
        var volBar = el('div', 'udp-volume-bar');
        var volFill = el('div', 'udp-volume-fill');
        volBar.appendChild(volFill);
        volWrap.appendChild(muteBtn);
        volWrap.appendChild(volBar);
        row1Left.appendChild(volWrap);
        row1.appendChild(row1Left);

        // Row1 CENTER: Play/Pause
        var row1Center = el('div', 'udp-controls-row1-center');
        var playBtn = el('button', 'udp-btn udp-play', ICONS.play);
        playBtn.type = 'button';
        playBtn.title = S.play || 'Ijro etish';
        row1Center.appendChild(playBtn);
        row1.appendChild(row1Center);

        // Row1 RIGHT: fullscreen + pip + gear
        var row1Right = el('div', 'udp-controls-row1-right');

        var fsBtn = el('button', 'udp-btn udp-fs', ICONS.fs);
        fsBtn.type = 'button';
        fsBtn.title = S.fullscreen || 'To\'liq ekran';
        row1Right.appendChild(fsBtn);

        if (document.pictureInPictureEnabled) {
            var pipBtn = el('button', 'udp-btn udp-pip', ICONS.pip);
            pipBtn.type = 'button';
            pipBtn.title = S.pip || 'Kichik oyna';
            row1Right.appendChild(pipBtn);
        }

        var gearBtn = el('button', 'udp-btn udp-settings', ICONS.gear);
        gearBtn.type = 'button';
        gearBtn.title = S.settings || 'Sozlamalar';
        var qualityLabel = el('span', 'udp-quality-label', 'HD');
        qualityLabel.title = S.quality || 'Sifat';
        gearBtn.appendChild(qualityLabel);
        row1Right.appendChild(gearBtn);

        row1.appendChild(row1Right);
        controls.appendChild(row1);

        /* --- ROW 2: seek --- */
        var row2 = el('div', 'udp-controls-row2');

        var timeCurrent = el('span', 'udp-time udp-time-current', '00:00');
        row2.appendChild(timeCurrent);

        var seekWrap = el('div', 'udp-seek');
        var seekTrack = el('div', 'udp-seek-track');
        var seekBuffer = el('div', 'udp-seek-buffer');
        var seekProgress = el('div', 'udp-seek-progress');
        var seekThumb = el('div', 'udp-seek-thumb');
        seekTrack.appendChild(seekBuffer);
        seekTrack.appendChild(seekProgress);
        seekTrack.appendChild(seekThumb);
        seekWrap.appendChild(seekTrack);
        var seekTooltip = el('div', 'udp-seek-tooltip', '0:00');
        seekWrap.appendChild(seekTooltip);
        row2.appendChild(seekWrap);

        var timeRemaining = el('span', 'udp-time udp-time-remaining', '-00:00');
        row2.appendChild(timeRemaining);

        controls.appendChild(row2);
        root.appendChild(controls);

        // Settings menu (inside gear button)
        var menu = el('div', 'udp-menu');
        gearBtn.appendChild(menu);
        var menuBackdrop = el('div', 'udp-menu-backdrop');
        menuBackdrop.style.display = 'none';
        document.body.appendChild(menuBackdrop);

        var menuCloseT = null;
        function openMenu(name, viaHover) {
            var wasOpen = menu.classList.contains('udp-open');
            clearTimeout(menuCloseT);
            if (!wasOpen) {
                menu.classList.add('udp-visible');
                void menu.offsetWidth;
                renderMenu(name || 'speed');
                menu.classList.add('udp-open');
            }
            if (!viaHover) menuBackdrop.style.display = 'block';
            root.classList.add('udp-ui-visible');
        }
        function closeMenu() {
            if (!menu.classList.contains('udp-visible')) return;
            clearTimeout(menuCloseT);
            menu.classList.remove('udp-open');
            menuBackdrop.style.display = 'none';
            menuCloseT = setTimeout(function () {
                menu.classList.remove('udp-visible');
            }, 180);
        }

        /* ===== Speed menu data & helpers ===== */
        var SPEED_VARIANTS = [
            { v: 0.5, name: 'Slow' },
            { v: 1.0, name: 'Normal' },
            { v: 1.2, name: 'Medium' },
            { v: 1.5, name: 'Fast' },
            { v: 1.7, name: 'Very fast' },
            { v: 2.0, name: 'Super fast' }
        ];
        function fmtRate(r) {
            if (!isFinite(r)) r = 1;
            var n = Math.round(r * 10) / 10;
            return (Math.abs(n - Math.round(n)) < 0.001 && n !== 1 ? String(Math.round(n)) : n.toFixed(1)) + 'x';
        }
        function clampRate(r) {
            if (!isFinite(r)) return 1;
            return Math.max(0.5, Math.min(2, Math.round(r * 10) / 10));
        }
        function syncSpeedSlider(slider) {
            var pct = ((parseFloat(slider.value) - 0.5) / 1.5) * 100;
            slider.style.setProperty('--udp-sfill', Math.max(0, Math.min(100, pct)).toFixed(1) + '%');
        }

        function menuItem(label, active, onClick, arrow) {
            var b = el('button', 'udp-menu-item' + (active ? ' udp-active' : ''));
            b.type = 'button';
            b.innerHTML = '<span>' + label + '</span><span class="udp-menu-check">&#10003;</span>' + (arrow ? '<span class="udp-menu-arrow">&#10095;</span>' : '');
            b.onclick = onClick;
            return b;
        }

        function renderMenu(name) {
            menu.innerHTML = '';
            if (name === 'speed') {
                /* --- Top: value + range slider --- */
                var top = el('div', 'udp-speed-top');
                var val = el('span', 'udp-speed-value', fmtRate(video.playbackRate));
                var slider = el('input', 'udp-speed-slider');
                slider.type = 'range';
                slider.min = '0.5';
                slider.max = '2';
                slider.step = '0.1';
                slider.value = String(clampRate(video.playbackRate));
                syncSpeedSlider(slider);
                top.appendChild(val);
                top.appendChild(slider);
                menu.appendChild(top);

                /* --- Bottom: named variants --- */
                var group = el('div', 'udp-menu-group udp-speed-group');
                SPEED_VARIANTS.forEach(function (sp) {
                    var b = el('button', 'udp-menu-item' + (Math.abs(video.playbackRate - sp.v) < 0.001 ? ' udp-active' : ''));
                    b.type = 'button';
                    b.innerHTML = '<span class="udp-speed-label"><span class="udp-speed-num">' + fmtRate(sp.v) +
                        '</span><span class="udp-speed-name">' + sp.name + '</span></span><span class="udp-menu-check">&#10003;</span>';
                    b.onclick = function (ev) {
                        if (ev) ev.stopPropagation();
                        setRate(sp.v);
                        slider.value = String(clampRate(sp.v));
                        syncSpeedSlider(slider);
                        val.textContent = fmtRate(video.playbackRate);
                        Array.prototype.forEach.call(group.children, function (row, i2) {
                            var sp2 = SPEED_VARIANTS[i2];
                            row.classList.toggle('udp-active', sp2 && Math.abs(video.playbackRate - sp2.v) < 0.001);
                        });
                    };
                    group.appendChild(b);
                });
                menu.appendChild(group);

                slider.addEventListener('input', function (ev) {
                    ev.stopPropagation();
                    setRate(parseFloat(slider.value));
                    syncSpeedSlider(slider);
                    val.textContent = fmtRate(video.playbackRate);
                    Array.prototype.forEach.call(group.children, function (row, i) {
                        var sp = SPEED_VARIANTS[i];
                        row.classList.toggle('udp-active', sp && Math.abs(video.playbackRate - sp.v) < 0.001);
                    });
                });
                slider.addEventListener('click', function (ev) { ev.stopPropagation(); });
                return;
            }
            if (name === 'quality') {
                var hq = el('div', 'udp-menu-header', S.quality || 'Sifat');
                var backq = el('button', 'udp-menu-back', '&#10094;');
                backq.type = 'button';
                backq.onclick = function () { renderMenu('main'); };
                hq.appendChild(backq);
                menu.appendChild(hq);
                var groupq = el('div', 'udp-menu-group');
                qualityOptions().forEach(function (q) {
                    groupq.appendChild(menuItem(q.label, q.active, function () {
                        setQuality(q);
                        renderMenu('quality');
                    }));
                });
                menu.appendChild(groupq);
                return;
            }
            if (name === 'cc') {
                var hc = el('div', 'udp-menu-header', S.subtitles || 'Subtitrlar');
                var backc = el('button', 'udp-menu-back', '&#10094;');
                backc.type = 'button';
                backc.onclick = function () { renderMenu('main'); };
                hc.appendChild(backc);
                menu.appendChild(hc);
                var groupc = el('div', 'udp-menu-group');
                groupc.appendChild(menuItem(S.off || 'O\u2018chirilgan', !currentTrackIndex(), function () { setTrack(-1); renderMenu('cc'); }));
                trackList().forEach(function (tr, i) {
                    groupc.appendChild(menuItem(tr.label, currentTrackIndex() === i, function () { setTrack(i); renderMenu('cc'); }));
                });
                menu.appendChild(groupc);
                return;
            }
            // main menu — quality + speed + subtitles + fullscreen
            var g1 = el('div', 'udp-menu-group');
            if (hasQualityOptions()) {
                g1.appendChild(menuItem(S.quality || 'Sifat', false, function () { renderMenu('quality'); }, true));
            }
            g1.appendChild(menuItem(S.speed || 'Tezlik', false, function () { renderMenu('speed'); }, true));
            if (trackList().length) {
                g1.appendChild(menuItem(S.subtitles || 'Subtitrlar', false, function () { renderMenu('cc'); }, true));
            }
            menu.appendChild(g1);
        }

        menuBackdrop.onclick = closeMenu;

        /* ================= Video controls ================= */
        var lastSavedVolume = 1;
        var isMuted = false;
        var isDraggingSeek = false;
        var isDraggingVol = false;

        try {
            var savedVol = parseFloat(localStorage.getItem('udp_volume') || '1');
            if (!isNaN(savedVol)) { lastSavedVolume = Math.max(0, Math.min(1, savedVol)); }
            isMuted = localStorage.getItem('udp_muted') === '1';
        } catch (e) {}

        video.volume = lastSavedVolume;
        video.muted = isMuted;
        updateVolumeUI();

        function updatePlayIcon() {
            playBtn.innerHTML = (video.paused || video.ended) ? ICONS.play : ICONS.pause;
        }
        function updateVolumeUI() {
            muteBtn.innerHTML = video.muted || video.volume === 0 ? ICONS.volMute : ICONS.volOn;
            var v = video.muted ? 0 : video.volume;
            volFill.style.width = (v * 100) + '%';
        }
        function setVolume(v) {
            v = Math.max(0, Math.min(1, v));
            video.volume = v;
            if (v > 0) { video.muted = false; }
            if (v > 0) lastSavedVolume = v;
            updateVolumeUI();
            try {
                localStorage.setItem('udp_volume', String(lastSavedVolume));
                localStorage.setItem('udp_muted', video.muted ? '1' : '0');
            } catch (e) {}
        }
        function toggleMute() {
            if (video.volume === 0) {
                video.volume = lastSavedVolume || 1;
                video.muted = false;
            } else {
                video.muted = !video.muted;
            }
            updateVolumeUI();
            try { localStorage.setItem('udp_muted', video.muted ? '1' : '0'); } catch (e) {}
        }

        function togglePlay() {
            if (video.paused || video.ended) {
                var p = video.play();
                if (p && p.catch) p.catch(function () {});
            } else {
                video.pause();
            }
        }

        function setRate(r) {
            video.playbackRate = r;
        }

        function updateTime() {
            var d = video.duration;
            if (!isFinite(d)) d = 0;
            var remaining = d - video.currentTime;
            if (remaining < 0) remaining = 0;
            timeCurrent.textContent = fmtTime(video.currentTime);
            timeRemaining.textContent = '-' + fmtTime(remaining);
        }

        function updateSeek() {
            var d = video.duration;
            if (!isFinite(d) || d === 0) { d = 1; }
            var pct = (video.currentTime / d) * 100;
            seekProgress.style.width = pct + '%';
            seekThumb.style.left = pct + '%';
        }
        function updateBuffer() {
            var d = video.duration;
            if (!isFinite(d) || d === 0) return;
            var end = 0;
            try {
                for (var i = 0; i < video.buffered.length; i++) {
                    if (video.buffered.end(i) > end) end = video.buffered.end(i);
                }
            } catch (e) {}
            seekBuffer.style.width = (Math.min(100, (end / d) * 100)) + '%';
        }

        function seekFromEvent(ev) {
            var rect = seekTrack.getBoundingClientRect();
            var ratio = (ev.clientX - rect.left) / rect.width;
            if (ratio < 0) ratio = 0;
            if (ratio > 1) ratio = 1;
            var d = video.duration;
            if (!isFinite(d) || d === 0) return;
            var t = ratio * d;
            video.currentTime = t;
            updateSeek();
            return t;
        }

        function updateTooltip(ev) {
            var rect = seekTrack.getBoundingClientRect();
            var ratio = (ev.clientX - rect.left) / rect.width;
            ratio = Math.max(0, Math.min(1, ratio));
            seekTooltip.textContent = fmtTime(ratio * (video.duration || 0));
            seekTooltip.style.left = (ratio * rect.width) + 'px';
        }

        seekWrap.addEventListener('pointerdown', function (ev) {
            ev.preventDefault();
            isDraggingSeek = true;
            seekWrap.classList.add('udp-dragging');
            seekWrap.setPointerCapture(ev.pointerId);
            updateTooltip(ev);
        });
        seekWrap.addEventListener('pointermove', function (ev) {
            if (isDraggingSeek) { seekFromEvent(ev); }
            updateTooltip(ev);
        });
        seekWrap.addEventListener('pointerup', function (ev) {
            if (!isDraggingSeek) return;
            isDraggingSeek = false;
            seekWrap.classList.remove('udp-dragging');
            seekWrap.releasePointerCapture(ev.pointerId);
            var wasEnded = video.ended;
            if (wasEnded) { video.currentTime = video.duration; }
            seekFromEvent(ev);
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
        });

        volBar.addEventListener('pointerdown', function (ev) {
            ev.preventDefault();
            isDraggingVol = true;
            volBar.setPointerCapture(ev.pointerId);
            setVolFromEvent(ev);
        });
        volBar.addEventListener('pointermove', function (ev) {
            if (isDraggingVol) setVolFromEvent(ev);
        });
        volBar.addEventListener('pointerup', function (ev) {
            if (!isDraggingVol) return;
            isDraggingVol = false;
            volBar.releasePointerCapture(ev.pointerId);
        });
        function setVolFromEvent(ev) {
            var rect = volBar.getBoundingClientRect();
            var v = (ev.clientX - rect.left) / rect.width;
            v = Math.max(0, Math.min(1, v));
            setVolume(v);
        }

        muteBtn.addEventListener('click', toggleMute);
        playBtn.addEventListener('click', function () { togglePlay(); });
        fsBtn.addEventListener('click', function () { closeMenu(); toggleFullscreen(); });

        video.addEventListener('click', function (ev) {
            if (ev.target === video && !video.dragging) togglePlay();
        });

        video.addEventListener('play', function () {
            root.classList.add('udp-playing');
            root.classList.remove('udp-paused');
            updatePlayIcon();
        });
        video.addEventListener('pause', function () {
            root.classList.remove('udp-playing');
            root.classList.add('udp-paused');
            updatePlayIcon();
            root.classList.add('udp-ui-visible');
        });
        video.addEventListener('ended', function () {
            root.classList.remove('udp-playing');
            root.classList.add('udp-paused');
            updatePlayIcon();
            showEnded();
        });
        video.addEventListener('timeupdate', function () { updateTime(); updateSeek(); updateSkip(); });
        video.addEventListener('progress', updateBuffer);
        video.addEventListener('durationchange', function () { updateTime(); updateSeek(); });
        video.addEventListener('volumechange', updateVolumeUI);

        /* ================= Buffering ================= */
        var loadingT = null;
        function setLoading(show) {
            clearTimeout(loadingT);
            if (show) {
                loadingT = setTimeout(function () {
                    root.classList.add('is-loading');
                }, 200);
            } else {
                root.classList.remove('is-loading');
            }
        }
        setLoading(video.readyState < 3);
        video.addEventListener('loadedmetadata', function () { setLoading(false); });
        video.addEventListener('canplay', function () { setLoading(false); });
        video.addEventListener('playing', function () { setLoading(false); });
        video.addEventListener('waiting', function () { if (!video.ended) setLoading(true); });
        video.addEventListener('seeking', function () { if (video.readyState < 3) setLoading(true); });
        video.addEventListener('seeked', function () { if (video.readyState >= 3) setLoading(false); });

        /* ================= Aspect ratio (vertikal video) ================= */
        function fitVideo() {
            var w = video.videoWidth, h = video.videoHeight;
            if (!w || !h) return;
            var ratio = w / h;
            if (ratio < 1.25) {
                root.classList.add('udp-vertical');
                var maxW = Math.round(0.78 * window.innerHeight * ratio);
                var wrapW = root.parentElement ? root.parentElement.clientWidth : window.innerWidth;
                root.style.maxWidth = Math.min(wrapW, maxW) + 'px';
                root.style.marginLeft = 'auto';
                root.style.marginRight = 'auto';
                video.style.objectFit = 'cover';
            } else {
                root.classList.remove('udp-vertical');
                root.style.maxWidth = '';
                root.style.marginLeft = '';
                root.style.marginRight = '';
                video.style.objectFit = 'cover';
            }
        }
        video.addEventListener('loadedmetadata', fitVideo);
        video.addEventListener('resize', fitVideo);
        window.addEventListener('resize', fitVideo);

        /* ================= Skip intro ================= */
        var introStart = cfg.introStart || 0;
        var introEnd = cfg.introEnd || 0;
        function updateSkip() {
            var show = !video.ended && introEnd > introStart && video.currentTime >= introStart && video.currentTime < introEnd && video.duration > introEnd;
            skipWrap.hidden = !show;
        }
        skipBtn.onclick = function () {
            if (video.duration > introEnd) video.currentTime = introEnd + 0.05;
            skipWrap.hidden = true;
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
        };
        video.addEventListener('timeupdate', updateSkip);
        video.addEventListener('durationchange', updateSkip);

        /* ================= HLS (hls.js) ================= */
        function startHls(src) {
            if (window.Hls && Hls.isSupported()) {
                initHls(src);
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = src;
            } else if (!window.Hls) {
                var s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
                s.onload = function () {
                    if (window.Hls && Hls.isSupported()) initHls(src);
                    else showError();
                };
                s.onerror = function () { showError(); };
                document.head.appendChild(s);
            } else {
                showError();
            }
        }
        function initHls(src) {
            hls = new Hls({
                maxBufferLength: 60,
                maxMaxBufferLength: 180,
                backBufferLength: 30,
                enableWorker: true,
                lowLatencyMode: false,
                autoStartLoad: true,
                startPosition: -1,
                fragLoadingMaxRetry: 6,
                manifestLoadingMaxRetry: 4
            });
            root.__udpHls = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                buildHlsQualityMenu();
                updateQualityLabel();
            });
            hls.on(Hls.Events.LEVEL_SWITCHED, function () {
                updateQualityLabel();
            });
            hls.on(Hls.Events.ERROR, function (evt, data) {
                if (data && data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !video.dataset.hlsRetried && video.dataset.hlsRefresh) {
                        video.dataset.hlsRetried = '1';
                        setLoading(true, S.reconnecting || 'Qayta ulanmoqda...');
                        fetch(video.dataset.hlsRefresh)
                            .then(function (r) { return r.json(); })
                            .then(function (d) {
                                if (d && d.ok && d.url) {
                                    try { hls && hls.destroy(); } catch (e) {}
                                    startHls(d.url);
                                } else {
                                    setLoading(false);
                                    showError();
                                }
                            })
                            .catch(function () { setLoading(false); showError(); });
                        return;
                    }
                    setLoading(false);
                    try { hls && hls.destroy(); } catch (e) {}
                    showError();
                }
            });
        }
        function buildHlsQualityMenu() {
            if (!hls || !hls.levels || !hls.levels.length) return;
            var hasMulty = hls.levels.length > 1;
            if (hasMulty) {
                hlsAutoLevels = hls.levels.map(function (l, i) { return { height: l.height || 0, index: i }; });
            }
        }
        var hlsAutoLevels = [];

        if (isHls) {
            if (video.dataset.hls) {
                startHls(video.dataset.hls);
            } else if (video.dataset.hlsPending) {
                bufferingLabel.textContent = S.pending || 'Video tayyorlanmoqda...';
                (function pollPending() {
                    if (video.dataset.hls) {
                        startHls(video.dataset.hls);
                        return;
                    }
                    fetch(video.dataset.hlsRefresh)
                        .then(function (r) { return r.json(); })
                        .then(function (d) {
                            if (d && d.ok && d.url) {
                                video.dataset.hls = d.url;
                                startHls(d.url);
                            } else if (d && d.msg === 'login_required') {
                                bufferingLabel.textContent = 'Video ko\u2018rish uchun saytga kiring';
                            } else {
                                setTimeout(pollPending, 15000);
                            }
                        })
                        .catch(function () { setTimeout(pollPending, 15000); });
                })();
            }
        }

        /* ================= Quality ================= */
        // O'ng pastdagi gear yonida joriy sifat yorlig'ini ko'rsatadi (HD/720p/Auto)
        function qualityLabelText() {
            if (isHls && hls) {
                if (hls.autoLevelEnabled) return S.quality_auto || 'Auto';
                var lvl = hls.currentLevel;
                if (lvl >= 0 && hls.levels && hls.levels[lvl]) {
                    var h = hls.levels[lvl].height || 0;
                    if (h > 0) return h + 'p';
                }
                return 'HD';
            }
            if (cfg.qualities && Object.keys(cfg.qualities).length) {
                var cur = video.currentSrc || '';
                var found = null;
                Object.keys(cfg.qualities).forEach(function (label) {
                    if (cfg.qualities[label] === cur) found = label;
                });
                if (found && found !== 'Auto') return found;
                return 'Auto';
            }
            return 'HD';
        }
        function updateQualityLabel() {
            qualityLabel.textContent = qualityLabelText();
        }
        var qualityOptions = function () {
            if (isHls && hlsAutoLevels.length) {
                var opts = [{ label: 'Auto', level: -1, active: hls.currentLevel === -1 }];
                hlsAutoLevels.forEach(function (lv) {
                    var label = lv.height >= 1000 ? Math.round(lv.height / 100) / 10 + 'k' : lv.height + 'p';
                    opts.push({ label: label, level: lv.index, active: hls.currentLevel === lv.index });
                });
                return opts;
            }
            var qs = [];
            if (cfg.qualities && Object.keys(cfg.qualities).length) {
                Object.keys(cfg.qualities).forEach(function (label) {
                    qs.push({ label: label, url: cfg.qualities[label], active: false });
                });
            }
            if (qs.length > 1) {
                var cur = video.currentSrc || '';
                qs.forEach(function (q) { q.active = q.url === cur; });
            }
            return qs;
        };
        var hasQualityOptions = function () {
            if (isHls && hlsAutoLevels.length) return true;
            return cfg.qualities && Object.keys(cfg.qualities).length > 1;
        };
        var setQuality = function (q) {
            if (isHls && hls) {
                hls.currentLevel = q.level;
                updateQualityLabel();
                return;
            }
            if (!q.url) return;
            var cur = video.currentTime;
            var wasPlaying = !video.paused && !video.ended;
            video.src = q.url;
            video.load();
            video.addEventListener('loadedmetadata', function handler() {
                if (cur < video.duration) video.currentTime = cur;
                video.removeEventListener('loadedmetadata', handler);
                updateQualityLabel();
            });
            if (wasPlaying) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
        };

        /* ================= Subtitles ================= */
        var trackList = function () {
            return Array.prototype.slice.call(video.querySelectorAll('track[src]'));
        };
        var currentTrackIndex = function () {
            var list = trackList();
            for (var i = 0; i < list.length; i++) {
                if (list[i].mode === 'showing') return i;
            }
            return -1;
        };
        var setTrack = function (i) {
            var list = trackList();
            list.forEach(function (tr, idx) {
                tr.mode = idx === i ? 'showing' : 'disabled';
            });
        };
        trackList();

        /* ================= PiP ================= */
        function togglePip() {
            if (document.pictureInPictureElement === video) {
                document.exitPictureInPicture().catch(function () {});
            } else if (video !== document.pictureInPictureElement) {
                video.requestPictureInPicture().catch(function () {});
            }
        }

        /* ================= Fullscreen ================= */
        function isFs() {
            return document.fullscreenElement === root ||
                document.webkitFullscreenElement === root ||
                document.mozFullScreenElement === root;
        }
        function toggleFullscreen() {
            if (isFs()) {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
            } else {
                var fn = root.requestFullscreen || root.webkitRequestFullscreen || root.mozRequestFullScreen;
                if (fn) fn.call(root);
            }
        }
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
        document.addEventListener('mozfullscreenchange', onFsChange);
        function onFsChange() {
            root.classList.toggle('udp-fs', isFs());
            fsBtn.innerHTML = isFs() ? ICONS.fsExit : ICONS.fs;
            fitVideo();
            if (isFs() && screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(function () {});
            } else if (!isFs() && screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        }

        /* PiP button click */
        if (pipBtn) {
            pipBtn.onclick = function () { closeMenu(); togglePip(); };
        }

        /* ================= Keyboard ================= */
        document.addEventListener('keydown', function (ev) {
            if (document.activeElement && /input|textarea|select/.test(document.activeElement.tagName)) return;
            if (!root.getBoundingClientRect().width) return;
            switch (ev.key) {
                case ' ':
                    ev.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowRight':
                    ev.preventDefault();
                    video.currentTime = Math.min((video.duration || 0), video.currentTime + 10);
                    showUi();
                    break;
                case 'ArrowLeft':
                    ev.preventDefault();
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    showUi();
                    break;
                case 'ArrowUp':
                    ev.preventDefault();
                    setVolume(video.volume + 0.1);
                    break;
                case 'ArrowDown':
                    ev.preventDefault();
                    setVolume(video.volume - 0.1);
                    break;
                case 'f':
                case 'F':
                    toggleFullscreen();
                    break;
                case 'm':
                case 'M':
                    toggleMute();
                    break;
                case 'Escape':
                    closeMenu();
                    break;
            }
        });

        /* ================= UI auto-hide ================= */
        var hideTimer = null;
        function showUi() {
            root.classList.add('udp-ui-visible');
            clearTimeout(hideTimer);
            if (!video.paused && !video.ended) {
                hideTimer = setTimeout(function () {
                    root.classList.remove('udp-ui-visible');
                }, 1500);
            }
        }
        root.addEventListener('mousemove', showUi);
        root.addEventListener('mouseenter', showUi);
        root.addEventListener('pointerdown', showUi);

        /* ================= Menu buttons ================= */
        var menuViaHover = false;
        var menuHoverT = null;
        var menuLeaveT = null;
        gearBtn.onclick = function (ev) {
            ev.stopPropagation();
            menuViaHover = false;
            clearTimeout(menuHoverT);
            clearTimeout(menuLeaveT);
            if (menu.classList.contains('udp-open')) closeMenu();
            else openMenu('speed');
        };
        gearBtn.addEventListener('mouseenter', function () {
            clearTimeout(menuLeaveT);
            menuViaHover = true;
            if (menu.classList.contains('udp-open')) return;
            menuHoverT = setTimeout(function () { openMenu('speed', true); }, 150);
        });
        gearBtn.addEventListener('mouseleave', function () {
            clearTimeout(menuHoverT);
            if (menuViaHover) menuLeaveT = setTimeout(closeMenu, 300);
        });

        /* ================= Resume ================= */
        var resumeAt = parseInt(cfg.resumeAt || '0', 10);
        var resumeHandled = false;
        function showResume() {
            if (resumeHandled || resumeAt <= 5) return;
            resumeHandled = true;
            if (video.duration > resumeAt + 5) {
                resumeSub.textContent = fmtTime(resumeAt) + ' \u2014 ' + (S.resume_sub || 'qayerda qolgan edingiz');
                resumeOv.hidden = false;
                video.pause();
                root.classList.add('udp-ui-visible');
            }
        }
        resumeCont.onclick = function () {
            resumeOv.hidden = true;
            video.currentTime = resumeAt;
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
        };
        resumeRestart.onclick = function () {
            resumeOv.hidden = true;
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
        };
        video.addEventListener('loadedmetadata', showResume);
        video.addEventListener('canplay', showResume);
        if (resumeAt > 5) {
            setLoading(false);
        }

        /* ================= Autoplay ================= */
        video.addEventListener('canplay', function onCanPlay() {
            video.removeEventListener('canplay', onCanPlay);
            if (resumeAt > 5) return;
            if (!video.paused) return;
            // Brauzer autoplay cheklovi ovozli videoni avtomatik boshlashni bloklaydi.
            // Shu sabab avval MUTED holda boshlaymiz, keyin ovozni ochishga urinamiz.
            var userMuted = false;
            try { userMuted = localStorage.getItem('udp_muted') === '1'; } catch (e) {}
            video.muted = true;
            var p = video.play();
            if (p && p.then) {
                p.then(function () {
                    // Muted holda muvaffaqiyatli boshlandi — ovozni ochamiz
                    if (!userMuted) {
                        video.muted = false;
                        isMuted = false;
                        if (muteBtn) muteBtn.innerHTML = ICONS.volOn;
                    }
                }).catch(function () {
                    // Hali ham bloklandi — muted tursin, foydalanuvchi bosganda ochiladi
                    if (!userMuted) {
                        try { localStorage.setItem('udp_muted', '1'); } catch (e2) {}
                    }
                });
            } else if (p !== undefined) {
                if (!userMuted) { video.muted = false; isMuted = false; if (muteBtn) muteBtn.innerHTML = ICONS.volOn; }
            }
        });

        /* ================= Error ================= */
        function showError() {
            setLoading(false);
            errOv.hidden = false;
        }
        function hideError() {
            errOv.hidden = true;
        }
        video.addEventListener('error', function () {
            if (video.dataset.fallback && !video.dataset.fallbackUsed) {
                video.dataset.fallbackUsed = '1';
                var cur = video.currentTime;
                var wasPlaying = !video.paused && !video.ended;
                video.removeAttribute('crossorigin');
                video.src = video.dataset.fallback;
                video.load();
                video.addEventListener('loadedmetadata', function onFbMeta() {
                    video.removeEventListener('loadedmetadata', onFbMeta);
                    delete video.dataset.errHandled;
                    if (cur > 0 && cur < video.duration) video.currentTime = cur;
                    if (wasPlaying) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
                });
                return;
            }
            if (video.dataset.refresh && !video.dataset.refreshUsed) {
                video.dataset.refreshUsed = '1';
                setLoading(true);
                fetch(video.dataset.refresh)
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (d && d.ok && d.url) {
                            var cur = video.currentTime;
                            var wasPlaying = !video.paused && !video.ended;
                            video.src = d.url;
                            video.load();
                            video.addEventListener('loadedmetadata', function onReMeta() {
                                video.removeEventListener('loadedmetadata', onReMeta);
                                setLoading(false);
                                if (cur > 0 && cur < video.duration) video.currentTime = cur;
                                if (wasPlaying) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
                            });
                        } else {
                            setLoading(false);
                            showError();
                        }
                    })
                    .catch(function () { setLoading(false); showError(); });
                return;
            }
            showError();
        });
        retryBtn.onclick = function () {
            hideError();
            endedOv.hidden = true;
            if (isHls && video.dataset.hls) {
                try { hls && hls.destroy(); } catch (e) {}
                hls = null;
                startHls(video.dataset.hls);
            } else {
                video.load();
                var p = video.play();
                if (p && p.catch) p.catch(function () {});
            }
        };

        /* ================= Ended ================= */
        function showEnded() {
            endedOv.hidden = false;
        }
        replayBtn.onclick = function () {
            endedOv.hidden = true;
            video.currentTime = 0;
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
        };

        /* ================= Initial state ================= */
        updatePlayIcon();
        updateTime();
        updateSeek();
        setRate(1);
        updateQualityLabel();

        /* ================= Stall soati (jonli oqim uchun) ================= */
        // Telegram relay (api/live.php) yoki HLS oqimi bir joyda "turg'un"
        // bo'lib qolsa (12 soniya oldinga siljish bo'lmasa), manbani qayta
        // ishga tushiramiz. Bu asl uzdub'da yo'q — bu yerda qo'shildi.
        var lastProgress = 0, stallT = 0, stallCnt = 0, stallWatch = 0;
        video.addEventListener('timeupdate', function () {
            lastProgress = video.currentTime;
            stallT = 0;
        });
        video.addEventListener('playing', function () {
            if (stallT) stallT = 0;
        });
        video.addEventListener('stalled', function () {
            if (!stallT) stallT = Date.now();
        });
        video.addEventListener('waiting', function () {
            if (!stallT) stallT = Date.now();
        });
        video.addEventListener('seeking', function () {
            if (!stallT) stallT = Date.now();
        });
        stallWatch = setInterval(function () {
            if (!root.isConnected) {
                clearInterval(stallWatch);
                return;
            }
            if (video.paused || video.ended || !video.currentTime) return;
            if (!stallT || Date.now() - stallT < 12000) return;
            if (stallCnt >= 2) return; // 2 marta urinamiz, keyin qo'yamiz
            stallCnt++;
            stallT = Date.now();
            var pos = video.currentTime;
            if (isHls && hls) {
                // HLS: segmentlarni qayta so'raymiz
                try { hls.startLoad(); } catch (e) {}
                var p1 = video.play();
                if (p1 && p1.catch) p1.catch(function () {});
                return;
            }
            // Direct/file: manbani qayta yuklaymiz
            try {
                video.load();
                if (pos > 1 && isFinite(video.duration) && pos < video.duration) {
                    video.currentTime = pos;
                }
                var p2 = video.play();
                if (p2 && p2.catch) p2.catch(function () {});
            } catch (e) {}
        }, 4000);
    }

    function initAll() {
        document.querySelectorAll('.udp-player[data-udp]').forEach(function (root) {
            if (root.classList.contains('udp-init')) return;
            initPlayer(root);
        });
    }

    // Dynamik modal uchun: {#modalBody} ichiga yangi udp markup tushganda
    // app.js shuni chaqiradi. destroyAll esa yopilishda hls/video'ni tozalaydi.
    function destroyAll() {
        document.querySelectorAll('.udp-player[data-udp]').forEach(function (root) {
            var v = root.querySelector('video');
            if (v) { try { v.pause(); } catch (e) {} }
            if (root.__udpHls) {
                try { root.__udpHls.destroy(); } catch (e) {}
                root.__udpHls = null;
            }
            root.classList.remove('udp-init');
        });
    }

    window.UDP = { initAll: initAll, destroyAll: destroyAll };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }
})();
