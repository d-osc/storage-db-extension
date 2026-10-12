/* Storage DB — DevTools panel
 * Storage types: localStorage, sessionStorage, cookies (chrome.cookies),
 * IndexedDB + Cache Storage + Storage Buckets + Privacy Sandbox APIs
 * (via chrome.devtools.inspectedWindow.eval), chrome.storage (extension).
 * Preview mode (opened outside DevTools) runs the same code paths against
 * a mock page in a hidden iframe.
 */
'use strict';

/* Surface any load-time error so a broken panel is never silently blank. */
(function installErrorSurface() {
  function show(msg) {
    try {
      var bar = document.getElementById('errorBar');
      if (!bar) return;
      bar.textContent = '⚠ ' + msg;
      bar.classList.remove('hidden');
    } catch (e) { /* nothing more we can do */ }
  }
  window.addEventListener('error', function (e) {
    show(((e && e.message) || 'Script error') + (e && e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    show('Unhandled rejection: ' + ((r && r.message) || String(r)));
  });
})();

/* ============================== helpers ============================== */
const $ = (sel, root) => (root || document).querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(2)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function detectType(v) {
  const s = String(v);
  if (s === '') return 'empty';
  if (s === 'true' || s === 'false') return 'boolean';
  if (s.trim() !== '' && !isNaN(Number(s))) return 'number';
  try {
    const p = JSON.parse(s);
    if (p !== null && typeof p === 'object') return 'json';
  } catch (e) { /* plain string */ }
  return 'string';
}

const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  view: '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
  decrypt: '<svg viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>',
};

function iconBtn(icon, title, onClick, extraClass) {
  const b = el('button', { class: 'iconbtn' + (extraClass ? ' ' + extraClass : ''), type: 'button', title: title });
  b.innerHTML = ICONS[icon];
  b.addEventListener('click', onClick);
  return b;
}

/* ============================== store registry ============================== */
const REAL = typeof chrome !== 'undefined' && !!(chrome.devtools && chrome.devtools.inspectedWindow);

const STORE_META = [
  { id: 'ls', label: 'Local Storage', group: 'storage' },
  { id: 'ss', label: 'Session Storage', group: 'storage' },
  { id: 'idb', label: 'IndexedDB', group: 'storage' },
  { id: 'cookies', label: 'Cookies', group: 'storage' },
  { id: 'cache', label: 'Cache Storage', group: 'storage' },
  { id: 'buckets', label: 'Storage Buckets', group: 'storage' },
  { id: 'ext', label: 'Extension Storage', group: 'storage' },
  { id: 'shared', label: 'Shared Storage', group: 'privacy' },
  { id: 'ig', label: 'Interest Groups', group: 'privacy' },
  { id: 'pst', label: 'Private State Tokens', group: 'privacy' },
];
const TABLE_STORES = ['ls', 'ss', 'idb', 'cookies', 'cache', 'buckets', 'ext'];
const JSON_STORES = ['ls', 'ss', 'idb', 'cookies', 'cache', 'buckets', 'ext'];
const JSON_EDITABLE = ['ls', 'ss'];
const FORM_STORES = ['shared', 'ig', 'pst'];
const AUTO_STORES = ['ls', 'ss', 'cookies', 'ext'];

const COLS = {
  ls: [
    { id: 'key', label: 'Key', width: '22%', get: (r) => r.k, cls: 'key-cell' },
    { id: 'value', label: 'Value', width: '46%', get: (r) => dispV(r) },
    { id: 'type', label: 'Type', width: '9%', get: (r) => detectType(dispV(r)) },
    { id: 'size', label: 'Size', width: '10%', get: (r) => r.size, numeric: true },
  ],
  cookies: [
    { id: 'name', label: 'Name', width: '14%', get: (r) => r.name, cls: 'key-cell' },
    { id: 'value', label: 'Value', width: '24%', get: (r) => r.value },
    { id: 'domain', label: 'Domain', width: '16%', get: (r) => r.domain },
    { id: 'path', label: 'Path', width: '7%', get: (r) => r.path },
    { id: 'expires', label: 'Expires', width: '16%', get: (r) => cookieExpiresText(r) },
    { id: 'flags', label: 'Attr', width: '8%', get: (r) => cookieFlagsText(r) },
    { id: 'csize', label: 'Size', width: '7%', get: (r) => r.size, numeric: true },
  ],
  idb: [
    { id: 'key', label: 'Primary key', width: '22%', get: (r) => r.k, cls: 'key-cell' },
    { id: 'value', label: 'Value (JSON)', width: '51%', get: (r) => r.v },
    { id: 'size', label: 'Size', width: '10%', get: (r) => r.size, numeric: true },
  ],
  cache: [
    { id: 'url', label: 'Request URL', width: '64%', get: (r) => r.k, cls: 'key-cell' },
    { id: 'method', label: 'Method', width: '10%', get: (r) => r.method },
    { id: 'dest', label: 'Destination', width: '12%', get: (r) => r.dest || '—' },
  ],
  buckets: [
    { id: 'name', label: 'Bucket', width: '34%', get: (r) => r.name, cls: 'key-cell' },
    { id: 'usage', label: 'Usage', width: '14%', get: (r) => r.usage, numeric: true },
    { id: 'quota', label: 'Quota', width: '14%', get: (r) => r.quota, numeric: true },
    { id: 'persisted', label: 'Persisted', width: '12%', get: (r) => (r.persisted ? 'yes' : 'no') },
    { id: 'bnote', label: 'Notes', width: '16%', get: (r) => r.error || '' },
  ],
  ext: [
    { id: 'key', label: 'Key', width: '24%', get: (r) => r.k, cls: 'key-cell' },
    { id: 'value', label: 'Value (JSON)', width: '49%', get: (r) => r.v },
    { id: 'size', label: 'Size', width: '10%', get: (r) => r.size, numeric: true },
  ],
};

const MAX_RENDER_ROWS = 2000;

const state = {
  store: 'ls',
  view: 'table',
  filter: '',
  sort: null,
  data: { ls: [], ss: [], cookies: [], idb: [], cache: [], buckets: [], ext: [] },
  snapshot: { ls: '', ss: '', cookies: '', idb: '', cache: '', buckets: '', ext: '' },
  pageMeta: { href: '', origin: 'http://localhost', hostname: '' },
  autoRefresh: true,
  jsonDirty: false,
  nested: true,
  idb: { dbs: [], db: null, stores: [], store: null },
  cacheSel: { names: [], name: null },
  extArea: 'local',
  extUsage: null,
};

const EXAMPLES = {
  keys: [
    '// List every localStorage key + value size',
    "db.keys().map(k => ({ key: k, chars: (db.get(k) || '').length }))",
  ].join('\n'),
  seed: [
    '// Seed demo data',
    'for (let i = 1; i <= 5; i++) {',
    "  db.set('demo:item:' + i, { id: i, name: 'Item ' + i, tags: ['demo'] })",
    '}',
    "db.keys().filter(k => k.startsWith('demo:'))",
  ].join('\n'),
  clean: [
    '// Delete every key that starts with tmp_',
    'let deleted = 0',
    'for (const k of db.keys()) {',
    "  if (k.startsWith('tmp_')) { db.del(k); deleted++ }",
    '}',
    "'deleted ' + deleted + ' keys'",
  ].join('\n'),
  cookies: [
    '// Cookies visible to the page (non-httpOnly only)',
    'db.cookie.list()',
  ].join('\n'),
  move: [
    '// Copy localStorage -> sessionStorage',
    "for (const k of db.keys('ls')) db.set(k, db.get(k), 'ss')",
    "'copied ' + db.size('ss') + ' keys into sessionStorage'",
  ].join('\n'),
};

/* ============================== mock layer (preview mode) ============================== */
let mockWin = null;
let MOCK_COOKIES = [];
let MOCK_EXT = {
  local: { 'settings:theme': 'dark', 'settings:dense': true, lastWorkspace: { name: 'lab', path: 'C:\\dev\\lab' } },
  sync: { 'account:locale': 'th-TH' },
  session: { 'panel:openCount': 3 },
};

function seedIframeIdb(win) {
  return new Promise((resolve) => {
    const rq = win.indexedDB.open('demo-app', 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      const users = db.createObjectStore('users', { keyPath: 'id' });
      users.createIndex('email', 'email', { unique: true });
      db.createObjectStore('settings', { keyPath: 'name' });
    };
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction(['users', 'settings'], 'readwrite');
      const users = tx.objectStore('users');
      users.put({ id: 1, name: 'Somchai', email: 'somchai@example.com', roles: ['admin'] });
      users.put({ id: 2, name: 'Somsri', email: 'somsri@example.com', roles: [] });
      users.put({ id: 3, name: 'Nay', email: 'nay@example.com' });
      const settings = tx.objectStore('settings');
      settings.put({ name: 'theme', value: 'dark' });
      settings.put({ name: 'locale', value: 'th-TH' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    };
    rq.onerror = () => resolve();
  });
}

async function seedIframeCaches(win) {
  try {
    if (!win.caches) return;
    const c = await win.caches.open('api-cache-v1');
    const mk = (body, type) => new win.Response(body, { headers: { 'content-type': type } });
    await c.put('/api/users', mk(JSON.stringify([{ id: 1, name: 'Somchai' }, { id: 2, name: 'Somsri' }]), 'application/json'));
    await c.put('/api/config', mk(JSON.stringify({ env: 'demo', debug: false }), 'application/json'));
    const assets = await win.caches.open('assets-v1');
    await assets.put('/img/logo.svg', mk('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>', 'image/svg+xml'));
  } catch (e) { /* ignore */ }
}

async function seedIframeBucket(win) {
  try {
    if (win.navigator.storageBuckets && win.navigator.storageBuckets.open) {
      await win.navigator.storageBuckets.open('media-cache', { persisted: true });
    }
  } catch (e) { /* ignore */ }
}

async function setupMock() {
  const f = document.createElement('iframe');
  f.style.display = 'none';
  f.src = 'about:blank';
  document.body.append(f);
  mockWin = f.contentWindow;

  const ls = mockWin.localStorage;
  ls.setItem('app:config', JSON.stringify({ theme: 'dark', locale: 'th-TH', sidebar: { collapsed: false, width: 240 } }));
  ls.setItem('app:token', 'eyJhbGciOiJIUzI1NiJ9.mock.signature');
  ls.setItem('cart', JSON.stringify([{ sku: 'SKU-1001', qty: 2 }, { sku: 'SKU-2049', qty: 1 }]));
  ls.setItem('visits', '1287');
  ls.setItem('flag:beta', 'true');
  ls.setItem('notes:draft', 'แก้ shipping ก่อนปิดงาน…\n- อัปเดต tax\n- ส่ง QA');
  ls.setItem('tmp_cache', 'x'.repeat(520));
  ls.setItem('tmp_marker', '1');
  const ss = mockWin.sessionStorage;
  ss.setItem('wizard:step', '3');
  ss.setItem('draft:form', JSON.stringify({ name: '', email: '' }));
  ss.setItem('debug:enabled', 'false');

  // encrypted entries สำหรับลอง encrypt mode (key = fallback keys ตาม mychannel)
  try {
    if (window.SdbAes && typeof crypto !== 'undefined' && crypto.subtle) {
      ls.setItem('app:user', await SdbAes.aesEncrypt(
        JSON.stringify({ id: 1, username: 'somchai', role: 'admin' }), ENC_PRESETS[0]));
      ls.setItem('app:secret-note', await SdbAes.aesEncrypt(
        'internal only — แก้ shipping ก่อนปิดงาน', ENC_PRESETS[0]));
      // entry นี้ใช้ passphrase ต่างกัน — ลองปุ่ม 🔑 decrypt ราย key
      ls.setItem('app:device', await SdbAes.aesEncrypt(
        JSON.stringify({ id: 'DEV-771', platform: 'android' }), 'device-secret-key'));
      ss.setItem('otp:ref', await SdbAes.aesEncrypt('REF-88213', ENC_PRESETS[1]));
    }
  } catch (e) { /* crypto.subtle ไม่พร้อมใน context นี้ — ข้าม mock ส่วนนี้ */ }

  const day = 86400;
  MOCK_COOKIES = [
    { name: 'sid', value: 'S-7f3a9c2e1b', domain: 'demo.local', path: '/', expirationDate: Math.floor(Date.now() / 1000) + 7 * day, session: false, httpOnly: true, secure: true, sameSite: 'lax', size: 15 },
    { name: 'theme', value: 'dark', domain: 'demo.local', path: '/', expirationDate: undefined, session: true, httpOnly: false, secure: false, sameSite: 'lax', size: 9 },
    { name: '_ga', value: 'GA1.1.999.123456', domain: '.demo.local', path: '/', expirationDate: Math.floor(Date.now() / 1000) + 400 * day, session: false, httpOnly: false, secure: true, sameSite: 'lax', size: 20 },
  ];

  await seedIframeIdb(mockWin);
  await seedIframeCaches(mockWin);
  await seedIframeBucket(mockWin);

  $('#mockBar').classList.remove('hidden');
}

/* ============================== page eval ============================== */
function evalInPage(expression) {
  if (!REAL) {
    return new Promise((resolve, reject) => {
      if (!mockWin) return reject(new Error('mock page not ready'));
      try { resolve(mockWin.eval(expression)); } catch (e) { reject(e); }
    });
  }
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, err) => {
      if (err) {
        let msg = err;
        if (err.isError || err.isException) msg = err.description || err.value || 'Evaluation failed';
        reject(new Error(String(msg)));
      } else {
        resolve(result);
      }
    });
  });
}

/* Async page operation: runs an expression (typically an async IIFE returning
 * a JSON string), polls for completion, and parses the JSON result. */
async function pageEval(expr) {
  const kickoff =
    '(function () {' +
    '  window.__SDBOP__ = { done: false };' +
    '  var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;' +
    '  var CODE = ' + JSON.stringify(expr) + ';' +
    '  (async function () {' +
    '    try {' +
    '      var r;' +
    '      try { r = eval(CODE); }' +
    '      catch (e1) { if (!(e1 instanceof SyntaxError)) throw e1; r = await new AsyncFn(CODE)(); }' +
    '      r = await Promise.resolve(r);' +
    '      window.__SDBOP__ = { done: true, result: r === undefined ? undefined : r };' +
    '    } catch (e) { window.__SDBOP__ = { done: true, error: String(e && e.message || e) }; }' +
    '  })();' +
    "  return 'started';" +
    '})()';
  await evalInPage(kickoff);
  for (let i = 0; i < 400; i++) {
    await sleep(80);
    const raw = await evalInPage(
      '(function(){ try { return JSON.stringify(window.__SDBOP__ || { done: false }); }' +
      ' catch (e) { return JSON.stringify({ done: true, error: "poll failed" }); } })()'
    );
    const st = JSON.parse(raw);
    if (st.done) {
      if (st.error) throw new Error(st.error);
      if (st.result === undefined) return undefined;
      // ops return JSON strings; plain strings like "ok" pass through untouched
      try { return JSON.parse(st.result); } catch (e) { return st.result; }
    }
  }
  throw new Error('Page operation timed out');
}

