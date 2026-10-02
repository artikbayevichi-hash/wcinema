// MP4 konteynerini o'qituvchi yordamchi (WcProbe.probeMp4).
//
// DIQQAT: bu endi ASOSIY MANBA. (Ilgari `tg-proof.php` dan avtomatik
// yaratilardi va "qo'lda tahrirlamang" degan edi — bu aynan shu sababdan
// "Offset is outside the bounds of the DataView" xatosi sinovdan o'tib
// ketgan edi: sinov `tg-proof.php` nusxasini tekshirardi, shu yerda esa
// tuzatilgan.) Endi `build/test-container.js` SHU faylni to'g'ridan
// yuklab tekshiradi — ikki nusxa bo'lmaydi.
//
// Asosiy qoida: quti yozuvidagi BARCHA indekslar BO'LAK ichidagi
// (chunk-relative) bo'ladi, fayl manzili EMAS. DataView bo'lakka qaragan
// bo'lgani uchun fayl manzilini uzatish chegaradan chiqishga olib keladi.
var CODEC_NAMES = {
    avc1: 'H.264 (AVC) - hamma brauzerda ishlaydi',
    avc3: 'H.264 (AVC) - hamma brauzerda ishlaydi',
    hvc1: 'HEVC/H.265 - Chrome DAStANDA qo\'llab-quvvatlamaydi',
    hev1: 'HEVC/H.265 - Chrome DAStANDA qo\'llab-quvvatlamaydi',
    'vp09': 'VP9 - ishlaydi',
    av01: 'AV1 - ishlaydi',
    mp4v: 'MPEG-4 Visual - ehtimol ishlamaydi',
    mp4a: 'AAC audio - ishlaydi',
    'ac-3': 'AC-3 audio',
    Opus: 'Opus audio'
  };

var CONTAINERS = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1, edts: 1, dinf: 1 };

// =====================================================================
//  MATROSKA / WEBM (EBML) — konteyner va KODEKNI aniqlash
// ---------------------------------------------------------------------
//  Maqsad: MKV ni bloklamasdan, ichidagi haqiqiy kodekni aniqlab
//  `canPlayType()` orqali tekshirish. Shunda:
//
//    * H.264 / HEVC / VP9 / AV1 / VP8  ->  <video> TABIIY ochiladi
//      (hech qanday konvertatsiya, 0.3 s da tayyor)
//    * MPEG-2 / VC-1 / DivX / MPEG-4 ASP, yoki qo'llab-quvvatlanmaydigan
//      AUDIO (MP3, AC-3, DTS)  ->  shu yerda qayta oʻramish/kodlash
//      kerak boʻladi (mediabunny / ffmpeg.wasm).
//
//  Bu qismi Telegram Web K ning SW'idagi tuzatmadan ilhomlangan:
//  ular ham MKV ni `<video>` ga to'g'ridan-to'g'ri beradi
//  (`Content-Type: video/x-matroska` + 206 Partial Content).
// =====================================================================

var MKV_ID = {
  SEGMENT: 0x18538067,
  TRACKS: 0x1654AE6B,
  TRACK_ENTRY: 0xAE,
  TRACK_TYPE: 0x83,        // 1 = video, 2 = audio
  CODEC_ID: 0x86,          // UTF-8 matn, masalan "V_MPEG4/ISO/AVC"
  CODEC_PRIVATE: 0x63A2    // avcC / hvcC / vpcC / av1C
};

// EBML Element ID — birinchi baytdagi nol sonralari ID uzunligini
// beradi (1..4 bayt). NOL BELGISI QOLADI.
function ebmlIdAt(u8, p) {
  if (p >= u8.length) return null;
  var b = u8[p], len = 1, mask = 0x80;
  while (len <= 4 && !(b & mask)) { mask >>= 1; len++; }
  if (len > 4 || p + len > u8.length) return null;
  var id = 0;
  for (var i = 0; i < len; i++) id = id * 256 + u8[p + i];
  return { id: id, len: len };
}

// EBML hajm — VINT. Nol belgisi OLIB TASHLANADI. Barcha bir-birlik
// bitlari 1 bo'lsa, hajm "nomaʼlum" (Segment shunday bo'ladi).
function ebmlSizeAt(u8, p) {
  if (p >= u8.length) return null;
  var b = u8[p], len = 1, mask = 0x80;
  while (len <= 8 && !(b & mask)) { mask >>= 1; len++; }
  if (len > 8 || p + len > u8.length) return null;
  var all = mask - 1;
  var val = b & all;
  for (var i = 1; i < len; i++) val = val * 256 + u8[p + i];
  return { value: val, len: len, unknown: val === all };
}

