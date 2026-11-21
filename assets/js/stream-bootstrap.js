/* ============================================================================
 * stream-bootstrap.js — SQL keshidan kelgan video ma'lumotlarini iste'mol qiladi
 * ============================================================================
 * watch.php HTML ichiga `window.__WCBOOT` sifatida yoziladi:
 *   • embed      — tekshiruv natijasi + ommaviy post uchun anonim CDN manzili
 *   • sharedDoc  — kontentga tegishli doc ma'lumoti (file_reference YO'Q)
 *   • sessionDoc — FAQAT shu brauzer sessiyasining chiptasi (SQLga yozilmaydi)
 *   • preview    — 1-s instant kadr
 *   • playback   — server hal qilgan oqim turi / manzil
 *   • topic / hls
 *
 * Vazifa: qo'shimcha API so'rovlarini YO'Q qilish. Agar ma'lumot bootstrapda
 * bo'lsa, hech qanday fetch() qilinmaydi — faqat video baytlari olinadi.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function boot() {
    var b = global.__WCBOOT;
    return (b && typeof b === 'object') ? b : null;
  }

  function cacheState() {
    var b = boot();
    return b ? String(b.cache || 'unknown') : 'none';
  }

  /** api/tg-embed.php o'rniga ishlatiladigan tayyor javob. */
  function embed() {
    var b = boot();
    var e = b && b.embed;
    if (!e || typeof e !== 'object') return null;
    return {
      success: true,
      playable: !!e.playable,
      reason: String(e.reason || ''),
      cdn: e.cdn || null,
      poster: e.poster || null
    };
  }

  /** 'ok' | 'bad' | 'unknown'. */
  function embedState() {
    var e = embed();
    if (!e) return 'unknown';
    if (e.playable) return 'ok';
    return e.reason === 'unknown' ? 'unknown' : 'bad';
  }

  function docMeta(key) {
    var b = boot();
    if (!b || !key) return null;
    if (b.sessionDoc && b.sessionDoc[key]) return b.sessionDoc[key];
    return (b.sharedDoc && b.sharedDoc[key]) || null;
  }

  function preview(key) {
    var b = boot();
    return (b && key && b.preview) ? (b.preview[key] || null) : null;
  }

  function topicId() {
    var b = boot();
    return (b && Number(b.topic) > 0) ? Number(b.topic) : null;
  }

  /**
   * MP4 indeks xaritasi (faqat doc_id + size mos kelsa).
   * Birinchi tomoshabinda yo'q — keyingilarida SQL keshidan keladi.
   */
  function indexInfo(doc, size) {
    var b = boot();
    var i = b && b.index;
    if (!i || !doc || !(Number(size) > 0)) return null;
    if (String(i.doc) !== String(doc) || Number(i.size) !== Number(size)) return null;
    if (!i.moov || typeof i.moov !== 'object') return null;
    return i;
  }

  /**
   * Ommaviy post uchun anonim CDN manzili bor bo'lsa, telegram playback'ni
   * oddiy <video src> ga aylantiramiz: na MTProto sessiya, na iframe, na
   * qo'shimcha API — faqat video so'rovi qoladi.
   */
  function effectivePlayback(pb) {
    if (!pb || global.__WC_CDN_FAILED) return pb;
    var e = embed();
    if (!e || !e.playable || !e.cdn || pb.type !== 'telegram') return pb;
    var out = {};
    for (var k in pb) {
      if (Object.prototype.hasOwnProperty.call(pb, k)) out[k] = pb[k];
    }
    out.original      = pb;                 // xato bo'lsa o'z pleyerimizga qaytish
    out.type          = 'direct';
    out.url           = e.cdn;
    out.mime          = 'video/mp4';
    out.crossOrigin   = false;              // CDN CORS header yubormasligi mumkin
    out.cdnSource     = true;
    // Qo'shimcha poster so'rovi qilmaymiz — faqat video baytlari olinadi.
    return out;
  }

  /** To'g'ridan-to'g'ri CDN yo'li ishlatilayotganmi (SW/R2 kerak emas). */
  function directCdn() {
    var pb = effectivePlayback(boot() ? boot().playback : null);
    return !!(pb && pb.cdnSource);
  }

  global.WCStreamBoot = {
    boot: boot,
    cacheState: cacheState,
    embed: embed,
    embedState: embedState,
    docMeta: docMeta,
    preview: preview,
    topicId: topicId,
    indexInfo: indexInfo,
    effectivePlayback: effectivePlayback,
    directCdn: directCdn
  };
})(typeof window !== 'undefined' ? window : globalThis);
