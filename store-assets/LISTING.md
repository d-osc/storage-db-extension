# Chrome Web Store — Listing ที่เตรียมไว้ (copy-pame ได้เลย)

## Store listing

**Name (ภาษาอังกฤษ)**: Storage DB — DevTools panel
**Summary (manifest description)**: Browse & edit all page storage: Local, Session, IndexedDB, Cookies, Cache, Buckets, Privacy Sandbox — table, JSON and script views.
**Category**: Developer Tools
**Language**: English (US) — เพิ่มภาษาไทยเป็น secondary ได้ถ้าต้องการ
**Graphics**:
- Icon 128×128: `icons/icon128.png`
- Screenshots 1280×800: `store-assets/screenshots/01..04` (อัปอย่างน้อย 1 ใบ, แนะนำทั้ง 4)
- Small promo tile 440×280: `store-assets/promo-tile-440x280.png`

### Detailed description (store)

```
Storage DB adds a full database workbench to Chrome DevTools. Open DevTools (F12) on any page and switch to the "Storage DB" tab to browse and edit every kind of storage that page uses — no console commands needed.

STORAGE TYPES
• Local Storage & Session Storage — spreadsheet-style table with sorting, filtering, inline editing, undo for deletes and full JSON editing
• IndexedDB — pick a database and object store, view/add/edit/delete records, clear stores, delete databases
• Cookies — edit every attribute: value, domain, path, expiry, httpOnly, secure, sameSite (httpOnly cookies included)
• Cache Storage — inspect cached requests, preview response bodies and headers, delete entries or whole caches
• Storage Buckets — usage/quota/persisted per bucket, create and delete buckets
• Extension Storage — chrome.storage local/sync/session of this extension with live refresh
• Privacy Sandbox — Shared Storage operations, Interest Group join/leave, Private State Token checks

THREE VIEWS
• Table — sortable columns, filter box, add/edit/delete with undo, JSON export
• JSON — Monaco editor (the engine behind VS Code) with code folding, live validation, nested object editing: JSON-string values expand into real objects and are stringified back on save
• Script — run JavaScript in the inspected page (await supported) with IntelliSense; helper API like db.get/db.set/db.keys plus direct access to indexedDB, caches and sharedStorage

Everything runs locally in your browser. No data ever leaves your machine, no accounts, no telemetry.

Open source: https://github.com/d-osc/storage-db-extension
```

## Privacy tab (Dashboard → Privacy)

**Does your extension collect user data?** — **No**

- Browsing activity: Not collected
- Website content: Not collected — the extension only reads/writes storage **locally in DevTools** of the page the developer is actively inspecting; nothing is transmitted, stored remotely, or shared.
- Personal communications / Authentication info / etc.: Not collected

**Privacy policy URL**: https://github.com/d-osc/storage-db-extension/blob/main/PRIVACY.md

## Permission justifications (ตอบตอน submit review)

| Permission | เหตุผล (แปะตามนี้) |
|---|---|
| `cookies` (+ broad host `http://*/*`, `https://*/*`) | Required to read and edit cookies (including httpOnly cookies, which pages cannot access) of **the page currently open in the user's DevTools**, via the chrome.cookies API. The extension is a developer tool that operates only on the inspected tab on the user's own machine. No network requests are made; no data is collected or transmitted anywhere. |
| `storage` | Stores nothing itself — used only to expose chrome.storage.local/sync/session of this extension to the developer inside the DevTools panel (the "Extension Storage" section). |
| `devtools_page` | Adds the Storage DB panel to Chrome DevTools. This is the single purpose of the extension: a local storage inspector/editor for web developers. |

**Single purpose statement**:
```
Storage DB is a Chrome DevTools panel that lets web developers browse and edit all storage of the page they are inspecting (localStorage, sessionStorage, IndexedDB, cookies, cache storage, storage buckets, extension storage and Privacy Sandbox APIs) directly in DevTools. All processing is local.
```