// Element bolalarini yurib o'tadi: cb(id, dataStart, dataEnd).
function ebmlWalk(u8, start, end, cb) {
  var p = start;
  while (p < end - 1) {
    var id = ebmlIdAt(u8, p);
    if (!id) return;
    var sz = ebmlSizeAt(u8, p + id.len);
    if (!sz) return;
    var ds = p + id.len + sz.len;
    if (sz.unknown) { cb(id.id, ds, end); return; }   // oxirigacha
    var de = ds + sz.value;
    if (de > end) { cb(id.id, ds, end); return; }     // kesilgan bo'lak
    cb(id.id, ds, de);
    p = de;
  }
}

// Segment > Tracks > TrackEntry ro'yxatini qaytaradi.
function mkvTracks(u8) {
  var tracks = [];
  var segStart = -1, segEnd = u8.length;

  ebmlWalk(u8, 0, u8.length, function (id, ds, de) {
    if (id === MKV_ID.SEGMENT) { segStart = ds; segEnd = de; }
  });
  if (segStart < 0) return tracks;

  ebmlWalk(u8, segStart, segEnd, function (id, ds, de) {
    if (id !== MKV_ID.TRACKS) return;
    ebmlWalk(u8, ds, de, function (eid, es, ee) {
      if (eid !== MKV_ID.TRACK_ENTRY) return;
      var t = { type: 0, codec: '', priv: null };
      ebmlWalk(u8, es, ee, function (tid, ts, te) {
        if (tid === MKV_ID.TRACK_TYPE) {
          t.type = u8[ts];
        } else if (tid === MKV_ID.CODEC_ID) {
          var s = '';
          for (var i = ts; i < te; i++) {
            var c = u8[i];
            if (c === 0) break;                      // UTF-8 NUL = tugash
            s += String.fromCharCode(c);
          }
          t.codec = s;
        } else if (tid === MKV_ID.CODEC_PRIVATE) {
          t.priv = u8.subarray(ts, te);
        }
      });
      if (t.codec) tracks.push(t);
    });
  });
  return tracks;
}

function hex2(n) {
  var s = n.toString(16).toUpperCase();
  return s.length < 2 ? '0' + s : s;
}

// avcC: [0]=version, [1]=profile, [2]=compatibility, [3]=level
function mkvAvcCodec(priv) {
  if (priv && priv.length >= 4 && priv[0] === 1) {
    return 'avc1.' + hex2(priv[1]) + hex2(priv[2]) + hex2(priv[3]);
  }
  return 'avc1.42E01E';
}

// hvcC: [0]=version, [1]=space|tier|profile, [2..5]=compatibility,
//       [6..11]=constraint, [12]=level
function mkvHevcCodec(priv) {
  try {
    if (!priv || priv.length < 13 || priv[0] !== 1) return 'hvc1.1.6.L93.B0';
    var sp = (priv[1] >> 6) & 3;
    var tier = (priv[1] >> 5) & 1;
    var prof = priv[1] & 31;
    var cf = ((priv[2] << 24) >>> 0) + (priv[3] << 16) + (priv[4] << 8) + priv[5];
    var lvl = priv[12];
    var rev = 0, t = cf >>> 0;
    for (var i = 0; i < 6; i++) { rev = rev * 16 + (t & 15); t = t >>> 4; }
    var space = sp === 0 ? '' : String.fromCharCode(64 + sp);
    return 'hvc1.' + space + prof + '.' +
      ('000000' + rev.toString(16).toUpperCase()).slice(-6) + '.' +
      (tier ? 'H' : 'L') + lvl;
  } catch (e) {
    return 'hvc1.1.6.L93.B0';
  }
}

// vpcC: [0]=version, [1]=profile, [2]=level, [3]=bitDepth(4 bit)
function mkvVp9Codec(priv) {
  try {
    if (!priv || priv.length < 4) return 'vp09.00.10.08';
    var p = priv[1] & 255, l = priv[2] & 255, d = (priv[3] >> 4) & 15;
    if (!d) d = 8;
    return 'vp09.' + hex2(p) + '.' + hex2(l) + '.' + hex2(d);
  } catch (e) {
    return 'vp09.00.10.08';
  }
}

