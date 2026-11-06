# Lightning browser extension

Sends the browser's downloads (and a right-click → **Download with Lightning**) to the Lightning
desktop app; right-click a page → **Scan this page with Lightning** lists every file link on it in
Lightning's Add several links window, with the page they came from and the browser's cookies for the link.

Right-click a page, video or link → **Download video with Lightning** hands a video page to Lightning's
YouTube downloader (any site yt-dlp supports, not just YouTube). The popup's **Video cookies** setting
controls what the browser shares for it:

- **Send with each video download**: the site's cookies go with that one download and are deleted when it ends.
- **Save in Lightning**: the cookies are kept in Lightning's data folder for later downloads.
- **Use cookies saved in Lightning**: nothing is sent; the saved copy is used.
- **Don't send cookies**: public videos only.

It talks to Lightning over `127.0.0.1` only. Lightning must be running.

1. In Lightning: **Settings → Browser** → copy the pairing key.
2. Load the extension:
   - Chrome / Edge / Brave: `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
   - Firefox: `about:debugging` → This Firefox → **Load Temporary Add-on** → `manifest.json`.
3. Click the extension's icon, paste the key, **Save**.

If Lightning is not running, the browser downloads the file itself as usual.