function chromeCookies(fn, arg) {
  return new Promise((resolve) => {
    if (!REAL || !chrome.cookies) return resolve(null);
    chrome.cookies[fn](arg, (res) => {
      void chrome.runtime.lastError;
      resolve(res === undefined ? null : res);
    });
  });
}

/* ============================== encrypt mode ============================== */
/* ถอด/เข้ารหัสค่า Local/Session Storage ที่แอปเข้ารหัสด้วย
 * CryptoJS.AES.encrypt(value, passphrase) (OpenSSL "Salted__" format) —
 * ตรวจ ciphertext ด้วย prefix "U2FsdGVkX1" เหมือน SecureLocalStorageService
 * ของ mychannel (key จริงคือ username ของ user ที่ login, fallback เป็น constant ต่อ storage) */
const ENC_PRESETS = ['mychannel-secure-local-storage', 'mychannel-secure-session-storage'];
const ENC_DEFAULT_PREFIX = 'U2FsdGVkX1';
const ENC_PREFS_KEY = 'sdb:encrypt';
const encState = { on: false, key: '', prefix: ENC_DEFAULT_PREFIX, keys: {} };

function loadEncState() {
  try {
    const s = JSON.parse(localStorage.getItem(ENC_PREFS_KEY) || '{}') || {};
    encState.on = !!s.on;
    encState.key = typeof s.key === 'string' ? s.key : '';
    encState.prefix = typeof s.prefix === 'string' && s.prefix ? s.prefix : ENC_DEFAULT_PREFIX;
    encState.keys = s.keys && typeof s.keys === 'object' ? s.keys : {};
  } catch (e) { /* keep defaults */ }
}
function saveEncState() {
  try {
    localStorage.setItem(ENC_PREFS_KEY, JSON.stringify({ on: encState.on, key: encState.key, prefix: encState.prefix, keys: encState.keys }));
  } catch (e) { /* ignore */ }
}
/** mode เปิดใช้ได้จริง (= เปิด + มี key + มี crypto) */
function encActive() {
  return !!(encState.on && encState.key && window.SdbAes && typeof crypto !== 'undefined' && crypto.subtle);
}
/** row นี้เป็น ciphertext ที่ถอดรหัสสำเร็จ */
function isEncRow(r) {
  return !!(r && r.enc && !r.derr && typeof r.dv === 'string');
}
/** ค่าที่ใช้แสดงผล/แก้ไข — decrypted เมื่อถอดได้ ไม่งั้นค่าดิบ */
function dispV(r) {
  return isEncRow(r) ? r.dv : r.v;
}

/** passphrase ที่ใช้กับ key นี้ — มี per-key override ใช้อันนั้นก่อน, ไม่มีจึงใช้ตัว global */
function encPassFor(key) {
  return (key && encState.keys && encState.keys[key]) || encState.key;
}

/** decrypt ทุก row ที่เป็น ciphertext ตอนอ่าน storage (ตกผลลัพธ์ไว้ใน row เอง) */
async function decryptRows(rows) {
  await Promise.all(rows.map(async (r) => {
    const cipher = SdbAes.splitCipherValue(r.v, encState.prefix);
    if (cipher === null) return;
    const pass = encPassFor(r.k);
    if (!pass) return; // ยังไม่มี passphrase สำหรับ key นี้ — แสดง ciphertext ดิบเหมือนค่าทั่วไป (ใช้ปุ่ม 🔑 ต่อ key)
    r.enc = true;
    try {
      r.dv = await SdbAes.aesDecrypt(cipher, pass);
    } catch (e) {
      // passphrase ไม่ตรง — แสดงเป็น ciphertext พร้อม marker, ไม่ถือว่าอ่านค่าสำเร็จ
      r.dv = null;
      r.derr = true;
    }
  }));
}

/* ============================== reads: web storage / cookies ============================== */
function storageProp(store) { return store === 'ss' ? 'sessionStorage' : 'localStorage'; }

async function readStorage(store) {
  const prop = storageProp(store);
  const expr =
    '(function () {' +
    '  try {' +
    '    var s = window.' + prop + ';' +
    '    var out = [];' +
    '    for (var i = 0; i < s.length; i++) {' +
    "      var k = s.key(i); var v = s.getItem(k) || '';" +
    '      out.push([k, v, new Blob([k, v]).size]);' +
    '    }' +
    '    return JSON.stringify(out);' +
    '  } catch (e) {' +
    "    return JSON.stringify({ __error: String(e && e.message || e) });" +
    '  }' +
    '})()';
  const raw = await evalInPage(expr);
  const parsed = JSON.parse(raw);
  if (parsed && parsed.__error) throw new Error(parsed.__error);
  const rows = parsed.map(([k, v, size]) => ({ k, v, size }));
  if (encActive()) await decryptRows(rows);
  return rows;
}

