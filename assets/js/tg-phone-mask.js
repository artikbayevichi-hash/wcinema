/* ============================================================================
 * W CINEMA — tg-phone-mask.js
 * ----------------------------------------------------------------------------
 * Davlatga mos DINAMIK telefon maskasi va validatsiya.
 *
 * `assets/vendor/libphonenumber-js.min.js` (lokal, internet talab qilmaydi)
 * ustidagi yupqa qatlam. Global interfeys: `window.TgPhone`.
 *
 *   TgPhone.ready()              — kutubxona yuklanganmi? (bool)
 *   TgPhone.maxLen(iso)          — davlat uchun MAX milliy raqam uzunligi
 *   TgPhone.minLen(iso)          — davlat uchun odatiy (birinchi) uzunlik
 *   TgPhone.digits(text)         — matndan faqat raqamlarni ajratadi
 *   TgPhone.limit(iso, digits)   — ortiqcha raqamlarni kesib tashlaydi
 *   TgPhone.format(iso, digits)  — guruhlangan matn: "90 123 45 67"
 *   TgPhone.mask(iso)            — placeholder: "00 000 00 00"
 *   TgPhone.e164(iso, digits)    — "+998901234567" (yoki null)
 *   TgPhone.validate(iso, digits)— { ok, valid, possible, e164, reason, maxLen }
 *   TgPhone.attach(input, opts)  — input'ga maskani ulaydi (pastga qarang)
 *
 * `attach(input, { getIso })` qaytaradi:
 *   · refresh()             — qiymatni qayta formatlaydi
 *   · setCountry(iso)       — davlat o'zgardi: maydon tozalanadi, placeholder
 *   · value()               — faqat raqamlar
 *
 * MUHIM: kutubxona yuklanmasa ham sahifa ishlashda davom etadi — maska
 * o'rniga oddiy zaxira (placeholder'siz, faqat raqamlar) ishlaydi.
 * ========================================================================== */
