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

1. In Lightning: **Settings → Browser** → **Add to Chrome** (or your browser). Lightning copies the
   extension to `Documents/Lightning Extension`, writes its pairing key beside it, opens the browser's
   extensions page and shows the folder in Finder.
2. Load the extension from that folder:
   - Chrome / Edge / Brave / Arc / Opera / Vivaldi: turn on Developer mode, then drag the folder onto
     the extensions page (or **Load unpacked** → the folder).
   - Firefox: `about:debugging` → This Firefox → **Load Temporary Add-on** → `manifest.json`
     (removed when Firefox quits).
   - Safari 18+: Settings → Advanced → show web developer features; Settings → Developer → allow
     unsigned extensions → **Add Temporary Extension** → the folder (removed when Safari quits).
3. The extension pairs by itself from `pairing.json`. Pasting the key in its popup (Enter the key manually) still works.

The popup shows one clear state (Lightning not running, not paired, wrong key, connected), the
on/off switch for taking over downloads, quick actions (scan this page, select videos on YouTube)
and the options. It speaks English, Persian (right to left) and Russian: Lightning's language
setting when it reports one, else the browser's language. If Lightning carries a newer extension
than the one loaded, the popup says to click Reload on the browser's extensions page.

In YouTube select mode, pick videos on any list or search page, or use **This video** on a watch page.

If Lightning is not running, the browser downloads the file itself as usual.