// av1C: [1]=seq_profile(3)|seq_level_idx_0(5),
//       [2]=seq_tier_0(1)|high_bitdepth(1)|twelve_bit(1)|...
function mkvAv1Codec(priv) {
  try {
    if (!priv || priv.length < 3) return 'av01.0.05M.08';
    var prof = (priv[1] >> 5) & 7;
    var lvl = priv[1] & 31;
    var tier = (priv[2] >> 7) & 1;
    var high = (priv[2] >> 6) & 1;
    var twelve = (priv[2] >> 5) & 1;
    var depth = high ? (twelve ? 12 : 10) : 8;
    return 'av01.' + prof + '.' + hex2(lvl) + (tier ? 'H' : 'M') + '.' + hex2(depth);
  } catch (e) {
    return 'av01.0.05M.08';
  }
}

var MKV_VIDEO_CODEC = {
  'V_MPEG4/ISO/AVC': 'avc1',
  'V_MPEG4/ISO/AVC/MPEG4/AVC': 'avc1',
  'V_MPEGH/ISO/HEVC': 'hvc1',
  'V_VP8': 'vp8',
  'V_VP9': 'vp09',
  'V_AV1': 'av01',
  'V_MPEG4/ISO/ASP': 'mp4v',       // DivX / Xvid — odatda ishlamaydi
  'V_MPEG4/ISO/SP': 'mp4v',
  'V_MPEG4/ISO/AP': 'mp4v',
  'V_MPEG1': 'mpeg1video',
  'V_MPEG2': 'mpeg2video',
  'V_THEORA': 'theora'
};

var MKV_AUDIO_CODEC = {
  'A_AAC': 'mp4a.40.2',
  'A_AAC/MPEG2/LC': 'mp4a.40.2',
  'A_AAC/MPEG4/LC': 'mp4a.40.2',
  'A_AAC/MPEG4/LC/SBR': 'mp4a.40.2',
  'A_AAC/MPEG4/MAIN': 'mp4a.40.2',
  'A_AAC/MPEG4/SSR': 'mp4a.40.2',
  'A_OPUS': 'opus',
  'A_VORBIS': 'vorbis',
  'A_FLAC': 'flac',
  'A_MPEG/L3': 'mp4a.40.34',
  'A_MPEG/L2': 'mp4a.40.14',
  'A_AC3': 'ac-3',
  'A_EAC3': 'ec-3',
  'A_DTS': '',                       // MSE qabul qilmaydi
  'A_PCM/INT/LIT': 'pcm-s16le',
  'A_TTA1': 'tta',
  'A_WAVPACK4': 'wavpack'
};

function mkvVideoCodec(id, priv) {
  var base = MKV_VIDEO_CODEC[id];
  if (base === undefined) {
    // nomaʼlum lekin oilaga tegishli bo'lsa
    if (id.indexOf('AVC') >= 0) base = 'avc1';
    else if (id.indexOf('HEVC') >= 0) base = 'hvc1';
    else return '';
  }
  if (!base) return '';
  if (base === 'avc1') return mkvAvcCodec(priv);
  if (base === 'hvc1') return mkvHevcCodec(priv);
  if (base === 'vp09') return mkvVp9Codec(priv);
  if (base === 'av01') return mkvAv1Codec(priv);
  return base;
}

function mkvAudioCodec(id, priv) {
  var base = MKV_AUDIO_CODEC[id];
  if (base === undefined) {
    if (id.indexOf('AAC') >= 0) base = 'mp4a.40.2';
    else return '';
  }
  return base || '';
}

