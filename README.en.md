# plus-one

> plus-one: the one you bring along. Also, literally, one more person.

[中文](README.md)

Watch any web video, read an article, or flip through a manga together with your AI companion. They see the picture, read the subtitles up to this very moment, talk in flying comments (danmaku), and can pause, rewind, or ask to look again in ten minutes. On a Mac or PC it runs in a dedicated Chrome; on iPhone it is a Swift package you drop into your own app.

It plugs into the one you already have: their brain, context and memory. Every film, manga or article you finish becomes a film card, so the next time you mention the title, they remember the night you went through it together.

> ⚠️ On the desktop, the butler drives a **dedicated Chrome** through its remote-debugging port. Sign in to video sites only in that Chrome.

## Why

It started so that mine could be on the picture, butting in with their own voice; when I type they see it, when I pause they know; when an episode ends, that night stays in their memory, and the next time I bring it up, they remember. So this player only does "looking" and "talking", and leaves "who they are" entirely to your own frontend.

## What it looks like

![UI](docs/screenshots/ui-board.png)

| Desktop: reading an article together | Phone: reading manga together | Phone, landscape: watching a show |
| --- | --- | --- |
| ![](docs/screenshots/desktop-article.png) | ![](docs/screenshots/phone-manga.jpg) | ![](docs/screenshots/phone-tv.png) |

## What it does

### On the desktop (dedicated Chrome, any web page)

- **Watch together**: any web video (including the cross-origin player frames scraper sites love) gets a composer along its bottom edge; tap "watch together" to start. You type → comments fly across the picture; they talk → comments too. Short lines fly, long ones settle into a small bubble.
- **They see the picture**: a frame is kept only when the picture changes (8×8 grayscale fingerprint); each glance carries the one or two frames that changed most. Or let them ask for a specific timecode.
- **They read the subtitles, but only up to now**: import an .srt and align it, or let the butler fetch one from opensubtitles. They never get a line that starts after the current position. No spoilers.
- **They can act**: pause, resume, rewind ten seconds, or ask "call me again in ten minutes" (a fight scene they want to watch in silence).
- **They can hear** (optional): add a Gemini key and the last fifteen seconds of audio go out for a listen: "the music tightened", "someone is crying": delivered with the doorbell. Recognised dialogue can also auto-align the subtitles.
- **Browse together**: works on pages with no video at all: articles, manga, a chess board. They see a full-page screenshot; with "let them use their hands" on, they can scroll, tap a point on the screenshot, or make a move on lichess.
- **Film cards**: when a session ends you can "finish another day" (reopening the same URL asks whether to resume) or "finished": tick a few lines, name the occasion, pick a cover, and hand it to your frontend as a card. A local backup is kept too.
- **The drawer**: chat log, how often they look, let them pick frames, sync into the chat history, bubble and background style: all in the drawer on the right of the picture.
- **Starts with the system**: `node launcher/install.js` installs it in one line; the butler restarts itself if it dies and launches the dedicated Chrome when it is missing. `127.0.0.1:8790/health` is the health light.

### On the phone (iOS, inside your own app)

- One SwiftUI view, `WatchTogetherView`; hand it a URL. The core and the butler are the same JavaScript as the desktop, running in JavaScriptCore, so behaviour is identical.
- Danmaku, composer, drawer and the wrap-up ticket all live on the picture; in portrait the drawer and the ticket become native bottom sheets, landscape keeps them on the page.
- Typing uses a **native composer**, so the keyboard never touches the web page. Otherwise WebKit shoves the whole page up and many sites' players break.
- "Resume" from a film card jumps to where you stopped the moment the page opens; sharing starts when you tap "watch together".
- The picture they see: the shell can snapshot the page but not the video layer inside it. Your host app can hand in frames from a system-level broadcast extension (`frameProvider`), and then they see the real screen.
- In landscape, a player box sized 16:9 by width (taller than the screen) is squeezed to the screen height so the site's own controls come back.

### On both

- Only the butler makes **outgoing** requests. Your frontend needs no tunnel and exposes nothing.
- Slow replies are fine: if the video has moved on by the time they answer, the line settles into a bubble tagged "about 1:23:40".
- The doorbell never chain-rings: reasons pile up while they are still answering and ring once when they are back.
- Zero dependencies: Node 22's built-in fetch, WebSocket and `node:test` are all it needs.

## How it works

