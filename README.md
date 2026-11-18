# KJR Game Day Soundboard

Game day music for the Kitchener Jr Rangers. It plays songs from your Spotify playlists, each one from its own start time, with one button for each moment of the game.

Live at **https://chochonut83.github.io/kjr-soundboard/** (GitHub Pages, branch `main`, folder `/ (root)`).

## Buttons

| Button | What it plays |
|---|---|
| Goal | The one goal song, from its start time |
| Penalty | A random penalty song, never the same one twice in a row |
| Skate-out | Opens the list so you pick one |
| Intermission | A random intermission song. No song repeats in a game |
| Stoppage | The game queue in order if you built one, otherwise a random stoppage song. No song repeats in a game |
| New game | Clears the played list and the queue |

Now Playing bar: **Fade** (lowers the volume, then pauses), **Next** (another song from the same button).

While a song plays, a big red **STOP** button sits above the tabs on every screen.

The button whose song is playing lights up with **ON AIR**.

Each song starts at its own start time. If the speaker device starts it from the beginning, the app jumps it to the start time.

## Files

| File | What it is |
|---|---|
| `index.html` | Page layout and styles |
| `app.js` | Everything the app does: Spotify sign-in (PKCE), playlists, buttons, queue, sync |
| `config.js` | Spotify Client ID and Firebase settings |
| `firebase-glue.js` | Talks to Firebase (Firestore + anonymous sign-in) |
| `firestore.rules` | Complete rules for the shared Firebase project; must match `kjr-stat-tracker/firestore.rules` |
| `sw.js`, `manifest.webmanifest`, icons | Home-screen install and offline start |
| `test/` | Test with a pretend Spotify and database: `node test/server.js .` then `node test/run.js` |

Firestore: one document per sync code at `soundboards/{code}` = `{board, by, at}`. `board` holds `songs` (`id, uri, name, artist, img, dur, start, cats`), `game` (`played, queue, qpos, last`) and `playlists`.

When you change `sw.js` or the icons, bump `VERSION` in `sw.js`.
