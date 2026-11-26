# Vienovo Telecast Control

Control room and live screen for the Vienovo Philippines Year End & Christmas Party 2026 telecast:
a timed rundown (optionally following the schedule), background music and videos for each segment, an employee-awards
spotlight, a grand-raffle spin wheel, a ticker, and a pop-out live screen that stays in sync with the
control room.

It was originally split out of a single 1.9 GB `index.html.html` export (the one-time extraction
scripts have since been removed).

## Run

```
npm install
npm start          # build, then run everything on port 3010:
                   #   control room:  http://localhost:3010/   (others: http://<this-PC-IP>:3010/)
                   #   live screen:   http://localhost:3010/#live  (or "Pop-out Live Screen")
npm run server     # run again without rebuilding (after a restart, when the code has not changed)

npm run dev        # only while changing the code: hot-reload dev server (Vite) next to `npm run server`
npm run build      # production build in dist/ (includes ~1.4 GB of media from public/)
```

## Multi-user mode (several locations, one show)

`server/index.mjs` is a small Node server that shares one show between everyone who opens the app
through it. Without it, the app works on one computer as before.

```
npm run server     # development: run next to `npm run dev`, which forwards /ws, /api and /uploads to it
npm start          # production: build, then serve everything from http://<host>:3010/
```

Roles, chosen when signing in:

- **Director** (code `DIRECTOR_CODE`, only one at a time; another director can take over): runs the
  show. Only the Director's flow is on air at the Live screens, and only the Director shares the live
  call and uses the show-wide cards (ticker, awards, raffle, backup).
- **Editor** (code `SHOW_CODE`): edits segments and uploads media. Changes reach everyone within a
  second, and each segment shows who edited it last. An editor can also run the whole flow (Start,
  ▶ segments, music, videos, backgrounds, sound effects) as a private preview: it plays on their
  own computer only and never reaches the Live screens. "Pop-out Live Screen" on an editor's computer
  shows the Director's program, including the live call.
- **Live screen** (code `SHOW_CODE`): open `http://<host>/#live` at each location and press F for
  fullscreen.

Settings are environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3010` | Port the server listens on |
| `SHOW_CODE` | **required** | Code for editors and live screens (min 8 characters) |
| `DIRECTOR_CODE` | **required** | Code for the director (min 8 characters, different from `SHOW_CODE`) |
| `DATA_DIR` | `./server-data` | Shared state and uploaded files |
| `MAX_UPLOAD_MB` | `2048` | Largest single upload |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | none | Relay for strict company firewalls |

**Access codes are required.** There are no built-in codes: the server prints an error and exits if
`SHOW_CODE` or `DIRECTOR_CODE` is missing, shorter than 8 characters, or if both are the same. It never prints
the codes. Easiest: create a file `frontend/.env` (git-ignored) with two lines, then run `npm run server`:

```
SHOW_CODE=your-editor-code
DIRECTOR_CODE=your-director-code
```

(`.env` accepts `KEY=VALUE` lines, `#` comments and optional quotes; real environment variables take
precedence over it.) Or set both variables in the terminal instead:

```
:: Windows (cmd)
set SHOW_CODE=your-editor-code
set DIRECTOR_CODE=your-director-code
npm run server

# Windows (PowerShell)
$env:SHOW_CODE = "your-editor-code"; $env:DIRECTOR_CODE = "your-director-code"; npm run server

# macOS / Linux
SHOW_CODE=your-editor-code DIRECTOR_CODE=your-director-code npm run server
```

After 10 wrong codes within 5 minutes, further sign-in attempts from the same computer are refused until
the 5 minutes have passed.

**Live call (CEO speech from Teams, Google Meet or Zoom).** These platforms cannot be embedded in
another page. Instead:

1. An editor pastes the meeting link into the segment, under 📞 Live call.
2. During that segment, the director clicks **🔗 Open meeting**, joins it in a Chrome or Edge tab,
   then clicks **📡 Share call to Live Screens**.
