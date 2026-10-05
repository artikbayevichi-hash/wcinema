/* ==========================================================================
 * tg-format.js - xabar matnini formatlash (yuborish + ko'rsatish)
 * --------------------------------------------------------------------------
 * Ikki qismli yordamchi modul. Tashqi kutubxonasiz, `document` ga bog'liq
 * emas (faqat `window.TgFormat` ga eksport qilinadi).
 *
 * 1) TgFormat.parse(matn, extraFn)
 *    Yozilgan yengil markupni MTProto `entities` massiviga aylantiradi va
 *    markup belgilarini matndan OLIB TASHLAB (Telegram shu tarzda ishlaydi):
 *
 *      **qalin**        *kursiv*        __ost osti__
 *      ~~o'chirilgan~~  || spoiler ||   `kod`      ```blok```
 *      >sitata satri                    [nom](https://havola)
 *
 *    `extraFn(sofMatn)` orqali qo'shimcha entity qo'shish mumkin (masalan
 *    `@username` -> InputMessageEntityMentionName); u sof matn offset'lari
 *    bo'yicha ishlaydi.
 *
 *    Ochilib qolgan belgilar (masalan `salom**`) buzilmaydi - ular oddiy
 *    matn qilib qoldiriladi. Aks holda Telegram "ENTITY_BOUNDS_INVALID"
 *    xatosini beradi va butun xabar yuborilmaydi.
 *
 * 2) TgFormat.render(matn, entities)
 *    Kelgan xabarning `entities` massivini HTML ga aylantiradi. Har bir teg
 *    oldindan `escape` qilinadi (XSS himoyasi), havola protokoli tekshiriladi.
 * ========================================================================== */
