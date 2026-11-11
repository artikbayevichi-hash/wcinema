/*!
 * tg-mtproto.js — Minimal MTProto 2.0 klient (brauzer uchun)
 * ============================================================================
 *
 * NIMA UCHUN:
 *   `tg-client.bundle.js` (GramJS/teleproto) — 5.4 MB (gzip'da 718 KB).
 *   Video ochilishidan oldin shu bundle yuklanib, decompress va parse qilinadi
 *   (mobil tarmoqda 0.5–1.5 s). Bu — boshqalaridan oldin ochilishning eng
 *   katta tormog'i edi.
 *
 *   Bu fayl faqat video oqimi uchun kerak bo'lgan qismni qo'lda yozadi:
 *     • MTProto 2.0 shifrlash (AES-256-IGE) + SHA-256
 *     • obfuscated2 transport (AES-256-CTR) + intermediate kadrlash
 *     • TL serializatsiya: initConnection / invokeWithLayer / upload.getFile
 *     • javobni o'qish: rpc_result / rpc_error / upload.file / upload.cdnFile
 *
 *   Natija: ~25 KB fayl. Video oqimi uchun 5.4 MB bundle umuman yuklanmaydi.
 *
 * XAVFSIZLIK:
 *   • Bu kod production'da ishlaydigan teleproto/GramJS implementatsiyasidan
 *     bayon qilingan (aynan production bundle'dagi AES/IGE kodi asosida).
 *   • `.work/tools/mtproto-vectors.mjs` orqali teleproto bilan BAYT-AN-BAYT
 *     tekshiriladi (`.work/tools/tg-mtproto.test.mjs`).
 *   • Ishlamasa — `tg-stream.js` avvalgi GramJS yo'liga qaytadi (fallback).
 *
 * ESHIM: Telegram DC'ga WebSocket orqali ulanadi (trafik sayt serveridan
 *   o'tmaydi!). Manzil: wss://<dc>.web.telegram.org:443/apiws
 * ============================================================================
 */