async function readCookies() {
  if (!REAL) return MOCK_COOKIES.slice().sort((a, b) => a.name.localeCompare(b.name));
  const all = (await chromeCookies('getAll', {})) || [];
  const host = state.pageMeta.hostname;
  const list = host
    ? all.filter((c) => {
        const d = (c.domain || '').replace(/^\./, '');
        return d !== '' && (d === host || host.endsWith('.' + d));
      })
    : all;
  return list
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expirationDate: c.expirationDate,
      session: !c.expirationDate,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: c.sameSite || 'unspecified',
      size: (c.name + c.value).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ============================== reads: IndexedDB ============================== */
const IDB_SER =
  'const ser = (v) => { try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); } };';

async function idbListDatabases() {
  return pageEval(
    '(async function () {' +
    '  if (!indexedDB.databases) return JSON.stringify([]);' +
    '  const dbs = await indexedDB.databases();' +
    '  return JSON.stringify((dbs || []).map(d => ({ name: d.name, version: d.version })));' +
    '})()'
  );
}

async function idbListStores(dbName) {
  return pageEval(
    '(async function () {' +
    '  const dbName = ' + JSON.stringify(dbName) + ';' +
    '  return await new Promise((resolve, reject) => {' +
    '    const rq = indexedDB.open(dbName);' +
    '    rq.onerror = () => reject(rq.error);' +
    '    rq.onsuccess = () => {' +
    '      const db = rq.result;' +
    '      const names = Array.from(db.objectStoreNames);' +
    '      if (!names.length) { db.close(); resolve("[]"); return; }' +
    '      const tx = db.transaction(names, "readonly");' +
    '      const out = [];' +
    '      let pending = names.length;' +
    '      const done = () => { if (--pending === 0) { db.close(); resolve(JSON.stringify(out)); } };' +
    '      names.forEach(n => {' +
    '        const st = tx.objectStore(n);' +
    '        const cq = st.count();' +
    '        cq.onsuccess = () => { out.push({ name: n, keyPath: st.keyPath === null ? null : String(st.keyPath), autoIncrement: !!st.autoIncrement, count: cq.result }); done(); };' +
    '        cq.onerror = done;' +
    '      });' +
    '    };' +
    '  });' +
    '})()'
  );
}

async function idbGetRecords(dbName, storeName) {
  const rows = await pageEval(
    '(async function () {' +
    '  const dbName = ' + JSON.stringify(dbName) + ', storeName = ' + JSON.stringify(storeName) + ';' +
    IDB_SER +
    '  return await new Promise((resolve, reject) => {' +
    '    const rq = indexedDB.open(dbName);' +
    '    rq.onerror = () => reject(rq.error);' +
    '    rq.onsuccess = () => {' +
    '      const db = rq.result;' +
    '      try {' +
    '        if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve("[]"); return; }' +
    '        const tx = db.transaction(storeName, "readonly");' +
    '        const out = [];' +
    '        tx.objectStore(storeName).openCursor().onsuccess = (e) => {' +
    '          const c = e.target.result;' +
    '          if (!c) return;' +
    '          if (out.length < 300) { out.push([ser(c.key), ser(c.value)]); c.continue(); }' +
    '        };' +
    '        tx.oncomplete = () => { db.close(); resolve(JSON.stringify(out)); };' +
    '        tx.onerror = () => { db.close(); reject(tx.error); };' +
    '      } catch (err) { db.close(); reject(err); }' +
    '    };' +
    '  });' +
    '})()'
  );
  return rows.map(([k, v]) => ({ k, v, size: new Blob([k, v]).size }));
}

/* ============================== writes: IndexedDB ============================== */
async function idbDeleteRecordAt(dbName, storeName, idx) {
  return pageEval(
    '(async function () {' +
    '  const dbName = ' + JSON.stringify(dbName) + ', storeName = ' + JSON.stringify(storeName) + ', idx = ' + idx + ';' +
    '  return await new Promise((resolve, reject) => {' +
    '    const rq = indexedDB.open(dbName);' +
    '    rq.onerror = () => reject(rq.error);' +
    '    rq.onsuccess = () => {' +
    '      const db = rq.result;' +
    '      try {' +
    '        const tx = db.transaction(storeName, "readwrite");' +
    '        const st = tx.objectStore(storeName);' +
    '        const cr = st.openCursor();' +
    '        let i = 0;' +
    '        cr.onsuccess = (e) => {' +
    '          const c = e.target.result;' +
    '          if (!c) return;' +
    '          if (i === idx) { c.delete(); return; }' +
    '          i++; c.continue();' +
    '        };' +
    '        tx.oncomplete = () => { db.close(); resolve("ok"); };' +
    '        tx.onerror = () => { db.close(); reject(tx.error); };' +
    '      } catch (err) { db.close(); reject(err); }' +
    '    };' +
    '  });' +
    '})()'
  );
}

async function idbPutRecord(dbName, storeName, editIdx, keyStr, valueStr) {
  return pageEval(
    '(async function () {' +
    '  const dbName = ' + JSON.stringify(dbName) + ', storeName = ' + JSON.stringify(storeName) + ', editIdx = ' + (editIdx === null ? 'null' : editIdx) + ';' +
    '  const keyStr = ' + JSON.stringify(keyStr) + ', valueStr = ' + JSON.stringify(valueStr) + ';' +
    '  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };' +
    '  const key = parse(keyStr);' +
    '  let value = parse(valueStr);' +
    '  return await new Promise((resolve, reject) => {' +
    '    const rq = indexedDB.open(dbName);' +
    '    rq.onerror = () => reject(rq.error);' +
    '    rq.onsuccess = () => {' +
    '      const db = rq.result;' +
    '      try {' +
    '        const tx = db.transaction(storeName, "readwrite");' +
    '        const st = tx.objectStore(storeName);' +
    '        const finish = (actualKey) => {' +
    '          if (st.keyPath && value && typeof value === "object") {' +
    '            try { value[st.keyPath] = actualKey; } catch (e) {}' +
    '            st.put(value);' +
    '          } else if (st.keyPath) { st.put(value); }' +
    '          else { st.put(value, actualKey); }' +
    '        };' +
    '        if (editIdx === null) { finish(key); }' +
    '        else {' +
    '          const cr = st.openCursor();' +
    '          let i = 0;' +
    '          cr.onsuccess = (e) => {' +
    '            const c = e.target.result;' +
    '            if (!c) return;' +
    '            if (i === editIdx) { finish(c.key); return; }' +
    '            i++; c.continue();' +
    '          };' +
    '        }' +
    '        tx.oncomplete = () => { db.close(); resolve("ok"); };' +
    '        tx.onerror = () => { db.close(); reject(tx.error); };' +
    '      } catch (err) { db.close(); reject(err); }' +
    '    };' +
    '  });' +
    '})()'
  );
}

async function idbClearStore(dbName, storeName) {
  return pageEval(
    '(async function () {' +
    '  const dbName = ' + JSON.stringify(dbName) + ', storeName = ' + JSON.stringify(storeName) + ';' +
    '  return await new Promise((resolve, reject) => {' +
    '    const rq = indexedDB.open(dbName);' +
    '    rq.onerror = () => reject(rq.error);' +
    '    rq.onsuccess = () => {' +
    '      const db = rq.result;' +
    '      try {' +
    '        const tx = db.transaction(storeName, "readwrite");' +
    '        tx.objectStore(storeName).clear();' +
    '        tx.oncomplete = () => { db.close(); resolve("ok"); };' +
    '        tx.onerror = () => { db.close(); reject(tx.error); };' +
    '      } catch (err) { db.close(); reject(err); }' +
    '    };' +
    '  });' +
    '})()'
  );
}

async function idbDeleteDatabase(dbName) {
  const res = await pageEval(
    '(async function () {' +
    '  const dbName = ' + JSON.stringify(dbName) + ';' +
    '  return await new Promise((resolve, reject) => {' +
    '    const rq = indexedDB.deleteDatabase(dbName);' +
    '    rq.onsuccess = () => resolve("ok");' +
    '    rq.onerror = () => reject(rq.error);' +
    '    rq.onblocked = () => resolve("blocked");' +
    '  });' +
    '})()'
  );
  if (res === 'blocked') toast('Database delete blocked — another connection (page) is holding it open.');
}

/* ============================== Cache Storage ============================== */
async function cacheListNames() {
  return pageEval(
    '(async function () {' +
    '  if (typeof caches === "undefined") return JSON.stringify({ unsupported: true, names: [] });' +
    '  return JSON.stringify({ names: await caches.keys() });' +
    '})()'
  );
}

async function cacheGetEntries(cacheName) {
  return pageEval(
    '(async function () {' +
    '  const name = ' + JSON.stringify(cacheName) + ';' +
    '  const c = await caches.open(name);' +
    '  const keys = await c.keys();' +
    '  return JSON.stringify(keys.map(r => [r.url, r.method || "GET", r.destination || ""]));' +
    '})()'
  );
}

async function cacheGetPreview(cacheName, url) {
  return pageEval(
    '(async function () {' +
    '  const name = ' + JSON.stringify(cacheName) + ', url = ' + JSON.stringify(url) + ';' +
    '  const c = await caches.open(name);' +
    '  const res = await c.match(url);' +
    '  if (!res) return JSON.stringify({ missing: true });' +
    '  const headers = [];' +
    '  res.headers.forEach((v, k) => headers.push([k, v]));' +
    '  let body = "";' +
    '  try {' +
    '    const t = await res.text();' +
    '    body = t.length > 5000 ? t.slice(0, 5000) + "\\n… (truncated)" : t;' +
    '  } catch (e) { body = "[body not readable as text]"; }' +
    '  return JSON.stringify({ status: res.status, statusText: res.statusText, type: res.type, headers, body });' +
    '})()'
  );
}

async function cacheDeleteEntry(cacheName, url) {
  return pageEval(
    '(async function () {' +
    '  const c = await caches.open(' + JSON.stringify(cacheName) + ');' +
    '  return JSON.stringify(await c.delete(' + JSON.stringify(url) + '));' +
    '})()'
  );
}

async function cacheDeleteCache(cacheName) {
  return pageEval('(async function () { return JSON.stringify(await caches.delete(' + JSON.stringify(cacheName) + ')); })()');
}

/* ============================== Storage Buckets ============================== */
async function bucketsList() {
  return pageEval(
    '(async function () {' +
    '  if (!navigator.storageBuckets || !navigator.storageBuckets.names) return JSON.stringify({ unsupported: true, list: [] });' +
    '  const names = await navigator.storageBuckets.names();' +
    '  const out = [];' +
    '  for (const n of names) {' +
    '    try {' +
    '      const b = await navigator.storageBuckets.open(n);' +
    '      const est = await b.estimate().catch(() => ({}));' +
    '      const persisted = await b.persisted().catch(() => false);' +
    '      out.push({ name: n, usage: est.usage || 0, quota: est.quota || 0, persisted: !!persisted });' +
    '    } catch (e) { out.push({ name: n, error: String(e && e.message || e) }); }' +
    '  }' +
    '  return JSON.stringify({ list: out });' +
    '})()'
  );
}

async function bucketsCreate(name, opts) {
  return pageEval(
    '(async function () {' +
    '  const opts = ' + JSON.stringify(opts) + ';' +
    '  await navigator.storageBuckets.open(' + JSON.stringify(name) + ', opts);' +
    '  return "ok";' +
    '})()'
  );
}

async function bucketsDelete(name) {
  return pageEval(
    '(async function () {' +
    '  const b = await navigator.storageBuckets.open(' + JSON.stringify(name) + ');' +
    '  return JSON.stringify(await b.delete());' +
    '})()'
  );
}

/* ============================== Extension storage (chrome.storage) ============================== */
function extArea() {
  return state.extArea || 'local';
}

async function extRead() {
  const area = extArea();
  if (!REAL) {
    const obj = MOCK_EXT[area] || {};
    const bytes = Object.entries(obj).reduce((a, [k, v]) => a + k.length + JSON.stringify(v).length, 0);
    return { obj, bytes };
  }
  const obj = await chrome.storage[area].get(null);
  let bytes = null;
  try { bytes = await chrome.storage[area].getBytesInUse(null); } catch (e) { /* optional */ }
  return { obj, bytes };
}

async function extRefreshData() {
  const { obj, bytes } = await extRead();
  state.extUsage = bytes;
  return Object.keys(obj)
    .sort()
    .map((k) => {
      const v = JSON.stringify(obj[k]);
      return { k, v, size: new Blob([k, v]).size };
    });
}

async function extSet(key, valueStr) {
  const parsed = (() => { try { return JSON.parse(valueStr); } catch (e) { return valueStr; } })();
  if (!REAL) { MOCK_EXT[extArea()][key] = parsed; return; }
  await chrome.storage[extArea()].set({ [key]: parsed });
}

async function extRemove(key) {
  if (!REAL) { delete MOCK_EXT[extArea()][key]; return; }
  await chrome.storage[extArea()].remove(key);
}

async function extClear() {
  if (!REAL) { MOCK_EXT[extArea()] = {}; return; }
  await chrome.storage[extArea()].clear();
}

/* ============================== Privacy Sandbox ============================== */
async function privacyCheck(kind) {
  const expr =
    kind === 'shared'
      ? 'typeof sharedStorage !== "undefined" && !!sharedStorage'
      : kind === 'ig'
        ? '"joinAdInterestGroup" in document && "leaveAdInterestGroup" in document'
        : '"hasPrivateToken" in document';
  try {
    return !!(await evalInPage('(function(){ try { return ' + expr + '; } catch (e) { return false; } })()'));
  } catch (e) {
    return false;
  }
}

async function sharedOp(op, key, value) {
  return pageEval(
    '(async function () {' +
    '  const op = ' + JSON.stringify(op) + ', key = ' + JSON.stringify(key || '') + ', value = ' + JSON.stringify(value === undefined ? '' : value) + ';' +
    '  if (typeof sharedStorage === "undefined") return JSON.stringify({ unsupported: true });' +
    '  if (op === "get") { const r = await sharedStorage.get(key); return JSON.stringify({ value: r ? r.value : null }); }' +
    '  if (op === "set") { await sharedStorage.set(key, String(value)); return JSON.stringify({ done: true }); }' +
    '  if (op === "append") { await sharedStorage.append(key, String(value)); return JSON.stringify({ done: true }); }' +
    '  if (op === "delete") { await sharedStorage.delete(key); return JSON.stringify({ done: true }); }' +
    '  if (op === "clear") { await sharedStorage.clear(); return JSON.stringify({ done: true }); }' +
    '  return JSON.stringify({ error: "unknown op" });' +
    '})()'
  );
}

async function igOp(op, group) {
  return pageEval(
    '(async function () {' +
    '  const op = ' + JSON.stringify(op) + ', group = ' + JSON.stringify(group) + ';' +
    '  if (!document.joinAdInterestGroup) return JSON.stringify({ unsupported: true });' +
    '  if (op === "join") { await document.joinAdInterestGroup(group); return JSON.stringify({ done: true }); }' +
    '  if (op === "leave") { await document.leaveAdInterestGroup(group); return JSON.stringify({ done: true }); }' +
    '  return JSON.stringify({ error: "unknown op" });' +
    '})()'
  );
}

async function pstCheckIssuer(issuer) {
  return pageEval(
    '(async function () {' +
    '  const issuer = ' + JSON.stringify(issuer) + ';' +
    '  if (!document.hasPrivateToken) return JSON.stringify({ unsupported: true });' +
    '  return JSON.stringify({ has: await document.hasPrivateToken(issuer) });' +
    '})()'
  );
}

/* ============================== refresh ============================== */
async function refreshStore(store) {
  try {
    if (store === 'ls' || store === 'ss') {
      state.data[store] = await readStorage(store);
    } else if (store === 'cookies') {
      state.data.cookies = await readCookies();
    } else if (store === 'idb') {
      await refreshIdb();
    } else if (store === 'cache') {
      await refreshCache();
    } else if (store === 'buckets') {
      const res = await bucketsList();
      state.data.buckets = (res && res.list) || [];
    } else if (store === 'ext') {
      state.data.ext = await extRefreshData();
    }
    if (state.data[store] !== undefined) state.snapshot[store] = JSON.stringify(state.data[store]);
    hideError();
  } catch (e) {
    showError(e.message);
  }
  render();
}

async function refreshIdb() {
  const dbs = await idbListDatabases();
  state.idb.dbs = dbs || [];
  if (!state.idb.db || !dbs.some((d) => d.name === state.idb.db)) {
    state.idb.db = dbs.length ? dbs[0].name : null;
    state.idb.store = null;
    state.data.idb = [];
  }
  if (state.idb.db) {
    state.idb.stores = (await idbListStores(state.idb.db)) || [];
    if (!state.idb.store || !state.idb.stores.some((s) => s.name === state.idb.store)) {
      state.idb.store = state.idb.stores.length ? state.idb.stores[0].name : null;
    }
    state.data.idb = state.idb.store ? await idbGetRecords(state.idb.db, state.idb.store) : [];
  } else {
    state.idb.stores = [];
    state.data.idb = [];
  }
}

async function refreshCache() {
  const res = await cacheListNames();
  if (res && res.unsupported) throw new Error('Cache Storage API is not available on this page.');
  state.cacheSel.names = (res && res.names) || [];
  if (!state.cacheSel.name || !state.cacheSel.names.includes(state.cacheSel.name)) {
    state.cacheSel.name = state.cacheSel.names.length ? state.cacheSel.names[0] : null;
  }
  state.data.cache = state.cacheSel.name
    ? (await cacheGetEntries(state.cacheSel.name)).map(([url, method, dest]) => ({ k: url, method, dest }))
    : [];
}

async function refreshAll() {
  for (const s of AUTO_STORES) {
    try {
      if (s === 'ls' || s === 'ss') state.data[s] = await readStorage(s);
      else if (s === 'cookies') state.data.cookies = await readCookies();
      else if (s === 'ext') state.data.ext = await extRefreshData();
      state.snapshot[s] = JSON.stringify(state.data[s]);
    } catch (e) {
      if (s === state.store) showError(e.message);
    }
  }
  if (TABLE_STORES.includes(state.store) && !AUTO_STORES.includes(state.store)) {
    await refreshStore(state.store);
    return;
  }
  render();
}

async function autoTick() {
  if (!state.autoRefresh || document.hidden) return;
  if (!AUTO_STORES.includes(state.store)) return;
  try {
    const store = state.store;
    let data;
    if (store === 'ls' || store === 'ss') data = await readStorage(store);
    else if (store === 'cookies') data = await readCookies();
    else if (store === 'ext') data = await extRefreshData();
    else return;
    const snap = JSON.stringify(data);
    if (snap !== state.snapshot[store]) {
      state.data[store] = data;
      state.snapshot[store] = snap;
      render();
    }
  } catch (e) { /* page may be navigating */ }
}

/* ============================== errors ============================== */
function showError(msg) {
  const bar = $('#errorBar');
  bar.textContent = '⚠ ' + msg + (REAL ? '' : ' (preview mode)');
  bar.classList.remove('hidden');
}
function hideError() { $('#errorBar').classList.add('hidden'); }

/* ============================== rendering ============================== */
function colSet() {
  if (state.store === 'cookies') return COLS.cookies;
  if (COLS[state.store]) return COLS[state.store];
  return COLS.ls;
}

function cookieExpiresText(c) {
  if (!c.expirationDate) return 'Session';
  const d = new Date(c.expirationDate * 1000);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function cookieFlagsText(c) {
  let s = '';
  if (c.httpOnly) s += 'H';
  if (c.secure) s += 'S';
  s += ({ no_restriction: 'N', lax: 'L', strict: 'St' })[c.sameSite] || '';
  return s;
}

function storeCount(id) {
  if (id === 'idb') return state.idb.dbs.length;
  if (id === 'cache') return state.cacheSel.names.length;
  if (id === 'buckets') return state.data.buckets.length;
  if (FORM_STORES.includes(id)) return -1;
  const d = state.data[id];
  return d ? d.length : 0;
}

function visibleRows() {
  let rows = (state.data[state.store] || []).slice();
  const q = state.filter.trim().toLowerCase();
  const cols = colSet();
  if (q) {
    rows = rows.filter((r) => cols.map((c) => String(c.get(r))).join(' ').toLowerCase().includes(q));
  }
  const s = state.sort;
  if (s) {
    const col = cols.find((c) => c.id === s.id);
    if (col) {
      rows.sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (col.numeric) return ((va || 0) - (vb || 0)) * s.dir;
        return String(va).localeCompare(String(vb)) * s.dir;
      });
    }
  }
  return rows;
}

function render() {
  try {
    renderInner();
  } catch (e) {
    showError('Render error — ' + (e && e.message ? e.message : String(e)));
  }
}

function renderInner() {
  renderSidebar();
  renderViewSwitch();
  renderToolbar();
  renderSubBar();
  $('#viewTable').classList.toggle('hidden', state.view !== 'table');
  $('#viewJson').classList.toggle('hidden', state.view !== 'json');
  $('#viewScript').classList.toggle('hidden', state.view !== 'script');
  $('#viewForm').classList.toggle('hidden', state.view !== 'form');
  if (state.view === 'table') renderTable();
  else if (state.view === 'json') syncJsonEditor(false);
  else if (state.view === 'form') renderFormPanel();
  renderStatus();
}

function renderViewSwitch() {
  for (const b of document.querySelectorAll('#viewSwitch button')) {
    const v = b.dataset.view;
    let visible;
    if (v === 'script') visible = true;
    else if (v === 'table') visible = TABLE_STORES.includes(state.store);
    else if (v === 'json') visible = JSON_STORES.includes(state.store);
    else visible = false;
    b.classList.toggle('hidden', !visible);
    b.classList.toggle('active', state.view === v);
  }
}

function renderSidebar() {
  for (const groupId of ['sideStorage', 'sidePrivacy']) $('#' + groupId).textContent = '';
  for (const st of STORE_META) {
    const count = storeCount(st.id);
    const b = el('button', {
      class: 'side-item' + (state.store === st.id ? ' active' : ''),
      type: 'button',
      title: st.label,
    }, el('span', { class: 'side-label' }, st.label));
    if (count >= 0) b.append(el('span', { class: 'count' }, String(count)));
    b.addEventListener('click', () => switchStore(st.id));
    $(st.group === 'privacy' ? '#sidePrivacy' : '#sideStorage').append(b);
  }
}

function renderToolbar() {
  const store = state.store;
  const isTable = TABLE_STORES.includes(store);
  const isForm = FORM_STORES.includes(store);
  $('#searchBox').classList.toggle('hidden', !isTable);
  const encBtn = $('#btnEncrypt');
  encBtn.classList.toggle('hidden', !(store === 'ls' || store === 'ss'));
  encBtn.classList.toggle('on', encActive());
  encBtn.title = encActive()
    ? 'Encrypt mode ON — AES values are shown decrypted (click to change the passphrase or turn off)'
    : 'Encrypt mode — decrypt AES (crypto-js) values in Local/Session Storage';
  $('#btnAdd').classList.toggle('hidden', isForm || store === 'cache');
  $('#btnExport').classList.toggle('hidden', isForm);
  $('#btnClear').classList.toggle('hidden', isForm || store === 'cache' || store === 'buckets');
  const addLabel = $('#btnAdd span');
  if (addLabel) {
    addLabel.textContent =
      store === 'idb' ? 'Add record'
      : store === 'ext' ? 'Add key'
      : store === 'buckets' ? 'Create bucket'
      : store === 'cookies' ? 'Add cookie'
      : 'Add';
  }
  const clearBtn = $('#btnClear');
  clearBtn.title = store === 'idb' ? 'Clear every record in this object store'
    : store === 'ext' ? 'Clear every key in this storage area'
    : 'Delete every entry in this storage';
}

