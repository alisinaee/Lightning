/*
 * The "What's new" panel on the download page. The page shows the entry whose `version` matches
 * the latest GitHub release's tag; a release with no entry here falls back to its own notes.
 *
 * Add the next version's entry before publishing it, newest first. `kind` is one of new, faster,
 * improved or fixed; `text` may wrap `code` in backticks.
 */
;(function (root) {
  'use strict'

  root.LightningChangelog = [
    {
      version: 'v1.0.0-rc.17',
      items: [
        {
          kind: 'new',
          title: 'Download later for several links',
          text: 'The last step of Several links has a Download later button. The group is added and waits; its Start button begins it.'
        },
        {
          kind: 'improved',
          title: 'DNS you can understand',
          text: 'Every DNS in the list says what it is. The test takes a second sample from the best servers and only suggests a change that is worth making.'
        },
        {
          kind: 'fixed',
          title: 'Auto DNS on resume',
          text: 'A resumed download on Auto DNS has its site tested, just as a new one does.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.16',
      items: [
        {
          kind: 'new',
          title: 'Test DNS for a site',
          text: 'Try every DNS on a link and see which server each leads to, how fast it connects and how fast it sends a sample. Iranian DNSs (Electro, Shecan, Begzar, 403, Radar) are in the list, and one that sends a site to a server with a bad certificate is flagged.'
        },
        {
          kind: 'new',
          title: 'Auto DNS',
          text: 'Choose Auto and Lightning remembers the best DNS it found for each site, and tests a new site in the background when a download starts.'
        },
        {
          kind: 'fixed',
          title: 'Auto groups and the VPN switch',
          text: 'Turning the VPN option on is no longer treated as a network coming back, so it gets files at once.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.15',
      items: [
        {
          kind: 'fixed',
          title: 'Retry in groups',
          text: 'A group and each of its failed files have a Retry button, and the top bar button retries failures when nothing is running. A file that can no longer continue starts over from a fresh look at its link.'
        },
        {
          kind: 'fixed',
          title: 'VPN and link checks',
          text: 'Checking a link now goes out on a real network like the download does, so a VPN can no longer make a link look like a different file.'
        },
        {
          kind: 'fixed',
          title: 'Steadier Auto groups',
          text: 'A network that keeps dropping out gets a new file only after it has stayed up for 20 seconds, so files no longer pile up on the other networks.'
        },
        {
          kind: 'improved',
          title: 'Tidier windows',
          text: 'Every dialog has a close button, Edit group has Cancel beside Done, hints sit on the button they describe at any text size, queued files say Queued, and running rows show just a bar and percentage.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.14',
      items: [
        {
          kind: 'new',
          title: 'Browser extension',
          text: 'Chrome, Edge, Brave and Firefox can hand downloads to Lightning, with the page and cookies they came from. Pair it once in Settings → Browser.'
        },
        {
          kind: 'new',
          title: 'Schedule',
          text: 'Weekly run or pause windows, overnight ones too, each with an optional speed cap. Settings → Schedule.'
        },
        {
          kind: 'new',
          title: 'Sign-in, cookies and headers',
          text: 'Basic auth, a Referer, cookies (or a `cookies.txt`), a User-Agent and extra headers per download, for links behind a login.'
        },
        {
          kind: 'new',
          title: 'Checksums',
          text: 'Paste a SHA-256, SHA-1 or MD5 and the finished file is verified.'
        },
        {
          kind: 'new',
          title: 'When downloads finish',
          text: 'Optionally ask whether to quit, sleep or shut down, and open a file or show it in its folder when it is done.'
        },
        {
          kind: 'new',
          title: 'Start at login and copied links',
          text: 'Lightning can start hidden when you sign in, and offer to download a link to a file when you copy one.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.13',
      items: [
        {
          kind: 'fixed',
          title: 'Check for updates works',
          text: 'The button in Settings now asks GitHub straight away and says whether you are up to date, an update is available, or GitHub could not be reached. The update icon blinks so you notice it.'
        },
        {
          kind: 'improved',
          title: 'Tidier list',
          text: 'Row actions are icons, columns fit their headers, and the Logs and Debug buttons can be switched on in Settings → Interface.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.12',
      items: [
        {
          kind: 'new',
          title: 'Lightning',
          text: 'Renamed and rebranded, with a new Settings window, download history, group settings, DNS and proxy options, and format badges on every file.'
        },
        {
          kind: 'fixed',
          title: 'Steadier downloads',
          text: 'Turning the VPN off now takes it out of running downloads, the last file in a group uses every network, and file names in ISO-8859-1 save correctly.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.11',
      items: [
        {
          kind: 'faster',
          title: 'More streams, sooner',
          text: 'Each network starts with 8 streams and doubles once they are all receiving, up to 32. Far-away servers fill your connection much faster.'
        },
        {
          kind: 'new',
          title: 'Pick your stream count',
          text: 'Leave it on Auto, or choose a fixed 4, 8, 16 or 32 streams per network on the start screen.'
        },
        {
          kind: 'improved',
          title: 'Backs off when a server asks',
          text: 'If a server turns some streams away or leaves them unanswered, that network drops to the ones it accepted, then gets one more back each minute.'
        },
        {
          kind: 'faster',
          title: 'Quicker finish',
          text: 'A slow block near the end is raced by a free stream sooner, and raced again if that backup gets stuck too.'
        },
        {
          kind: 'improved',
          title: 'Unticking the last network pauses',
          text: 'Switching off the last network pauses the download, and switching one back on resumes it.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.10',
      items: [
        {
          kind: 'new',
          title: 'Switch networks mid-download',
          text: 'Networks can join, leave or be ticked on and off while a download runs. Unplug your phone and the download carries on over Wi-Fi; plug it back in and add it again.'
        },
        {
          kind: 'new',
          title: 'Waits instead of failing',
          text: 'With no network available, a download waits for one to come back. An error keeps the partial file, so you can resume from the error screen.'
        },
        {
          kind: 'faster',
          title: 'Picks its own stream count',
          text: 'Each network starts with 4 streams and Lightning adds more only while they actually add speed, so the streams setting is gone.'
        },
        {
          kind: 'faster',
          title: 'Reuses connections',
          text: 'Each stream keeps one connection open instead of reconnecting for every 8 MB block, which saves a handshake per block.'
        },
        {
          kind: 'improved',
          title: 'Writes straight to your folder',
          text: 'Downloads go into a `.lightning` file in the folder you chose and take their real name when they finish, with no copy at the end.'
        },
        {
          kind: 'improved',
          title: 'Rides out busy servers and sleep',
          text: 'Busy servers are waited out, connections recover when your computer wakes up, and the computer stays awake while a download runs. IPv6 now works on every network you select.'
        },
        {
          kind: 'improved',
          title: 'Windows installer options',
          text: 'Choose where Lightning is installed, and whether it adds a desktop shortcut.'
        }
      ]
    },
    {
      version: 'v1.0.0-rc.9',
      items: [
        {
          kind: 'new',
          title: 'Remembers your settings',
          text: 'Parallel streams and your download folder are kept between launches, and the app opens with them already in place.'
        },
        {
          kind: 'new',
          title: 'Same-network warning',
          text: 'Lightning warns you when two selected connections are on the same local network, since Windows only uses one adapter then.'
        },
        {
          kind: 'improved',
          title: 'Explains single-connection downloads',
          text: 'When a server can’t split a download, the app now says why only one connection can be used.'
        },
        {
          kind: 'fixed',
          title: 'Smaller fixes',
          text: 'Downloading to a drive root on Windows (like `D:\\`) works, pause and cancel stay visible on small windows, and a dismissed update prompt stays dismissed.'
        }
      ]
    }
  ]
})(typeof window !== 'undefined' ? window : module.exports)
