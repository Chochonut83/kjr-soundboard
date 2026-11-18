# KJR Game Day Soundboard — Blueprint

As of November 18, 2026. Live version: v1.4 (Rangers "arena night" look) in `Chochonut83/kjr-soundboard`. The Claude GitHub App has access to the repo. The soundboard rules block is published in Firebase (owner pasted it Nov 17). Spotify Client ID `028414dc172f4768837e9eed2f1caaf2` is in `config.js`.

Open item: `kjr-stat-tracker/firestore.rules` in that repo (and its copy in this project) doesn't have the soundboard block yet. Add it before anyone pastes the Stat Tracker's rules file into Firebase again, or soundboard sync stops working.

## What it is

A phone-first web app that plays game day music at Kitchener Jr Rangers games. It controls Spotify (Premium) through the Spotify Web API: each song starts at its own saved start time. Separate app from the Stat Tracker; it shares the Stat Tracker's Firebase project.

## Where everything lives

| Thing | Location |
|---|---|
| Live app | `https://chochonut83.github.io/kjr-soundboard/` (GitHub Pages, branch `main`, `/ (root)`) |
| Source in this project | `kjr-soundboard/...` (same files as the repo) |
| Plan doc | `https://claude.ai/artifact/LAi7Yw2HiyRjrrpR9NX38V` |
| Setup guide | Claude doc "KJR Game Day Soundboard Setup Guide" `https://claude.ai/artifact/Pzn7Mzgq5UjSocfPsedNDA` (setup steps, game day use, troubleshooting, Future versions list) |
| Spotify app | Owner's Spotify Developer Dashboard. Redirect URI `https://chochonut83.github.io/kjr-soundboard/`. Development mode: owner needs Premium, max 5 users (User Management). Client ID goes in `config.js` (`SPOTIFY_CLIENT_ID`) or is typed into Settings on each device. |
| Firebase | Project `kjr-aaa-u13-stattracker` (Stat Tracker's). Collection `soundboards/{syncCode}`. Rules block added to the shared rules file and published in Firebase (Nov 17). |
| Logo | Header: project file "Kitchener Jr Rangers.png" cropped to the shield (`logo-240.png`). App icon and artwork: the owner's "KJR Soundboard" art (1254×1254 PNG, sent in chat Nov 17; not stored in the project): `icon-192/512.png` (corners outside its frame made transparent), `apple-touch-icon.png` (solid, iOS rounds it), `icon-maskable-*.png` (art at 80% on `#020614`), `favicon.png`, `soundboard-art.jpg` (640 px, on the Connect Spotify banner and the bottom of Settings). |

## Files

| File | What it is |
|---|---|
| `index.html` | Layout and all styles (fonts Saira Condensed + Barlow; dark "arena night" theme in the shield colours, see Look) |
| `app.js` | The whole app: Spotify PKCE sign-in, token refresh, playlists import, song editor, buttons, queue, fade, devices, Firebase sync, backup file |
| `config.js` | `SB_CONFIG.SPOTIFY_CLIENT_ID` and `FIREBASE_CONFIG` (Stat Tracker's project) |
| `firebase-glue.js` | Only file that talks to Firebase (SDK 10.12.2, anonymous auth, named app "soundboard") |
| `firestore.rules` | Complete rules for the shared project (Stat Tracker + soundboard block). Must stay identical to `kjr-stat-tracker/firestore.rules`. |
| `sw.js` | Offline start. App files are network-first with `cache: "no-cache"` (asks GitHub if the file changed, so a new version shows the next time the app opens; page loads fetched by address with `redirect: "manual"`). Bump `VERSION` (now `kjr-sb-4`) when icons/sw change. |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `favicon.png`, `logo-240.png`, `soundboard-art.jpg` | Home-screen install (binary files: kept in GitHub only) |
| `test/server.js`, `test/mock-glue.js`, `test/run.js` | Test with a pretend Spotify and database |

## Look (v1.4)

Approved from the mockup "KJR Soundboard – New Look Mockup" (`https://claude.ai/artifact/MCXRAf3EU2uKANxS9YoNSY`, Nov 18).

- Colours (CSS variables in `index.html`): background `--bg #071533` (soft spotlight at the top), panels `--panel #0e2453`, borders `--line #20407f`, header `--head #0b1f4d`, logo blue `--blue #16468e`, logo red `--red #e22426`, muted text `--muted #a9bcdd`, playing/sync green `--live #3ddc84`.
- Header: shield logo, "Kitchener Jr Rangers" small caps over a slanted "GAME DAY SOUNDBOARD" (Soundboard in red), and the shield's blue-white-red diagonal band along the bottom. Header height is `--head-h` (78 px + safe area); the Now Playing strip (`.nowwrap`) sticks right under it.
- Game buttons (`.pad-btn`): 3D: coloured bottom edge (`--edge`), gloss on the top half, white inner rim like the shield's; press sinks them 6 px. Each has a line icon (`ICONS` in `app.js`: siren, stopwatch, bolt, cup, music note) and the label in `.txt` (`.big` + `small`). GOAL is red with the shield's white band and blue corner; Penalty gold; Skate-out blue; Intermission navy (icon beside the text); Stoppage white, with a blue pill when the queue is on.
- ON AIR: `liveKey()` gives the button the playing song came from (queue songs = Stoppage, previews = none); `renderNow` toggles `.live` on it (white outline, blinking ON AIR tag, GOAL also glows).
- Now Playing: green border and an animated equalizer while a song is on (hidden while fading). Speaker pill has a speaker icon.
- Tabs: line icons; the open tab is logo blue with a red underline. Toast is white (red for errors, green for success). Animations stop for "reduce motion".

## Button rules

| Button | Behaviour |
|---|---|
| Goal | The one song with the `goal` category (only one allowed; picking a new one moves it) |
| Penalty | Random from `penalty`, never the same as the last penalty song |
| Skate-out | Sheet listing `skate` songs; the user picks |
| Intermission | Random from `inter` songs not yet played this game; when all played, repeats one (not the last) and says so |
| Stoppage | If the queue has songs left: next one in order (`qpos`). Otherwise random from `stop` songs not yet played; same repeat rule |
| New game | New `game` object: played list, queue and `qpos` cleared |
| Local files | Detected by `is_local` on the playlist entry or the song, or a `spotify:local:` URI. Imported from playlists as songs with `id = uri` (`spotify:local:Artist:Album:Title:Seconds`), `local:true`, `pl` (playlist id) and `idx` (position). The Web API can't play a local URI directly, so they play with `{context_uri: spotify:playlist:<pl>, offset:{position: idx}, position_ms}`. Before each play `findLocal` checks `idx` with one `limit=1` request and searches the playlist if it moved. `watchLocal`: at 2.5 s, warns if Spotify isn't on that song (file not on the device); when the song should have ended (+1.5 s), pauses if Spotify moved on to another playlist song. Re-importing refreshes `idx`. A local entry Spotify sends without a song object or URI can't be imported; the import toast says how many. |
| Start time | Play request sends `position_ms`. Many devices (phones, sleeping devices) ignore it and start at 0:00, so `ensureStart` polls `currently-playing` (up to 10 times, 350–600 ms apart) until the song is on; if `progress_ms` is more than 2.5 s short of the start time it calls `PUT /me/player/seek` (at most twice). Skipped for start times under 1.5 s. |
| Now Playing | Fade (volume steps down over `settings.fade` s, pause, volume restored; devices without `supports_volume` just pause), Next (presses the same button again) |
| Big Stop | `#bigStop`: large red button fixed above the tab bar (z-index 55, above sheets) whenever `now` is set, on every tab and over sheets. Hides at once, then pauses. During a fade it pauses first, then restores the volume. `watchPlayback` checks `currently-playing` every 5 s (from 4 s after a play, only while the page is visible) and clears `now` when Spotify isn't playing, so the button goes away when a song ends or is paused in Spotify. `body.playing` adds bottom padding to the page, sheets and toast. |

Played list is shared by Intermission, Stoppage and the queue. Goal, Penalty, Skate-out and previews don't add to it.

## Data

Browser storage (`kjr-sb-` prefix): `board`, `settings` ({fade, device:{id,name}}), `auth` (Spotify tokens), `me`, `clientId`, `sync` (code), `syncedAt`, `deviceKey`, `now`, `pkce`.

```
board = {
  songs: [{id, uri, name, artist, img, dur, start /*ms*/, cats: ["goal"|"penalty"|"skate"|"inter"|"stop"],
           local?, pl?, idx? /* local files only: playlist id and position */}],
  game: {id, at, played: [songId], queue: [songId], qpos, last: {cat: songId}},
  playlists: [{id, name}],
  updatedAt
}
```

Firestore `soundboards/{code}` = `{board, by: deviceKey, at}`. Codes look like `kjr-ab12cd` (6–40 chars). Whole-board last-write-wins: a device adopts a snapshot when its `board.updatedAt` is newer and `by` isn't itself. Writes are debounced 500 ms.

Spotify endpoints used (post-February-2026 names): `GET /me`, `GET /me/playlists`, `GET /playlists/{id}/items` (items carry `item`; older `track` also accepted; only playlists the user owns or collaborates on), `GET /me/player/devices`, `PUT /me/player/play` with `{uris:[uri], position_ms}` and `device_id`, `PUT /me/player/pause`, `PUT /me/player/seek`, `PUT /me/player/volume`, `GET /me/player`, `GET /me/player/currently-playing`. Scopes: `playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state user-read-currently-playing`.

## How changes are made and shipped

1. Edit the files in `kjr-soundboard/`.
2. `node --check app.js`.
3. Test: `node test/server.js .` then `NODE_PATH=<playwright> node test/run.js` (50 checks: sign-in, import incl. local files, editor, every button, queue, fade, stop during fade, start-time jump on a device that ignores it, big Stop on every tab and over sheets, Stop hiding when Spotify stops, start-from-now, local file play/stop/re-find, two-phone sync, reload). The pretend Spotify has `page.spotify` (`ignorePos`, `progressOverride`, `playing`) for these cases. Screenshots go to `test/shot-*.png`..
4. Push to `Chochonut83/kjr-soundboard` `main`. Pages republishes in 1–2 minutes. Never overwrite a `config.js` that has the real Client ID with a blank one.
5. If `firestore.rules` changed: update it in both repos and tell the owner to paste it into Firebase.
6. Update this blueprint, the stored files and the setup guide.

## Known limits

- iPhone: apps can't change Spotify's volume, so Fade = stop. Home-screen apps have separate storage from Safari; connect Spotify inside whichever one is used.
- Spotify Autoplay can start a similar song when a track ends; turn it off on the speaker device.
- Local files only play if Spotify on the speaker device has the file (on a phone: the playlist downloaded with its local files).
- Phones put Spotify to sleep in the background; the app re-finds the device or asks.
- When a device ignores the start position, the first fraction of a second plays from 0:00 before the app jumps it to the start time.
- After an update, a phone that already has the app open may need it closed and opened again (twice if it was installed before v1.3) to load the new version. Settings shows the version at the bottom.

## Change history

| Date | Change |
|---|---|
| Nov 17, 2026 | First version built and tested (`1b049fe`); pushed to GitHub with the Spotify Client ID (`8898d9d`); Firebase rules block published |
| Nov 17, 2026 | v1.1: owner's KJR Soundboard art as the app icon, favicon, Connect Spotify banner and Settings footer; `sw.js` VERSION `kjr-sb-2`; test serves config.js with a blank Client ID |
| Nov 17, 2026 | v1.2: local files from playlists are imported and play from their playlist position; the app stops Spotify when a local song ends |
| Nov 17, 2026 | v1.3 (`bd2583a`): songs jump to their start time when the device ignores it; big red Stop button on every view while a song plays (replaces the small Stop in Now Playing); Stop during a fade pauses before restoring volume; import also detects local files flagged only on the playlist entry and reports ones Spotify left out; `sw.js` revalidates app files, VERSION `kjr-sb-3` |
| Nov 18, 2026 | v1.4 (`c18983f`): Rangers "arena night" look from the approved mockup: dark navy theme in the shield colours, 3D press-down game buttons with icons, shield stripe on GOAL and under the header, ON AIR light on the playing button, equalizer in Now Playing, icon tabs, all tabs and sheets restyled; theme colour `#0b1f4d`; `sw.js` VERSION `kjr-sb-4` |
