# KJR Game Day Soundboard — Blueprint

As of November 17, 2026. Live version: GitHub commit `8898d9d` ("Add the Spotify Client ID") in `Chochonut83/kjr-soundboard`. The Claude GitHub App has access to the repo. The soundboard rules block is published in Firebase (owner pasted it Nov 17). Spotify Client ID `028414dc172f4768837e9eed2f1caaf2` is in `config.js`.

Open item: `kjr-stat-tracker/firestore.rules` in that repo (and its copy in this project) doesn't have the soundboard block yet. Add it before anyone pastes the Stat Tracker's rules file into Firebase again, or soundboard sync stops working.

## What it is

A phone-first web app that plays game day music at Kitchener Jr Rangers games. It controls Spotify (Premium) through the Spotify Web API: each song starts at its own saved start time. Separate app from the Stat Tracker; it shares the Stat Tracker's Firebase project.

## Where everything lives

| Thing | Location |
|---|---|
| Live app | `https://chochonut83.github.io/kjr-soundboard/` (GitHub Pages, branch `main`, `/ (root)`) once the repo exists |
| Source in this project | `kjr-soundboard/...` (same files as the repo) |
| Plan doc | `https://claude.ai/artifact/LAi7Yw2HiyRjrrpR9NX38V` |
| Setup guide | Claude doc "KJR Game Day Soundboard Setup Guide" `https://claude.ai/artifact/Pzn7Mzgq5UjSocfPsedNDA` (setup steps, game day use, troubleshooting, Future versions list) |
| Spotify app | Owner's Spotify Developer Dashboard. Redirect URI `https://chochonut83.github.io/kjr-soundboard/`. Development mode: owner needs Premium, max 5 users (User Management). Client ID goes in `config.js` (`SPOTIFY_CLIENT_ID`) or is typed into Settings on each device. |
| Firebase | Project `kjr-aaa-u13-stattracker` (Stat Tracker's). Collection `soundboards/{syncCode}`. Rules block added to the shared rules file; the owner must paste it into Firebase. |
| Logo | Project file "Kitchener Jr Rangers.png", cropped to the shield: `logo-240.png` (header) and the icons (shield on navy `#0b2350`, 80% size; maskable 62%). |

## Files

| File | What it is |
|---|---|
| `index.html` | Layout and all styles (fonts Saira Condensed + Barlow, Stat Tracker colours) |
| `app.js` | The whole app: Spotify PKCE sign-in, token refresh, playlists import, song editor, buttons, queue, fade, devices, Firebase sync, backup file |
| `config.js` | `SB_CONFIG.SPOTIFY_CLIENT_ID` and `FIREBASE_CONFIG` (Stat Tracker's project) |
| `firebase-glue.js` | Only file that talks to Firebase (SDK 10.12.2, anonymous auth, named app "soundboard") |
| `firestore.rules` | Complete rules for the shared project (Stat Tracker + soundboard block). Must stay identical to `kjr-stat-tracker/firestore.rules`. |
| `sw.js` | Offline start (network-first for app files). Bump `VERSION` (`kjr-sb-1`) when icons/sw change. |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `logo-240.png` | Home-screen install (binary files: kept in GitHub only) |
| `test/server.js`, `test/mock-glue.js`, `test/run.js` | Test with a pretend Spotify and database |

## Button rules

| Button | Behaviour |
|---|---|
| Goal | The one song with the `goal` category (only one allowed; picking a new one moves it) |
| Penalty | Random from `penalty`, never the same as the last penalty song |
| Skate-out | Sheet listing `skate` songs; the user picks |
| Intermission | Random from `inter` songs not yet played this game; when all played, repeats one (not the last) and says so |
| Stoppage | If the queue has songs left: next one in order (`qpos`). Otherwise random from `stop` songs not yet played; same repeat rule |
| New game | New `game` object: played list, queue and `qpos` cleared |
| Now Playing | Fade (volume steps down over `settings.fade` s, pause, volume restored; devices without `supports_volume` just pause), Stop, Next (presses the same button again) |

Played list is shared by Intermission, Stoppage and the queue. Goal, Penalty, Skate-out and previews don't add to it.

## Data

Browser storage (`kjr-sb-` prefix): `board`, `settings` ({fade, device:{id,name}}), `auth` (Spotify tokens), `me`, `clientId`, `sync` (code), `syncedAt`, `deviceKey`, `now`, `pkce`.

```
board = {
  songs: [{id, uri, name, artist, img, dur, start /*ms*/, cats: ["goal"|"penalty"|"skate"|"inter"|"stop"]}],
  game: {id, at, played: [songId], queue: [songId], qpos, last: {cat: songId}},
  playlists: [{id, name}],
  updatedAt
}
```

Firestore `soundboards/{code}` = `{board, by: deviceKey, at}`. Codes look like `kjr-ab12cd` (6–40 chars). Whole-board last-write-wins: a device adopts a snapshot when its `board.updatedAt` is newer and `by` isn't itself. Writes are debounced 500 ms.

Spotify endpoints used (post-February-2026 names): `GET /me`, `GET /me/playlists`, `GET /playlists/{id}/items` (items carry `item`; older `track` also accepted; only playlists the user owns or collaborates on), `GET /me/player/devices`, `PUT /me/player/play` with `{uris:[uri], position_ms}` and `device_id`, `PUT /me/player/pause`, `PUT /me/player/volume`, `GET /me/player`, `GET /me/player/currently-playing`. Scopes: `playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state user-read-currently-playing`.

## How changes are made and shipped

1. Edit the files in `kjr-soundboard/`.
2. `node --check app.js`.
3. Test: `node test/server.js .` then `NODE_PATH=<playwright> node test/run.js` (33 checks: sign-in, import, editor, every button, queue, fade, start-from-now, two-phone sync, reload).
4. Push to `Chochonut83/kjr-soundboard` `main`. Pages republishes in 1–2 minutes. Never overwrite a `config.js` that has the real Client ID with a blank one.
5. If `firestore.rules` changed: update it in both repos and tell the owner to paste it into Firebase.
6. Update this blueprint, the stored files and the setup guide.

## Known limits

- iPhone: apps can't change Spotify's volume, so Fade = stop. Home-screen apps have separate storage from Safari; connect Spotify inside whichever one is used.
- Spotify Autoplay can start a similar song when a track ends; turn it off on the speaker device.
- Phones put Spotify to sleep in the background; the app re-finds the device or asks.

## Change history

| Date | Change |
|---|---|
| Nov 17, 2026 | First version built and tested (`1b049fe`); pushed to GitHub with the Spotify Client ID (`8898d9d`); Firebase rules block published |