(function (global) {
    'use strict';

    // ========================================================================
    // 0. Yordamchi funksiyalar
    // ========================================================================

    function concatBytes(a, b) {
        const out = new Uint8Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
    }

    function randomBytes(n) {
        const out = new Uint8Array(n);
        const g = global.crypto || global.msCrypto;
        if (g && typeof g.getRandomValues === 'function') {
            g.getRandomValues(out);
            return out;
        }
        for (let i = 0; i < n; i++) out[i] = (Math.random() * 256) | 0;
        return out;
    }

    function base64ToBytes(b64) {
        const bin = global.atob(String(b64).replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function bytesToBase64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return global.btoa(bin);
    }

    function toBigInt(v) {
        if (typeof v === 'bigint') return v;
        if (typeof v === 'number') return BigInt(Math.trunc(v));
        if (typeof v === 'string') return v.trim() ? BigInt(v.trim()) : 0n;
        if (v instanceof Uint8Array) {
            let r = 0n;
            for (let i = v.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(v[i]);
            return r;
        }
        return 0n;
    }

    function rotr32(v, n) {
        return ((v >>> n) | (v << (32 - n))) >>> 0;
    }

    // ========================================================================
    // 1. SHA-256 (pure JS — WebCrypto `subtle` http:// da yo'q)
    // ========================================================================

    const SHA256_K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);

    function sha256(data) {
        const len = data.length;
        const total = ((len + 9 + 63) & ~63);
        const buf = new Uint8Array(total);
        buf.set(data);
        buf[len] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(total - 8, Math.floor(len / 0x20000000), false);
        dv.setUint32(total - 4, (len << 3) >>> 0, false);

        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
        let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

        const w = new Uint32Array(64);
        for (let off = 0; off < total; off += 64) {
            for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
            for (let i = 16; i < 64; i++) {
                const a = w[i - 15], b = w[i - 2];
                const s0 = (rotr32(a, 7) ^ rotr32(a, 18) ^ (a >>> 3)) >>> 0;
                const s1 = (rotr32(b, 17) ^ rotr32(b, 19) ^ (b >>> 10)) >>> 0;
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
            }
            let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
            for (let i = 0; i < 64; i++) {
                const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
                const ch = ((e & f) ^ (~e & g)) >>> 0;
                const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
                const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
                const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
                const t2 = (S0 + maj) >>> 0;
                h = g; g = f; f = e; e = (d + t1) >>> 0;
                d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
            h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
        }
        const out = new Uint8Array(32);
        const odv = new DataView(out.buffer);
        odv.setUint32(0, h0, false); odv.setUint32(4, h1, false);
        odv.setUint32(8, h2, false); odv.setUint32(12, h3, false);
        odv.setUint32(16, h4, false); odv.setUint32(20, h5, false);
        odv.setUint32(24, h6, false); odv.setUint32(28, h7, false);
        return out;
    }

    // ========================================================================
    // 2. AES-256 (ECB bloki) + CTR + IGE
    //    Jadval va algoritm production bundle'idagi teleproto IGE.js dan.
    // ========================================================================

    const InvSbox = new Uint8Array(256);
    const Td0 = new Uint32Array(256);
    const Td1 = new Uint32Array(256);
    const Td2 = new Uint32Array(256);
    const Td3 = new Uint32Array(256);
    const Te0 = new Uint32Array(256);
    const Te1 = new Uint32Array(256);
    const Te2 = new Uint32Array(256);
    const Te3 = new Uint32Array(256);
    const Sbox = new Uint8Array(256);
    const Rcon = [
        16777216, 33554432, 67108864, 134217728, 268435456,
        536870912, 1073741824, 2147483648, 452984832, 905969664
    ];

    (function initTables() {
        const xtime = (a) => (a << 1 ^ (a & 128 ? 283 : 0)) & 255;
        const inv = new Uint8Array(256);
        let p = 1, q = 1;
        do {
            p = (p ^ p << 1 ^ (p & 128 ? 283 : 0)) & 255;
            q ^= q << 1;
            q ^= q << 2;
            q ^= q << 4;
            q &= 255;
            if (q & 128) q ^= 9;
            inv[p] = q;
        } while (p !== 1);
        inv[0] = 0;
        for (let i = 0; i < 256; i++) {
            const x = inv[i];
            let s = x ^ (x << 1 | x >> 7) ^ (x << 2 | x >> 6) ^ (x << 3 | x >> 5) ^ (x << 4 | x >> 4) ^ 99;
            s &= 255;
            Sbox[i] = s;
            InvSbox[s] = i;
        }
        for (let i = 0; i < 256; i++) {
            const j = InvSbox[i];
            const m9 = (xtime(xtime(xtime(j))) ^ j) & 255;
            const mb = (xtime(xtime(xtime(j))) ^ xtime(j) ^ j) & 255;
            const md = (xtime(xtime(xtime(j))) ^ xtime(xtime(j)) ^ j) & 255;
            const me = (xtime(xtime(xtime(j))) ^ xtime(xtime(j)) ^ xtime(j)) & 255;
            Td0[i] = (me << 24 | m9 << 16 | md << 8 | mb) >>> 0;
            Td1[i] = (mb << 24 | me << 16 | m9 << 8 | md) >>> 0;
            Td2[i] = (md << 24 | mb << 16 | me << 8 | m9) >>> 0;
            Td3[i] = (m9 << 24 | md << 16 | mb << 8 | me) >>> 0;

            const s = Sbox[i];
            const s2 = xtime(s), s3 = s2 ^ s;
            Te0[i] = (s2 << 24 | s << 16 | s << 8 | s3) >>> 0;
            Te1[i] = rotr32(Te0[i], 8);
            Te2[i] = rotr32(Te0[i], 16);
            Te3[i] = rotr32(Te0[i], 24);
        }
    })();

    const AES256_ROUNDS = 14;

    function expandKey(key) {
        const Nk = 8;
        const ek = new Uint32Array(4 * (AES256_ROUNDS + 1));
        for (let i = 0; i < Nk; i++) {
            ek[i] = (key[4 * i] << 24 | key[4 * i + 1] << 16 | key[4 * i + 2] << 8 | key[4 * i + 3]) >>> 0;
        }
        for (let i = Nk; i < ek.length; i++) {
            let t = ek[i - 1];
            if (i % Nk === 0) {
                t = (t << 8 | t >>> 24) >>> 0;
                t = (Sbox[t >>> 24 & 255] << 24 | Sbox[t >>> 16 & 255] << 16 | Sbox[t >>> 8 & 255] << 8 | Sbox[t & 255]) >>> 0;
                t = (t ^ Rcon[i / Nk - 1]) >>> 0;
            } else if (i % Nk === 4) {
                t = (Sbox[t >>> 24 & 255] << 24 | Sbox[t >>> 16 & 255] << 16 | Sbox[t >>> 8 & 255] << 8 | Sbox[t & 255]) >>> 0;
            }
            ek[i] = (ek[i - Nk] ^ t) >>> 0;
        }
        return ek;
    }

    function expandDecKey(key) {
        const ek = expandKey(key);
        const dk = new Uint32Array(ek.length);
        for (let r = 0; r <= AES256_ROUNDS; r++) {
            for (let c = 0; c < 4; c++) dk[4 * r + c] = ek[4 * (AES256_ROUNDS - r) + c];
        }
        for (let r = 1; r < AES256_ROUNDS; r++) {
            for (let c = 0; c < 4; c++) {
                const w = dk[4 * r + c];
                dk[4 * r + c] = (Td0[Sbox[w >>> 24 & 255]] ^ Td1[Sbox[w >>> 16 & 255]] ^
                    Td2[Sbox[w >>> 8 & 255]] ^ Td3[Sbox[w & 255]]) >>> 0;
            }
        }
        return dk;
    }

    function encBlock(ek, s0, s1, s2, s3, out) {
        s0 = (s0 ^ ek[0]) >>> 0;
        s1 = (s1 ^ ek[1]) >>> 0;
        s2 = (s2 ^ ek[2]) >>> 0;
        s3 = (s3 ^ ek[3]) >>> 0;
        let k = 4;
        for (let r = 1; r < AES256_ROUNDS; r++) {
            const t0 = (Te0[s0 >>> 24 & 255] ^ Te1[s1 >>> 16 & 255] ^ Te2[s2 >>> 8 & 255] ^ Te3[s3 & 255] ^ ek[k++]) >>> 0;
            const t1 = (Te0[s1 >>> 24 & 255] ^ Te1[s2 >>> 16 & 255] ^ Te2[s3 >>> 8 & 255] ^ Te3[s0 & 255] ^ ek[k++]) >>> 0;
            const t2 = (Te0[s2 >>> 24 & 255] ^ Te1[s3 >>> 16 & 255] ^ Te2[s0 >>> 8 & 255] ^ Te3[s1 & 255] ^ ek[k++]) >>> 0;
            const t3 = (Te0[s3 >>> 24 & 255] ^ Te1[s0 >>> 16 & 255] ^ Te2[s1 >>> 8 & 255] ^ Te3[s2 & 255] ^ ek[k++]) >>> 0;
            s0 = t0; s1 = t1; s2 = t2; s3 = t3;
        }
        out[0] = ((Sbox[s0 >>> 24 & 255] << 24 | Sbox[s1 >>> 16 & 255] << 16 |
            Sbox[s2 >>> 8 & 255] << 8 | Sbox[s3 & 255]) ^ ek[k++]) >>> 0;
        out[1] = ((Sbox[s1 >>> 24 & 255] << 24 | Sbox[s2 >>> 16 & 255] << 16 |
            Sbox[s3 >>> 8 & 255] << 8 | Sbox[s0 & 255]) ^ ek[k++]) >>> 0;
        out[2] = ((Sbox[s2 >>> 24 & 255] << 24 | Sbox[s3 >>> 16 & 255] << 16 |
            Sbox[s0 >>> 8 & 255] << 8 | Sbox[s1 & 255]) ^ ek[k++]) >>> 0;
        out[3] = ((Sbox[s3 >>> 24 & 255] << 24 | Sbox[s0 >>> 16 & 255] << 16 |
            Sbox[s1 >>> 8 & 255] << 8 | Sbox[s2 & 255]) ^ ek[k++]) >>> 0;
    }

    function decBlock(dk, s0, s1, s2, s3, out) {
        s0 = (s0 ^ dk[0]) >>> 0;
        s1 = (s1 ^ dk[1]) >>> 0;
        s2 = (s2 ^ dk[2]) >>> 0;
        s3 = (s3 ^ dk[3]) >>> 0;
        let k = 4;
        for (let r = 1; r < AES256_ROUNDS; r++) {
            const t0 = (Td0[s0 >>> 24 & 255] ^ Td1[s3 >>> 16 & 255] ^ Td2[s2 >>> 8 & 255] ^ Td3[s1 & 255] ^ dk[k++]) >>> 0;
            const t1 = (Td0[s1 >>> 24 & 255] ^ Td1[s0 >>> 16 & 255] ^ Td2[s3 >>> 8 & 255] ^ Td3[s2 & 255] ^ dk[k++]) >>> 0;
            const t2 = (Td0[s2 >>> 24 & 255] ^ Td1[s1 >>> 16 & 255] ^ Td2[s0 >>> 8 & 255] ^ Td3[s3 & 255] ^ dk[k++]) >>> 0;
            const t3 = (Td0[s3 >>> 24 & 255] ^ Td1[s2 >>> 16 & 255] ^ Td2[s1 >>> 8 & 255] ^ Td3[s0 & 255] ^ dk[k++]) >>> 0;
            s0 = t0; s1 = t1; s2 = t2; s3 = t3;
        }
        out[0] = ((InvSbox[s0 >>> 24 & 255] << 24 | InvSbox[s3 >>> 16 & 255] << 16 |
            InvSbox[s2 >>> 8 & 255] << 8 | InvSbox[s1 & 255]) ^ dk[k++]) >>> 0;
        out[1] = ((InvSbox[s1 >>> 24 & 255] << 24 | InvSbox[s0 >>> 16 & 255] << 16 |
            InvSbox[s3 >>> 8 & 255] << 8 | InvSbox[s2 & 255]) ^ dk[k++]) >>> 0;
        out[2] = ((InvSbox[s2 >>> 24 & 255] << 24 | InvSbox[s1 >>> 16 & 255] << 16 |
            InvSbox[s0 >>> 8 & 255] << 8 | InvSbox[s3 & 255]) ^ dk[k++]) >>> 0;
        out[3] = ((InvSbox[s3 >>> 24 & 255] << 24 | InvSbox[s2 >>> 16 & 255] << 16 |
            InvSbox[s1 >>> 8 & 255] << 8 | InvSbox[s0 & 255]) ^ dk[k++]) >>> 0;
    }

    /** AES-256-ECB bitta blokni shifrlaydi (16 bayt). */
    function aesEncryptBlock(key, block, out, off) {
        const ek = expandKey(key);
        const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
        const o = new Uint32Array(4);
        encBlock(ek, dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12), o);
        const odv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        odv.setUint32(off, o[0]); odv.setUint32(off + 4, o[1]);
        odv.setUint32(off + 8, o[2]); odv.setUint32(off + 12, o[3]);
    }

    /** AES-256-ECB bitta blokni ochadi (16 bayt). */
    function aesDecryptBlock(key, block, out, off) {
        const dk = expandDecKey(key);
        const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
        const o = new Uint32Array(4);
        decBlock(dk, dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12), o);
        const odv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        odv.setUint32(off, o[0]); odv.setUint32(off + 4, o[1]);
        odv.setUint32(off + 8, o[2]); odv.setUint32(off + 12, o[3]);
    }

    /** AES-256-IGE shifrlash. */
    function igeEncrypt(key, iv, plain) {
        const n = plain.length;
        const out = new Uint8Array(n);
        const ek = expandKey(key);
        const tmp = new Uint8Array(16);
        const res = new Uint32Array(4);
        const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
        let c0 = (iv[0] << 24 | iv[1] << 16 | iv[2] << 8 | iv[3]) >>> 0;
        let c1 = (iv[4] << 24 | iv[5] << 16 | iv[6] << 8 | iv[7]) >>> 0;
        let c2 = (iv[8] << 24 | iv[9] << 16 | iv[10] << 8 | iv[11]) >>> 0;
        let c3 = (iv[12] << 24 | iv[13] << 16 | iv[14] << 8 | iv[15]) >>> 0;
        let p0 = (iv[16] << 24 | iv[17] << 16 | iv[18] << 8 | iv[19]) >>> 0;
        let p1 = (iv[20] << 24 | iv[21] << 16 | iv[22] << 8 | iv[23]) >>> 0;
        let p2 = (iv[24] << 24 | iv[25] << 16 | iv[26] << 8 | iv[27]) >>> 0;
        let p3 = (iv[28] << 24 | iv[29] << 16 | iv[30] << 8 | iv[31]) >>> 0;
        const odv = new DataView(out.buffer);
        for (let i = 0; i < n; i += 16) {
            const b0 = (dv.getUint32(i) ^ c0) >>> 0;
            const b1 = (dv.getUint32(i + 4) ^ c1) >>> 0;
            const b2 = (dv.getUint32(i + 8) ^ c2) >>> 0;
            const b3 = (dv.getUint32(i + 12) ^ c3) >>> 0;
            encBlock(ek, b0, b1, b2, b3, res);
            const n0 = (res[0] ^ p0) >>> 0;
            const n1 = (res[1] ^ p1) >>> 0;
            const n2 = (res[2] ^ p2) >>> 0;
            const n3 = (res[3] ^ p3) >>> 0;
            odv.setUint32(i, n0); odv.setUint32(i + 4, n1);
            odv.setUint32(i + 8, n2); odv.setUint32(i + 12, n3);
            c0 = n0; c1 = n1; c2 = n2; c3 = n3;
            p0 = dv.getUint32(i); p1 = dv.getUint32(i + 4);
            p2 = dv.getUint32(i + 8); p3 = dv.getUint32(i + 12);
        }
        return out;
    }

    /** AES-256-IGE ochish. */
    function igeDecrypt(key, iv, cipher) {
        const n = cipher.length;
        const out = new Uint8Array(n);
        const dk = expandDecKey(key);
        const tmp = new Uint32Array(4);
        const cv = new DataView(cipher.buffer, cipher.byteOffset, cipher.byteLength);
        const ov = new DataView(out.buffer);
        let pc0 = (iv[0] << 24 | iv[1] << 16 | iv[2] << 8 | iv[3]) >>> 0;
        let pc1 = (iv[4] << 24 | iv[5] << 16 | iv[6] << 8 | iv[7]) >>> 0;
        let pc2 = (iv[8] << 24 | iv[9] << 16 | iv[10] << 8 | iv[11]) >>> 0;
        let pc3 = (iv[12] << 24 | iv[13] << 16 | iv[14] << 8 | iv[15]) >>> 0;
        let pp0 = (iv[16] << 24 | iv[17] << 16 | iv[18] << 8 | iv[19]) >>> 0;
        let pp1 = (iv[20] << 24 | iv[21] << 16 | iv[22] << 8 | iv[23]) >>> 0;
        let pp2 = (iv[24] << 24 | iv[25] << 16 | iv[26] << 8 | iv[27]) >>> 0;
        let pp3 = (iv[28] << 24 | iv[29] << 16 | iv[30] << 8 | iv[31]) >>> 0;
        for (let i = 0; i < n; i += 16) {
            const c0 = cv.getUint32(i), c1 = cv.getUint32(i + 4);
            const c2 = cv.getUint32(i + 8), c3 = cv.getUint32(i + 12);
            decBlock(dk, (c0 ^ pp0) >>> 0, (c1 ^ pp1) >>> 0, (c2 ^ pp2) >>> 0, (c3 ^ pp3) >>> 0, tmp);
            const p0 = (tmp[0] ^ pc0) >>> 0;
            const p1 = (tmp[1] ^ pc1) >>> 0;
            const p2 = (tmp[2] ^ pc2) >>> 0;
            const p3 = (tmp[3] ^ pc3) >>> 0;
            ov.setUint32(i, p0); ov.setUint32(i + 4, p1);
            ov.setUint32(i + 8, p2); ov.setUint32(i + 12, p3);
            pc0 = c0; pc1 = c1; pc2 = c2; pc3 = c3;
            pp0 = p0; pp1 = p1; pp2 = p2; pp3 = p3;
        }
        return out;
    }

    /** AES-256-CTR (16 baytli nonce, to'liq 128-bit big-endian hisoblagich). */
    function CtrStream(key, iv) {
        this.ek = expandKey(key);
        this.counter = new Uint8Array(iv);
        this.keystream = new Uint8Array(16);
        this.used = 16;
        this.res = new Uint32Array(4);
    }
    CtrStream.prototype._next = function () {
        const dv = new DataView(this.counter.buffer);
        const b = new Uint8Array(16);
        const o = new Uint32Array(4);
        encBlock(this.ek, dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12), o);
        const bdv = new DataView(b.buffer);
        bdv.setUint32(0, o[0]); bdv.setUint32(4, o[1]);
        bdv.setUint32(8, o[2]); bdv.setUint32(12, o[3]);
        this.keystream = b;
        this.used = 0;
        for (let i = 15; i >= 0; i--) {
            this.counter[i] = this.counter[i] + 1 & 255;
            if (this.counter[i] !== 0) break;
        }
    };
    CtrStream.prototype.update = function (data) {
        const out = new Uint8Array(data.length);
        for (let off = 0; off < data.length;) {
            if (this.used === 16) this._next();
            const count = Math.min(16 - this.used, data.length - off);
            for (let i = 0; i < count; i++) out[off + i] = data[off + i] ^ this.keystream[this.used + i];
            this.used += count;
            off += count;
        }
        return out;
    };

    // ========================================================================
    // 3. TL (Type Language) — yozuvchi va o'quvchi
    // ========================================================================

    function TgWriter() {
        this.buf = new Uint8Array(1024);
        this.len = 0;
    }
    TgWriter.prototype._need = function (n) {
        if (this.len + n <= this.buf.length) return;
        let size = this.buf.length * 2;
        while (size < this.len + n) size *= 2;
        const nb = new Uint8Array(size);
        nb.set(this.buf.subarray(0, this.len));
        this.buf = nb;
    };
    TgWriter.prototype.u32 = function (v) {
        this._need(4);
        const dv = new DataView(this.buf.buffer);
        dv.setUint32(this.len, v >>> 0, true);
        this.len += 4;
    };
    TgWriter.prototype.i32 = function (v) {
        this._need(4);
        const dv = new DataView(this.buf.buffer);
        dv.setInt32(this.len, v | 0, true);
        this.len += 4;
    };
    TgWriter.prototype.long = function (v) {
        const b = toBigInt(v);
        this.u32(Number(b & 0xFFFFFFFFn));
        this.u32(Number((b >> 32n) & 0xFFFFFFFFn));
    };
    /**
     * TL `bytes`/`string` kodlash (production bundle'dagi serializeBytes bilan
     * bir xil): uzunlik < 254 → 1 bayt; aks holda 254 + 3 bayt (LE).
     * To'ldiruvchi (padding) 4-baytlik chegaraga to'g'riladi.
     */
    TgWriter.prototype.bytes = function (b) {
        const len = b.length;
        let header;
        if (len < 254) {
            header = 1;
            this._need(1);
            this.buf[this.len++] = len;
        } else {
            header = 4;
            this._need(4);
            this.buf[this.len++] = 254;
            this.buf[this.len++] = len & 0xFF;
            this.buf[this.len++] = (len >> 8) & 0xFF;
            this.buf[this.len++] = (len >> 16) & 0xFF;
        }
        const pad = (4 - ((header + len) % 4)) % 4;
        this._need(len + pad);
        this.buf.set(b, this.len);
        this.len += len;
        for (let i = 0; i < pad; i++) this.buf[this.len++] = 0;
    };
    TgWriter.prototype.str = function (s) {
        const enc = typeof TextEncoder !== 'undefined'
            ? new TextEncoder().encode(s)
            : Uint8Array.from(unescape(encodeURIComponent(s)).split('').map((c) => c.charCodeAt(0)));
        this.bytes(enc);
    };
    TgWriter.prototype.raw = function (b) {
        this._need(b.length);
        this.buf.set(b, this.len);
        this.len += b.length;
    };
    TgWriter.prototype.finish = function () {
        return this.buf.subarray(0, this.len);
    };

    function TgReader(data, offset) {
        this.data = data;
        this.off = offset || 0;
        this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    TgReader.prototype.u32 = function () {
        const v = this.dv.getUint32(this.off, true);
        this.off += 4;
        return v;
    };
    TgReader.prototype.i32 = function () {
        const v = this.dv.getInt32(this.off, true);
        this.off += 4;
        return v;
    };
    TgReader.prototype.long = function () {
        const lo = this.u32();
        const hi = this.u32();
        return (BigInt(hi) << 32n) | BigInt(lo);
    };
    TgReader.prototype.bytes = function () {
        const first = this.data[this.off++];
        let len, header;
        if (first < 254) {
            len = first;
            header = 1;
        } else {
            len = this.data[this.off] | (this.data[this.off + 1] << 8) | (this.data[this.off + 2] << 16);
            this.off += 3;
            header = 4;
        }
        const out = this.data.subarray(this.off, this.off + len);
        this.off += len;
        const pad = (4 - ((header + len) % 4)) % 4;
        this.off += pad;
        return out;
    };
    TgReader.prototype.str = function () {
        const b = this.bytes();
        if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b);
        let s = '';
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return decodeURIComponent(escape(s));
    };

    // --- TL konstruktor ID'lar (production bundle sxemasi, layer 229) ---
    const TL = {
        INIT_CONNECTION: 0xc1cd5ea9,
        INVOKE_WITH_LAYER: 0xda9b0d0d,
        UPLOAD_GET_FILE: 0xbe5335be,
        UPLOAD_FILE: 0x96a18d5,
        UPLOAD_CDN_FILE: 0xa99fca4f,
        INPUT_DOCUMENT_FILE_LOCATION: 0xbad07584,
        RPC_RESULT: 0xf35c6d01,
        RPC_ERROR: 0x2144ca19,
        MSG_CONTAINER: 0x73f3f8dc,
        MSG_ACK: 0x62b6f447
    };

    const LAYER = 229;

    function buildGetFile(loc, offset, limit) {
        const w = new TgWriter();
        w.u32(TL.UPLOAD_GET_FILE);
        w.u32(1);                 // flags: precise (bit 0)
        w.u32(TL.INPUT_DOCUMENT_FILE_LOCATION);
        w.long(loc.id);
        w.long(loc.accessHash);
        w.bytes(loc.fileReference);
        w.str(loc.thumbSize || '');
        w.long(offset);
        w.i32(limit);
        return w.finish();
    }

    function buildInitConnection(query, init) {
        const w = new TgWriter();
        w.u32(TL.INIT_CONNECTION);
        w.u32(0);                 // flags: proxy/params yo'q
        w.i32(init.apiId);
        w.str(init.deviceModel);
        w.str(init.systemVersion);
        w.str(init.appVersion);
        w.str(init.systemLangCode);
        w.str(init.langPack);
        w.str(init.langCode);
        w.raw(query);             // query: X
        return w.finish();
    }

    function buildInvokeWithLayer(query) {
        const w = new TgWriter();
        w.u32(TL.INVOKE_WITH_LAYER);
        w.i32(LAYER);
        w.raw(query);
        return w.finish();
    }

    // ========================================================================
    // 4. Sessiya (localStorage) ni o'qish
    // ========================================================================

    /**
     * GramJS/teleproto StringSession formati:
     *   '1' + base64(dcId:u8 | [ip4:4 | addrLen:i16BE + addr] | port:i16BE | authKey:256)
     */
    function parseSession(str) {
        if (!str || typeof str !== 'string') throw new Error('Sessiya topilmadi');
        if (str[0] !== '1') throw new Error('Sessiya versiyasi qo\'llab-quvvatlanmaydi');
        const b64 = str.slice(1);
        const bin = base64ToBytes(b64);
        const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
        let off = 0;
        const dcId = dv.getUint8(off); off += 1;
        let address;
        if (b64.length === 352) {
            address = dv.getUint8(off) + '.' + dv.getUint8(off + 1) + '.' +
                dv.getUint8(off + 2) + '.' + dv.getUint8(off + 3);
            off += 4;
        } else {
            const len = dv.getInt16(off, false); off += 2;
            if (len > 100) {
                const parts = [];
                for (let i = 0; i < 16; i += 2) {
                    parts.push(dv.getUint16(off + i, false).toString(16));
                }
                address = parts.join(':');
                off += 16;
            } else {
                let s = '';
                for (let i = 0; i < len; i++) s += String.fromCharCode(bin[off + i]);
                address = s;
                off += len;
            }
        }
        const port = dv.getInt16(off, false); off += 2;
        const authKey = bin.subarray(off, off + 256);
        if (authKey.length !== 256) throw new Error('auth_key uzunligi noto\'g\'ri');
        return { dcId, address, port, authKey };
    }

    // ========================================================================
    // 5. MTProto ulanishi (obfuscated2 + intermediate kadrlash, WebSocket)
    // ========================================================================

    const DC_HOSTS = { 1: 'pluto', 2: 'venus', 3: 'aurora', 4: 'vesta', 5: 'flora' };
    const WS_PORT = 443;

    function dcHost(dcId) {
        const h = DC_HOSTS[dcId];
        if (!h) throw new Error('Noma\'lum DC: ' + dcId);
        return h + '.web.telegram.org';
    }

    function MtConnection(opts) {
        this.authKey = opts.authKey;
        this.keyId = opts.keyId;               // 8 bayt
        this.dcId = opts.dcId;
        this.salt = new Uint8Array(8);         // server salt (javobdan yangilanadi)
        this.sessionId = randomBytes(8);
        this.seqNo = 0;
        this.lastMsgId = 0n;
        this.pending = new Map();
        this.buf = new Uint8Array(0);
        this.ws = null;
        this.ready = false;
        this.closed = false;
        this.encryptor = null;
        this.decryptor = null;
    }

    MtConnection.prototype._nextMsgId = function () {
        const now = Date.now() / 1000;
        const sec = Math.floor(now);
        const frac = Math.floor((now - sec) * 4294967296) & ~3;
        let id = (BigInt(sec) << 32n) | BigInt(frac >>> 0);
        if (id <= this.lastMsgId) id = this.lastMsgId + 4n;
        this.lastMsgId = id;
        return id;
    };

    /** MTProto 2.0: a = sha256(msgKey + authKey[x..x+36]), b = sha256(authKey[x+40..x+76] + msgKey) */
    MtConnection.prototype._calcKey = function (msgKey, client) {
        const x = client ? 0 : 8;
        const a = sha256(concatBytes(msgKey, this.authKey.subarray(x, x + 36)));
        const b = sha256(concatBytes(this.authKey.subarray(x + 40, x + 76), msgKey));
        const key = new Uint8Array(32);
        key.set(a.subarray(0, 8), 0);
        key.set(b.subarray(8, 24), 8);
        key.set(a.subarray(24, 32), 24);
        const iv = new Uint8Array(32);
        iv.set(b.subarray(0, 8), 0);
        iv.set(a.subarray(8, 24), 8);
        iv.set(b.subarray(24, 32), 24);
        return { key, iv };
    };

    /** MTProto paketini yig'adi va shifrlaydi: keyId(8) + msgKey(16) + IGE(plain) */
    MtConnection.prototype.encryptMessage = function (body) {
        const msgId = this._nextMsgId();
        const seqNo = (this.seqNo++ * 2) + 1;
        const w = new TgWriter();
        w.long(msgId);
        w.i32(seqNo);
        w.i32(body.length);
        w.raw(body);
        const inner = w.finish();
        return this._encryptInner(inner, msgId, seqNo).packet;
    };

    /**
     * `inner` (msgId|seqNo|len|body) dan to'liq MTProto paketini yasaydi.
     * Test uchun deterministik variant — msgId/seqNo oldindan beriladi.
     */
    MtConnection.prototype._encryptInner = function (inner, msgId, seqNo, padOverride) {
        const padLen = (((-(16 + inner.length + 12)) % 16) + 16) % 16 + 12;
        const plain = new Uint8Array(16 + inner.length + padLen);
        plain.set(this.salt, 0);
        plain.set(this.sessionId, 8);
        plain.set(inner, 16);
        if (padOverride) {
            plain.set(padOverride, 16 + inner.length);
        } else {
            randomBytes(padLen).forEach((b, i) => { plain[16 + inner.length + i] = b; });
        }

        const msgKeyLarge = sha256(concatBytes(this.authKey.subarray(88, 120), plain));
        const msgKey = msgKeyLarge.subarray(8, 24);
        const { key, iv } = this._calcKey(msgKey, true);
        const encrypted = igeEncrypt(key, iv, plain);

        const packet = new Uint8Array(24 + encrypted.length);
        packet.set(this.keyId, 0);
        packet.set(msgKey, 8);
        packet.set(encrypted, 24);
        return { packet: packet, plain: plain, msgKey: msgKey };
    };

    /** Serverdan kelgan paketni ochadi. Qaytaradi: {msgId, salt, body} */
    MtConnection.prototype.decryptMessage = function (packet) {
        if (packet.length < 24) throw new Error('Paket juda qisqa');
        const msgKey = packet.subarray(8, 24);
        const { key, iv } = this._calcKey(msgKey, false);
        const plain = igeDecrypt(key, iv, packet.subarray(24));
        // Tekshiruv: msg_key = sha256(authKey[96..128] + plain)[8..24]
        const expect = sha256(concatBytes(this.authKey.subarray(96, 128), plain)).subarray(8, 24);
        for (let i = 0; i < 16; i++) {
            if (expect[i] !== msgKey[i]) throw new Error('msg_key mos kelmadi');
        }
        const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
        const salt = plain.subarray(0, 8);
        // plain: salt(8) | session_id(8) | msg_id(8) | seq_no(4) | length(4) | body
        const msgId = (BigInt(dv.getUint32(20, true)) << 32n) | BigInt(dv.getUint32(16, true));
        const seqNo = dv.getInt32(24, true);
        const len = dv.getInt32(28, true);
        const body = plain.subarray(32, 32 + len);
        return { msgId, salt, seqNo, body };
    };

    MtConnection.prototype.connect = function () {
        if (this.ready) return Promise.resolve(this);
        const self = this;
        return new Promise(function (resolve, reject) {
            let url;
            try {
                url = 'wss://' + dcHost(self.dcId) + ':' + WS_PORT + '/apiws';
            } catch (e) {
                reject(e);
                return;
            }
            let ws;
            try {
                ws = new global.WebSocket(url, 'binary');
            } catch (e) {
                reject(e);
                return;
            }
            ws.binaryType = 'arraybuffer';
            let settled = false;
            const fail = (err) => {
                if (settled) return;
                settled = true;
                try { ws.close(); } catch (e) {}
                reject(err);
            };
            const timer = setTimeout(function () {
                fail(new Error('WebSocket ulanish vaqti tugadi'));
            }, 15000);
            ws.onerror = function () {
                const error = new Error('WebSocket xatosi');
                if (!settled) fail(error);
                else self._failAll(error);
            };
            ws.onclose = function () {
                if (!settled) fail(new Error('WebSocket yopildi'));
                else {
                    self.closed = true;
                    self.ready = false;
                    self._failAll(new Error('Telegram WebSocket uzildi'));
                }
            };
            ws.onopen = function () {
                try {
                    // --- obfuscated2 handshake ---
                    const header = randomBytes(64);
                    while (header[0] === 0xef) {
                        const h2 = randomBytes(64);
                        h2.set(header, 0);
                        header.set(h2);
                    }
                    const dv = new DataView(header.buffer);
                    // tag "eeeeeeee" (intermediate protocol)
                    dv.setUint32(56, 0xeeeeeeee, true);
                    dv.setInt16(60, self.dcId, true);
                    const reversed = new Uint8Array(64);
                    for (let i = 0; i < 64; i++) reversed[i] = header[63 - i];
                    const enc = new CtrStream(header.subarray(8, 40), header.subarray(40, 56));
                    const dec = new CtrStream(reversed.subarray(8, 40), reversed.subarray(40, 56));
                    // header ning oxirgi 8 bayti shifrlanadi (keystream 56..64)
                    const encHeader = enc.update(header);
                    header.set(encHeader.subarray(56, 64), 56);
                    self.encryptor = enc;
                    self.decryptor = dec;
                    ws.send(header.buffer);
                    self.ws = ws;
                    self.ready = true;
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(self);
                    }
                } catch (e) {
                    fail(e);
                }
            };
            ws.onmessage = function (ev) {
                let chunk;
                if (typeof ev.data === 'string') {
                    chunk = new Uint8Array(ev.data.length);
                    for (let i = 0; i < ev.data.length; i++) chunk[i] = ev.data.charCodeAt(i) & 0xFF;
                } else {
                    chunk = new Uint8Array(ev.data);
                }
                try {
                    self._onChunk(chunk);
                } catch (e) {
                    self._failAll(e);
                }
            };
        });
    };

    MtConnection.prototype._failAll = function (err) {
        const pend = Array.from(this.pending.values());
        this.pending.clear();
        pend.forEach(function (p) {
            if (p.timer) clearTimeout(p.timer);
            p.reject(err);
        });
    };

    MtConnection.prototype._onChunk = function (chunk) {
        const dec = this.decryptor.update(chunk);
        const merged = concatBytes(this.buf, dec);
        let off = 0;
        while (merged.length - off >= 4) {
            const len = new DataView(merged.buffer, merged.byteOffset + off, 4).getInt32(0, true);
            if (len < 24 || len > (1 << 24) + 1024) {
                this._failAll(new Error('Noto\'g\'ri paket uzunligi: ' + len));
                return;
            }
            if (merged.length - off < 4 + len) break;
            const body = merged.subarray(off + 4, off + 4 + len);
            off += 4 + len;
            try {
                this._onPacket(body);
            } catch (e) {
                this._failAll(e);
                return;
            }
        }
        this.buf = merged.slice(off);
    };

    MtConnection.prototype._onPacket = function (packet) {
        const msg = this.decryptMessage(packet);
        // Server salt'ini yangilaymiz (keyingi so'rovlar uchun).
        if (msg.salt && !(msg.salt[0] === 0 && msg.salt[1] === 0 && msg.salt[2] === 0 && msg.salt[3] === 0 &&
            msg.salt[4] === 0 && msg.salt[5] === 0 && msg.salt[6] === 0 && msg.salt[7] === 0)) {
            this.salt.set(msg.salt);
        }
        // msgId bo'yicha pending so'rovni topamiz (rpc_result req_msg_id orqali).
        const parsed = parseRpc(msg.body);
        if (!parsed) return;
        if (parsed.kind === 'result' || parsed.kind === 'error') {
            const p = this.pending.get(parsed.reqId);
            if (p) {
                this.pending.delete(parsed.reqId);
                if (p.timer) clearTimeout(p.timer);
                if (parsed.kind === 'result') p.resolve(parsed.result);
                else p.reject(parsed.error);
            }
        }
    };

    /** Server javobini tahlil qiladi: rpc_result / rpc_error / msg_container. */
    function parseRpc(body) {
        const r = new TgReader(body, 0);
        const ctor = r.u32();
        if (ctor === TL.MSG_CONTAINER) {
            const count = r.u32();
            let out = null;
            for (let i = 0; i < count; i++) {
                const len = r.u32();
                const sub = body.subarray(r.off, r.off + len);
                r.off += len + ((4 - (len % 4)) % 4);
                const res = parseRpc(sub);
                if (res && (res.kind === 'result' || res.kind === 'error')) out = res;
            }
            return out;
        }
        if (ctor === TL.RPC_RESULT) {
            const reqId = r.long();
            return { kind: 'result', reqId, result: readUploadFile(r) };
        }
        if (ctor === TL.RPC_ERROR) {
            const reqId = r.long();
            const code = r.i32();
            const message = r.str();
            return { kind: 'error', reqId, error: new Error(message || ('RPC xato #' + code)) };
        }
        if (ctor === TL.MSG_ACK) {
            return null;
        }
        return null;
    }

    /** upload.file yoki upload.cdnFile ni o'qiydi. */
    function readUploadFile(r) {
        const ctor = r.u32();
        if (ctor === TL.UPLOAD_FILE) {
            r.u32();                 // type (storage.FileType)
            r.i32();                 // mtime
            return r.bytes();        // bytes
        }
        if (ctor === TL.UPLOAD_CDN_FILE) {
            return r.bytes();
        }
        throw new Error('Kutilmagan javob turi: 0x' + ctor.toString(16));
    }

    MtConnection.prototype.request = function (queryBytes) {
        const self = this;
        return this.connect().then(function () {
            let body = queryBytes;
            if (!self._initSent) {
                self._initSent = true;
                const init = {
                    apiId: self.apiId,
                    deviceModel: self.deviceModel,
                    systemVersion: self.systemVersion,
                    appVersion: self.appVersion,
                    systemLangCode: 'en',
                    langPack: '',
                    langCode: ''
                };
                body = buildInvokeWithLayer(buildInitConnection(queryBytes, init));
            }
            const packet = self.encryptMessage(body);
            const len = packet.length;
            const framed = new Uint8Array(4 + len);
            new DataView(framed.buffer).setInt32(0, len, true);
            framed.set(packet, 4);
            const encrypted = self.encryptor.update(framed);

            const msgId = self.lastMsgId;
            return new Promise(function (resolve, reject) {
                const timer = setTimeout(function () {
                    const p = self.pending.get(msgId);
                    if (!p) return;
                    self.pending.delete(msgId);
                    reject(new Error('Telegram RPC javobi 8 s ichida kelmadi'));
                }, 8000);
                self.pending.set(msgId, { resolve: resolve, reject: reject, timer: timer });
                try {
                    self.ws.send(encrypted.buffer);
                } catch (e) {
                    self.pending.delete(msgId);
                    clearTimeout(timer);
                    reject(e);
                }
            });
        });
    };

    MtConnection.prototype.close = function () {
        this.closed = true;
        this.ready = false;
        if (this.ws) {
            try { this.ws.close(); } catch (e) {}
        }
        this._failAll(new Error('Ulanish yopildi'));
    };

    // ========================================================================
    // 6. Ommaviy klient API
    // ========================================================================

    function createClient(opts) {
        const session = parseSession(opts.session);
        const conn = new MtConnection({
            authKey: session.authKey,
            keyId: session.authKeyId || new Uint8Array(8),
            dcId: session.dcId
        });
        conn.apiId = opts.apiId || 6;
        conn.deviceModel = opts.deviceModel || 'W CINEMA Web';
        conn.systemVersion = opts.systemVersion || '1.0';
        conn.appVersion = opts.appVersion || '1.0';
        // auth_key_id = SHA1(auth_key)[12..20] (little-endian o'qiladi)
        const digest = sha1(session.authKey);
        conn.keyId = digest.subarray(12, 20);
        let keyIdLong = 0n;
        for (let i = 7; i >= 0; i--) keyIdLong = (keyIdLong << 8n) | BigInt(conn.keyId[i]);

        // --- BOSHQA DC'LAR UCHUN auth_key'lar ------------------------------
        // Telegram har bir DC uchun ALOHIDA auth_key talab qiladi: boshqa DC
        // manziliga "uy" DC kaliti bilan murojaat qilinsa, server
        // AUTH_KEY_UNREGISTERED qaytaradi (natijada oqim GramJS'ga tushib,
        // 5.4 MB bundle + DH handshake + export/import — 5–40 s).
        //
        // GramJS o'zi ishlagan paytda har bir DC uchun kalit yaratib,
        // `session.authKeys` da saqlaydi. `tg-stream.js` shu kalitlarni
        // localStorage'ga ko'chirib qo'yadi (`harvestDcKeys`) va keyingi
        // sahifa yuklanishida shu yerga beradi — u holda tez klient barcha
        // DC'larga to'g'ridan-to'g'ri ulanadi (bundle ham, handshake ham yo'q).
        const dcKeys = new Map();

        function asU8(v) {
            if (!v) return null;
            if (v instanceof Uint8Array) return v;
            if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return new Uint8Array(v);
            if (v.buffer && v.byteLength === v.buffer.byteLength) return new Uint8Array(v.buffer);
            if (Array.isArray(v)) return new Uint8Array(v);
            return null;
        }

        function addDcKey(id, raw) {
            const n = Number(id);
            const k = asU8(raw);
            if (!(n > 0) || !k || k.length !== 256) return false;
            dcKeys.set(n, { authKey: k, keyId: sha1(k).subarray(12, 20) });
            return true;
        }

        if (opts.dcKeys && typeof opts.dcKeys === 'object') {
            Object.keys(opts.dcKeys).forEach(function (id) { addDcKey(id, opts.dcKeys[id]); });
        }

        /** Berilgan DC uchun kalit: saqlangan bo'lsa — o'sha, aks holda uy DC. */
        function keyFor(id) {
            return dcKeys.get(Number(id)) || { authKey: session.authKey, keyId: conn.keyId };
        }

        const clients = new Map();

        // --- Ulanishlar havzasi (pool) -----------------------------------
        // Telegram Web / Desktop kabi bitta DC ga bir nechta alohida
        // WebSocket ochamiz (har birining o'z session_id si bor, auth_key
        // umumiy). SUKUT BO'YICHA O'CHIQ: yoqish uchun
        //   localStorage.wc_pool = '3'   (2..4)
        // Havza ulanishida xato bo'lsa — o'zi o'chadi va so'rov asosiy
        // ulanishda qayta bajariladi (video to'xtamaydi).
        const poolSize = (function () {
            try {
                const n = parseInt(global.localStorage.getItem('wc_pool'), 10);
                return n >= 2 && n <= 4 ? n : 1;
            } catch (e) { return 1; }
        })();
        const pools = new Map();
        let poolRR = 0;
        let poolBroken = false;

        function newExtraConnection(id) {
            const k = keyFor(id);
            const c = new MtConnection({
                authKey: k.authKey,
                keyId: k.keyId,
                dcId: id
            });
            c.apiId = conn.apiId;
            c.deviceModel = conn.deviceModel;
            c.systemVersion = conn.systemVersion;
            c.appVersion = conn.appVersion;
            return c;
        }

        function closeExtras() {
            pools.forEach(function (arr) {
                for (let i = 1; i < arr.length; i++) arr[i].close();
            });
            pools.clear();
        }

        // So'rovni havzadagi navbatdagi ulanishga beradi (round-robin).
        function send(dcId, body) {
            const id = dcId || session.dcId;
            const main = getConnection(id);
            if (poolSize < 2 || poolBroken) return main.request(body);
            let arr = pools.get(id);
            if (!arr) { arr = [main]; pools.set(id, arr); }
            while (arr.length < poolSize) arr.push(newExtraConnection(id));
            poolRR = (poolRR + 1) % arr.length;
            const c = arr[poolRR];
            if (c === main) return main.request(body);
            return c.request(body).catch(function (e) {
                // Havza ishlamadi: o'chiramiz va asosiy ulanishda qaytaramiz.
                poolBroken = true;
                closeExtras();
                return main.request(body);
            });
        }

        function getConnection(dcId) {
            const id = dcId || session.dcId;
            if (clients.has(id)) return clients.get(id);
            const k = keyFor(id);
            const c = new MtConnection({
                authKey: k.authKey,
                keyId: k.keyId,
                dcId: id
            });
            c.apiId = conn.apiId;
            c.deviceModel = conn.deviceModel;
            c.systemVersion = conn.systemVersion;
            c.appVersion = conn.appVersion;
            clients.set(id, c);
            return c;
        }

        return {
            session: session,
            dcId: session.dcId,
            keyId: keyIdLong,

            /** Ulanishni oldindan boshlash (sahifa yuklanayotgan paytda). */
            warm: function (dcId) {
                try {
                    return getConnection(dcId).connect();
                } catch (e) {
                    return Promise.reject(e);
                }
            },

            /** Yangi DC kalitini qo'shish (GramJS'dan yig'ilgan bo'lishi mumkin). */
            setDcKey: function (dcId, raw) {
                return addDcKey(dcId, raw);
            },

            /** Shu DC uchun alohida kalit bormi? */
            hasDcKey: function (dcId) {
                return dcKeys.has(Number(dcId));
            },

            /** Buzilgan kalitni tashlab, ulanishni yopamiz. */
            dropDcKey: function (dcId) {
                const id = Number(dcId);
                dcKeys.delete(id);
                const c = clients.get(id);
                if (c && id !== session.dcId) {
                    try { c.close(); } catch (e) {}
                    clients.delete(id);
                }
            },

            /** Faylning bir qismini oladi. */
            getFile: function (loc, offset, limit) {
                const body = buildGetFile(loc, offset, limit);
                return send(loc.dcId, body);
            },

            /** [offset, offset+length) oralig'ini parallel yuklab, birlashtiradi. */
            readRange: function (loc, offset, length, opts) {
                const options = opts || {};
                const maxChunk = options.chunk || 512 * 1024;
                const parallel = options.parallel || 4;
                const parts = [];
                let done = 0;
                for (let p = 0; p < length; p += maxChunk) {
                    parts.push({ off: offset + p, len: Math.min(maxChunk, length - p) });
                }
                let idx = 0;
                const out = new Uint8Array(length);
                const workers = [];
                const run = function () {
                    if (idx >= parts.length) return Promise.resolve();
                    const part = parts[idx++];
                    return self_getFile(loc, part.off, part.len).then(function (buf) {
                        out.set(buf.subarray(0, part.len), part.off - offset);
                        done += part.len;
                        return run();
                    });
                };
                function self_getFile(l, o, len) {
                    return send(l.dcId, buildGetFile(l, o, len));
                }
                for (let i = 0; i < Math.min(parallel, parts.length); i++) workers.push(run());
                return Promise.all(workers).then(function () { return out; });
            },

            close: function () {
                clients.forEach(function (c) { c.close(); });
                clients.clear();
                closeExtras();
            }
        };
    }

    // --- SHA-1 (auth_key_id uchun) ---
    function sha1(data) {
        const ml = data.length;
        const total = (((ml + 8) >> 6) + 1) << 6;
        const buf = new Uint8Array(total);
        buf.set(data);
        buf[ml] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(total - 4, (ml << 3) >>> 0, false);
        dv.setUint32(total - 8, Math.floor(ml / 0x20000000), false);
        let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
        const w = new Uint32Array(80);
        for (let off = 0; off < total; off += 64) {
            for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
            for (let i = 16; i < 80; i++) {
                const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
                w[i] = (v << 1 | v >>> 31) >>> 0;
            }
            let a = h0, b = h1, c = h2, d = h3, e = h4;
            for (let i = 0; i < 80; i++) {
                let f, k;
                if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
                else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
                else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
                else { f = b ^ c ^ d; k = 0xCA62C1D6; }
                const t = (((a << 5 | a >>> 27) >>> 0) + f + e + k + w[i]) >>> 0;
                e = d; d = c; c = (b << 30 | b >>> 2) >>> 0; b = a; a = t;
            }
            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
            h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
        }
        const out = new Uint8Array(20);
        const odv = new DataView(out.buffer);
        odv.setUint32(0, h0, false); odv.setUint32(4, h1, false); odv.setUint32(8, h2, false);
        odv.setUint32(12, h3, false); odv.setUint32(16, h4, false);
        return out;
    }

    // ========================================================================
    // 7. Eksport
    // ========================================================================

    global.TgFast = {
        VERSION: '1.0',
        LAYER: LAYER,
        parseSession: parseSession,
        createClient: createClient,
        // Test uchun (Node.js da tekshirish):
        _internals: {
            sha256: sha256,
            sha1: sha1,
            igeEncrypt: igeEncrypt,
            igeDecrypt: igeDecrypt,
            aesEncryptBlock: aesEncryptBlock,
            aesDecryptBlock: aesDecryptBlock,
            CtrStream: CtrStream,
            TgWriter: TgWriter,
            TgReader: TgReader,
            buildGetFile: buildGetFile,
            buildInitConnection: buildInitConnection,
            buildInvokeWithLayer: buildInvokeWithLayer,
            MtConnection: MtConnection,
            TL: TL
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
