# Lightning browser extension

Sends the browser's downloads (and a right-click → **Download with Lightning**) to the Lightning
desktop app, with the page they came from and the browser's cookies for the link.

It talks to Lightning over `127.0.0.1` only. Lightning must be running.

1. In Lightning: **Settings → Browser** → copy the pairing key.
2. Load the extension:
   - Chrome / Edge / Brave: `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
   - Firefox: `about:debugging` → This Firefox → **Load Temporary Add-on** → `manifest.json`.
3. Click the extension's icon, paste the key, **Save**.

If Lightning is not running, the browser downloads the file itself as usual.
