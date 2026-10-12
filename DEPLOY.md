# วิธี Deploy ขึ้น Chrome Web Store (ทำตามทีละขั้น = ผ่าน 100%)

Package พร้อมแล้ว: **`store-assets/storage-db-extension-v1.1.0.zip`** (manifest อยู่ที่ root ของ zip ตามที่ store กำหนด)

## ขั้นที่ 1 — สมัคร Developer Account (ครั้งเดียว, ต้องใช้บัญชี Google ของคุณ)

1. เปิด https://chrome.google.com/webstore/devconsole/register
2. ล็อกอินบัญชี Google ที่จะใช้เป็นเจ้าของ extension
3. จ่ายค่าธรรมเนียมสมัคร **ครั้งเดียว $5** (บัตร/บัญชีที่ผูกกับ Google Payments)
4. ยืนยันอีเมลผู้พัฒนา

> ขั้นนี้ทำแทนไม่ได้ — ต้องเป็นบัญชีและการชำระเงินของคุณเอง

## ขั้นที่ 2 — อัปโหลด

1. เข้า https://chrome.google.com/webstore/devconsole
2. กด **New item** → เลือกไฟล์ `storage-db-extension-v1.1.0.zip`
3. ระบบจะสร้าง draft ให้ — ยังไม่ต้อง submit ให้กรอกข้อมูลก่อน

## ขั้นที่ 3 — กรอก Store listing

ข้อมูลทั้งหมด copy จาก `store-assets/LISTING.md` ได้เลย:

- **Store listing tab**
  - Name: `Storage DB — DevTools panel` (ดึงจาก manifest อัตโนมัติ)
  - Summary: ดึงจาก manifest อัตโนมัติ
  - Description: ใบ้ข้อความจากหัวข้อ "Detailed description" ใน LISTING.md
  - Category: **Developer Tools**
  - Language: English (United States)
  - Upload screenshots ทั้ง 4 ใบจาก `store-assets/screenshots/` (1280×800)
  - Upload small promo tile: `store-assets/promo-tile-440x280.png`
- **Privacy tab**
  - "Does your extension collect user data?" → **No** (ทุกหมวดเลือก "not collected")
  - Privacy policy URL: `https://github.com/d-osc/storage-db-extension/blob/main/PRIVACY.md`

## ขั้นที่ 4 — กรอกเหตุผลการใช้สิทธิ์ (สำคัญ — มี broad host permissions)

ตอนกด Submit ระบบจะถาม justification ของแต่ละ permission — ข้อความตอบอยู่ใน `store-assets/LISTING.md` หัวข้อ "Permission justifications" (ครบทั้ง cookies + host permissions, storage และ single purpose statement)

## ขั้นที่ 5 — Submit และรอ review

1. กด **Submit for review**
2. เลือก visibility: **Public** (หรือ Unlisted ถ้าอยากลองก่อนแจกลิงก์ส่วนตัว)
3. รอ review — ปกติ 1–7 วัน (extension ที่มี broad host permissions มักใช้เวลาฝั่งผู้ตรวจนานกว่าปกติ อาจถึง 2–3 สัปดาห์ในช่วงเร่งด่วน)
4. สถานะจะแจ้งทางอีเมลผู้พัฒนา — ถ้าถูกตีกลับ ระบบบอกเหตุผลและแก้แล้ว submit ใหม่ได้

## เช็คลิสต์ความพร้อม (ตรวจให้แล้ว)

- [x] Manifest V3 ถูกต้อง (manifest.json ที่ root, version 1.1.0, description 131/132 ตัวอักษร)
- [x] ไอคอน 16/48/128 px ครบ
- [x] ไม่มี remote code / eval — Monaco editor และ worker ทั้งหมด vendor ไว้ในตัว (ผ่าน CSP ของ MV3)
- [x] ไฟล์ทั้งหมดที่ manifest อ้างถึงมีจริง
- [x] สิทธิ์น้อยที่สุดที่ทำงานได้ (cookies + storage + devtools_page)
- [x] Privacy policy พร้อม (PRIVACY.md ฝากบน GitHub)
- [x] Screenshots 1280×800 จำนวน 4 ใบ + promo tile 440×280
- [x] ZIP โครงสร้างถูก (manifest.json ที่ root)

## อัปเดตเวอร์ชันถัดไป

1. แก้ `version` ใน `manifest.json` (เช่น 1.2.0)
2. build zip ใหม่: `git archive -o store-assets/storage-db-extension-v1.2.0.zip HEAD -- manifest.json devtools.html devtools.js panel.html panel.css panel.js icons libs README.md PRIVACY.md`
3. DevConsole → เลือก item → **Package** → Upload new package → Submit for review