function renderSubBar() {
  const bar = $('#subBar');
  bar.textContent = '';
  const store = state.store;
  if (store === 'idb') {
    const dbSel = el('select', {});
    if (!state.idb.dbs.length) dbSel.append(el('option', { value: '' }, '(no databases)'));
    for (const d of state.idb.dbs) dbSel.append(el('option', { value: d.name }, d.name + ' (v' + d.version + ')'));
    dbSel.value = state.idb.db || '';
    dbSel.addEventListener('change', async () => {
      state.idb.db = dbSel.value || null;
      state.idb.store = null;
      await refreshStore('idb');
    });
    const storeSel = el('select', {});
    if (!state.idb.stores.length) storeSel.append(el('option', { value: '' }, '(no object stores)'));
    for (const s of state.idb.stores) {
      storeSel.append(el('option', { value: s.name }, s.name + ' · ' + s.count + (s.keyPath ? ' (key: ' + s.keyPath + ')' : '')));
    }
    storeSel.value = state.idb.store || '';
    storeSel.addEventListener('change', async () => {
      state.idb.store = storeSel.value || null;
      await refreshStore('idb');
    });
    const delDb = el('button', { class: 'danger', type: 'button' }, 'Delete database');
    delDb.addEventListener('click', async () => {
      if (!state.idb.db) return;
      if (!window.confirm('Delete the entire database "' + state.idb.db + '" including all object stores?')) return;
      try {
        await idbDeleteDatabase(state.idb.db);
        state.idb.db = null;
        state.idb.store = null;
        await refreshStore('idb');
        toast('Database deleted');
      } catch (e) { toast('Delete failed: ' + e.message); }
    });
    bar.append(el('span', { class: 'sub-label' }, 'Database'), dbSel,
      el('span', { class: 'sub-label' }, 'Object store'), storeSel,
      el('span', { class: 'grow' }), delDb);
    bar.classList.remove('hidden');
  } else if (store === 'cache') {
    const sel = el('select', {});
    if (!state.cacheSel.names.length) sel.append(el('option', { value: '' }, '(no caches)'));
    for (const n of state.cacheSel.names) sel.append(el('option', { value: n }, n));
    sel.value = state.cacheSel.name || '';
    sel.addEventListener('change', async () => {
      state.cacheSel.name = sel.value || null;
      await refreshStore('cache');
    });
    const del = el('button', { class: 'danger', type: 'button' }, 'Delete cache');
    del.addEventListener('click', async () => {
      if (!state.cacheSel.name) return;
      if (!window.confirm('Delete the cache "' + state.cacheSel.name + '"?')) return;
      try {
        await cacheDeleteCache(state.cacheSel.name);
        state.cacheSel.name = null;
        await refreshStore('cache');
        toast('Cache deleted');
      } catch (e) { toast('Delete failed: ' + e.message); }
    });
    bar.append(el('span', { class: 'sub-label' }, 'Cache'), sel, el('span', { class: 'grow' }), del);
    bar.classList.remove('hidden');
  } else if (store === 'ext') {
    const areaSel = el('select', {},
      el('option', { value: 'local' }, 'chrome.storage.local'),
      el('option', { value: 'sync' }, 'chrome.storage.sync'),
      el('option', { value: 'session' }, 'chrome.storage.session'));
    areaSel.value = extArea();
    areaSel.addEventListener('change', async () => {
      state.extArea = areaSel.value;
      state.filter = '';
      $('#searchBox').value = '';
      await refreshStore('ext');
    });
    const usage = el('span', { class: 'usage' },
      state.extUsage === null || state.extUsage === undefined ? '' : fmtSize(state.extUsage) + ' in use');
    bar.append(el('span', { class: 'sub-label' }, 'Area'), areaSel, usage);
    bar.classList.remove('hidden');
  } else if (store === 'buckets') {
    bar.append(el('span', { class: 'sub-label' }, 'navigator.storageBuckets — per-origin buckets with their own quota, persistence and cache storage.'));
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

function iconBtnsFor(row) {
  const store = state.store;
  if (store === 'cache') {
    return [
      iconBtn('view', 'Preview cached response', () => cachePreviewModal(row)),
      iconBtn('delete', 'Delete cached request', () => cacheDeleteRow(row)),
    ];
  }
  if (store === 'buckets') {
    return [iconBtn('delete', 'Delete bucket', () => bucketDeleteRow(row), 'danger')];
  }
  const btns = [];
  if ((store === 'ls' || store === 'ss') && window.SdbAes
      && SdbAes.splitCipherValue(row.v, encState.prefix) !== null) {
    btns.push(iconBtn('decrypt', 'Decrypt this key with its own passphrase', () => openDecryptModal(row)));
  }
  btns.push(
    iconBtn('edit', 'Edit', () => openItemModal(row)),
    iconBtn('delete', 'Delete', () => deleteRow(row), 'danger'),
  );
  return btns;
}

function renderTable() {
  const table = $('#dataTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const cols = colSet();

  thead.textContent = '';
  const headRow = el('tr');
  for (const c of cols) {
    const th = el('th', { style: 'width:' + c.width }, c.label);
    if (state.sort && state.sort.id === c.id) th.append(el('span', { class: 'sort-ind' }, state.sort.dir > 0 ? '▲' : '▼'));
    th.addEventListener('click', () => {
      if (state.sort && state.sort.id === c.id) state.sort.dir = -state.sort.dir;
      else state.sort = { id: c.id, dir: 1 };
      renderTable();
    });
    headRow.append(th);
  }
  const actW = (state.store === 'ls' || state.store === 'ss') ? '9%' : (state.store === 'cache' ? '7%' : '6%');
  headRow.append(el('th', { style: 'width: ' + actW }, ''));
  thead.append(headRow);

  tbody.textContent = '';
  const all = state.data[state.store] || [];
  const rows = visibleRows();

  if (!rows.length) {
    const msg = all.length
      ? 'No matches for the current filter.'
      : state.store === 'idb'
        ? (state.idb.db ? 'This object store is empty — add a record with Add record.' : 'No IndexedDB databases for this page.')
        : state.store === 'cache'
          ? (state.cacheSel.name ? 'This cache is empty.' : 'No Cache Storage caches for this page.')
          : state.store === 'buckets'
            ? 'No storage buckets — create one with Create bucket.'
            : state.store === 'ext'
              ? 'This chrome.storage area is empty.'
              : state.store === 'cookies' ? 'No cookies for this page.'
              : 'Empty — add your first entry with the Add button.';
    tbody.append(el('tr', {}, el('td', { class: 'empty-state', colspan: String(cols.length + 1) }, msg)));
    return;
  }

  const capped = rows.length > MAX_RENDER_ROWS;
  for (const r of rows.slice(0, MAX_RENDER_ROWS)) {
    const tr = el('tr');
    for (const c of cols) {
      if (c.id === 'value' || (state.store !== 'cookies' && c.id === 'key')) {
        // value / key cells share the truncating preview style
        if (c.id === 'value') { tr.append(valueCell(r)); continue; }
      }
      if (c.id === 'type') {
        const t = detectType(dispV(r));
        tr.append(el('td', {}, el('span', { class: 'badge b-' + t, title: 'detected via JSON.parse' }, t)));
        continue;
      }
      if (c.id === 'flags') { tr.append(flagsCell(r)); continue; }
      if (state.store === 'buckets' && c.id === 'persisted') {
        const yes = c.get(r) === 'yes';
        tr.append(el('td', {}, el('span', { class: 'badge b-' + (yes ? 'boolean' : 'string') }, yes ? 'persisted' : 'best-effort')));
        continue;
      }
      if (c.numeric && (c.id === 'usage' || c.id === 'quota' || c.id === 'size')) {
        const td = el('td', { class: 'mono' }, fmtSize(c.get(r)));
        tr.append(td);
        continue;
      }
      const raw = String(c.get(r));
      let preview = raw;
      if (preview.length > 300) preview = preview.slice(0, 300) + '…';
      const td = el('td', { class: c.cls || 'mono' }, preview);
      td.title = raw;
      if (c.id === 'key' && (state.store === 'ls' || state.store === 'ss' || state.store === 'idb' || state.store === 'ext')) {
        td.addEventListener('dblclick', () => openItemModal(r));
      }
      tr.append(td);
    }
    const actions = el('td', { class: 'actions' });
    for (const b of iconBtnsFor(r)) actions.append(b);
    tr.append(actions);
    tbody.append(tr);
  }
  if (capped) {
    tbody.append(el('tr', {}, el('td', { class: 'empty-state', colspan: String(cols.length + 1) },
      'Showing first ' + MAX_RENDER_ROWS + ' of ' + rows.length + ' rows — use the filter to narrow down.')));
  }
}

function valueCell(r) {
  const raw = r.v !== undefined ? r.v : r.value;
  const dblEdit = TABLE_STORES.includes(state.store) && state.store !== 'cache' && state.store !== 'buckets';

  if (r.enc && (r.derr || typeof r.dv === 'string')) {
    const td = el('td', { class: 'mono value-cell' });
    td.append(el('span', { class: 'badge b-aes', title: 'value is AES-encrypted in storage (prefix: ' + (encState.prefix || ENC_DEFAULT_PREFIX) + ')' }, 'aes'), ' ');
    if (r.derr) {
      td.classList.add('dec-failed');
      td.title = 'Decryption failed (wrong passphrase?) — use the 🔑 row button to set a passphrase for this key.\nciphertext:\n' + raw;
      td.append(el('span', { class: 'dec-msg' }, '🔒 decrypt failed — wrong passphrase? (🔑)'));
    } else {
      td.title = 'AES-encrypted in storage — shown decrypted · double-click to edit (re-encrypts on save)';
      let preview = String(r.dv);
      const type = detectType(preview);
      if (type === 'json') {
        td.classList.add('is-json');
        try { preview = JSON.stringify(JSON.parse(preview)); } catch (e) { /* keep raw */ }
      }
      if (preview.length > 300) preview = preview.slice(0, 300) + '…';
      td.append(preview);
    }
    if (dblEdit) td.addEventListener('dblclick', () => openItemModal(r));
    return td;
  }

  const type = detectType(raw);
  let preview = raw === null || raw === undefined ? '' : String(raw);
  if (type === 'json') {
    try { preview = JSON.stringify(JSON.parse(preview)); } catch (e) { /* keep raw */ }
  }
  if (preview.length > 300) preview = preview.slice(0, 300) + '…';
  const td = el('td', { class: 'mono value-cell' + (type === 'json' ? ' is-json' : ''), title: 'Double-click to edit' }, preview);
  if (dblEdit) {
    td.addEventListener('dblclick', () => openItemModal(r));
  }
  return td;
}

function flagsCell(c) {
  const wrap = el('span', { class: 'flags' });
  if (c.httpOnly) wrap.append(el('span', { class: 'flag f-http', title: 'httpOnly' }, 'H'));
  if (c.secure) wrap.append(el('span', { class: 'flag f-secure', title: 'Secure' }, 'S'));
  const ss = ({ no_restriction: 'None', lax: 'Lax', strict: 'Strict' })[c.sameSite];
  if (ss) wrap.append(el('span', { class: 'flag f-ss', title: 'SameSite=' + ss }, ss[0]));
  if (!c.expirationDate) wrap.append(el('span', { class: 'flag f-session', title: 'Session cookie' }, '•'));
  return el('td', {}, wrap);
}

function renderStatus() {
  const store = state.store;
  let text = '';
  const host = state.pageMeta.hostname ? ' · ' + state.pageMeta.hostname : '';
  if (store === 'ls' || store === 'ss') {
    const total = state.data[store].reduce((a, r) => a + (r.size || 0), 0);
    text = state.data[store].length + ' items · ' + fmtSize(total) + host;
    if (encActive()) {
      const nEnc = state.data[store].filter((r) => r.enc).length;
      text += ' · AES on' + (nEnc ? ' (' + nEnc + ' encrypted)' : '');
    }
  } else if (store === 'cookies') {
    text = state.data.cookies.length + ' cookies' + host;
  } else if (store === 'idb') {
    text = state.idb.dbs.length + ' databases';
    if (state.idb.db) {
      text += ' · ' + state.idb.db;
      if (state.idb.store) text += '.' + state.idb.store + ': ' + state.data.idb.length + ' records';
    }
  } else if (store === 'cache') {
    text = state.cacheSel.names.length + ' caches';
    if (state.cacheSel.name) text += ' · ' + state.cacheSel.name + ': ' + state.data.cache.length + ' entries';
  } else if (store === 'buckets') {
    const usage = state.data.buckets.reduce((a, r) => a + (r.usage || 0), 0);
    text = state.data.buckets.length + ' buckets · ' + fmtSize(usage) + ' used';
  } else if (store === 'ext') {
    text = 'chrome.storage.' + extArea() + ' · ' + state.data.ext.length + ' keys'
      + (state.extUsage !== null && state.extUsage !== undefined ? ' · ' + fmtSize(state.extUsage) : '');
  } else {
    text = 'Privacy Sandbox';
  }
  if (state.filter && TABLE_STORES.includes(store)) {
    text = visibleRows().length + ' shown (of ' + (state.data[store] || []).length + ') · ' + text;
  }
  $('#statusMain').textContent = text;
  $('#statusRight').textContent = FORM_STORES.includes(store) ? state.pageMeta.hostname || '' : 'Storage DB';
}

/* ============================== form view (privacy sandbox) ============================== */
function formLogLine(kind, text) {
  const log = $('#formLog');
  if (!log) return;
  const line = el('div', { class: 'out-line ' + (kind || '') }, text);
  log.append(line);
  log.scrollIntoView({ block: 'end' });
}

function availabilityPill(ok, okText, offText) {
  return el('span', { class: 'availability ' + (ok ? 'ok' : 'off') }, (ok ? '● ' : '○ ') + (ok ? okText : offText));
}

function renderFormPanel() {
  const panel = $('#formPanel');
  panel.textContent = '';
  const store = state.store;

  if (store === 'shared') {
    const keyI = el('input', { type: 'text', placeholder: 'key (must be known — Shared Storage keys cannot be enumerated)' });
    const valI = el('input', { type: 'text', placeholder: 'value (text)' });
    const run = async (op, withValue) => {
      const k = keyI.value.trim();
      if (op !== 'clear' && !k) { formLogLine('error', 'key is required'); return; }
      try {
        const res = await sharedOp(op, k, withValue ? valI.value : undefined);
        formLogLine('result', op + '(' + (k ? '"' + k + '"' : '') + ') → ' + JSON.stringify(res));
      } catch (e) {
        formLogLine('error', op + ' failed — ' + e.message);
      }
    };
    const mk = (label, fn) => {
      const b = el('button', { type: 'button' }, label);
      b.addEventListener('click', fn);
      return b;
    };
    panel.append(
      el('div', { class: 'form-block' },
        el('h3', {}, 'Shared Storage'),
        privacyPillAsync(panel, 'shared'),
        el('p', { class: 'desc' },
          'Privacy Sandbox storage for the page origin. Keys cannot be listed from the page for privacy reasons — ',
          'get / set / append / delete work on a known key, clear() wipes everything. Also reachable from the Script view: ',
          'await sharedStorage.get("key")'),
        el('div', { class: 'form-row' },
          el('label', { class: 'fld' }, el('span', {}, 'Key'), keyI),
          el('label', { class: 'fld' }, el('span', {}, 'Value'), valI)),
        el('div', { class: 'form-row' },
          mk('Get', () => run('get', false)),
          mk('Set', () => run('set', true)),
          mk('Append', () => run('append', true)),
          mk('Delete', () => run('delete', false)),
          mk('Clear all', () => { if (window.confirm('Clear ALL shared storage entries for this origin?')) run('clear', false); })),
        el('div', { class: 'form-log', id: 'formLog' })),
    );
  } else if (store === 'ig') {
    const ownerI = el('input', { type: 'text', placeholder: 'https://owner.example' });
    const nameI = el('input', { type: 'text', placeholder: 'group name' });
    const bidI = el('input', { type: 'text', placeholder: 'https://owner.example/bidding-logic.js (join only)' });
    const lifeI = el('input', { type: 'number', min: '1', value: '30', title: 'lifetime in days (join only)' });
    const mk = (label, fn, cls) => {
      const b = el('button', { type: 'button', class: cls || '' }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const doOp = async (op) => {
      const owner = ownerI.value.trim();
      const name = nameI.value.trim();
      if (!owner || !name) { formLogLine('error', 'owner and name are required'); return; }
      const group = { owner, name };
      if (op === 'join') {
        group.biddingLogicUrl = bidI.value.trim();
        group.lifetimeMs = Math.max(1, parseInt(lifeI.value || '30', 10)) * 86400000;
      }
      try {
        const res = await igOp(op, group);
        formLogLine('result', op + ' → ' + JSON.stringify(res));
      } catch (e) {
        formLogLine('error', op + ' failed — ' + e.message);
      }
    };
    panel.append(
      el('div', { class: 'form-block' },
        el('h3', {}, 'Interest Groups (Protected Audience)'),
        privacyPillAsync(panel, 'ig'),
        el('p', { class: 'desc' },
          'Join or leave Protected Audience interest groups for this page. Chrome does not let extensions list existing groups ',
          '(only the page owner or DevTools internals can enumerate them) — you can still join/leave with owner + name. ',
          'Joining requires the bidding logic URL to be served with the right permissions and may fail on sites without the feature policy.'),
        el('div', { class: 'form-row' },
          el('label', { class: 'fld' }, el('span', {}, 'Owner origin'), ownerI),
          el('label', { class: 'fld' }, el('span', {}, 'Group name'), nameI)),
        el('div', { class: 'form-row' },
          el('label', { class: 'fld' }, el('span', {}, 'Bidding logic URL'), bidI),
          el('label', { class: 'fld' }, el('span', {}, 'Lifetime (days)'), lifeI)),
        el('div', { class: 'form-row' },
          mk('Join group', () => doOp('join'), 'primary'),
          mk('Leave group', () => doOp('leave'))),
        el('div', { class: 'form-log', id: 'formLog' })),
    );
  } else if (store === 'pst') {
    const issuerI = el('input', { type: 'text', placeholder: 'https://issuer.example' });
    const checkBtn = el('button', { type: 'button', class: 'primary' }, 'Check token');
    checkBtn.addEventListener('click', async () => {
      const issuer = issuerI.value.trim();
      if (!issuer) { formLogLine('error', 'issuer origin is required'); return; }
      try {
        const res = await pstCheckIssuer(issuer);
        formLogLine('result', 'hasPrivateToken(' + issuer + ') → ' + JSON.stringify(res));
      } catch (e) {
        formLogLine('error', 'check failed — ' + e.message);
      }
    });
    panel.append(
      el('div', { class: 'form-block' },
        el('h3', {}, 'Private State Tokens'),
        privacyPillAsync(panel, 'pst'),
        el('p', { class: 'desc' },
          'Private State Tokens (formerly Trust Tokens) are private by design — tokens cannot be read, listed or counted from the page. ',
          'What the page CAN do is ask whether it holds a token from a specific issuer with document.hasPrivateToken(issuer). ',
          'To reset tokens use chrome://settings/content/privacySandbox or the site data settings.'),
        el('div', { class: 'form-row' },
          el('label', { class: 'fld' }, el('span', {}, 'Issuer origin'), issuerI),
          checkBtn),
        el('div', { class: 'form-log', id: 'formLog' })),
    );
  }
}

/* availability pill that resolves asynchronously and inserts itself */
function privacyPillAsync(container, kind) {
  const pill = el('span', { class: 'availability off' }, '… checking availability');
  pill.style.marginBottom = '8px';
  privacyCheck(kind).then((ok) => {
    pill.className = 'availability ' + (ok ? 'ok' : 'off');
    pill.textContent = ok
      ? '● API available on this page'
      : '○ API not available (needs a secure context / enabled feature / permission policy)';
  }).catch(() => {
    pill.className = 'availability off';
    pill.textContent = '○ API not available';
  });
  return pill;
}

/* ============================== JSON view ============================== */
function rowsToJsonObject() {
  const store = state.store;
  if (store === 'cookies') {
    return (state.data.cookies || []).map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : 'session',
      httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
    }));
  }
  if (store === 'idb') {
    const out = {};
    for (const r of state.data.idb || []) {
      if (state.nested) {
        try { out[r.k] = JSON.parse(r.v); continue; } catch (e) { /* keep raw */ }
      }
      out[r.k] = r.v;
    }
    return { database: state.idb.db, objectStore: state.idb.store, records: out };
  }
  if (store === 'cache') {
    return { cache: state.cacheSel.name, requests: (state.data.cache || []).map((r) => ({ url: r.k, method: r.method })) };
  }
  if (store === 'buckets') {
    return { buckets: state.data.buckets || [] };
  }
  if (store === 'ext') {
    const out = {};
    for (const r of state.data.ext || []) {
      try { out[r.k] = JSON.parse(r.v); } catch (e) { out[r.k] = r.v; }
    }
    return { area: 'chrome.storage.' + extArea(), keys: out };
  }
  const obj = {};
  for (const r of state.data[store] || []) {
    const val = dispV(r);
    if (state.nested) {
      try { obj[r.k] = JSON.parse(val); continue; } catch (e) { /* keep raw */ }
    }
    obj[r.k] = val;
  }
  return obj;
}

function syncJsonEditor(force) {
  if (!jsonEditor) return;
  if (!force && state.jsonDirty) return;
  const editable = JSON_EDITABLE.includes(state.store);
  $('#btnApplyJson').classList.toggle('hidden', !editable);
  $('#btnFormat').classList.toggle('hidden', !editable && state.store !== 'cookies');
  $('#btnNested').classList.toggle('hidden', !(editable || state.store === 'idb' || state.store === 'ext'));
  $('#btnNested').textContent = 'Nested: ' + (state.nested ? 'ON' : 'OFF');
  $('#btnNested').classList.toggle('on', state.nested);
  $('#jsonHint').textContent = editable
    ? (state.nested
      ? 'JSON-string values are expanded into nested objects — edit freely, then Save (nested objects are stringified back automatically).'
      : 'Raw string values — edit this object and Save; keys are added / updated / removed to match exactly.')
    : 'Read-only snapshot — edit rows in Table view instead.';
  jsonEditor.updateOptions({ readOnly: !editable });
  setJsonText(JSON.stringify(rowsToJsonObject(), null, 2));
  state.jsonDirty = false;
  clearJsonErrorLine();
}

function saveJson() {
  if (!JSON_EDITABLE.includes(state.store)) return;
  if (!jsonEditor) return;
  const text = jsonEditor.getValue();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    showJsonError(text, e);
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    toast('Root must be an object like { "key": "value" }');
    return;
  }
  const current = new Map((state.data[state.store] || []).map((r) => [r.k, r]));
  const remove = [];
  let added = 0, updated = 0, removed = 0;
  for (const k of current.keys()) {
    if (!Object.prototype.hasOwnProperty.call(parsed, k)) { remove.push(k); removed++; }
  }
  (async () => {
    try {
      const set = [];
      for (const [k, v] of Object.entries(parsed)) {
        const sv = v === null || v === undefined ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        const orig = current.get(k);
        let toStore = sv;
        if (encActive() && orig && isEncRow(orig)) {
          // key นี้เข้ารหัสอยู่ใน storage — ค่าที่แก้เป็น plaintext ต้องเข้ารหัสกลับก่อนลง (ด้วย passphrase ราย key)
          toStore = sv === orig.dv ? orig.v
            : SdbAes.wrapCipher(await SdbAes.aesEncrypt(sv, encPassFor(k)), encState.prefix);
        }
        if (!orig) added++;
        else if (toStore !== orig.v) updated++;
        set.push([k, toStore]);
      }
      if (set.length || remove.length) await storageApply(state.store, { set, remove });
      state.jsonDirty = false;
      await refreshStore(state.store);
      toast('Saved — ' + added + ' added, ' + updated + ' updated, ' + removed + ' removed');
    } catch (e) {
      toast('Save failed: ' + e.message);
    }
  })();
}

/* ============================== actions ============================== */
async function switchStore(id) {
  if (state.store === id) return;
  if (state.view === 'json' && state.jsonDirty) {
    if (!window.confirm('Discard unsaved JSON edits and switch storage?')) return;
    state.jsonDirty = false;
  }
  state.store = id;
  state.sort = null;
  state.filter = '';
  const sb = $('#searchBox');
  if (sb) sb.value = '';
  state.view = FORM_STORES.includes(id)
    ? 'form'
    : (TABLE_STORES.includes(id) ? 'table' : 'json');
  if (!AUTO_STORES.includes(id) || id === 'ext') await refreshStore(id);
  else render();
}

function switchView(view) {
  if (view === 'table' && !TABLE_STORES.includes(state.store)) return;
  if (view === 'json' && !JSON_STORES.includes(state.store)) return;
  state.view = view;
  render();
}

async function deleteRow(r) {
  const store = state.store;
  try {
    if (store === 'cookies') {
      await cookieRemove(r);
      await refreshStore('cookies');
      toast('Cookie "' + r.name + '" deleted');
    } else if (store === 'ls' || store === 'ss') {
      await storageApply(store, { set: [], remove: [r.k] });
      const undone = { key: r.k, value: r.v };
      await refreshStore(store);
      toast('Key "' + r.k + '" deleted', {
        label: 'Undo',
        fn: async () => {
          try {
            await storageApply(store, { set: [[undone.key, undone.value]] });
            await refreshStore(store);
          } catch (e) { toast('Undo failed: ' + e.message); }
        },
      });
    } else if (store === 'idb') {
      const idx = state.data.idb.indexOf(r);
      if (idx < 0) return;
      await idbDeleteRecordAt(state.idb.db, state.idb.store, idx);
      await refreshStore('idb');
      toast('Record deleted');
    } else if (store === 'ext') {
      await extRemove(r.k);
      await refreshStore('ext');
      toast('Key "' + r.k + '" deleted');
    }
  } catch (e) {
    toast('Delete failed: ' + e.message);
  }
}

async function cacheDeleteRow(r) {
  try {
    await cacheDeleteEntry(state.cacheSel.name, r.k);
    await refreshStore('cache');
    toast('Cached request deleted');
  } catch (e) {
    toast('Delete failed: ' + e.message);
  }
}

async function bucketDeleteRow(r) {
  if (!window.confirm('Delete bucket "' + r.name + '" and everything in it?')) return;
  try {
    await bucketsDelete(r.name);
    await refreshStore('buckets');
    toast('Bucket "' + r.name + '" deleted');
  } catch (e) {
    toast('Delete failed: ' + e.message);
  }
}

async function clearAll() {
  const store = state.store;
  if (store === 'cookies') {
    const rows = state.data.cookies;
    if (!rows.length) return;
    if (!window.confirm('Delete all ' + rows.length + ' cookies for ' + (state.pageMeta.hostname || 'this page') + '?')) return;
    for (const c of rows) await cookieRemove(c);
    await refreshStore('cookies');
    toast(rows.length + ' cookies deleted');
  } else if (store === 'ls' || store === 'ss') {
    const label = store === 'ls' ? 'localStorage' : 'sessionStorage';
    const backup = state.data[store].slice();
    if (!backup.length) return;
    if (!window.confirm('Clear ALL ' + backup.length + ' keys from ' + label + '?')) return;
    try {
      await storageApply(store, { clear: true });
      await refreshStore(store);
      toast(label + ' cleared', {
        label: 'Undo',
        fn: async () => {
          try {
            await storageApply(store, { set: backup.map((r) => [r.k, r.v]) });
            await refreshStore(store);
          } catch (e) { toast('Undo failed: ' + e.message); }
        },
      });
    } catch (e) {
      toast('Clear failed: ' + e.message);
    }
  } else if (store === 'idb') {
    if (!state.idb.db || !state.idb.store) return;
    if (!window.confirm('Clear every record in "' + state.idb.db + '.' + state.idb.store + '"?')) return;
    try {
      await idbClearStore(state.idb.db, state.idb.store);
      await refreshStore('idb');
      toast('Object store cleared');
    } catch (e) { toast('Clear failed: ' + e.message); }
  } else if (store === 'ext') {
    const n = state.data.ext.length;
    if (!n) return;
    if (!window.confirm('Clear ALL ' + n + ' keys from chrome.storage.' + extArea() + '?')) return;
    try {
      await extClear();
      await refreshStore('ext');
      toast('Storage area cleared');
    } catch (e) { toast('Clear failed: ' + e.message); }
  }
}

function exportJson() {
  const stamp = new Date().toISOString().slice(0, 10);
  const host = (state.pageMeta.hostname || 'page').replace(/[^a-z0-9.-]/gi, '_');
  const blob = new Blob([JSON.stringify(rowsToJsonObject(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.store + '-' + host + '-' + stamp + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Exported ' + a.download);
}

/* ============================== web storage writes ============================== */
async function storageApply(store, ops) {
  const prop = storageProp(store);
  const expr =
    '(function () {' +
    '  try {' +
    '    var s = window.' + prop + ';' +
    '    var set = ' + JSON.stringify(ops.set || []) + ';' +
    '    var rm = ' + JSON.stringify(ops.remove || []) + ';' +
    '    for (var i = 0; i < set.length; i++) s.setItem(set[i][0], set[i][1]);' +
    '    for (var j = 0; j < rm.length; j++) s.removeItem(rm[j]);' +
    '    if (' + (ops.clear ? 'true' : 'false') + ') s.clear();' +
    "    return 'OK';" +
    '  } catch (e) {' +
    "    return 'ERR:' + String(e && e.message || e);" +
    '  }' +
    '})()';
  const res = await evalInPage(expr);
  if (String(res).indexOf('ERR:') === 0) throw new Error(String(res).slice(4));
}

function cookieUrl(c) {
  const domain = (c.domain || state.pageMeta.hostname || '').replace(/^\./, '');
  const proto = c.secure ? 'https' : 'http';
  return proto + '://' + domain + (c.path || '/');
}

async function cookieRemove(c) {
  if (!REAL) {
    MOCK_COOKIES = MOCK_COOKIES.filter((x) => !(x.name === c.name && x.domain === c.domain));
    return;
  }
  await chromeCookies('remove', { url: cookieUrl(c), name: c.name });
}

async function cookieSet(details) {
  if (!REAL) {
    const item = {
      name: details.name,
      value: details.value,
      domain: details.domain || state.pageMeta.hostname,
      path: details.path || '/',
      expirationDate: details.expirationDate,
      session: !details.expirationDate,
      httpOnly: !!details.httpOnly,
      secure: !!details.secure,
      sameSite: details.sameSite || 'unspecified',
      size: (details.name + details.value).length,
    };
    const i = MOCK_COOKIES.findIndex((x) => x.name === item.name && x.domain === item.domain);
    if (i >= 0) MOCK_COOKIES[i] = item; else MOCK_COOKIES.push(item);
    return true;
  }
  return !!(await chromeCookies('set', details));
}

/* ============================== modals ============================== */
function showModal(build) {
  const overlay = $('#modalOverlay');
  const box = $('#modalBox');
  box.textContent = '';
  build(box);
  overlay.classList.remove('hidden');
  const first = box.querySelector('input, textarea, select');
  if (first) first.focus();
}
function hideModal() { $('#modalOverlay').classList.add('hidden'); }

function openItemModal(existing) {
  const store = state.store;
  if (store === 'cookies') return openCookieModal(existing);
  if (store === 'idb') return openIdbRecordModal(existing);
  if (store === 'buckets') return openBucketModal();
  if (store === 'ext') return openExtModal(existing);
  if (store === 'cache') return;

  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const keyI = el('input', { type: 'text', spellcheck: 'false', placeholder: 'key' });
    keyI.value = existing ? existing.k : '';
    const valI = el('textarea', { rows: '12', spellcheck: 'false', placeholder: 'value — plain text, JSON, anything' });
    // encrypted entry → แสดง plaintext ที่ถอดแล้ว (ถอดไม่ได้จะเห็น ciphertext ตามที่เก็บจริง)
    valI.value = existing ? dispV(existing) : '';
    const encChk = encActive() ? el('input', { type: 'checkbox' }) : null;
    if (encChk) encChk.checked = isEncRow(existing);

    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', hideModal);
    const save = el('button', { type: 'button', class: 'primary' }, existing ? 'Save changes' : 'Add');
    save.addEventListener('click', async () => {
      const key = keyI.value.trim();
      if (!key) { err.textContent = 'Key is required.'; err.classList.remove('hidden'); return; }
      save.disabled = true;
      try {
        let value = valI.value;
        if (encChk && encChk.checked) {
          // ค่าเดิมไม่ได้แก้ → เก็บ ciphertext เดิมไว้เลย (ไม่สุ่ม salt ใหม่โดยไม่จำเป็น)
          if (isEncRow(existing) && value === existing.dv) value = existing.v;
          else value = SdbAes.wrapCipher(await SdbAes.aesEncrypt(value, encPassFor(existing ? existing.k : key)), encState.prefix);
        }
        const ops = { set: [[key, value]] };
        if (existing && existing.k !== key) ops.remove = [existing.k];
        await storageApply(state.store, ops);
        hideModal();
        await refreshStore(state.store);
        toast(existing ? 'Updated "' + key + '"' : 'Added "' + key + '"');
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        save.disabled = false;
      }
    });

    box.append(
      el('h3', {}, existing ? 'Edit entry' : 'New entry — ' + (state.store === 'ss' ? 'sessionStorage' : 'localStorage')),
      el('label', { class: 'fld' }, el('span', {}, 'Key'), keyI),
      el('label', { class: 'fld' }, el('span', {}, 'Value'), valI,
        el('span', { class: 'hint' }, encActive()
          ? 'Encrypted entries are shown decrypted and re-encrypted with your passphrase on Save (toggle below).'
          : 'Stored exactly as text — use the JSON view or scripts to store structured data.')),
      encChk ? el('div', { class: 'check-row' },
        el('label', {}, encChk, 'Encrypt with AES before saving (crypto-js compatible)')) : null,
      err,
      el('div', { class: 'modal-actions' }, cancel, save),
    );
  });
}

function openIdbRecordModal(existing) {
  if (!state.idb.db || !state.idb.store) return;
  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const keyI = el('input', { type: 'text', spellcheck: 'false', placeholder: '1  ·  "user-1"  ·  (JSON value)' });
    keyI.value = existing ? existing.k : '';
    const valI = el('textarea', { rows: '12', spellcheck: 'false', placeholder: '{ "any": "JSON value" }' });
    if (existing) {
      try { valI.value = JSON.stringify(JSON.parse(existing.v), null, 2); } catch (e) { valI.value = existing.v; }
    }

    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', hideModal);
    const save = el('button', { type: 'button', class: 'primary' }, existing ? 'Save changes' : 'Add record');
    save.addEventListener('click', async () => {
      const key = keyI.value.trim();
      if (!key) { err.textContent = 'Key is required (e.g. 1 for a numeric key, "abc" for a string key).'; err.classList.remove('hidden'); return; }
      save.disabled = true;
      try {
        const idx = existing ? state.data.idb.indexOf(existing) : null;
        await idbPutRecord(state.idb.db, state.idb.store, idx, key, valI.value);
        hideModal();
        await refreshStore('idb');
        toast(existing ? 'Record updated' : 'Record added');
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        save.disabled = false;
      }
    });

    box.append(
      el('h3', {}, (existing ? 'Edit record — ' : 'New record — ') + state.idb.db + '.' + state.idb.store),
      el('label', { class: 'fld' }, el('span', {}, 'Primary key'), keyI,
        el('span', { class: 'hint' }, 'Parsed as JSON first: 1 → number, "a" → string. If the store has a keyPath it is injected into the value automatically.')),
      el('label', { class: 'fld' }, el('span', {}, 'Value (JSON)'), valI,
        el('span', { class: 'hint' }, 'Stored as a structured value when it parses as JSON, otherwise as a plain string.')),
      err,
      el('div', { class: 'modal-actions' }, cancel, save),
    );
  });
}

function openExtModal(existing) {
  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const keyI = el('input', { type: 'text', spellcheck: 'false', placeholder: 'key' });
    keyI.value = existing ? existing.k : '';
    const valI = el('textarea', { rows: '10', spellcheck: 'false', placeholder: '{ "any": "JSON value" }' });
    if (existing) {
      try { valI.value = JSON.stringify(JSON.parse(existing.v), null, 2); } catch (e) { valI.value = existing.v; }
    }

    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', hideModal);
    const save = el('button', { type: 'button', class: 'primary' }, existing ? 'Save changes' : 'Add key');
    save.addEventListener('click', async () => {
      const key = keyI.value.trim();
      if (!key) { err.textContent = 'Key is required.'; err.classList.remove('hidden'); return; }
      save.disabled = true;
      try {
        await extSet(key, valI.value);
        hideModal();
        await refreshStore('ext');
        toast(existing ? 'Updated "' + key + '"' : 'Added "' + key + '"');
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        save.disabled = false;
      }
    });

    box.append(
      el('h3', {}, (existing ? 'Edit key — ' : 'New key — ') + 'chrome.storage.' + extArea()),
      el('label', { class: 'fld' }, el('span', {}, 'Key'), keyI),
      el('label', { class: 'fld' }, el('span', {}, 'Value (JSON)'), valI,
        el('span', { class: 'hint' }, 'Objects/arrays are stored natively as structured values.')),
      err,
      el('div', { class: 'modal-actions' }, cancel, save),
    );
  });
}

