# Storage DB — Chrome DevTools Extension

DevTools panel สำหรับดูและแก้ไขข้อมูลทุกชนิดของหน้าเว็บในรูปแบบ database — **LocalStorage, SessionStorage, IndexedDB, Cookies, Cache Storage, Storage Buckets, Extension Storage (chrome.storage), Shared Storage, Interest Groups และ Private State Tokens** พร้อม Table/JSON views และ Script console ที่ใช้ Monaco Editor (engine เดียวกับ VS Code)

## การติดตั้ง

1. เปิด `chrome://extensions`
2. เปิด **Developer mode** (มุมขวาบน)
3. กด **Load unpacked** แล้วเลือกโฟลเดอร์นี้
4. เปิดเว็บที่ต้องการ แล้วกด F12 → แท็บ **Storage DB**

## โครงสร้าง

UI เป็น sidebar ซ้ายแบบ Application panel ของ DevTools แบ่งเป็นกลุ่ม **Storage** (แสดงเป็นตาราง/JSON ได้) และ **Privacy Sandbox** (ฟอร์มปฏิบัติการ)

| ไฟล์ | หน้าที่ |
|---|---|
| `manifest.json` | Manifest V3 — devtools panel + สิทธิ์ `cookies`, `storage` |
| `devtools.html/js` | สร้างแท็บ "Storage DB" ใน DevTools |
| `panel.html/css/js` | หน้า panel ทั้งหมด (views, การอ่าน/เขียนข้อมูล) |
| `libs/monaco/` | Monaco Editor 0.52 (MIT) + `libs/monaco-worker.js` (worker bootstrap แบบ CSP-safe) |
| `icons/` | ไอคอน extension |
| `tools/make-icons.js` | สคริปต์ generate ไอคอน (`node tools/make-icons.js`) |

## Storage แต่ละชนิด

### Local / Session Storage
Table view: sort, filter, double-click แก้ไข, ลบมี Undo · JSON view แก้แล้ว Save ได้ (แปลงค่าที่เป็น JSON string เป็น object ซ้อนให้อัตโนมัติ)

### IndexedDB
เลือก Database → Object store จากแถบด้านบน แล้วดู/เพิ่ม/แก้/ลบ records (key อ่านเป็น JSON: `1` = number, `"a"` = string · store ที่มี keyPath จะใส่ key ให้อัตโนมัติ), เคลียร์ทั้ง store, ลบทั้ง database

### Cookies
แก้ได้ครบทุก attribute — domain, path, expiry, httpOnly, secure, sameSite (ผ่าน `chrome.cookies` API จึงมองเห็น httpOnly ด้วย)

### Cache Storage
เลือก Cache แล้วดู requests ทั้งหมด · กดไอคอนตา เพื่อดู response body + headers ของแต่ละ entry · ลบ entry หรือลบทั้ง cache

### Storage Buckets (Chrome 122+)
ดู bucket ทั้งหมดพร้อม usage/quota/persisted · สร้าง bucket (ตั้ง persisted + quota ได้) · ลบ bucket

### Extension Storage
`chrome.storage.local / sync / session` ของ extension นี้เอง — เพิ่ม/แก้/ลบ key (ค่าเป็น JSON structure ได้), เคลียร์ทั้ง area, refresh อัตโนมัติเมื่อค่าเปลี่ยน (onChanged)

### Shared Storage (Privacy Sandbox)
Get / Set / Append / Delete / Clear ตาม key — keys enumerate ไม่ได้โดย design ของ API จึงต้องรู้ key ล่วงหน้า (มี availability check ในหน้า)

### Interest Groups (Protected Audience)
Join / Leave group ด้วย owner + name + bidding logic URL — Chrome ไม่เปิดให้ extension รายการกลุ่มที่มีอยู่ (เป็นข้อจำกัดของ API)

### Private State Tokens
เช็ค `document.hasPrivateToken(issuer)` — token เป็น private โดย design อ่าน/นับไม่ได้ หน้านี้ใช้ตรวจว่ามี token จาก issuer นั้นหรือไม่

## Views

- **Table** — sort คลิกหัวคอลัมน์, ช่อง filter, action buttons เมื่อ hover แถว, Export เป็นไฟล์ JSON, Clear all (มี Undo สำหรับ ls/ss)
- **JSON** — Monaco editor: พับบรรทัด, เลขบรรทัด, ตรวจ JSON เรียลไทม์ (ขีดหยักแดง), บอกบรรทัดที่ผิดตอน Save (แก้ได้เฉพาะ ls/ss, ชนิดอื่นเป็น read-only snapshot)
- **Script** — console JS รันในหน้าเว็บ (await ได้, IntelliSense) กด `Ctrl+Enter`

```js
db.get(key) · db.json(key) · db.set(key, value) · db.del(key) · db.keys() · db.clear('ss')
db.cookie.list() / .set() / .del()
indexedDB · caches · sharedStorage   // API ของหน้าเว็บใช้ได้ตรง ๆ
```

## ข้อจำกัด / หมายเหตุ

- ใช้กับหน้า `chrome://` และ Chrome Web Store ไม่ได้ (Chrome บล็อก)
- การอ่านข้อมูลหน้าเว็บทำผ่าน `chrome.devtools.inspectedWindow.eval` — Privacy Sandbox APIs บางตัวต้องเปิดใช้ใน Chrome settings ก่อน
- IndexedDB แก้ไข record อ้างอิงด้วยลำดับแถว ถ้าหน้าเว็บเปลี่ยนข้อมูลระหว่างกด อาจต้อง refresh ก่อน
- เปิด `panel.html` ตรง ๆ จะเข้าโหมด **Preview** ที่ใช้ mock data (รวม IndexedDB/Cache จำลอง) เพื่อดู UI อย่างเดียว