3. In the browser's share dialog, the director picks that tab and ticks **Also share tab audio**.

The stream goes peer-to-peer (WebRTC) from the director's PC to each screen, so plan about
3 Mbit/s of upload per remote screen.

- Browsers only allow tab sharing on a **secure address**: `https://…` or `http://localhost`. On
  `http://<this-PC-IP>:3010` the button turns into **⚠ Sharing blocked on this address: how to fix**, which
  explains the options: open the control room at `http://localhost:3010` on the server PC (one click when it is
  that PC), or on another PC allow the address under `edge://flags/#unsafely-treat-insecure-origin-as-secure`,
  or serve the app over https. Live Screens don't need this.
- Links may be pasted without `https://`; the platform is detected from the link.
- While sharing, the call bar shows how many Live Screens are receiving. A screen that gets no picture
  for 15 s (e.g. a company firewall blocks WebRTC) offers **🔗 Join the meeting on this screen instead**, so
  that location can join the meeting directly.

For use across different offices, put the server on a host every location can reach, with HTTPS
(e.g. a VPS or Render behind a domain). Screen sharing needs HTTPS or localhost.

**Quick option: Cloudflare tunnel.** With the server running, open a second terminal and run
`npm run tunnel` (uses `../tools/cloudflared/cloudflared.exe`). It prints an address like
`https://<random-words>.trycloudflare.com` that every location can open over the internet, and sharing
the call works there from any computer. Keep that terminal open during the show. The address changes
each time the tunnel restarts, so send the new one to the venues. The tunnel is slower than the local
network, so press **⬇ Save media on this PC** at every location before the show. Anyone with the address
reaches the sign-in page, so set your own `SHOW_CODE` and `DIRECTOR_CODE` instead of the defaults.

## Structure

```
public/assets/
  logo.png, background-default.jpg, raffle-default.m4a   formerly inline data: URIs
  media/<id>.mp4|jpg                                     the 35 uploads embedded in the export
src/
  main.tsx, App.tsx          React shell: mounts #app, then loads the engine
  data/
    initialState.json        saved show: rundown, awards, raffle pool, media list
    mediaManifest.json       media id -> /assets/media/... URL
  telecast/
    main.js                  boot (control room or live screen)
    constants.js             asset URLs, default rundown, scenes, palette, helpers
    state.js                 the show state `S` (localStorage) + setS / fixSegs / dedupe
    sync.js                  save + sync between windows (BroadcastChannel, postMessage, pop-out)
    net.js                   multi-user: sign-in, roles, patches to/from the server, uploads
    call.js                  live call: director shares a meeting tab, WebRTC to every screen
    media.js                 IndexedDB for uploads, falls back to public/assets/media
    playback.js              audio/video commands, monitor follows the live screen
    actions.js               go to segment, playback command, spin
    render.js                render loop, 1 s auto-pilot scheduler, start-of-show dialog
    persistence.js           load bundled state, JSON backup / restore
    stage/stage.js           16:9 broadcast stage (snow, panels, ticker, awards)
    stage/wheel.js           raffle wheel, winner card, confetti
    control/control.js       control-room layout and bindings
    control/rundown.js       card 1: rundown
    control/library.js       card 2: media library (upload once) + card 4: sound-effects board (played by hand, not in segments)
    control/editor.js        card 3: segment editor, picks music / videos / photos from the library
    styles/                  base.css -> control.css -> stage.css -> ice.css (order matters)
```

## Notes

- Timing: 1 min 30 s before a segment ends, the control room shows a countdown card pinned to the top
  of the screen (it turns red in the last 15 s, has **+1 min** and **Next segment now** buttons, and
  the countdown is also in the browser tab title). When the time is up, each segment does what its **Autoplay & timing** setting
  says in the Segment editor: **Ask me with a pop-up** (continue to the next segment, +1 min, +5 min, or
  stay), or **Go to the next segment automatically** (after 5 s, and after its video ends). The same
  section sets whether a segment auto-plays its music and its first video. Auto-Pilot only starts
  segments at their set clock times.