(function (global) {
  'use strict';

  var LP = global.libphonenumber || null;
  var FALLBACK_MAX = 15;

  // --------------------------------------------------------------------------
  // Meta'dan davlat -> [minLen, maxLen] xaritasini bir marta quramiz.
  // libphonenumber-js "compact" metadata:
  //   countries[ISO] = [cc, idd, pattern, possibleLengths?, formats, ...]
  // `possibleLengths` — son yoki massiv (masalan UZ=[9], RU=[10,14]).
  // --------------------------------------------------------------------------
  // LEN[ISO] = [minLen, maxLen, typicalLen]
  var LEN = {};
  (function buildLengths() {
    if (!LP || !LP.AsYouType) return;
    var meta;
    try { meta = new LP.AsYouType('US').metadata; } catch (e) { meta = null; }
    var countries = meta && meta.metadata && meta.metadata.countries;
    if (!countries) return;
    for (var iso in countries) {
      if (!Object.prototype.hasOwnProperty.call(countries, iso)) continue;
      var entry = countries[iso];
      var pl = entry && entry[3];
      if (!pl) continue;
      var arr = (typeof pl === 'number') ? [pl] : pl;
      var min = 0, max = 0, typical = 0;
      for (var i = 0; i < arr.length; i++) {
        var n = arr[i] | 0;
        if (n <= 0) continue;
        if (!min || n < min) min = n;
        if (n > max) max = n;
        // Ko'p mamlakatlarda milliy raqam 9-10 xonali bo'ladi: 10 ga eng
        // yaqin uzunlikni "odatiy" (placeholder uchun) deb olamiz.
        if (!typical || Math.abs(n - 10) < Math.abs(typical - 10)) typical = n;
      }
      if (max > 0) LEN[iso] = [min || max, max, typical || max];
    }
  })();

  function isset(iso) { return Object.prototype.hasOwnProperty.call(LEN, iso); }

  function ready() { return !!LP; }

  function maxLen(iso) {
    iso = String(iso || '').toUpperCase();
    return isset(iso) ? LEN[iso][1] : FALLBACK_MAX;
  }

  function minLen(iso) {
    iso = String(iso || '').toUpperCase();
    return isset(iso) ? LEN[iso][0] : 0;
  }

  // Placeholder uzunligi (odatiy raqam uzunligi).
  function typicalLen(iso) {
    iso = String(iso || '').toUpperCase();
    return isset(iso) ? LEN[iso][2] : 10;
  }

  function digits(text) {
    return String(text == null ? '' : text).replace(/\D/g, '');
  }

  function limit(iso, d) {
    var m = maxLen(iso);
    return (d && d.length > m) ? d.slice(0, m) : (d || '');
  }

  // Guruhlash (AsYouType orqali). Har chaqiruvda yangi formatter — chunki
  // AsYouType inkremental; to'liq raqam satrini bir marta berish to'g'ri.
  function format(iso, d) {
    if (!LP || !LP.AsYouType || !d) return d || '';
    try { return new LP.AsYouType(iso).input(d); } catch (e) { return d; }
  }

  // Placeholder: odatiy uzunlikdagi "9" larni formatlab, raqamlarni "0" ga
  // almashtiramiz (ajratgichlar saqlanadi). Masalan US -> "(000) 000-0000".
  function mask(iso) {
    var n = typicalLen(iso) || 10;
    var sample = '';
    for (var i = 0; i < n; i++) sample += '9';
    return format(iso, sample).replace(/\d/g, '0');
  }

  function callingCode(iso) {
    if (!LP || !LP.getCountryCallingCode) return '';
    try { return String(LP.getCountryCallingCode(String(iso || '').toUpperCase())); }
    catch (e) { return ''; }
  }

  // Milliy raqam (davlat kodisiz) -> E.164 ("+998901234567").
  function e164(iso, d) {
    d = digits(d);
    var cc = callingCode(iso);
    if (!cc || !d) return null;
    var full = '+' + cc + d;
    if (!LP || !LP.parsePhoneNumberFromString) return full;
    try {
      var pn = LP.parsePhoneNumberFromString(full);
      return (pn && pn.number) ? pn.number : full;
    } catch (e) { return full; }
  }

  // To'liq validatsiya.
  //   ok  — shlyuz: raqam shu davlat uchun TO'LIQ va MUMKIN (uzunlik/format).
  //   valid — libphonenumberning qat'iy "isValid" natijasi (qo'shimcha).
  // Telegram o'zi ham ba'zan "possible" darajasidagi raqamlarni qabul qiladi,
  // shuning uchun foydalanuvchini ortiqcha bloklamaymiz.
  function validate(iso, d) {
    d = digits(d);
    iso = String(iso || '').toUpperCase();

    if (!LP || !LP.isPossiblePhoneNumber) {
      // Zaxira: kutubxona yo'q — faqat minimal uzunlikni tekshiramiz.
      var okFallback = d.length >= 5;
      return { ok: okFallback, valid: okFallback, possible: okFallback,
               e164: okFallback ? e164(iso, d) : null,
               reason: okFallback ? '' : 'short', maxLen: maxLen(iso) };
    }

    var cc = callingCode(iso);
    if (!cc) return { ok: false, valid: false, possible: false, e164: null, reason: 'invalid', maxLen: maxLen(iso) };

    var full = '+' + cc + d;
    var possible = false, valid = false;
    try { possible = LP.isPossiblePhoneNumber(full, iso); } catch (e) {}
    try { valid = LP.isValidPhoneNumber ? LP.isValidPhoneNumber(full, iso) : possible; } catch (e) {}

    var reason = '';
    if (!possible) {
      var v = '';
      try { v = LP.validatePhoneNumberLength ? LP.validatePhoneNumberLength(full, iso) : ''; } catch (e) {}
      if (v === 'TOO_SHORT' || v === 'NOT_A_NUMBER') reason = 'short';
      else if (v === 'TOO_LONG') reason = 'long';
      else if (v === 'INVALID_LENGTH') reason = (d.length >= maxLen(iso)) ? 'long' : 'invalid';
      else reason = (d.length < maxLen(iso)) ? 'short' : 'invalid';
    }

    return {
      ok: possible,
      valid: valid,
      possible: possible,
      e164: possible ? e164(iso, d) : null,
      reason: reason,
      maxLen: maxLen(iso)
    };
  }

  // --------------------------------------------------------------------------
  // Input'ga ulash: har bosishda formatlaydi, ortiqcha raqamni to'sadi va
  // kursorni saqlaydi.
  // --------------------------------------------------------------------------
  function attach(input, opts) {
    opts = opts || {};
    if (!input) return null;
    var getIso = typeof opts.getIso === 'function' ? opts.getIso : function () { return 'UZ'; };
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    function reformat(keepCaret) {
      var iso = getIso();
      var raw = digits(input.value);
      var capped = limit(iso, raw);

      var before = capped.length;           // kursor oldidagi raqamlar soni
      if (keepCaret) {
        try {
          var sel = input.selectionStart;
          before = digits(String(input.value).slice(0, sel == null ? 0 : sel)).length;
        } catch (e) { /* seçim mavjud emas */ }
        if (before > capped.length) before = capped.length;
      }

      var out = format(iso, capped);
      input.value = out;

      if (keepCaret) {
        var pos = out.length, count = 0, placed = false;
        for (var i = 0; i < out.length; i++) {
          if (/\d/.test(out.charAt(i))) {
            count++;
            if (count === before) { pos = i + 1; placed = true; break; }
          }
        }
        if (before === 0) pos = 0;
        else if (!placed) pos = out.length;
        try { input.setSelectionRange(pos, pos); } catch (e) {}
      }

      onChange(out, capped);
      return out;
    }

    input.addEventListener('input', function () { reformat(true); });
    // Ba'zi brauzerlarda 'tel' maydoniga '+' kabi belgilar qo'lda kiritilishi
    // mumkin — ularni ham filtrlash uchun (paste bilan birga).
    input.addEventListener('paste', function () { setTimeout(function () { reformat(true); }, 0); });

    return {
      reformat: function () { return reformat(true); },
      setCountry: function (iso) {
        input.value = '';
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('placeholder', mask(iso));
        onChange('', '');
      },
      value: function () { return digits(input.value); }
    };
  }

  global.TgPhone = {
    ready: ready,
    maxLen: maxLen,
    minLen: minLen,
    typicalLen: typicalLen,
    digits: digits,
    limit: limit,
    format: format,
    mask: mask,
    callingCode: callingCode,
    e164: e164,
    validate: validate,
    attach: attach
  };
})(typeof window !== 'undefined' ? window : globalThis);
