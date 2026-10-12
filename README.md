# Storage DB — Chrome DevTools Extension

DevTools panel สำหรับดูและแก้ไข**ข้อมูลทุกชนิดของหน้าเว็บ**ในรูปแบบ database — LocalStorage, SessionStorage, IndexedDB, Cookies, Cache Storage, Storage Buckets, Extension Storage (chrome.storage), Shared Storage, Interest Groups และ Private State Tokens พร้อม Table / JSON / Script views ที่ใช้ **Monaco Editor** (engine เดียวกับ VS Code)

UI ธีม **Chrome DevTools dark** (palette จริงของ DevTools, มุมโค้ง 2px, typography กระชับ) และ**แผงทุกส่วนลากย่อ/ขยายได้**

- 📦 Repo: https://github.com/d-osc/storage-db-extension
- 🚀 จะเผยแพร่บน Chrome Web Store? ดูคู่มือ [`DEPLOY.md`](DEPLOY.md)
- 🔒 Privacy policy: [`PRIVACY.md`](PRIVACY.md)

## การติดตั้ง

1. เปิด `chrome://extensions`
2. เปิด **Developer mode** (มุมขวาบน)
3. กด **Load unpacked** แล้วเลือกโฟลเดอร์นี้
4. เปิดเว็บที่ต้องการ (http/https) กด F12 → แท็บ **Storage DB**

> หมายเหตุ: หลัง reload extension ต้อง**ปิด DevTools ให้สนิทแล้วเปิดใหม่** ไม่งั้นแท็บเก่าจะเป็นแท็บตาย

## ภาพรวมการใช้งาน

- **Sidebar ซ้าย** (แบบ Application panel ของ DevTools) แบ่ง 2 กลุ่ม: **Storage** (10 ชนิด พร้อมตัวเลขจำนวน) และ **Privacy Sandbox**
- **Table view** — คลิกหัวคอลัมน์ sort, ช่อง filter, double-click แก้ไข, ปุ่มลบ/แก้ไขเมื่อ hover แถว, Export เป็น JSON
- **JSON view** — Monaco editor พับบรรทัดได้ ตรวจ JSON เรียลไทม์ (ขีดหยักแดง) บอกบรรทัดที่ผิดตอน Save และโหมด **Nested** ที่กางค่า JSON string เป็น object ซ้อนจริงแล้ว stringify กลับให้อัตโนมัติ (แก้ได้เฉพาะ Local/Session Storage, ชนิดอื่นเป็น read-only snapshot)
- **Script view** — console JS รันในหน้าเว็บที่ inspect (await ได้, IntelliSense) กด `Ctrl+Enter`
- **Resize ได้ทุกแผง** — ลากขอบขวา sidebar (150–380px), ลากเส้นแบ่ง editor↔output (แนวตั้งตอนกว้าง / แนวนอนตอนแคบ) · **ดับเบิลคลิกที่เส้น = รีเซ็ต** · ค่าที่ตั้งจะจำไว้
- **Auto refresh** — ข้อมูล Local/Session/Cookies/Extension Storage โหลดใหม่เองทุก 3 วินาที (ปิดได้), refresh อัตโนมัติเมื่อเปลี่ยนหน้าเว็บ
- **Encrypt mode (AES)** 🔒 — ถอด/เข้ารหัสค่าใน Local/Session Storage ที่แอปเขียนไว้แบบ `CryptoJS.AES.encrypt(value, passphrase)` (AES-256-CBC, OpenSSL `Salted__` format — ตรวจอัตโนมัติจาก prefix `U2FsdGVkX1`) กดไอคอนกุญแจใส่ passphrase (เช่น username ของ user ที่ login หรือ fallback key ของแอป) แล้ว:
  - **Table view** แสดงค่า decrypted พร้อม badge `aes` (Type ตรวจจากค่าที่ถอดแล้ว) — ถอดไม่สำเร็จ (passphrase ผิด) จะขึ้น marker แดง
  - **แก้ไข** double-click จะเห็น plaintext — Save แล้ว**เข้ารหัสกลับอัตโนมัติ** (มี checkbox คุมต่อรายการ) หรือติ๊กออกเพื่อบันทึกเป็น plaintext
  - **JSON view** กาง/แก้ค่า decrypted ได้ และ re-encrypt เฉพาะ key ที่เข้ารหัสอยู่เดิมตอน Save
  - เข้ากันได้ 100% กับ crypto-js (ใช้ Web Crypto + EVP_BytesToKey MD5 แบบเดียวกัน — แอปอ่านค่าที่แก้กลับได้ทันที) เช่น `SecureLocalStorageService` ของ mychannel · passphrase เก็บไว้เฉพาะในเครื่อง
  - **Decrypt ราย key** 🔑 — แถวที่เป็น ciphertext มีปุ่มกุญแจให้ถอดค่าเดียวด้วย passphrase ของ key นั้น (ใช้ได้แม้ไม่เปิด encrypt mode) ติ๊กจำได้ → key นั้นจะ auto-decrypt ด้วย passphrase ของตัวเองแทนตัว global (เหมาะกับหน้าที่แต่ละ key เข้ารหัสด้วย user คนละคน) — รายการ per-key ทั้งหมดดู/ลบได้ใน settings ของ encrypt mode
  - **Ciphertext prefix ปรับได้** (default `U2FsdGVkX1` ตาม format ของ crypto-js) — ถ้าแอป mark ciphertext ด้วย prefix อื่น เช่น `enc:U2FsdGVkX1…` ให้ใส่ `enc:` ในช่อง Ciphertext prefix ได้ ค่าที่เขียนกลับจะถูกเติม prefix ตามที่ตั้งอัตโนมัติ