function openBucketModal() {
  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const nameI = el('input', { type: 'text', spellcheck: 'false', placeholder: 'bucket-name' });
    const persistChk = el('input', { type: 'checkbox' });
    const quotaI = el('input', { type: 'number', min: '0', placeholder: 'optional bytes' });

    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', hideModal);
    const save = el('button', { type: 'button', class: 'primary' }, 'Create bucket');
    save.addEventListener('click', async () => {
      const name = nameI.value.trim();
      if (!name) { err.textContent = 'Name is required.'; err.classList.remove('hidden'); return; }
      const opts = { persisted: persistChk.checked };
      const q = parseInt(quotaI.value, 10);
      if (q > 0) opts.quota = q;
      save.disabled = true;
      try {
        await bucketsCreate(name, opts);
        hideModal();
        await refreshStore('buckets');
        toast('Bucket "' + name + '" created');
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        save.disabled = false;
      }
    });

    box.append(
      el('h3', {}, 'Create storage bucket'),
      el('label', { class: 'fld' }, el('span', {}, 'Name'), nameI),
      el('div', { class: 'check-row' },
        el('label', {}, persistChk, 'persisted (durable storage)'),
        el('label', { class: 'fld', style: 'margin:0;max-width:220px' }, el('span', {}, 'Quota (bytes, optional)'), quotaI)),
      err,
      el('div', { class: 'modal-actions' }, cancel, save),
    );
  });
}