// Matroska/WebM faylni tahlil qiladi va brauzer qo'llab-quvvatlayotgan
// KODEKLARNI aniqlaydi. Natija `probeMp4` ga qaytariladi.
function probeMatroska(u8, cont) {
  var mime = cont.id === 'webm' ? 'video/webm' : 'video/x-matroska';
  var tracks = mkvTracks(u8);
  var videoId = '', audioId = '', videoCodec = '', audioCodec = '';

  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].type === 1 && !videoCodec) {
      videoId = tracks[i].codec;
      videoCodec = mkvVideoCodec(videoId, tracks[i].priv);
    } else if (tracks[i].type === 2 && !audioCodec) {
      audioId = tracks[i].codec;
      audioCodec = mkvAudioCodec(audioId, tracks[i].priv);
    }
  }

  // --- Izoh TOPILMADI: optimistik qaror -------------------------------
  // Chunki eski xatolik "MKV oynatilmaydi" edi. Endi biz aniq
  // bloklamaymiz: brauzerga urinib ko'ramiz, xato bo'lsa
  // `onVideoError()` zaxira yo'lga (mediabunny) o'tadi.
  if (!videoCodec) {
    return {
      summary: cont.name + ' — Tracks izohi topilmadi, tabiiy ochib ko‘ryamiz',
      container: cont.id, containerName: cont.name,
      playable: true, uncertain: true, reason: '',
      where: null, moovSize: 0,
      codecs: [], videoCodecs: [], audioCodecs: [],
      codecOk: false, audioOk: true,
      headBoxes: [], truncated: null
    };
  }

  var v = document.createElement('video');
  var mv = v.canPlayType(mime + '; codecs="' + videoCodec + '"');
  var ma = audioCodec ? v.canPlayType(mime + '; codecs="' + audioCodec + '"') : 'probably';
  var videoOk = mv !== '';
  var audioOk = ma !== '';
  var playable = videoOk;

  var reason = '';
  if (!videoOk) {
    reason = cont.name + ' ichidagi ' + videoId + ' kodek bu brauzerda qo‘llab-quvvatlanmaydi'
      + ' (so‘ralgan: ' + videoCodec + ') — shuning uchun faylni qayta tayyorlash kerak';
  } else if (!audioOk) {
    // Video o'ynaydi, lekin audio yo'q. Bloklamaymiz — film ko'rinadi.
    reason = '';
  }

  var codecs = [];
  if (videoCodec) codecs.push(videoCodec);
  if (audioCodec) audioCodecsPush(codecs, audioCodec);

  return {
    summary: cont.name + ' · video ' + videoId + (audioId ? ' · audio ' + audioId : '')
      + ' → ' + (videoOk ? 'brauzer ochadi' : 'qayta tayyorlash kerak')
      + (!audioOk && audioId ? ' · audio qo‘llab-quvvatlanmaydi' : ''),
    container: cont.id, containerName: cont.name,
    playable: playable, uncertain: false, reason: reason,
    where: null, moovSize: 0,
    codecs: codecs,
    videoCodecs: [videoCodec],
    audioCodecs: audioCodec ? [audioCodec] : [],
    codecOk: videoOk, audioOk: audioOk,
    headBoxes: [], truncated: null
  };
}

function audioCodecsPush(arr, c) { if (c && arr.indexOf(c) < 0) arr.push(c); }

function probeContainer(u8) {
    function str(p, n) {
      var s = '';
      for (var i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]);
      return s;
    }

    if (u8.length < 16) {
      return { id: 'short', name: 'noma\'lum', playable: false,
               reason: 'Fayl juda kichik yoki sarlavhasi o\'qilmadi' };
    }

    if (u8[0] === 0x1A && u8[1] === 0x45 && u8[2] === 0xDF && u8[3] === 0xA3) {
      // EBML ichida "matroska" yoki "webm" so'zi bor
      var ebml = str(0, Math.min(1024, u8.length));
      var webm = ebml.indexOf('webm') >= 0;
      return {
        id: webm ? 'webm' : 'mkv',
        name: webm ? 'WebM' : 'MKV (Matroska)',
        // DIQQAT — bu yerda avval `playable: false` qo'yilgan edi
        // ("Chrome MKV o'ynamaydi" degan xato fikrga tayanib). Bu
        // YOLG'ON edi va har bir MKV fayl behuda remux qilinishiga
        // majbur bo'lardi.
        //
        // HAQIQAT: Chromium ichidagi FFmpegDemuxer Matroska
        // KONTEYNERINI o'z ichida demux qiladi, shuning uchun
        // <video src="...mkv"> TABIIY ochiladi. O'lchangan faktlar
        // (Chromium 152 / Electron 44):
        //   canPlayType('video/x-matroska; codecs="avc1.4D401E"') -> 'probably'
        //   canPlayType('video/x-matroska; codecs="hvc1.1.6.L93.B0"') -> 'probably'
        //   test.mkv (2.2 MB, H.264/AAC) -> loadeddata 0.3 s, 1280x720, xato yo'q
        //
        // Ya'ni KONTEYNER hech qachon muammo emas. Haqiqiy savol —
        // ichidagi KODEK shu brauzerda bormi. Uni `probeMatroska()`
        // aniqlaydi (CodecID + CodecPrivate -> RFC 6381 -> canPlayType).
        //
        // Qolgan konteynerlar (AVI, MPEG-TS) uchun esa bu hali ham
        // to'g'ri: ularni brauzer demux qilmaydi.
        playable: true,
        matroska: true,
        reason: ''
      };
    }

    if (str(4, 4) === 'ftyp') return { id: 'mp4', name: 'MP4', playable: true };

    if (str(0, 4) === 'RIFF' && str(8, 4) === 'AVI ') {
      return { id: 'avi', name: 'AVI', playable: false,
               reason: 'Bu fayl AVI formatida — brauzer uni o\'ynata olmaydi' };
    }

    return { id: 'unknown', name: 'noma\'lum format', playable: false,
             reason: 'Fayl formati aniqlanmadi — brauzer uni o\'ynata olmaydi' };
  }
