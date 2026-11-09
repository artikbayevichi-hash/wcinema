// tg-cdn-worker.js dagi `esds` tuzatish mantiqini alohida sinash.
// SW faylini to'liq ishga tushirib bo'lmaydi (u `self` ga tayanadi), shuning
// uchun faqat kerakli bo'limni ajratib olamiz.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../tg-cdn-worker.js', 'utf8');

const a = src.indexOf('const ESDS_TAG');
const b = src.indexOf('// Javob baytlarini kerak bo\'lsa tuzatilgan NUSXA');
if (a < 0 || b < 0) throw new Error('bo\'lim topilmadi');

const code = src.slice(a, b);
const mod = new Function(code + '\nreturn {patchEsds, FIXED_ESDS};')();

// 27 baytli, buzuq DSI (05 02 13 88) bo'lgan esds tanasi.
const broken = Uint8Array.from([
  0x03, 0x19, 0x00, 0x00, 0x00,
  0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00, 0x00, 0x01, 0xf4, 0x00, 0x00, 0x01, 0xf4, 0x00,
  0x05, 0x02, 0x13, 0x88,
  0x06, 0x01, 0x02,
]);
if (broken.length !== 27) throw new Error('tana uzunligi: ' + broken.length);

// MP4 qutisi: [size:4]['esds'][version+flags:4][tana]
// Oldidan 'mp4a' qo'yamiz (WebK talabi: 100 bayt ichida).
const prefix = new Uint8Array(40).fill(0xaa);
prefix.set([0x6d, 0x70, 0x34, 0x61]); // mp4a
const box = new Uint8Array(8 + 4 + broken.length);
const dv = new DataView(box.buffer);
dv.setUint32(0, box.length, false);
box.set([0x65, 0x73, 0x64, 0x73], 4);   // esds
box.set(broken, 12);

const file = new Uint8Array(prefix.length + box.length + 16);
file.set(prefix, 0);
file.set(box, prefix.length);

const before = file.slice();
const ok = mod.patchEsds(file);

console.log('patchEsds ->', ok);
console.log('o\'zgargan baytlar:', compare(before, file));
console.log('FIXED_ESDS joylandi:', compare(mod.FIXED_ESDS, file.subarray(prefix.length + 12, prefix.length + 12 + 27)) === 0);
console.log('boshqa baytlar tegilmagan:', untouched(before, file, prefix.length + 12, prefix.length + 12 + 27));

// Ikkinchi marta chaqirilganda endi buzuq emas - false qaytishi kerak.
console.log('qayta chaqiriq (allaqachon tuzatilgan) ->', mod.patchEsds(file.slice()));

function compare(x, y) {
  let n = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n;
}
function untouched(x, y, from, to) {
  for (let i = 0; i < x.length; i++) {
    if (i >= from && i < to) continue;
    if (x[i] !== y[i]) return false;
  }
  return true;
}