function cachePreviewModal(r) {
  showModal((box) => {
    const body = el('pre', { class: 'cache-body' }, 'Loading…');
    const close = el('button', { type: 'button' }, 'Close');
    close.addEventListener('click', hideModal);
    box.append(
      el('h3', { class: 'mono', style: 'word-break:break-all;font-size:12px' }, r.k),
      body,
      el('div', { class: 'modal-actions' }, close),
    );
    cacheGetPreview(state.cacheSel.name, r.k).then((res) => {
      body.textContent = '';
      if (!res || res.missing) {
        body.textContent = 'Entry not found (it may have been evicted).';
        return;
      }
      body.append(el('div', { class: 'cache-meta' },
        'status: ' + res.status + ' ' + res.statusText + ' · type: ' + res.type + '\n' +
        'headers:\n' + (res.headers || []).map(([k, v]) => '  ' + k + ': ' + v).join('\n')));
      body.append(el('div', { class: 'cache-body-text' }, res.body || '(empty body)'));
    }).catch((e) => {
      body.textContent = 'Preview failed — ' + e.message;
    });
  });
}

function openCookieModal(existing) {
  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const nameI = el('input', { type: 'text', spellcheck: 'false', placeholder: 'name' });
    nameI.value = existing ? existing.name : '';
    const valI = el('textarea', { rows: '3', spellcheck: 'false', placeholder: 'value' });
    valI.value = existing ? existing.value : '';
    const domainI = el('input', { type: 'text', spellcheck: 'false', placeholder: state.pageMeta.hostname || 'example.com' });
    domainI.value = existing ? existing.domain : (state.pageMeta.hostname || '');
    const pathI = el('input', { type: 'text', spellcheck: 'false' });
    pathI.value = existing ? existing.path : '/';

    let days = 90;
    if (existing && existing.expirationDate) {
      days = Math.max(1, Math.ceil((existing.expirationDate - Date.now() / 1000) / 86400));
    }
    const sessionChk = el('input', { type: 'checkbox' });
    sessionChk.checked = existing ? !existing.expirationDate : false;
    const daysI = el('input', { type: 'number', min: '1', step: '1' });
    daysI.value = String(days);
    const httpChk = el('input', { type: 'checkbox' });
    httpChk.checked = existing ? existing.httpOnly : false;
    const secureChk = el('input', { type: 'checkbox' });
    secureChk.checked = existing ? existing.secure : state.pageMeta.origin.indexOf('https') === 0;
    const hostOnlyChk = el('input', { type: 'checkbox' });
    hostOnlyChk.checked = existing ? existing.domain && existing.domain.indexOf('.') !== 0 : true;
    const ssSel = el('select', {},
      el('option', { value: 'lax' }, 'Lax'),
      el('option', { value: 'strict' }, 'Strict'),
      el('option', { value: 'no_restriction' }, 'None (requires Secure)'),
      el('option', { value: 'unspecified' }, 'Unspecified'));
    ssSel.value = existing ? (existing.sameSite || 'unspecified') : 'lax';

    const syncDays = () => { daysI.disabled = sessionChk.checked; };
    sessionChk.addEventListener('change', syncDays);
    syncDays();

    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', hideModal);
    const save = el('button', { type: 'button', class: 'primary' }, existing ? 'Save changes' : 'Add cookie');
    save.addEventListener('click', async () => {
      const name = nameI.value.trim();
      let domain = domainI.value.trim();
      const path = pathI.value.trim() || '/';
      if (!name) { err.textContent = 'Name is required.'; err.classList.remove('hidden'); return; }
      if (!domain) { err.textContent = 'Domain is required.'; err.classList.remove('hidden'); return; }
      save.disabled = true;

      const hostOnly = hostOnlyChk.checked;
      const bare = domain.replace(/^\./, '');
      let secure = secureChk.checked;
      let sameSite = ssSel.value;
      if (sameSite === 'no_restriction' && !secure) secure = true;

      const details = {
        url: (secure || state.pageMeta.origin.indexOf('https') === 0 ? 'https://' : 'http://') + bare + path,
        name: name,
        value: valI.value,
        path: path,
        secure: secure,
        httpOnly: httpChk.checked,
        sameSite: sameSite,
      };
      if (!hostOnly) details.domain = domain.startsWith('.') ? domain : '.' + domain;
      if (!sessionChk.checked) details.expirationDate = Math.floor(Date.now() / 1000) + parseInt(daysI.value || '90', 10) * 86400;

      try {
        if (existing && (existing.name !== name || existing.domain !== domain || existing.path !== path)) {
          await cookieRemove(existing);
        }
        const ok = await cookieSet(details);
        if (!ok) throw new Error('chrome.cookies.set rejected the cookie (check url / domain / sameSite).');
        hideModal();
        await refreshStore('cookies');
        toast(existing ? 'Cookie "' + name + '" updated' : 'Cookie "' + name + '" added');
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        save.disabled = false;
      }
    });

    box.append(
      el('h3', {}, existing ? 'Edit cookie' : 'New cookie'),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', {}, 'Name'), nameI),
        el('label', { class: 'fld' }, el('span', {}, 'Value'), valI)),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', {}, 'Domain'), domainI),
        el('label', { class: 'fld' }, el('span', {}, 'Path'), pathI)),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', {}, 'SameSite'), ssSel),
        el('label', { class: 'fld' }, el('span', {}, 'Expires after (days)'), daysI)),
      el('div', { class: 'check-row' },
        el('label', {}, sessionChk, 'Session cookie'),
        el('label', {}, httpChk, 'httpOnly'),
        el('label', {}, secureChk, 'Secure'),
        el('label', { title: 'When unchecked, the domain gets a leading dot so subdomains share the cookie' }, hostOnlyChk, 'Host-only')),
      el('span', { class: 'hint', style: 'color:var(--muted);font-size:11px;display:block;margin-top:2px' },
        'httpOnly and expiration attributes work through the chrome.cookies API — script commands (document.cookie) cannot see or change httpOnly cookies.'),
      err,
      el('div', { class: 'modal-actions' }, cancel, save),
    );
  });
}