// -----------------------------------------------------------------------
//  DIQQAT: quyidagi barcha indekslar BO'LAK ichidagi (chunk-relative),
//  fayl manzili EMAS. Sababi: DataView bo'lakka qarashli, fayl esa
//  500 MB+ bo'lishi mumkin. Ilgari fayl manzili uzatilardi va
//  "Offset is outside the bounds of the DataView" xatosi chiqardi.
// -----------------------------------------------------------------------
function viewOf(u8) {
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}
function boxType(u8, p) {
  return String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
}

// Sarlavhani o'qib, qutining {type,start,size,data,cut} ni qaytaradi.
// `data` = tarkib (payload) boshlanishi, `cut` = haqiqiy ma'lumotda
// butunlay ko'rinmaganligi.
function readBoxAt(u8, p, end) {
  var dv = viewOf(u8);
  var size = dv.getUint32(p);
  var type = boxType(u8, p);
  var hdr = 8;
  if (size === 1) {
    if (p + 16 > end) return null;          // 64 baytli hajm ham to'liq yo'q
    size = Number(dv.getBigUint64(p + 8));
    hdr = 16;
  } else if (size === 0) {
    size = end - p;                          // "oxirigacha" degan belgi
  }
  if (!(size >= hdr)) return null;            // buzilgan yoki manzil chegarasidan tashqarida
  return {
    type: type,
    start: p,
    size: size,
    data: p + hdr,
    cut: (p + size) > end
  };
}

// `from`..`to` — bo'lak ichidagi indekslar. Ikkalasi ham haqiqiy
// buffer uzunligiga qisqartiriladi, shuning uchun KESILGAN quti
// chegaradan chiqib keta olmaydi.
function readBoxes(u8, from, to) {
  var out = [];
  var n = u8.byteLength;
  if (!(from >= 0)) from = 0;
  if (!(to <= n)) to = n;
  var p = from;
  while (p + 8 <= to) {
    var box = readBoxAt(u8, p, to);
    if (!box) break;
    out.push(box);
    if (box.cut) break;
    p += box.size;
  }
  return out;
}

// stsd = FullBox: 4 bayt (version+flags) + 4 bayt (entry_count)
function sampleEntryTypes(u8, box) {
  var out = [];
  var n = u8.byteLength;
  var end = box.start + box.size;
  if (end > n) end = n;                     // <- che chegarasini to'rtaramiz
  var p = box.data + 8;
  var dv = viewOf(u8);
  while (p + 8 <= end) {
    var size = dv.getUint32(p);              // p+4 <= end <= n -> xavfsiz
    if (size < 8) break;
    out.push(String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]));
    p += size;
  }
  return out;
}

function findCodecs(u8, moovFrom, moovTo) {
  var out = { vide: [], soun: [], other: [] };

  function readTrak(f, t) {
    var handler = null, stsd = null;
    (function inner(a, b, depth) {
      if (depth > 6) return;
      var bs = readBoxes(u8, a, b);
      for (var i = 0; i < bs.length; i++) {
        var box = bs[i];
        if (box.type === 'hdlr' && box.data + 12 <= u8.byteLength) {
          // hdlr = version+flags(4) + pre_defined(4) + handler_type(4)
          handler = String.fromCharCode(u8[box.data + 8], u8[box.data + 9],
            u8[box.data + 10], u8[box.data + 11]);
        } else if (box.type === 'stsd') {
          stsd = box;
        } else if (CONTAINERS[box.type]) {
          inner(box.data, box.start + box.size, depth + 1);
        }
      }
    })(f, t, 0);

    if (!stsd) return;
    var bucket = handler === 'vide' ? out.vide
      : handler === 'soun' ? out.soun
      : out.other;
    var entries = sampleEntryTypes(u8, stsd);
    for (var i = 0; i < entries.length; i++) bucket.push(entries[i]);
  }

  var top = readBoxes(u8, moovFrom, moovTo);
  for (var i = 0; i < top.length; i++) {
    if (top[i].type === 'trak') readTrak(top[i].data, top[i].start + top[i].size);
  }
  return out;
}