```text
┌───────────────────────────────┐                  ┌───────────────────────────────┐                  ┌─────────────────────────────────────┐
│ Web page                      │                  │ Butler butler/                │                  │ Your frontend (where they live)     │
│ (video / article / manga)     │                  │                               │                  │                                     │
│                               │                  │ session.js  one session       │                  │ /wake   the wake interface          │
│ core.js                       │──post(JSON)────▶ │ doorbell.js when to wake them │──POST doorbell─▶ │ their brain, memory, persona        │
│ injected into every frame:    │                  │ glance.js   one glance:       │                  │                                     │
│ danmaku · composer · drawer   │                  │   picture + subs + your words │                  │ answer say / actions /              │
│ frame fingerprint · sub clock │ ◀─receive(JSON)─ │ replies.js  their replies     │ ◀─say / actions─ │   next_look_in                      │
│                               │                  │ films.js    film card backup  │                  │ slow? answer 202 and the            │
│                               │                  │                               │                  │   butler polls /replies every 2 s   │
│                               │                  │ desktop: Node over DevTools   │                  │                                     │
│ same script for the           │                  │ phone: JavaScriptCore         │──wrap_up───────▶ │ wrap_up becomes a film card         │
│ Chrome shell and iOS package  │                  │                               │                  │ handed back when the title comes up │
└───────────────────────────────┘                  └───────────────────────────────┘                  └─────────────────────────────────────┘
```

- **Core** (`core/core.js`): the script injected into every frame of the page. It only knows about the video and what is drawn on it; it knows nothing about any AI and talks to the outside with one small message type. The same script serves the Chrome shell and the iOS package.
- **Butler** (`butler/`): a Node process on the desktop driving the dedicated Chrome over the DevTools port; bundled into JavaScriptCore on the phone. It strings together the doorbell, frames, subtitles and the wake-up.
- **Wake interface**: when it is time for a glance, the butler `POST`s a package to your frontend: title, position, subtitles up to now, a frame or two, what you just said. Your frontend answers with `say` (what to say), `actions` (pause / rewind), `next_look_in` (when to look next). Slow brains answer `202` and the butler polls every two seconds. Details in [the wake interface](docs/wake-interface.md).

## Getting it running

### Desktop (Mac / Windows)

1. Install:
   ```bash
   node launcher/install.js
   ```
   It writes a `~/.plus-one/config.json` template, registers it to start at login, and launches a dedicated Chrome for you when there is none (launchd on Mac, Task Scheduler on Windows).