/* ============================== encrypt mode settings ============================== */
function openEncryptModal() {
  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const onChk = el('input', { type: 'checkbox' });
    onChk.checked = encState.on;
    const presets = el('datalist', { id: 'encKeyPresets' });
    for (const k of ENC_PRESETS) presets.append(el('option', { value: k }));
    const keyI = el('input', {
      type: 'text', spellcheck: 'false', list: 'encKeyPresets',
      placeholder: 'passphrase the app encrypts with (e.g. username)',
    });
    keyI.value = encState.key;
    const prefixI = el('input', {
      type: 'text', spellcheck: 'false', placeholder: ENC_DEFAULT_PREFIX,
      title: 'Values starting with this are treated as AES ciphertext',
    });
    prefixI.value = encState.prefix || ENC_DEFAULT_PREFIX;

    const cancel = el('button', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', hideModal);
    const apply = el('button', { type: 'button', class: 'primary' }, 'Apply');
    apply.addEventListener('click', async () => {
      if (onChk.checked && !keyI.value.trim()) {
        err.textContent = 'A passphrase is required to enable encrypt mode.';
        err.classList.remove('hidden');
        return;
      }
      apply.disabled = true;
      encState.on = onChk.checked;
      encState.key = keyI.value;
      encState.prefix = prefixI.value.trim() || ENC_DEFAULT_PREFIX;
      saveEncState();
      hideModal();
      await refreshAll();
      toast(encActive()
        ? 'Encrypt mode ON — AES values are shown decrypted, edits re-encrypt on Save'
        : 'Encrypt mode off');
    });

    const keyEntries = Object.entries(encState.keys || {});
    const keyChips = el('div', { class: 'check-row enc-keys' });
    for (const [k, p] of keyEntries) {
      const chip = el('span', { class: 'chip', title: 'per-key passphrase: ' + k },
        k + ' · ' + (p.length > 14 ? p.slice(0, 14) + '…' : p));
      const x = el('button', { type: 'button', class: 'chip-x', title: 'Forget the per-key passphrase for "' + k + '"' }, '×');
      x.addEventListener('click', async () => {
        delete encState.keys[k];
        saveEncState();
        chip.remove();
        await refreshAll();
        toast('Forgot per-key passphrase for "' + k + '"');
      });
      chip.append(x);
      keyChips.append(chip);
    }

    box.append(
      el('h3', {}, 'Encrypt mode — AES (crypto-js compatible)'),
      el('span', { class: 'hint', style: 'display:block;margin:2px 0 4px;color:var(--muted);font-size:11px;line-height:1.55' },
        'Values written by CryptoJS.AES.encrypt(value, passphrase) — AES-256-CBC, OpenSSL "Salted__" format — ',
        'are shown decrypted in Table/JSON views and re-encrypted on Save. ',
        'mychannel apps use the logged-in username as the passphrase; before login they fall back to the preset keys below.'),
      el('div', { class: 'check-row' },
        el('label', {}, onChk, 'Decrypt AES-encrypted values in Local/Session Storage')),
      el('div', { class: 'grid-2' },
        el('label', { class: 'fld' }, el('span', {}, 'Passphrase'), presets, keyI,
          el('span', { class: 'hint' }, 'Kept in this browser only (panel localStorage) — never leaves the machine.')),
        el('label', { class: 'fld' }, el('span', {}, 'Ciphertext prefix'), prefixI,
          el('span', { class: 'hint' }, 'Values starting with this are treated as AES ciphertext. Default ' + ENC_DEFAULT_PREFIX +
            ' = crypto-js OpenSSL format; set a wrapper like "enc:" if your app marks ciphertext differently.'))),
      keyEntries.length ? el('div', { class: 'fld', style: 'margin:4px 0 0' },
        el('span', {}, 'Per-key passphrases'),
        keyChips,
        el('span', { class: 'hint' }, 'Keys decrypted via the 🔑 row button — each uses its own passphrase instead of the global one.')) : null,
      err,
      el('div', { class: 'modal-actions' }, cancel, apply),
    );
  });
}

/* ============================== per-key decrypt ============================== */
function openDecryptModal(row) {
  showModal((box) => {
    const err = el('div', { class: 'form-error hidden' });
    const passI = el('input', { type: 'text', spellcheck: 'false', placeholder: 'passphrase for this key' });
    passI.value = encPassFor(row.k) || '';
    const rememberChk = el('input', { type: 'checkbox' });
    rememberChk.checked = true;
    const out = el('textarea', { rows: '8', readonly: 'readonly', spellcheck: 'false' });
    out.style.display = 'none';

    const copyBtn = el('button', { type: 'button' }, 'Copy');
    copyBtn.style.display = 'none';
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(out.value); toast('Copied to clipboard'); }
      catch (e) { toast('Copy failed: ' + e.message); }
    });
    const close = el('button', { type: 'button' }, 'Close');
    close.addEventListener('click', hideModal);
    const tryBtn = el('button', { type: 'button', class: 'primary' }, 'Decrypt');
    tryBtn.addEventListener('click', async () => {
      err.classList.add('hidden');
      const pass = passI.value;
      if (!pass) {
        err.textContent = 'Enter a passphrase for this key.';
        err.classList.remove('hidden');
        return;
      }
      tryBtn.disabled = true;
      try {
        const cipher = SdbAes.splitCipherValue(row.v, encState.prefix);
        const plain = await SdbAes.aesDecrypt(cipher, pass);
        out.value = plain;
        out.style.display = '';
        copyBtn.style.display = '';
        if (rememberChk.checked) {
          encState.keys[row.k] = pass;
          saveEncState();
          if (encActive()) await refreshStore(state.store); // แถวเริ่ม decrypt อัตโนมัติด้วย override นี้
          toast('Decrypted "' + row.k + '"' + (encActive() ? ' — passphrase remembered for this key' : ''));
        } else {
          toast('Decrypted "' + row.k + '"');
        }
      } catch (e) {
        out.style.display = 'none';
        copyBtn.style.display = 'none';
        err.textContent = 'Decryption failed — wrong passphrase for this key.';
        err.classList.remove('hidden');
      }
      tryBtn.disabled = false;
    });

    box.append(
      el('h3', { class: 'mono', style: 'word-break:break-all;font-size:12px' }, 'Decrypt — ' + row.k),
      el('span', { class: 'hint', style: 'display:block;margin:2px 0 4px;color:var(--muted);font-size:11px;line-height:1.55' },
        'Decrypt this single value with its own passphrase (per-key). ',
        encActive()
          ? 'When remembered, this key auto-decrypts with this passphrase instead of the global one.'
          : 'Encrypt mode is off — the table still shows ciphertext; turn it on to auto-decrypt this key.'),
      el('label', { class: 'fld' }, el('span', {}, 'Passphrase for this key'), passI),
      el('div', { class: 'check-row' },
        el('label', {}, rememberChk, 'Remember this passphrase for "' + row.k + '" only')),
      err,
      out,
      el('div', { class: 'modal-actions' }, copyBtn, close, tryBtn),
    );
  });
}

/* ============================== script runner ============================== */
function buildKickoff(code) {
  return (
    '(function () {' +
    '  var LOGS = [];' +
    '  var push = function (lvl, args) { if (LOGS.length < 500) LOGS.push([lvl].concat(args)); };' +
    '  var ser = function (v) {' +
    '    try {' +
    "      if (v === undefined) return 'undefined';" +
    "      if (v === null) return 'null';" +
    '      var t = typeof v;' +
    "      if (t === 'string') return v;" +
    "      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);" +
    "      if (t === 'function') return Function.prototype.toString.call(v).slice(0, 400);" +
    "      if (t === 'symbol') return v.toString();" +
    "      if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);" +
    "      return JSON.stringify(v, function (k, val) { return typeof val === 'bigint' ? String(val) + 'n' : val; }, 2);" +
    '    } catch (e) { try { return String(v); } catch (e2) { return "[unserializable]"; } }' +
    '  };' +
    "  var LEVELS = ['log', 'info', 'warn', 'error', 'debug'];" +
    '  var patched = LEVELS.map(function (m) {' +
    '    var orig = console[m] ? console[m].bind(console) : null;' +
    '    console[m] = function () { var a = [].slice.call(arguments); push(m, a.map(ser)); if (orig) orig.apply(console, a); };' +
    '    return { m: m, orig: orig };' +
    '  });' +
    '  var restore = function () {' +
    '    patched.forEach(function (p) { if (p.orig) console[p.m] = p.orig; else delete console[p.m]; });' +
    '  };' +
    "  var stor = function (which) { return which === 'ss' ? window.sessionStorage : window.localStorage; };" +
    '  var db = {' +
    '    ls: window.localStorage,' +
    '    ss: window.sessionStorage,' +
    '    get: function (k, which) { return stor(which).getItem(k); },' +
    '    json: function (k, which) { try { return JSON.parse(stor(which).getItem(k)); } catch (e) { return undefined; } },' +
    "    set: function (k, v, which) { stor(which).setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }," +
    '    del: function (k, which) { stor(which).removeItem(k); },' +
    '    keys: function (which) { var s = stor(which), out = []; for (var i = 0; i < s.length; i++) out.push(s.key(i)); return out; },' +
    '    size: function (which) { return stor(which).length; },' +
    '    clear: function (which) { stor(which).clear(); },' +
    '    cookie: {' +
    '      list: function () {' +
    "        return document.cookie.split('; ').filter(Boolean).map(function (c) {" +
    "          var i = c.indexOf('='); return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) };" +
    '        });' +
    '      },' +
    '      get: function (name) {' +
    "        var pre = name + '=';" +
    "        var parts = document.cookie.split('; ');" +
    '        for (var i = 0; i < parts.length; i++) {' +
    '          if (parts[i].lastIndexOf(pre, 0) === 0) return decodeURIComponent(parts[i].slice(pre.length));' +
    '        }' +
    '        return null;' +
    '      },' +
    '      set: function (name, value, opts) {' +
    '        opts = opts || {};' +
    "        var s = name + '=' + encodeURIComponent(value) +'; path=' + (opts.path || '/') + '; max-age=' + ((opts.days || 365) * 86400);" +
    "        if (opts.domain) s += '; domain=' + opts.domain;" +
    "        if (opts.secure) s += '; secure';" +
    "        if (opts.sameSite) s += '; samesite=' + opts.sameSite;" +
    '        document.cookie = s;' +
    '      },' +
    '      del: function (name, path) {' +
    "        document.cookie = name + '=; path=' + (path || '/') + '; max-age=0';" +
    '      }' +
    '    }' +
    '  };' +
    '  var log = function () { push("log", [].slice.call(arguments).map(ser)); };' +
    '  window.__SDB__ = { done: false };' +
    '  var __SDB_CODE__ = ' + JSON.stringify(code) + ';' +
    '  var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;' +
    '  (async function () {' +
    '    var result, wrapped = false;' +
    '    try {' +
    '      try {' +
    '        result = eval(__SDB_CODE__);' +
    '      } catch (e1) {' +
    '        if (!(e1 instanceof SyntaxError)) throw e1;' +
    '        var fn = new AsyncFn("db", "log", __SDB_CODE__);' +
    '        wrapped = true;' +
    '        result = await fn(db, log);' +
    '      }' +
    '      result = await Promise.resolve(result);' +
    '      if (wrapped && result === undefined) push("info", ["(await-style script — use `return value` to capture the result)"]);' +
    '      window.__SDB__ = { done: true, logs: LOGS, result: ser(result) };' +
    '    } catch (e) {' +
    '      window.__SDB__ = { done: true, logs: LOGS, error: ser(e) || "Error" };' +
    '    } finally {' +
    '      restore();' +
    '    }' +
    '  })();' +
    "  return 'started';" +
    '})()'
  );
}

const POLL_EXPR = '(function(){ try { return JSON.stringify(window.__SDB__ || { done: false }); } catch (e) { return JSON.stringify({ done: true, error: "poll failed" }); } })()';

function appendOut(kind, text) {
  const out = $('#scriptOutput');
  const line = el('div', { class: 'out-line ' + kind }, text);
  out.append(line);
  out.scrollTop = out.scrollHeight;
}

async function runScript() {
  const code = scriptEditor ? scriptEditor.getValue() : '';
  if (!code.trim()) return;
  const btn = $('#btnRun');
  const btnOriginal = btn.innerHTML;
  const btnLabel = btn.querySelector('span');
  appendOut('run', '▶ run · ' + new Date().toLocaleTimeString());
  btn.disabled = true;
  if (btnLabel) btnLabel.textContent = 'Running…';
  const t0 = performance.now();
  let st = null;
  try {
    await evalInPage(buildKickoff(code));
    for (let i = 0; i < 600; i++) {
      await sleep(100);
      st = JSON.parse(await evalInPage(POLL_EXPR));
      if (st.done) break;
    }
  } catch (e) {
    st = { done: true, error: e.message, logs: [] };
  }
  if (!st || !st.done) {
    appendOut('error', '✖ Timed out after 60s — the script is still running (or the page navigated).');
  } else {
    for (const entry of st.logs || []) {
      const lvl = entry[0];
      appendOut('log-' + lvl, entry.slice(1).join(' '));
    }
    if (st.error) appendOut('error', '✖ ' + st.error);
    else appendOut('result', '⇐ ' + st.result);
  }
  appendOut('meta', 'finished in ' + Math.round(performance.now() - t0) + 'ms');
  btn.disabled = false;
  if (btnLabel) btnLabel.textContent = 'Run';
  btn.innerHTML = btnOriginal;
  if (AUTO_STORES.includes(state.store) || TABLE_STORES.includes(state.store)) await refreshStore(state.store);
}

/* ============================== toast ============================== */
let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = '';
  t.append(el('span', {}, msg));
  if (action) {
    const b = el('button', { type: 'button' }, action.label);
    b.addEventListener('click', () => { hideToast(); action.fn(); });
    t.append(b);
  }
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() { $('#toast').classList.add('hidden'); }

/* ============================== Monaco editors ============================== */
let jsonEditor = null;
let scriptEditor = null;
let monacoLoading = null;
let monacoSuppressChange = false;
let jsonErrDecorations = null;
let scriptPlaceholderEl = null;

const SCRIPT_PLACEHOLDER =
  "// Runs inside the inspected page — await is allowed.\n" +
  "// The value of the last expression is shown in the output.\n\n" +
  "db.keys()   // list all localStorage keys\n\n" +
  "// db.set('user', { name: 'Test', roles: ['admin'] })\n" +
  "// for (const k of db.keys()) if (k.startsWith('tmp_')) db.del(k)";

function loadMonaco() {
  if (monacoLoading) return monacoLoading;
  monacoLoading = new Promise((resolve, reject) => {
    if (typeof window.require !== 'function') {
      reject(new Error('loader.js missing from libs/monaco/vs'));
      return;
    }
    window.MonacoEnvironment = {
      getWorkerUrl: function () {
        return new URL('libs/monaco-worker.js', document.baseURI).href;
      },
    };
    window.require.config({ paths: { vs: new URL('libs/monaco/vs', document.baseURI).href } });
    window.require(['vs/editor/editor.main'], resolve, (err) => {
      reject(new Error(err && err.message ? err.message : String(err)));
    });
  });
  return monacoLoading;
}