(function (global) {
  'use strict';

  var MAX_ENTITIES = 100;   // Telegram chegarasi (styled entities)

  // ------------------------------------------------------------------ yordam
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;'
        : c === '<' ? '&lt;'
        : c === '>' ? '&gt;'
        : c === '"' ? '&quot;'
        : '&#39;';
    });
  }

  function nl2br(s) { return String(s).replace(/\r\n|\r|\n/g, '<br>'); }

  /** GramJS obyekti `className`, oddiy obyekt esa `_` ishlatadi. */
  function typeOf(e) {
    if (!e) return '';
    if (typeof e._ === 'string') return e._;
    if (typeof e.className === 'string') return e.className;
    return '';
  }

  /** Entity nusxasini boshqa offset/uzunlik bilan nusxalash. */
  function clone(e, offset, length) {
    var o = { _: typeOf(e), offset: offset, length: length };
    for (var k in e) {
      if (k === 'offset' || k === 'length' || k === '_' || k === 'className') continue;
      var v = e[k];
      if (v === null || typeof v === 'undefined') continue;
      o[k] = v;
    }
    return o;
  }

  // ------------------------------------------------------------------ MARKS
  // Uzunroq belgilar BIRINCHI turishi kerak (`**` `*` dan oldin).
  var MARKS = [
    { o: '```', c: '```', t: 'MessageEntityPre', raw: true },
    { o: '**',  c: '**',  t: 'MessageEntityBold' },
    { o: '__',  c: '__',  t: 'MessageEntityUnderline' },
    { o: '~~',  c: '~~',  t: 'MessageEntityStrike' },
    { o: '||',  c: '||',  t: 'MessageEntitySpoiler' },
    { o: '`',   c: '`',   t: 'MessageEntityCode', raw: true },
    { o: '*',   c: '*',   t: 'MessageEntityItalic' }
  ];

  function isSp(ch) {
    return ch === '' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  function markAt(src, i) {
    for (var k = 0; k < MARKS.length; k++) {
      if (src.substr(i, MARKS[k].o.length) === MARKS[k].o) return MARKS[k];
    }
    return null;
  }

  // ================================================================= PARSE
  /**
   * @param {string} src
   * @param {Function} [extraFn] sof matnni oladi, entity massivini qaytaradi
   * @return {{text: string, entities: Array}}
   */
  function parseInline(src, extraFn) {
    src = String(src == null ? '' : src);
    var out = '';
    var ents = [];
    var stack = [];
    var i = 0;
    var n = src.length;

    function push(type, start, extra) {
      var len = out.length - start;
      if (len <= 0) return;
      var e = { _: type, offset: start, length: len };
      if (extra) for (var k in extra) e[k] = extra[k];
      ents.push(e);
    }

    while (i < n) {
      var top = stack.length ? stack[stack.length - 1] : null;

      // 1) kod/blok ichida - faqat yopish belgisini qidiramiz
      if (top && top.mark.raw) {
        var end = src.indexOf(top.mark.c, i);
        if (end < 0) { out += src.slice(i); i = n; break; }
        out += src.slice(i, end);
        i = end + top.mark.c.length;
        push(top.type, top.start, top.extra);
        stack.pop();
        continue;
      }

      // 2) yopish belgisi (stack tepasidagining o'z belgisi)
      if (top && src.substr(i, top.mark.c.length) === top.mark.c
          && !isSp(src.charAt(i - 1))) {
        i += top.mark.c.length;
        push(top.type, top.start, top.extra);
        stack.pop();
        continue;
      }

      // 3) havola: [nom](https://...)
      if (src.charAt(i) === '[') {
        var link = readLink(src, i, out.length);
        if (link) {
          out += link.text;
          i = link.next;
          ents.push.apply(ents, link.entities);
          ents.push(link.entity);
          continue;
        }
      }

      // 4) ochish belgisi
      var mk = markAt(src, i);
      if (mk && !isSp(src.charAt(i + mk.o.length))) {
        var extra = null;
        var j = i + mk.o.length;
        // ```php ... ``` -> MessageEntityPre { language: 'php' }
        if (mk.t === 'MessageEntityPre') {
          var lang = /^[A-Za-z0-9_+#.-]{1,32}/.exec(src.slice(j));
          if (lang) { extra = { language: lang[0] }; j += lang[0].length; }
        }
        stack.push({
          mark: mk, type: mk.t, start: out.length, extra: extra,
          raw: src.slice(i, j)
        });
        i = j;
        continue;
      }

      // 5) oddiy belgi
      out += src.charAt(i);
      i++;
    }

    // Ochilib qolgan belgilar: belgilarni tiklaymiz (teskari tartibda,
    // shunda offset'lar to'g'ri silinadi).
    for (var s = stack.length - 1; s >= 0; s--) {
      var st = stack[s];
      if (!st.raw) continue;
      out = out.slice(0, st.start) + st.raw + out.slice(st.start);
      for (var q = 0; q < ents.length; q++) {
        if (ents[q].offset >= st.start) ents[q].offset += st.raw.length;
      }
    }

    if (typeof extraFn === 'function') {
      try {
        var more = extraFn(out);
        if (more && more.length) ents.push.apply(ents, more);
      } catch (e) { /* extra muvaffaqiyatsiz - matn baribir yuboriladi */ }
    }

    return { text: out, entities: trimEnts(ents) };
  }

  function readLink(src, i, outStart) {
    var close = src.indexOf('](', i + 1);
    if (close < 0) return null;
    var urlEnd = src.indexOf(')', close + 2);
    if (urlEnd < 0) return null;
    var label = src.slice(i + 1, close);
    var url = src.slice(close + 2, urlEnd).trim();
    if (!label || !url) return null;
    if (!safeUrl(url)) return null;
    var inner = parseInline(label);          // ichida **qalin** ham bo'lishi mumkin
    for (var q = 0; q < inner.entities.length; q++) {
      inner.entities[q].offset += outStart;
    }
    return {
      text: inner.text,
      next: urlEnd + 1,
      entities: inner.entities,
      entity: { _: 'MessageEntityTextUrl', offset: outStart, length: inner.text.length, url: url }
    };
  }

  // ------------------------------------------------------ sitata (>qator)
  function applyBlockquote(text, ents) {
    if (!/(^|\n)>[ \t]?/.test(text)) {
      // Qator boshidagi `>` yo'q - sitata ham, entity ham o'zgarmaydi.
      // DIQQAT: bu tekshiruv SHART: aks holda quyidagi tsiklda `out` ga
      // hech narsa tushmaydi va barcha entity'lar yo'qoladi (matn ichidagi
      // oddiy `>` belgisi ham bu holatni kiritadi).
      return { text: text, entities: ents };
    }

    // Har bir eski belgi uchun yangi offsetni `map` da saqlaymiz. Shu
    // yagona xaritalash barcha holatlarni to'g'ri hal qiladi:
    //   * `>` olib tashlangan qatordagi entity'lar qisqaradi;
    //   * bir necha qatorni bosib o'tadigan entity butunligicha saqlanadi
    //     (aks holda offset silinishi uni ikki marta chiqarardi).
    var lines = text.split('\n');
    var parts = [];
    var extra = [];
    var map = [];
    var n = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = /^>[ \t]?/.exec(line);
      var rm = m ? m[0].length : 0;
      var body = line.slice(rm);
      if (m && body) extra.push({ _: 'MessageEntityBlockquote', offset: n, length: body.length });
      for (var j = 0; j < line.length; j++) map.push(n + Math.max(0, j - rm));
      parts.push(body);
      n += body.length;
      if (i < lines.length - 1) { parts.push('\n'); map.push(n); n += 1; }
    }

    var out = [];
    for (var q = 0; q < (ents || []).length; q++) {
      var e = ents[q];
      var s = Number(e.offset), len = Number(e.length);
      if (!isFinite(s) || !isFinite(len) || len <= 0 || s < 0 || s >= map.length) continue;
      var ns = map[s];
      var ne = map[Math.min(map.length - 1, s + len - 1)] + 1;
      if (ne - ns > 0) out.push(clone(e, ns, ne - ns));
    }
    for (var w = 0; w < extra.length; w++) out.push(extra[w]);

    return { text: parts.join(''), entities: trimEnts(out) };
  }

  /**
   * Entity ro'yxatini tozalaydi va Telegram konvensiyasi bo'yicha tartibga
   * keltiradi (offset o'sishi, teng offsetda uzunlik qisqarishi).
   */
  function trimEnts(list) {
    var res = [];
    var seen = {};
    for (var i = 0; i < list.length && res.length < MAX_ENTITIES; i++) {
      var e = list[i];
      if (!e || !e._ || !(e.length > 0)) continue;
      var key = e._ + ':' + e.offset + ':' + e.length;
      if (seen[key]) continue;
      seen[key] = 1;
      res.push(e);
    }
    res.sort(function (a, b) {
      return (a.offset - b.offset) || (b.length - a.length);
    });
    return res;
  }

  /**
   * To'liq parse: markup + sitata qatorlari.
   * @return {{text: string, entities: Array}}
   */
  function parse(src, extraFn) {
    var p = parseInline(src, extraFn);
    return applyBlockquote(p.text, p.entities);
  }

  // ================================================================= RENDER
  var TAGS = {
    MessageEntityBold:       ['<b>', '</b>'],
    MessageEntityItalic:     ['<i>', '</i>'],
    MessageEntityUnderline:  ['<u>', '</u>'],
    MessageEntityStrike:     ['<s>', '</s>'],
    MessageEntityCode:       ['<code>', '</code>'],
    MessageEntityBlockquote: ['<blockquote>', '</blockquote>'],
    MessageEntityBotCommand: ['<span class="tg-cmd">', '</span>'],
    MessageEntityHashtag:    ['<span class="tg-tag">', '</span>'],
    MessageEntityCashtag:    ['<span class="tg-tag">', '</span>']
  };

  /** Faqat xavfsiz protokollarga (http/https/mailto/tg) ruxsat. */
  function safeUrl(u) {
    // Boshqaruv belgilari (0x00-0x20, 0x7f) va bo'sh joy `javascript:`
    // kabi xavfli sxemalarni oldindan olib tashlaymiz.
    u = String(u == null ? '' : u).replace(/[\x00-\x20\x7f]/g, '').trim();
    return /^(https?:\/\/|tg:\/\/|mailto:)/i.test(u) ? u : '';
  }

  function a(inner, href, cls) {
    if (!href) return '<span class="tg-link-plain">' + inner + '</span>';
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer nofollow"'
      + ' referrerpolicy="no-referrer"' + (cls ? ' class="' + cls + '"' : '') + '>'
      + inner + '</a>';
  }

  function tagsFor(e, text, innerHtml) {
    var raw = text.substr(e.offset, e.length);
    if (innerHtml === null || typeof innerHtml === 'undefined') {
      // Bargak (ichki entity yo'q) - oddiy teg bilan o'ramiz.
      // DIQQAT: `pre`dan tashqari har joyda qator uzilishlari `<br>` ga
      // aylantiriladi, aks holda matn bitta qatorda bir xil ko'rinadi.
      var inner = nl2br(esc(raw));
      switch (typeOf(e)) {
        case 'MessageEntityTextUrl':
          return a(inner, safeUrl(e.url));
        case 'MessageEntityUrl':
          return a(inner, safeUrl(raw));
        case 'MessageEntityEmail':
          return a(inner, safeUrl('mailto:' + raw));
        case 'MessageEntityMention':
          return a(inner, safeUrl('https://t.me/' + raw.replace(/^@/, '')), 'tg-ment');
        case 'MessageEntityPre':
          // `<pre>` ichida haqiqiy qator uzilishi saqlanadi.
          return '<pre class="tg-pre"><code' + (e.language
            ? ' class="language-' + esc(String(e.language)) + '"' : '') + '>' + esc(raw) + '</code></pre>';
        case 'MessageEntitySpoiler':
          return '<span class="tg-spoiler" role="button" tabindex="0">' + inner + '</span>';
        default: {
          var t = TAGS[typeOf(e)];
          return t ? t[0] + inner + t[1] : inner;
        }
      }
    }
    // Ichki entity bor - tashqi teg + ichki HTML
    switch (typeOf(e)) {
      case 'MessageEntityPre':
        return '<pre class="tg-pre"><code>' + innerHtml + '</code></pre>';
      case 'MessageEntitySpoiler':
        return '<span class="tg-spoiler" role="button" tabindex="0">' + innerHtml + '</span>';
      default: {
        var tg = TAGS[typeOf(e)];
        return tg ? tg[0] + innerHtml + tg[1] : innerHtml;
      }
    }
  }

  /**
   * Telegram sitatani har bir QATOR uchun alohida entity yuboradi:
   *   `> birinchi\n> ikkinchi`  ->  2 ta Blockquote (0..8 va 9..17)
   * Ikkalasini birlashtirmasak ekranda ikki alohida chiziqli blok paydo bo'ladi.
   * Shu sababli qo'shni (bo'sh qator bilan ajratilgan) sitatalar bitta
   * `<blockquote>` ga birlashtiriladi.
   */
  function mergeBlockquotes(list, text) {
    var res = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var prev = res[res.length - 1];
      if (prev && typeOf(prev) === 'MessageEntityBlockquote' && typeOf(e) === 'MessageEntityBlockquote') {
        var prevEnd = prev.offset + prev.length;
        var gap = e.offset - prevEnd;
        // 0 = qo'sh-qo'sh, 1 = oraliqda bitta "\n" bor
        if (gap === 0 || (gap === 1 && text.charAt(prevEnd) === '\n')) {
          prev.length = e.offset + e.length - prev.offset;
          continue;
        }
      }
      res.push(e);
    }
    return res;
  }

  function normalize(list, text) {
    var len = text.length;
    var res = [];
    var seen = {};
    for (var i = 0; i < (list || []).length; i++) {
      var e = list[i];
      if (!e) continue;
      var t = typeOf(e);
      if (!t) continue;
      var off = Number(e.offset), ln = Number(e.length);
      if (!isFinite(off) || !isFinite(ln) || ln <= 0) continue;
      if (off < 0) { ln += off; off = 0; }
      if (off + ln > len) ln = len - off;
      if (ln <= 0) continue;
      var key = t + ':' + off + ':' + ln;
      if (seen[key]) continue;
      seen[key] = 1;
      res.push(clone(e, off, ln));
    }
    res.sort(function (a2, b2) {
      return (a2.offset - b2.offset) || (b2.length - a2.length);
    });
    return mergeBlockquotes(res, text);
  }

  /**
   * Entity ichida boshqa entity bormi (ya'ni `<b><i>...</i></b>`)?
   * Tashqi teg ichida chiziqli bo'lishi kerak - aks holda matn bir tekis
   * qator bo'lib chiqadi va ichki stil ko'rinmaydi.
   */
  function hasChild(list, i) {
    var e = list[i];
    var s = e.offset, t = s + e.length;
    for (var j = 0; j < list.length; j++) {
      if (j === i) continue;
      var c = list[j];
      if (c.offset >= s && c.offset + c.length <= t && c.length < e.length) return true;
    }
    return false;
  }

  /**
   * @param {string} text
   * @param {Array} entities
   * @return {string} xavfsiz HTML
   */
  function render(text, entities) {
    text = String(text == null ? '' : text);
    if (!text) return '';
    var list = normalize(entities, text);
    if (!list.length) return nl2br(esc(text));

    // `skip` = hozirgi oynani ochgan entity. Uni qayta ishlash cheksiz
    // rekursiyaga olib kelardi (Bold 0..14 ichida Italic 6..14 -> loop).
    function walk(from, to, skip) {
      var buf = '';
      var cur = from;
      for (var i = 0; i < list.length; i++) {
        if (i === skip) continue;
        var e = list[i];
        var s = e.offset, t = s + e.length;
        if (s < from || t > to) continue;   // bu qatlamga tegmagan
        if (s < cur) continue;               // allaqachin chiqarilgan (ichki)
        buf += nl2br(esc(text.slice(cur, s)));
        buf += tagsFor(e, text, hasChild(list, i) ? walk(s, t, i) : null);
        cur = t;
      }
      buf += nl2br(esc(text.slice(cur, to)));
      return buf;
    }

    return walk(0, text.length, -1);
  }

  // ------------------------------------------------------------- yuklash
  function bindSpoilers(root) {
    root = root || (global.document && global.document.body);
    if (!root || root.__tgFormatBound) return;
    root.__tgFormatBound = true;
    var open = function (sp) {
      sp.classList.add('is-open');
    };
    root.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== root) {
        if (t.classList && t.classList.contains('tg-spoiler')) { open(t); return; }
        t = t.parentNode;
      }
    }, true);
    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var t = ev.target;
      if (t && t.classList && t.classList.contains('tg-spoiler')) {
        ev.preventDefault();
        open(t);
      }
    }, true);
  }

  var TgFormat = {
    parse: parse,
    parseInline: parseInline,
    render: render,
    esc: esc,
    bindSpoilers: bindSpoilers
  };

  global.TgFormat = TgFormat;
  if (typeof module !== 'undefined' && module.exports) module.exports = TgFormat;
})(typeof window !== 'undefined' ? window : this);