## Storage แต่ละชนิด

| ชนิด | ความสามารถ |
|---|---|
| **Local / Session Storage** | Table CRUD + Undo, JSON edit + Save (add/update/remove เป๊ะ) |
| **IndexedDB** | เลือก Database → Object store, ดู/เพิ่ม/แก้/ลบ records (key รองรับ number/string, store แบบ keyPath ใส่ key อัตโนมัติ), เคลียร์ store, ลบ database |
| **Cookies** | แก้ครบทุก attribute — value, domain, path, expiry, httpOnly, secure, sameSite (เห็น httpOnly ผ่าน chrome.cookies) |
| **Cache Storage** | ดู requests ต่อ cache, กดไอคอนตา preview response body + headers, ลบ entry หรือทั้ง cache |
| **Storage Buckets** | usage/quota/persisted ต่อ bucket, สร้าง (ตั้ง persisted + quota), ลบ — ต้องใช้ Chrome 122+ |
| **Extension Storage** | `chrome.storage.local/sync/session` ของ extension นี้ — CRUD + refresh อัตโนมัติผ่าน onChanged |
| **Shared Storage** | Get / Set / Append / Delete / Clear ตาม key + availability check (keys enumerate ไม่ได้โดย design ของ API) |
| **Interest Groups** | Join / Leave ด้วย owner + name + bidding logic URL (API ไม่เปิดให้ list กลุ่มที่มีอยู่) |
| **Private State Tokens** | เช็ค `hasPrivateToken(issuer)` (token เป็น private อ่าน/นับไม่ได้โดย design) |

## Script API

```js
db.get(key)              // ค่าดิบ (string) — เพิ่ม 'ss' เพื่อใช้ sessionStorage
db.json(key)             // JSON.parse แล้ว
db.set(key, value)       // object/array เก็บเป็น JSON อัตโนมัติ
db.del(key) · db.keys() · db.size() · db.clear('ss')
db.cookie.list() / .set(n, v, opts) / .del(n)

indexedDB · caches · sharedStorage   // API ของหน้าเว็บเรียกตรง ๆ ได้
log(...)                              // พิมพ์ลง output (console.log ก็ถูกจับ)
```

ค่าของ **expression สุดท้าย** จะแสดงเป็นผลลัพธ์ (ใช้ `await` ได้ — ถ้าใช้ await ให้ `return` ค่าเพื่อ capture)

## ข้อจำกัด

- ใช้กับหน้า `chrome://` และ Chrome Web Store ไม่ได้ (Chrome บล็อก)
- Privacy Sandbox APIs บางตัวต้องเปิดใช้ใน Chrome settings ก่อน (มี availability check ในหน้า)
- IndexedDB แก้ไข record อ้างอิงด้วยลำดับแถว — ถ้าหน้าเว็บเปลี่ยนข้อมูลระหว่างกด ให้ refresh ก่อน
- เปิด `panel.html` ตรง ๆ จะเข้าโหมด **Preview** (mock data รวม IndexedDB/Cache จำลอง ไม่ต้องมี extension)

## โครงสร้างโปรเจกต์

```
manifest.json          # MV3 — devtools_page + permissions (cookies, storage)
devtools.html/js       # สร้างแท็บ "Storage DB" ใน DevTools
panel.html/css/js      # หน้า panel ทั้งหมด (views + การอ่าน/เขียนข้อมูล)
libs/monaco/           # Monaco Editor 0.52 (MIT) — vendor ไว้ในตัว
libs/monaco-worker.js  # worker bootstrap แบบ CSP-safe (MV3 บล็อก blob worker)
libs/aes.js            # AES crypto-js compatible (Web Crypto + EVP_BytesToKey) สำหรับ encrypt mode
icons/                 # ไอคอน extension
tools/make-icons.js    # regenerate ไอคอน: node tools/make-icons.js
tools/csp-server.py    # server จำลอง CSP ของ MV3 สำหรับทดสอบ local
store-assets/          # ภาพ + ข้อความสำหรับ Chrome Web Store (ดู LISTING.md)
DEPLOY.md              # คู่มือ submit ขึ้น Chrome Web Store ทีละขั้น
PRIVACY.md             # privacy policy
```

## พัฒนาต่อ

- ทดสอบ UI: `python -m http.server 8931` แล้วเปิด `http://localhost:8931/panel.html` (โหมด Preview)
- ทดสอบภายใต้ CSP ของ MV3: `python tools/csp-server.py 8932 .`
- Build zip ส่ง store: คำสั่งในท้าย `DEPLOY.md`
- การอ่าน/เขียนข้อมูลหน้าเว็บทำผ่าน `chrome.devtools.inspectedWindow.eval` (expression-based, รองรับ async ผ่าน polling) — cookies ผ่าน `chrome.cookies`

## ลิขสิทธิ์ของ dependencies

- [Monaco Editor](https://github.com/microsoft/monaco-editor) 0.52.2 — MIT License (Microsoft)