function defineMonacoTheme() {
  window.monaco.editor.defineTheme('storage-db', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd0d0d0' },
      { token: 'string.key.json', foreground: '8ab4f8' },
      { token: 'string.value.json', foreground: '89ca78' },
      { token: 'key', foreground: '8ab4f8' },
      { token: 'string', foreground: '89ca78' },
      { token: 'number', foreground: 'd19a66' },
      { token: 'keyword', foreground: 'c678dd' },
      { token: 'keyword.json', foreground: 'd19a66' },
      { token: 'comment', foreground: '7f848e', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'd0d0d0' },
      { token: 'type.identifier', foreground: '9cdcfe' },
      { token: 'delimiter', foreground: '9aa0a6' },
      { token: 'delimiter.bracket.json', foreground: '9aa0a6' },
      { token: 'tag', foreground: '8ab4f8' },
      { token: 'attribute.name', foreground: '9cdcfe' },
      { token: 'attribute.value', foreground: '89ca78' },
    ],
    colors: {
      'editor.background': '#202124',
      'editor.foreground': '#d0d0d0',
      'editorLineNumber.foreground': '#5f6368',
      'editorLineNumber.activeForeground': '#9aa0a6',
      'editor.lineHighlightBackground': '#292a2d',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#264f7855',
      'editorCursor.foreground': '#8ab4f8',
      'editorIndentGuide.background1': '#3c4043',
      'editorIndentGuide.activeBackground1': '#5f6368',
      'editorGutter.background': '#202124',
      'editorWidget.background': '#292a2d',
      'editorWidget.border': '#3c4043',
      'editorHoverWidget.background': '#292a2d',
      'editorHoverWidget.border': '#3c4043',
      'editorSuggestWidget.background': '#292a2d',
      'editorSuggestWidget.border': '#3c4043',
      'editorSuggestWidget.selectedBackground': '#3c4043',
      'editorBracketMatch.background': '#264f78',
      'editorBracketMatch.border': '#8ab4f8',
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': '#f28b82',
      'editorWarning.foreground': '#fdd663',
      'scrollbarSlider.background': '#545458aa',
      'scrollbarSlider.hoverBackground': '#717174bb',
      'scrollbarSlider.activeBackground': '#8ab4f880',
    },
  });
}

function baseEditorOptions() {
  return {
    theme: 'storage-db',
    automaticLayout: true,
    fontFamily: "'Google Sans Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace",
    fontSize: 12,
    lineHeight: 18,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    tabSize: 2,
    padding: { top: 6, bottom: 6 },
    overviewRulerBorder: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    autoClosingBrackets: 'always',
    scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 14, useShadows: false },
  };
}

function updateScriptPlaceholder() {
  if (!scriptPlaceholderEl) return;
  const empty = scriptEditor && scriptEditor.getValue() === '';
  const focused = scriptEditor && scriptEditor.hasTextFocus();
  scriptPlaceholderEl.style.display = empty && !focused ? 'block' : 'none';
}

function initEditors() {
  loadMonaco().then(() => {
    defineMonacoTheme();

    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemas: [],
      enableSchemaRequest: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    jsonEditor = monaco.editor.create($('#jsonEditor'), Object.assign(baseEditorOptions(), {
      language: 'json',
      readOnly: true,
      value: '',
    }));
    jsonEditor.onDidChangeModelContent(() => {
      if (!monacoSuppressChange) state.jsonDirty = true;
    });
    jsonEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => saveJson());

    scriptEditor = monaco.editor.create($('#scriptInput'), Object.assign(baseEditorOptions(), {
      language: 'javascript',
      value: '',
      quickSuggestions: { other: true, comments: false, strings: false },
    }));
    scriptEditor.onDidChangeModelContent(updateScriptPlaceholder);
    scriptEditor.onDidFocusEditorText(updateScriptPlaceholder);
    scriptEditor.onDidBlurEditorText(updateScriptPlaceholder);
    scriptEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runScript());

    scriptPlaceholderEl = el('div', { class: 'editor-placeholder' });
    scriptPlaceholderEl.textContent = SCRIPT_PLACEHOLDER;
    $('#scriptInput').append(scriptPlaceholderEl);
    updateScriptPlaceholder();

    if (state.view === 'json') syncJsonEditor(true);
  }).catch((e) => {
    showError('Monaco editor failed to load — ' + e.message);
  });
}

function setJsonText(text) {
  if (!jsonEditor) return;
  const viewState = jsonEditor.saveViewState();
  monacoSuppressChange = true;
  jsonEditor.setValue(text);
  monacoSuppressChange = false;
  if (!JSON_EDITABLE.includes(state.store) || !viewState) jsonEditor.setPosition({ lineNumber: 1, column: 1 });
  else jsonEditor.restoreViewState(viewState);
}

function clearJsonErrorLine() {
  if (jsonErrDecorations) jsonErrDecorations.clear();
}

/* Strict-JSON scanner that reports WHERE the document breaks (Chrome's own
 * JSON.parse errors no longer include a position). Returns {pos, msg} or null
 * when the text looks valid — only used to locate errors, never to accept. */
function locateJsonError(text) {
  let i = 0;
  const n = text.length;
  const err = (msg) => ({ pos: i, msg: msg });
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')) i++; };
  function str() {
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return null; }
      if (c === '\\') { i += 2; continue; }
      if (c.charCodeAt(0) < 32 || c === '\n') return err('Unterminated / invalid string');
      i++;
    }
    return err('Unterminated string');
  }
  function num() {
    const start = i;
    if (text[i] === '-') i++;
    while (i < n && text[i] >= '0' && text[i] <= '9') i++;
    if (text[i] === '.') { i++; while (i < n && text[i] >= '0' && text[i] <= '9') i++; }
    if (text[i] === 'e' || text[i] === 'E') { i++; if (text[i] === '+' || text[i] === '-') i++; while (i < n && text[i] >= '0' && text[i] <= '9') i++; }
    return i === start ? err('Invalid number') : null;
  }
  function value() {
    ws();
    if (i >= n) return err('Unexpected end of input');
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return null; }
    if (text.startsWith('false', i)) { i += 5; return null; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    if (c === '-' || (c >= '0' && c <= '9')) return num();
    return err("Unexpected token '" + c + "'");
  }
  function object() {
    i++; ws();
    if (text[i] === '}') { i++; return null; }
    for (;;) {
      ws();
      if (text[i] !== '"') return err("Expected '\"' to start a property name");
      const e1 = str(); if (e1) return e1;
      ws();
      if (text[i] !== ':') return err("Expected ':' after property name");
      i++;
      const e2 = value(); if (e2) return e2;
      ws();
      if (text[i] === ',') { i++; ws(); if (text[i] === '}') return err('Trailing comma in object'); continue; }
      if (text[i] === '}') { i++; return null; }
      return err("Expected ',' or '}' after property value");
    }
  }
  function array() {
    i++; ws();
    if (text[i] === ']') { i++; return null; }
    for (;;) {
      const e = value(); if (e) return e;
      ws();
      if (text[i] === ',') { i++; ws(); if (text[i] === ']') return err('Trailing comma in array'); continue; }
      if (text[i] === ']') { i++; return null; }
      return err("Expected ',' or ']' after array element");
    }
  }
  const e = value();
  if (e) return e;
  ws();
  return i < n ? err('Unexpected trailing characters') : null;
}

function showJsonError(text, nativeError) {
  clearJsonErrorLine();
  let msg = nativeError ? String(nativeError.message || nativeError) : 'Invalid JSON';
  let lineInfo = '';
  const located = locateJsonError(text);
  if (located && jsonEditor) {
    const line = text.slice(0, Math.min(located.pos, text.length)).split('\n').length - 1;
    if (!jsonErrDecorations) jsonErrDecorations = jsonEditor.createDecorationsCollection([]);
    jsonErrDecorations.set([{
      range: new monaco.Range(line + 1, 1, line + 1, 1),
      options: { isWholeLine: true, className: 'line-error', linesDecorationsClassName: 'line-error-glyph' },
    }]);
    lineInfo = ' (line ' + (line + 1) + ')';
    msg = located.msg;
  }
  toast('Invalid JSON — ' + msg + lineInfo);
}

/* ============================== resizable panes ============================== */
const LAYOUT_KEY = 'sdb:layout';

function readLayout() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function writeLayout(patch) {
  try {
    const cur = readLayout();
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(Object.assign(cur, patch)));
  } catch (e) { /* storage may be unavailable */ }
}
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function wireDrag(handle, handlers) {
  let start = null;
  const onMove = (e) => {
    if (!start) return;
    handlers.onMove(e.clientX - start.x, e.clientY - start.y, start.data);
  };
  const onUp = () => {
    if (!start) return;
    start = null;
    handle.classList.remove('active');
    document.body.classList.remove('resizing', 'rows');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (handlers.onEnd) handlers.onEnd();
  };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, data: handlers.onStart() };
    handle.classList.add('active');
    document.body.classList.add('resizing');
    if (handlers.rows) document.body.classList.add('rows');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    e.preventDefault();
  });
  handle.addEventListener('dblclick', () => {
    handlers.onReset();
    writeLayout(handlers.layoutReset());
  });
}

function initResizers() {
  const layout = $('#layout');

  // sidebar width
  const sideHandle = $('#sideResizer');
  if (sideHandle) {
    wireDrag(sideHandle, {
      onStart: () => $('#sidebar').getBoundingClientRect().width,
      onMove: (dx, dy, startW) => {
        const w = clamp(startW + dx, 150, 380);
        layout.style.setProperty('--sidebar-w', w + 'px');
      },
      onEnd: () => writeLayout({ sidebarW: parseFloat(layout.style.getPropertyValue('--sidebar-w')) || null }),
      onReset: () => layout.style.removeProperty('--sidebar-w'),
      layoutReset: () => ({ sidebarW: null }),
    });
  }

  // editor <-> output split (horizontal, or vertical on narrow layouts)
  const divider = $('#scriptDivider');
  if (divider) {
    wireDrag(divider, {
      rows: true,
      onStart: () => null,
      onMove: (dx, dy) => {
        const host = $('#viewScript').getBoundingClientRect();
        const stacked = window.matchMedia('(max-width: 900px)').matches;
        if (stacked) {
          const pct = clamp(((window.lastPointerY || 0) + dy - host.top) / host.height * 100, 18, 82);
          layout.style.setProperty('--script-row-split', pct + '%');
        } else {
          const pct = clamp(((window.lastPointerX || 0) + dx - host.left) / host.width * 100, 22, 78);
          layout.style.setProperty('--script-split', pct + '%');
        }
      },
      onEnd: () => writeLayout({
        scriptSplit: parseFloat(layout.style.getPropertyValue('--script-split')) || null,
        scriptRowSplit: parseFloat(layout.style.getPropertyValue('--script-row-split')) || null,
      }),
      onReset: () => {
        layout.style.removeProperty('--script-split');
        layout.style.removeProperty('--script-row-split');
      },
      layoutReset: () => ({ scriptSplit: null, scriptRowSplit: null }),
    });
    // remember the drag origin (pointerdown position) for percentage math
    divider.addEventListener('pointerdown', (e) => {
      window.lastPointerX = e.clientX;
      window.lastPointerY = e.clientY;
    });
  }

  // restore persisted layout
  const saved = readLayout();
  if (saved.sidebarW) layout.style.setProperty('--sidebar-w', saved.sidebarW + 'px');
  if (saved.scriptSplit) layout.style.setProperty('--script-split', saved.scriptSplit + '%');
  if (saved.scriptRowSplit) layout.style.setProperty('--script-row-split', saved.scriptRowSplit + '%');
}

/* ============================== events / init ============================== */
function wireEvents() {
  document.querySelectorAll('#viewSwitch button').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  $('#searchBox').addEventListener('input', (e) => {
    state.filter = e.target.value;
    if (state.view === 'table') { renderTable(); renderStatus(); }
  });

  $('#btnRefresh').addEventListener('click', () => refreshStore(state.store));
  $('#btnEncrypt').addEventListener('click', openEncryptModal);
  $('#btnAdd').addEventListener('click', () => openItemModal(null));
  $('#btnClear').addEventListener('click', clearAll);
  $('#btnExport').addEventListener('click', exportJson);
  $('#autoRefresh').addEventListener('change', (e) => { state.autoRefresh = e.target.checked; });

  $('#btnFormat').addEventListener('click', () => {
    if (!jsonEditor) return;
    try {
      setJsonText(JSON.stringify(JSON.parse(jsonEditor.getValue()), null, 2));
      state.jsonDirty = false;
      clearJsonErrorLine();
    } catch (e) {
      showJsonError(jsonEditor.getValue(), e);
    }
  });
  $('#btnCopyJson').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(jsonEditor ? jsonEditor.getValue() : '');
      toast('Copied to clipboard');
    } catch (e) {
      toast('Copy failed: ' + e.message);
    }
  });
  $('#btnApplyJson').addEventListener('click', saveJson);
  $('#btnNested').addEventListener('click', () => {
    if (state.jsonDirty && !window.confirm('Discard unsaved edits and reload from storage?')) return;
    state.nested = !state.nested;
    state.jsonDirty = false;
    syncJsonEditor(true);
  });

  $('#btnRun').addEventListener('click', runScript);
  $('#btnClearOut').addEventListener('click', () => { $('#scriptOutput').textContent = ''; });
  $('#scriptExamples').addEventListener('change', (e) => {
    const key = e.target.value;
    if (!key) return;
    if (scriptEditor) {
      scriptEditor.setValue(EXAMPLES[key]);
      scriptEditor.focus();
      scriptEditor.setPosition({ lineNumber: scriptEditor.getModel().getLineCount(), column: 1 });
    }
    e.target.value = '';
  });

  $('#modalOverlay').addEventListener('mousedown', (e) => {
    if (e.target === $('#modalOverlay')) hideModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModal();
    if (e.defaultPrevented) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (state.view === 'json' && JSON_EDITABLE.includes(state.store)) { e.preventDefault(); saveJson(); }
      else if (state.view === 'script') { e.preventDefault(); runScript(); }
    }
  });
}

async function loadPageMeta() {
  if (!REAL) {
    state.pageMeta = { href: 'https://demo.local/app', origin: 'https://demo.local', hostname: 'demo.local' };
    return;
  }
  try {
    const raw = await evalInPage('JSON.stringify({ href: location.href, origin: location.origin, hostname: location.hostname })');
    state.pageMeta = JSON.parse(raw);
  } catch (e) {
    showError('Cannot access this page (' + e.message + '). Built-in Chrome pages (chrome://…) are restricted.');
  }
}

async function init() {
  try {
    await initInner();
  } catch (e) {
    showError('Panel failed to start — ' + (e && e.message ? e.message : String(e)));
  }
}

async function initInner() {
  loadEncState();
  if (!REAL) await setupMock();
  window.__sdbErrors = [];
  const origErr = console.error.bind(console);
  console.error = function () {
    const msg = [].map.call(arguments, (a) => (a && a.message) || String(a)).join(' ');
    window.__sdbErrors.push(msg);
    if (/monaco|worker|loader/i.test(msg)) showError(msg);
    origErr.apply(null, arguments);
  };
  initEditors();
  wireEvents();
  initResizers();
  await loadPageMeta();
  if (REAL) {
    chrome.devtools.network.onNavigated.addListener(async (url) => {
      try {
        state.pageMeta = { href: url, origin: new URL(url).origin, hostname: new URL(url).hostname };
      } catch (e) { /* keep old meta */ }
      await refreshAll();
    });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(() => {
        if (state.store === 'ext') refreshStore('ext');
      });
    }
  }
  await refreshAll();
  setInterval(autoTick, 3000);
}

document.addEventListener('DOMContentLoaded', init);
