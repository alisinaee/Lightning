import { t } from '@shared/i18n/react'

/** The index behind the search field in Settings, as data: one entry per setting (or section title)
 * on every page. `page` is a page ID of SettingsDialog (the same IDs as in the `settings/<page>`
 * address, never renamed here). `label` is the plain English text the row shows, and the search
 * matches on it; `keywords` add words a person might type instead. A later translation pass can
 * match the translated label too. A row is found on the page by its label (data-setting). */
export interface SettingEntry {
  page: string
  label: string
  keywords: string[]
}

export const SETTINGS_INDEX: SettingEntry[] = [
  // General
  {
    page: 'General',
    label: 'Language',
    keywords: ['english', 'persian', 'farsi', 'russian', 'فارسی', 'русский', 'locale', 'translate']
  },
  { page: 'General', label: 'Telegram settings', keywords: ['tdl'] },
  { page: 'General', label: 'YouTube options', keywords: ['video', 'yt-dlp'] },
  {
    page: 'General',
    label: 'About',
    keywords: ['version', 'update', 'check for updates', 'release']
  },
  {
    page: 'General',
    label: 'Files at once',
    keywords: ['parallel', 'simultaneous', 'queue', 'concurrent']
  },
  {
    page: 'General',
    label: 'Default folder',
    keywords: ['destination', 'directory', 'save to', 'location']
  },
  {
    page: 'General',
    label: 'Remove a finished download from the list when its file is deleted or moved',
    keywords: ['missing', 'clean']
  },
  {
    page: 'General',
    label: 'Warn before downloading something I already have',
    keywords: ['duplicate', 'already']
  },
  // History
  {
    page: 'History',
    label: 'History',
    keywords: ['finished', 'downloaded', 'uploaded', 'rename', 'remove']
  },
  // Usage
  {
    page: 'Usage',
    label: 'Usage',
    keywords: ['data', 'traffic', 'statistics', 'bandwidth', 'chart']
  },
  // Appearance
  { page: 'Appearance', label: 'Text size', keywords: ['font', 'scale', 'zoom', 'small', 'large'] },
  { page: 'Appearance', label: 'Theme', keywords: ['dark', 'light', 'mode', 'system'] },
  { page: 'Appearance', label: 'Window glass', keywords: ['transparency', 'blur', 'vibrancy'] },
  { page: 'Appearance', label: 'Transparency', keywords: ['glass', 'opacity'] },
  { page: 'Appearance', label: 'Blur', keywords: ['glass', 'vibrancy'] },
  {
    page: 'Appearance',
    label: 'Color',
    keywords: ['accent', 'amber', 'blue', 'teal', 'green', 'violet', 'rose']
  },
  // Network
  { page: 'Network', label: 'VPN', keywords: ['tunnel', 'use vpn for downloads'] },
  {
    page: 'Network',
    label: 'Speed and data limits',
    keywords: ['limit', 'throttle', 'cap', 'bandwidth', 'slow mode']
  },
  {
    page: 'Network',
    label: 'Proxy',
    keywords: ['system proxy', 'no proxy', 'configure manually', 'http', 'https', 'ftp', 'socks']
  },
  { page: 'Network', label: 'Advanced', keywords: ['stall', 'timeout'] },
  {
    page: 'Network',
    label: 'Stall timeout (seconds)',
    keywords: ['stalled', 'connection', 'no data']
  },
  // Notifications
  {
    page: 'Notifications',
    label: 'Notify me when a download is added',
    keywords: ['notification', 'alert']
  },
  {
    page: 'Notifications',
    label: 'Notify me when a download finishes',
    keywords: ['notification', 'completed', 'done']
  },
  {
    page: 'Notifications',
    label: 'Notify me when a download fails',
    keywords: ['notification', 'error']
  },
  {
    page: 'Notifications',
    label: 'Only when Lightning is in the background',
    keywords: ['notification', 'inactive', 'focus']
  },
  // Power
  {
    page: 'Power',
    label: 'Keep the computer awake while a download is running',
    keywords: ['sleep', 'prevent sleep', 'caffeinate']
  },
  {
    page: 'Power',
    label: 'When all downloads finish, ask what to do (quit, sleep or shut down)',
    keywords: ['shutdown', 'quit', 'sleep', 'finished']
  },
  // Schedule
  {
    page: 'Schedule',
    label: 'Schedule',
    keywords: ['window', 'time', 'weekly', 'start time', 'end time', 'limit speed']
  },
  // Browser
  {
    page: 'Browser',
    label: 'Let the browser extension send links to Lightning',
    keywords: ['extension', 'integration', 'chrome', 'firefox', 'pairing key']
  },
  {
    page: 'Browser',
    label: 'Add the extension',
    keywords: ['install', 'extension', 'chrome', 'firefox']
  },
  { page: 'Browser', label: 'Pairing key', keywords: ['token', 'extension'] },
  // Telegram
  { page: 'Telegram', label: 'Telegram', keywords: ['sign in', 'sign out', 'account', 'tdl'] },
  {
    page: 'Telegram',
    label: 'Telegram links in the clipboard',
    keywords: ['clipboard', 'watch', 'offer to download a telegram message when its link is copied']
  },
  { page: 'Telegram', label: 'Telegram folder', keywords: ['destination', 'directory'] },
  { page: 'Telegram', label: 'Connections per file', keywords: ['threads'] },
  { page: 'Telegram', label: 'Files at once', keywords: ['parallel'] },
  {
    page: 'Telegram',
    label: 'Skip files already in the folder with the same name and size',
    keywords: ['duplicate', 'skip']
  },
  {
    page: 'Telegram',
    label: 'Sort finished files into Videos, Photos, Audio, Documents and Other folders',
    keywords: ['organize', 'folders']
  },
  { page: 'Telegram', label: "Download an album's files together", keywords: ['group', 'album'] },
  {
    page: 'Telegram',
    label: 'Use a takeout session (gentler limits for large exports)',
    keywords: ['takeout', 'export']
  },
  { page: 'Telegram', label: 'Use the manual proxy from Network settings', keywords: ['proxy'] },
  { page: 'Telegram', label: 'File name template', keywords: ['rename', 'naming'] },
  // YouTube
  {
    page: 'YouTube',
    label: 'YouTube',
    keywords: ['video', 'quality', 'format', 'cookies', 'folder', 'subtitles']
  },
  // Clipboard
  {
    page: 'Clipboard',
    label: 'Track the clipboard for download links',
    keywords: ['copy', 'paste', 'watch', 'monitor', 'privacy']
  },
  { page: 'Clipboard', label: 'File links', keywords: ['clipboard', 'zip', 'magnet', 'torrent'] },
  { page: 'Clipboard', label: 'YouTube links', keywords: ['clipboard', 'video'] },
  { page: 'Clipboard', label: 'Telegram links', keywords: ['clipboard', 'message'] },
  {
    page: 'Clipboard',
    label: 'Only while Lightning is in the background',
    keywords: ['clipboard', 'focus', 'notification']
  },
  {
    page: 'Clipboard',
    label: 'Recent links',
    keywords: ['clipboard history', 'copied', 'clear history', 'download', 'copy', 'remove']
  },
  // Interface
  {
    page: 'Interface',
    label: 'Closing the window keeps Lightning running in the background',
    keywords: ['close', 'tray', 'menu bar']
  },
  {
    page: 'Interface',
    label: 'Start Lightning when I sign in (hidden in the tray)',
    keywords: ['login', 'startup', 'autostart', 'boot']
  },
  { page: 'Interface', label: 'Title bar', keywords: ['logs', 'debug'] },
  { page: 'Interface', label: 'Show the Logs button', keywords: ['title bar', 'log'] },
  {
    page: 'Interface',
    label: 'Show the Debug button (the Test lab)',
    keywords: ['title bar', 'lab', 'development']
  },
  { page: 'Interface', label: 'Downloads', keywords: ['list'] },
  { page: 'Interface', label: 'Show the side panel', keywords: ['sidebar'] },
  {
    page: 'Interface',
    label: 'Show a progress line along the bottom of each row',
    keywords: ['progress bar']
  },
  {
    page: 'Interface',
    label: 'Show the website under file names',
    keywords: ['host', 'source', 'domain']
  },
  { page: 'Interface', label: 'Help', keywords: ['tour', 'intro', 'quick tour'] },
  {
    page: 'Interface',
    label: 'Show the quick tour again',
    keywords: ['help', 'tour', 'onboarding']
  },
  { page: 'Interface', label: 'Play the intro again', keywords: ['help', 'animation'] },
  // Status bar
  { page: 'Status bar', label: 'In the bar', keywords: ['status bar'] },
  { page: 'Status bar', label: 'How many downloads there are', keywords: ['count'] },
  { page: 'Status bar', label: 'The total speed', keywords: ['speed'] },
  { page: 'Status bar', label: 'The speed limit, when one is set', keywords: ['limit'] },
  { page: 'Status bar', label: 'How many are waiting', keywords: ['queue', 'queued'] },
  {
    page: 'Status bar',
    label: 'The speed of each network',
    keywords: ['interface', 'wifi', 'ethernet']
  },
  { page: 'Status bar', label: 'Slow mode', keywords: ['limit'] },
  { page: 'Status bar', label: 'Free disk space', keywords: ['storage', 'space'] },
  { page: 'Status bar', label: 'The menu', keywords: ['status bar', 'popover'] },
  {
    page: 'Status bar',
    label: 'Open a menu of live details when the count and speed are clicked',
    keywords: ['popover']
  },
  { page: 'Status bar', label: 'A graph of the speed over the last minute', keywords: ['chart'] },
  { page: 'Status bar', label: 'Totals: speed, received, left and time left', keywords: ['eta'] },
  { page: 'Status bar', label: 'Connections on each network', keywords: ['sockets'] },
  { page: 'Status bar', label: 'The downloads running now', keywords: ['active'] },
  { page: 'Status bar', label: 'Waiting, paused and failed counts', keywords: ['queue'] },
  { page: 'Status bar', label: 'Free disk space and the folder', keywords: ['storage'] },
  { page: 'Status bar', label: 'Running downloads listed', keywords: ['rows', 'number'] },
  { page: 'Status bar', label: 'Menu bar icon', keywords: ['tray', 'macos'] },
  {
    page: 'Status bar',
    label:
      'Clicking the icon opens a panel with bars and colours, instead of a menu (right-click always gives the menu)',
    keywords: ['tray', 'panel']
  },
  { page: 'Status bar', label: 'A speed graph in the panel', keywords: ['chart', 'tray'] },
  {
    page: 'Status bar',
    label: 'Quick buttons in the panel: new download, pause all and the rest',
    keywords: ['tray', 'buttons']
  },
  { page: 'Status bar', label: 'How many are downloading and the total speed', keywords: ['tray'] },
  { page: 'Status bar', label: 'Panel buttons', keywords: ['tray', 'quick buttons'] },
  {
    page: 'Status bar',
    label: 'The total speed as text beside the icon',
    keywords: ['tray', 'menu bar']
  },
  { page: 'Status bar', label: 'Speed unit', keywords: ['mbps', 'mb/s', 'bits', 'bytes'] }
]

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

/** The entries matching `query`: every word must be in the label, the page name or a keyword.
 * Label hits come before keyword-only hits. */
export function searchSettings(
  query: string,
  index: SettingEntry[] = SETTINGS_INDEX
): SettingEntry[] {
  const words = normalise(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: { entry: SettingEntry; score: number }[] = []
  for (const entry of index) {
    // The English label and the translated one (plus page names) both match.
    const label = normalise(`${entry.label} ${t(entry.label)}`)
    const rest = normalise(`${entry.page} ${t(entry.page)} ${entry.keywords.join(' ')}`)
    if (!words.every((word) => label.includes(word) || rest.includes(word))) continue
    const inLabel = words.every((word) => label.includes(word))
    scored.push({
      entry,
      score:
        (inLabel ? 0 : 10) +
        (normalise(t(entry.label)).startsWith(words[0]) || label.startsWith(words[0]) ? 0 : 1)
    })
  }
  return scored.sort((a, b) => a.score - b.score).map((item) => item.entry)
}
