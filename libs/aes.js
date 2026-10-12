/* Storage DB — AES helpers compatible with crypto-js
 *
 * Encrypt mode อ่าน/เขียนค่าที่เข้ารหัสด้วย `CryptoJS.AES.encrypt(value, passphrase)`
 * (AES-256-CBC, PKCS7, OpenSSL "Salted__" format, passphrase ผ่าน EVP_BytesToKey MD5)
 * ให้ผลลัพธ์ตรงกับ crypto-js ทุก byte — เพื่อให้แก้ค่าในหน้าเว็บที่ใช้
 * SecureLocalStorageService (mychannel) แล้วแอปอ่านกลับได้ทันที
 *
 * ใช้ Web Crypto (crypto.subtle) สำหรับ AES เอง และ MD5 ในตัวสำหรับ KDF
 * (Web Crypto ไม่มี MD5) — ไม่ต้องพ่วง crypto-js ทั้งก้อนเข้า extension
 */
'use strict';
(function (global) {
  /* ============================== MD5 ==============================
   * มีไว้เฉพาะกับ EVP_BytesToKey ของ OpenSSL (crypto-js EvpKdf ใช้ MD5 1 iteration)
   * RFC 1321 — รับ/คืน Uint8Array */
  var MD5_S = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]);
  var MD5_K = new Uint32Array(64);
  for (var i = 0; i < 64; i++) {
    MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }

  function md5(input) {
    // padding: 0x80 แล้ว zero จนถึง 8 ไบต์สุดท้าย สำหรับ little-endian bit length
    var blocks = ((input.length + 8) >> 6) + 1;
    var total = blocks * 64;
    var msg = new Uint8Array(total);
    msg.set(input);
    msg[input.length] = 0x80;
    var dv = new DataView(msg.buffer);
    var bits = input.length * 8;
    dv.setUint32(total - 8, bits >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bits / 4294967296), true);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var M = new Uint32Array(16);
    for (var off = 0; off < total; off += 64) {
      for (var j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
      var A = a0, B = b0, C = c0, D = d0;
      for (var k = 0; k < 64; k++) {
        var F, g;
        if (k < 16) { F = (B & C) | (~B & D); g = k; }
        else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
        else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * k) % 16; }
        F = (F + A + MD5_K[k] + M[g]) >>> 0;
        A = D; D = C; C = B;
        var s = MD5_S[k];
        B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    var out = new Uint8Array(16);
    var odv = new DataView(out.buffer);
    odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
    odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
    return out;
  }

  /* ============================== OpenSSL EVP_BytesToKey ==============================
   * D_1 = MD5(pass + salt), D_i = MD5(D_{i-1} + pass + salt) — เอา 48 ไบต์แรก
   * (key 32 + iv 16) ตรงตาม crypto-js EvpKdf (MD5, 1 iteration) */
  function evpBytesToKey(pass, salt, need) {
    var chunks = [];
    var last = new Uint8Array(0);
    var totalLen = 0;
    while (totalLen < need) {
      var h = new Uint8Array(last.length + pass.length + salt.length);
      h.set(last, 0);
      h.set(pass, last.length);
      h.set(salt, last.length + pass.length);
      last = md5(h);
      chunks.push(last);
      totalLen += last.length;
    }
    var out = new Uint8Array(totalLen);
    var o = 0;
    for (var c = 0; c < chunks.length; c++) { out.set(chunks[c], o); o += chunks[c].length; }
    return out.subarray(0, need);
  }

  /* ============================== base64 ============================== */
  function b64ToBytes(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  /* "Salted__" — magic header ของ OpenSSL format; base64 ของมันคือ "U2FsdGVkX1"
   * ใช้เป็น prefix ตรวจว่าค่าใน storage เป็น ciphertext หรือ plaintext */
  var SALTED = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]);
  var CIPHERTEXT_PREFIX = 'U2FsdGVkX1';

  function looksEncrypted(v) {
    return typeof v === 'string' && v.indexOf(CIPHERTEXT_PREFIX) === 0;
  }

  function subtle() {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Web Crypto (crypto.subtle) is not available in this context');
    }
    return crypto.subtle;
  }

  function importAesKey(raw) {
    return subtle().importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
  }

  function derive(passphrase, salt) {
    var pass = new TextEncoder().encode(passphrase);
    var dk = evpBytesToKey(pass, salt, 48);
    return { keyBytes: dk.subarray(0, 32), iv: dk.subarray(32, 48) };
  }

  /** ถอดรหัส ciphertext (base64, OpenSSL format) → plaintext string
   *  throw เมื่อ format ผิดหรือ key ไม่ถูก (padding check ของ AES-CBC ไม่ผ่าน) */
  async function aesDecrypt(ciphertextB64, passphrase) {
    var all = b64ToBytes(String(ciphertextB64).trim());
    if (all.length < 32 || all.length % 16 !== 0) throw new Error('Invalid ciphertext length');
    for (var i = 0; i < 8; i++) {
      if (all[i] !== SALTED[i]) throw new Error('Missing OpenSSL "Salted__" header');
    }
    var salt = all.subarray(8, 16);
    var data = all.subarray(16);
    var d = derive(passphrase, salt);
    var key = await importAesKey(d.keyBytes);
    var plain = await subtle().decrypt({ name: 'AES-CBC', iv: d.iv }, key, data);
    return new TextDecoder('utf-8').decode(plain);
  }

  /** เข้ารหัส plaintext → base64 ciphertext (สุ่ม salt ใหม่ทุกครั้ง เหมือน crypto-js) */
  async function aesEncrypt(plaintext, passphrase) {
    var salt = crypto.getRandomValues(new Uint8Array(8));
    var d = derive(passphrase, salt);
    var key = await importAesKey(d.keyBytes);
    var data = await subtle().encrypt(
      { name: 'AES-CBC', iv: d.iv }, key, new TextEncoder().encode(plaintext));
    var out = new Uint8Array(16 + data.byteLength);
    out.set(SALTED, 0);
    out.set(salt, 8);
    out.set(new Uint8Array(data), 16);
    return bytesToB64(out);
  }

  global.SdbAes = {
    aesEncrypt: aesEncrypt,
    aesDecrypt: aesDecrypt,
    looksEncrypted: looksEncrypted,
    CIPHERTEXT_PREFIX: CIPHERTEXT_PREFIX,
    md5: md5, // เปิดไว้ทดสอบ
  };
})(typeof window !== 'undefined' ? window : globalThis);