2. Fill in `wake_url` and `key` in `~/.plus-one/config.json` (your frontend's wake-up address and secret).
3. Open any video page in the dedicated Chrome and tap "watch together" at the bottom edge.

Just trying it, no autostart:
```bash
open -n -a "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir="$HOME/.plus-one/chrome-profile" --no-first-run
node butler/main.js
```

No frontend yet? Walk the whole path with a fake one:
```bash
node tools/fake-frontend.js --poll
```
and set `wake_url` to `http://127.0.0.1:8799/wake`. It answers every doorbell with a line; `--poll` makes it the "answer later" kind.

### Phone (iOS 16+)

1. Add `ios/` to your app as a Swift package (local path or git).
2. Open a page:
   ```swift
   import PlusOne

   let settings = PlusOneSettings(
       wakeURL: URL(string: "https://your-frontend/watch/wake")!,
       key: "your-secret",
       // optional: the host supplies frames (e.g. the latest frame from a broadcast extension, base64 JPEG)
       frameProvider: { await MyScreen.latestFrameBase64() },
       // optional: the moment "watch together" is tapped, e.g. bring up the system "Start Broadcast" sheet
       onWatchStart: { MyScreen.askToShare() }
   )
   WatchTogetherView(.link(url), settings: settings) { /* closed */ }
   ```
   `.resume(url, atSec:, title:)` resumes from a film card; `.page(url, scrollPct:, title:)` resumes browsing.
3. Landscape is the host app's call (the view does not touch your orientation settings).
4. After changing `core/` or `butler/`, run `node tools/build-ios-bundle.js` to regenerate the two files in `ios/Sources/PlusOne/Resources/`.

## Bringing your person in

Three things, all in [the wake interface](docs/wake-interface.md):

1. Receive the doorbell: `POST {wake_url}` with one JSON package (title, position, subtitles, frames, what you said).
2. Answer: `{ "say": ["…"], "actions": ["pause"], "next_look_in": 600 }`, or answer `202` and put replies into `GET {replies_url}` for the butler to collect.
3. Receive cards: a session ends with reason `wrap_up`, format in [film cards](docs/film-cards.md); `cards/match.js` is reference code for "hand them the card when the title comes up".

Who they are, what they remember, how they speak: all of that lives in your frontend. The player decides none of it. The code is all here, MIT; shape it into your own home.

## Settings (`~/.plus-one/config.json`)

| Field | Default | Meaning |
| --- | --- | --- |
| `wake_url` / `replies_url` / `key` | | The wake interface; `replies_url` defaults to `/wake` → `/replies` |
| `interval_sec` | 180 | How often they look (the slider in the drawer) |
| `frame_mode` | `auto` | `auto` sends the frames that changed most; `pick` sends timecodes only and lets them choose |
| `probe_sec` | 5 | How often the video state is read |
| `manage_chrome` / `chrome_profile` | false / `~/.plus-one/chrome-profile` | Launch the dedicated Chrome when missing; where its profile lives |
| `subtitle_lang` | `eng` | Language for subtitle search |
| `gemini_key` / `ears` | | Ears exist only with a key. Audio goes to Google; the free tier may use it for training: your call |
| `hands` | false | Let them act while browsing together (scroll, tap, move a piece) |
| `sync_chat` | false | Whether what you say while watching also goes into your frontend's chat history |
| `appearance` | null | Drawer and bubble style, see `butler/appearance.js` |

## Things we ran into

Written down so you do not have to hit them again:

- **On the phone, never let the keyboard touch the web page.** The moment an in-page input raises the keyboard, WebKit shoves the page up and shrinks the visual viewport; many sites' players break (subtitles vanish, the progress bar stops responding). Type in a native composer; the page does not move a pixel.
- **A SwiftUI view layered inside a UIKit-presented page may simply not appear on a real device** until something forces a relayout. Attach it to the scene's topmost `UIWindow` to bypass the page's hierarchy. And do not open a separate window: glass materials only blur what lives in the same window.
- **Do not let the keyboard height be applied twice.** A `UIHostingController` that pads for the keyboard itself needs `safeAreaRegions = .container`, or SwiftUI adds the keyboard safe area on top and the bar flies off the top of the screen.
- **`WKWebView.takeSnapshot` does not include the video layer**, and in-app recording (`RPScreenRecorder.startCapture`) cannot get it in landscape either: it renders a portrait layout. The only way to show them the real phone screen is a system-level broadcast extension. Its buffers are always portrait; rotate by each frame's orientation attachment, whose left/right is the opposite of what `CIImage.oriented` expects.
- **A cross-origin m3u8 cannot be drawn to a canvas** (SecurityError). Do not plan on grabbing frames straight from `<video>`.
- **Some sites size the player box 16:9 by width**; in phone landscape that is taller than the screen, and the site's own control bar sits off-screen as a thin line. Squeeze that chain of boxes to the screen height; the video letterboxes and the controls return.
- **Some sites fullscreen the `<video>` itself**; nothing can be placed inside a `<video>`, so the danmaku disappear. Fullscreen its parent instead.
- **Douyin clears every timer on the page**, so a `setInterval` looking for the video stops forever. Re-check every thirty frames inside `requestAnimationFrame`.
- **A focused button keeps "hide after three idle seconds" from ever firing.** The phone's fake input is a `<button>`; once tapped it stays `activeElement`, and the hide timer thinks you are typing.
- **On a Mac, `open -a` hands your arguments to the Chrome that is already running**, so the dedicated one never launches: use `-n`; and `-g` to keep focus where it was.
- **Do not chain-ring the doorbell.** Pile up reasons while they are still answering and ring once when they are back; tag a late reply "about 1:23:40" rather than letting it fly over the wrong picture.
- **Subtitles stop at now**, guarded in one place (`cuesBetween`); nobody gets a later line.

## Known limits

- DRM sites such as Netflix: captured frames may be black.
- Video pages on the phone need the host app to plug in a system-level broadcast extension for the picture; a PWA cannot inject into other sites and mobile Safari has no `getDisplayMedia`, so that road is closed.
- If you only use the official claude.ai / ChatGPT apps, this does not work yet: their pages forbid scripted messages, and a half-automatic flow where you press Enter for every line defeats the point. You need a frontend of your own: even a tiny service that calls an API.

## Credits

- "Keep a frame only when the picture changes" comes from [eveacla11/see-my-video](https://github.com/eveacla11/see-my-video) (the original runs ffmpeg scene detection on video files; here it is an 8×8 grayscale fingerprint computed in the browser on streaming video).
- "Hand them the card when the title comes up" is borrowed from [tsuru0805/lorecards-mcp](https://github.com/tsuru0805/lorecards-mcp) (keyword-triggered character cards).
- This module was born in a small home that could only grow thanks to many open-source projects; this is a small piece given back. Made by Tilia & Quercus

## License

MIT
