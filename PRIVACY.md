# Privacy Policy — Storage DB (DevTools extension)

_Last updated: 2026-08-22_

Storage DB is a Chrome DevTools panel extension for web developers. This policy explains what the extension does with data.

## What the extension does

Storage DB reads and writes browser storage (localStorage, sessionStorage, IndexedDB, cookies, Cache Storage, storage buckets, chrome.storage and Privacy Sandbox APIs) **only for the web page that the user is actively inspecting in their own Chrome DevTools**, and only on the user's own device.

## Data collection

The extension does **not** collect, transmit, sell or share any personal data:

- No analytics, telemetry or tracking of any kind
- No network requests are made by the extension (it contains no tracking or remote code)
- No data leaves the user's device
- No user accounts or authentication

All editing operations happen locally through Chrome DevTools APIs (`chrome.devtools.inspectedWindow`, `chrome.cookies`, `chrome.storage`).

## Permissions

- `cookies` / host permissions — used to display and edit cookies of the inspected page in DevTools
- `storage` — used to show the extension's own chrome.storage in the panel
- `devtools_page` — adds the panel to DevTools

## Contact

Questions about this policy can be raised at the project repository:
https://github.com/d-osc/storage-db-extension