- Adding segments: hover between two rows in the Rundown and click the ＋ that appears (or
  **＋ Add segment** at the bottom). The new segment opens in the Segment editor, starting right after
  the one before it. **🗑 Delete segment** in the Segment editor removes one (not the segment on air).
  Segments are matched by id, so the segment on air stays on air when others are inserted or deleted.
- Employee awards are listed in one folder per award (e.g. "Sales Awardee"). Click an awardee to put them
  on the Live Screen and click again to hide them. **▶ Next in folder** goes through one award, and
  **⏭ Next award** goes through the whole list folder by folder. `control/awards.js`.
- Employee awards can have a 🥇 Gold, 🥈 Silver or 🥉 Bronze medal (or none). Pick it next to **Add**, change
  it in the list, or put it in the CSV as an optional last column (`Name, Award, gold`). The spotlight on
  the Live Screen then shows a medal badge and colours the name and frame to match.
- The ✕ (delete / remove) on media items and sound effects is hidden until you click the item.
- Sound effects are heard only at the location that plays them (that computer and its pop-out Live
  Screen). They are never sent through the server, so other venues are not affected. The effects volume is
  per computer too.
- **Media at each location** (`saveMedia` in `media.js`): every signed-in control room and Live Screen copies
  the show's videos, songs and pictures into its own browser by itself, so during the show they play from
  its own disk instead of streaming from the server PC. It starts with the segment on air and the next one,
  downloads big files in 4 parallel pieces, pauses while the live call is shared (the call also uses the
  server PC's upload), and while the show is running only fetches the current and next segments. The
  **⬇ Save media on this PC** button (control-room header, and on a Live Screen when you hover it) shows the
  progress and saves everything at once when pressed. Let it finish at each location before the show. The
  server PC itself keeps no extra copy. These copies are not included in **Download backup**.
- **Locations** (`LOCS` in `constants.js`): everyone picks their venue when signing in (Cebu City, NCR
  Makati, CDO Mindanao). A segment can belong to one location (**Belongs to** in the Segment editor) or to
  all. An Editor changes their own location's segments and the shared ones directly; another location's
  segment shows 🔒 and is read-only for them (they can still preview it), and the server refuses such changes
  too, so the three venues never overwrite each other. Segments an Editor adds belong to their location. The
  Director can change everything. The rundown shows a location tag on each segment, highlights yours, and has
  **Only my location's segments**.
- **🔁 Change media in many segments** (Rundown card, `control/bulk.js`): add, replace or remove the same
  music, videos or photos in many segments at once, e.g. in every location's segments. Tick the locations
  (or single segments); the list marks which segments will change, **Apply** sends them all together, and
  **↩ Undo last change** puts them back. An Editor gets only their location's and the shared segments.
- **One clock** (`clock.js`): every PC measures its clock against the server's, so countdowns, the show timer
  and the raffle wheel match at every location even when a PC's own clock is off.

- The engine renders imperatively into `#app`. React provides the shell and the build, but the UI
  is not made of React components.
- Media is stored once in the library (`S.lib`). Segments only hold ordered lists of library ids
  (`g.aud`, `g.vid`, `g.img`), so using a song in several segments costs no extra space. Older
  saves are converted automatically (`migrateToLibrary` in `state.js`).
  Byte-identical duplicate files were removed from `public/assets/media` when the project was set up.
- Uploads made in the app are stored in this browser's IndexedDB, as before. **Download backup**
  saves the state plus those uploads as JSON, and **Restore backup** loads that file back in. The
  bundled media in `public/assets/media` is not included in the backup.
- To change the starting show, edit `src/data/initialState.json`. A browser that already has a
  newer save (`savedAt`) keeps its own copy.