// -----------------------------------------------------------------------
//  mo'ov QIDIRISH
//
//  "mo'ov fayl oxirida" degan holatda biz faqat OXIRIDAN 4 MB o'qiamiz.
//  Lekin bu bo'lak odatda quti CHECARASIDAN boshlanmaydi — `size - TAIL`
//  nuqtasi `mdat` ning ICHIDA qoladi. Shuning uchun oddiy quti yozuvi
//  ishonchli emas.
//
//  Yechim: avval normal yozuv, keyin imzo bo'yicha qidiruv. Bir nechta
//  nomzat bo'lishi mumkin (mo'ov ichida ham "moov" so'zi uchraydi),
//  shuning uchun faqat VIDEO KODEKI topilgan nomzat qabul qilinadi.
// -----------------------------------------------------------------------
function moovCandidates(u8) {
  var out = [];
  var seen = {};
  function add(box) {
    if (!box) return;
    var key = box.start + ':' + box.size;
    if (seen[key]) return;
    seen[key] = 1;
    out.push(box);
  }

  // 1) to'g'ridan-to'g'ri quti yozuvi
  var boxes = readBoxes(u8, 0, u8.byteLength);
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].type === 'moov') add(boxes[i]);
  }

  // 2) imzo bo'yicha qidiruv — "mo'ov" = 6D 6F 6F 76
  for (var p = 4; p + 8 <= u8.byteLength; p++) {
    if (u8[p] !== 0x6D || u8[p + 1] !== 0x6F || u8[p + 2] !== 0x6F || u8[p + 3] !== 0x76) {
      continue;
    }
    var box = readBoxAt(u8, p - 4, u8.byteLength);
    if (box && box.type === 'moov') add(box);
  }
  return out;
}
function codecOk(t) { return t === 'avc1' || t === 'avc3' || t === 'vp09' || t === 'av01'; }
async function probeMp4(size, fetchRange) {
    var HEAD = Math.min(65536, size);
    var TAIL = Math.min(4 * 1024 * 1024, size);

    var head = await fetchRange(0, HEAD - 1);

    // --- Avval KONTAYNER turini aniqlaymiz -------------------------------
    // MP4 bo'lmasa, `moov` qutisi umuman yo'q — qidirish behuda va
    // "moov topilmadi" degan chalkash xato chiqadi. To'g'ri xato:
    // "bu MKV, brauzerda ochib bo'lmaydi".
    var cont = probeContainer(head);

    // --- MATROSKA / WEBM -------------------------------------------------
    // Konteyner brauzerda TABIIY ochiladi. Endi faqat ichidagi
    // KODEK tekshiriladi: topilmadi bo'lsa kattaroq oyna bilan
    // qayta urinamiz (Tracks baʼzan boshdan uzoqroqda bo'ladi).
    if (cont.matroska) {
      var mk = probeMatroska(head, cont);
      if (mk.uncertain && size > head.byteLength) {
        var wide = Math.min(4 * 1024 * 1024, size);
        if (wide > head.byteLength) {
          try {
            var head2 = await fetchRange(0, wide - 1);
            var mk2 = probeMatroska(head2, cont);
            if (!mk2.uncertain) mk = mk2;
          } catch (e) { /* kengaytirilgan oyna ishlamadi — asl natija qoladi */ }
        }
      }
      return mk;
    }

    if (!cont.playable) {
      // DIQQAT: `uncertain: false` MAJBURIY. Bu holatda "aniqlanmagan"
      // degani yo'q — format aniq ma'lum (MKV/WebM/AVI), demak bloklash
      // to'g'ri qaror. Maydon tushib qolsa, `undefined` bo'ladi va
      // `uncertain === false` tekshiruvi baribir `false` bo'ladi, lekin
      // aniqligi uchun maydon to'liq ko'rsatiladi.
      return {
        summary: 'format: ' + cont.name + ' — MP4 emas, brauzerda oynatilmaydi',
        container: cont.id,
        containerName: cont.name,
        playable: false,
        uncertain: false,
        reason: cont.reason,
        where: null,
        moovSize: 0,
        codecs: [], videoCodecs: [], audioCodecs: [],
        codecOk: false,
        headBoxes: [],
        truncated: null
      };
    }

    // -----------------------------------------------------------------------
    //  mo'ov QIDIRISH — 4 ta usul, ARZON usuldan qimmat tomon
    // -----------------------------------------------------------------------
    //  Indekslar BO'LAK ichidagi (chunk-relative) bo'ladi, fayl manzili EMAS.
    //  Aks holda DataView chegaradan chiqib, "Offset is outside the bounds of
    //  the DataView" xatosi beradi.
    //
    //  1) BOSH OYNA (64 KB) — arzon. `mo'ov` fayl boshida bo'lsa shu yetadi.
    //  2) `mo'ov` boshda lekin 64 KB dan KATTOR — uni ANIQ manzildan o'qiymiz.
    //  3) `mdat` hajmi sarlavhada yozilgan. Uning tugagan manzili = keyingi
    //     qutining boshlanishi, ya'ni `mo'ov` ning. ANIQ hisoblab olamiz.
    //     Bu eng muhim usul: uzun kinoda `mo'ov` o'nlab MB bo'ladi va
    //     "oxiridan 4 MB" umuman yetmaydi — `mo'ov` ning o'zi oynadan
    //     tashqarida qoladi va imzo qidiruvi ham yordam bermaydi.
    //  4) ZAXIRA: oxiridan 4 MB + imzo bo'yicha qidiruv, keyin oyna
    //     kattalashtirilib (4 -> 8 -> 16 -> 24 MB) qayta urinish.
    //
    //  Har oynada faqat VIDEO KODEKI topilgan nomzat qabul qilinadi: `mdat`
    //  ichida tasodifan "moov" so'zi uchrashi mumkin.
    // -----------------------------------------------------------------------
    var MAX_WINDOW = 24 * 1024 * 1024;

    var headList = readBoxes(head, 0, head.byteLength);
    var headTypes = headList.map(function (b) { return b.type; });

    var best = null;       // video kodeki topilgan nomzat
    var fallback = null;   // faqat nomzat topilgan (kodeksiz)
    var truncated = null;  // ogohlantirish matni (sababni saqlaydi)
    var where = null, how = null;

    // Nomzatni qabul qiladi. `true` qaytaradi — video kodeki topildi.
    function take(found) {
      if (!found) return false;
      if (!fallback) fallback = found;
      if (found.codes.vide.length && !best) { best = found; return true; }
      return false;
    }

    // Bir oynani skanerlaydi. Qaytaradi {box, codes} yoki null.
    async function scanWindow(start, want) {
      var len = Math.min(want, MAX_WINDOW, size - start);
      if (!(len >= 8)) return null;
      var w = await fetchRange(start, start + len - 1);
      var list = moovCandidates(w);
      var first = null;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var c = findCodecs(w, b.data, b.start + b.size);
        if (c.vide.length) return { box: b, codes: c };
        if (!first) first = { box: b, codes: c };
      }
      return first;
    }

    // --- 1) mo'ov bosh oynada bormi? -------------------------------------
    var idx = -1;
    for (var i = 0; i < headList.length; i++) {
      if (headList[i].type === 'moov') { idx = i; break; }
    }

    if (idx >= 0) {
      where = 'boshidan';
      var m0 = headList[idx];
      if (!m0.cut && m0.start + m0.size <= head.byteLength) {
        how = 'bosh oyna';
        take({ box: m0, codes: findCodecs(head, m0.data, m0.start + m0.size) });
      } else {
        // 64 KB sig'madi. `mo'ov` boshlanishi ma'lum — undan o'qiymiz.
        how = 'boshdan ' + ((m0.size + 65536) / 1048576).toFixed(0) + ' MB';
        take(await scanWindow(m0.start, m0.size + 65536));
      }
    }

    // --- 3) `mdat` tugagan manzil -> `mo'ov` ning ANIQ boshlanishi -------
    //
    // `mdat` = filmning o'zi, `mo'ov` = indeks. Indeks odatda faylning
    // oxirida, demak `mdat` ning o'ng tomonida qoladi. `mdat` hajmi esa
    // sarlavhada aniq yozilgan bo'lgani uchun keyingi qutining manzilini
    // BILIB qo'yamiz — tasodifiy o'qish umuman kerak bo'lmaydi.
    var nextOff = null;
    // DIQQAT: shart `idx < 0` bo'lishi SHART. `!idx` yozilsa, u faqat
    // `idx === 0` da ro'sh bo'lardi — ya'ni "mo'ov boshda topilmagan"
    // holatda (`idx === -1`) usul butunlay o'tkazib yuborilardi.
    if (!best && idx < 0) {
      for (var j = 0; j < headList.length; j++) {
        var b2 = headList[j];
        if (!b2.cut) continue;                       // to'liq ko'rindi, o'tkazamiz
        var end = b2.start + b2.size;
        if (nextOff === null || end > nextOff) nextOff = end;
      }
    }
    if (!best && nextOff !== null && nextOff + 8 < size) {
      where = 'mdat oxiridan';
      how = 'mdat oxiridan (' + (nextOff / 1048576).toFixed(1) + ' MB)';
      take(await scanWindow(nextOff, Math.min(MAX_WINDOW, size - nextOff)));
    }

    // --- 4) zaxira usul: oxiridan 4 MB -----------------------------------
    var tailFrom = size - TAIL;
    if (!best && (nextOff === null || tailFrom !== nextOff)) {
      where = 'oxiridan';
      how = 'oxiridan ' + (TAIL / 1048576).toFixed(0) + ' MB';
      take(await scanWindow(tailFrom, TAIL));
    }

    // --- 4b) oynani kattalashtirib, fayl oxiriga bog'langan holda urinamiz
    if (!best) {
      var wnd = Math.min(TAIL, size);
      for (var k = 0; k < 3; k++) {
        wnd *= 2;
        if (wnd > MAX_WINDOW) wnd = MAX_WINDOW;
        var nf = Math.max(0, size - wnd);
        if (nf >= tailFrom) break;                  // kattaroq imkoniyat yo'q
        where = 'oxiridan';
        how = 'oxiridan ' + (wnd / 1048576).toFixed(0) + ' MB';
        if (take(await scanWindow(nf, wnd))) break;
      }
    }

    var picked = best || fallback;
    var moov = picked ? picked.box : null;
    var codes = picked ? picked.codes : { vide: [], soun: [], other: [] };

    if (moov && codes.vide.length) where = where || 'topildi';
    if (!moov) {
      var tops = readBoxes(head, 0, head.byteLength);
      for (var t = 0; t < tops.length; t++) {
        if (tops[t].cut) truncated = tops[t].type + ' qutisi kesilib qoldi';
      }
    } else if (moov.cut && !codes.vide.length) {
      truncated = 'moov qutisi ' + (moov.size / 1048576).toFixed(1)
        + ' MB — oynaga sig\'madi';
    }

    var vids = codes.vide;

    // -----------------------------------------------------------------------
    //  "ANIQLANMAGAN" — bu YALG'ON xato bo'lishi mumkin
    // -----------------------------------------------------------------------
    //  Konteyner MP4 ekan, lekin `mo'ov` indeksini o'qib chiqolmadik
    //  (jumbo indeks, g'adir-budur fayl, Telegram CDN ning nozik joyi).
    //  Bunday holatda "Chrome o'ynata olmaydi" degan XATOLIQ xabar berish
    //  YOMON: aslida o'ynatilishi mumkin bo'lgan filmni bloklab qo'yadi.
    //  (Bu holatda foydalanuvchi "aniqlanmagan kodeki bor" xatosini ko'rdi,
    //  film esa Telegram'da to'g'ri oqsa ham.)
    //
    //  To'g'ri yechim: `uncertain = true` — o'yishga IZOH BILAN ruxsat
    //  beriladi. Haqiqiy kodessizlik (HEVC) alohida aniqlangan bo'lsa,
    //  `uncertain` false qoladi va CTA darhol chiqadi.
    // -----------------------------------------------------------------------
    var uncertain = vids.length === 0;
    var ok = vids.length > 0 ? vids.every(codecOk) : uncertain;

    var parts = ['format: ' + cont.name];
    parts.push('moov ' + (where || 'topilmadi')
      + (moov ? ' (' + (moov.size / 1024).toFixed(0) + ' KB)' : ''));
    parts.push('video: ' + (vids.join(', ') || 'aniqlanmadi'));
    if (codes.soun.length) parts.push('audio: ' + codes.soun.join(', '));
    if (codes.other.length) parts.push('boshqa trek: ' + codes.other.join(', '));
    if (how) parts.push('qayerdan: ' + how);

    var summary = parts.join(' · ');
    if (ok && !uncertain) summary += ' · ✅ brauzerda oynatilishi kutilmoqda';
    else if (uncertain) summary += ' · ⚠️ indeks o\'qilmadi, sinab ko\'ramiz';
    else summary += ' · ❌ bu kodek Chrome\'da ishlamaydi';

    return {
      summary: summary,
      container: cont.id,
      containerName: cont.name,
      // Oynatish uchun ikkalasi ham kerak: MP4 konteyneri VA
      // brauzer tushunadigan kodek (H.264 / AAC). HEVC (H.265) MP4 ichida
      // bo'lsa ham, Chrome uni H.264 ni qo'llab-quvvatlamaydi.
      playable: ok,
      uncertain: uncertain,
      reason: ok ? null : (uncertain
        ? 'Indeksni o\'qib chiqolmadik — sabab: ' + (truncated || 'mo\'ov topilmadi')
        : 'Bu faylda ' + vids.join(', ') + ' kodeki bor — Chrome uni o\'ynata olmaydi'),
      where: where,
      moovSize: moov ? moov.size : 0,
      codecs: vids.concat(codes.soun, codes.other),
      videoCodecs: vids,
      audioCodecs: codes.soun,
      codecOk: ok,
      headBoxes: headTypes,
      truncated: truncated
    };
  }

if (typeof window !== 'undefined') {
  window.WcProbe = { probeMp4: probeMp4, probeContainer: probeContainer };
}
