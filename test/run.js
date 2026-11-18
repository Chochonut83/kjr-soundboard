// End-to-end test with a pretend Spotify. Start test/server.js first, then: node test/run.js
const {chromium} = require("playwright");
const BASE = "http://localhost:8790/";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// ----- pretend Spotify -----
function fakeSpotify(log) {
  const tracks = Array.from({length: 55}, (_, i) => ({id: "t" + i, uri: "spotify:track:t" + i, type: "track", name: "Song " + i, artists: [{name: "Band " + i}], duration_ms: 200000, album: {images: [{url: "https://i.scdn.co/x" + i}]}}));
  const LOCAL = "spotify:local:Rink+Band::Rangers+Anthem:3";
  const items = tracks.map(t => ({item: t})).concat([{item: {type: "track", is_local: true, id: null, uri: LOCAL, name: "Rangers Anthem", artists: [{name: "Rink Band"}], duration_ms: 3000, album: {images: []}}}, {item: null}]);
  const st = {vol: 80, playing: null, progress: 0};
  return async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const json = (o, s) => route.fulfill({status: s || 200, contentType: "application/json", body: JSON.stringify(o)});
    if (u.host === "accounts.spotify.com" && p === "/authorize") {
      log.push({auth: Object.fromEntries(u.searchParams)});
      return route.fulfill({status: 302, headers: {Location: u.searchParams.get("redirect_uri") + "?code=CODE1&state=" + u.searchParams.get("state")}});
    }
    if (u.host === "accounts.spotify.com" && p === "/api/token") { log.push({token: req.postData()}); return json({access_token: "AT", refresh_token: "RT", expires_in: 3600}); }
    if (p === "/v1/me") return json({id: "coach", display_name: "Coach K"});
    if (p === "/v1/me/playlists") return json({items: [{id: "p1", name: "Game Day", owner: {id: "coach"}, items: {total: 56}, images: []}, {id: "p2", name: "Top Hits", owner: {id: "spotify"}, items: {total: 50}, images: []}], next: null});
    if (p === "/v1/playlists/p1/items") { const off = +u.searchParams.get("offset"); const page = items.slice(off, off + 50); return json({items: page, next: off + 50 < items.length ? "more" : null}); }
    if (p === "/v1/me/player/devices") return json({devices: [{id: "d1", name: "Rink iPad", type: "Tablet", is_active: false, supports_volume: true}]});
    if (p === "/v1/me/player/play" && m === "PUT") {
      const b = JSON.parse(req.postData());
      if (b.context_uri) { // local file: plays from the playlist, then Spotify moves on to the next song
        const uri = (items[b.offset.position] || {}).item; log.push({play: uri && uri.uri, ctx: b.context_uri, off: b.offset.position, pos: b.position_ms, dev: u.searchParams.get("device_id")});
        st.playingUri = uri && uri.uri; st.playing = "local"; clearTimeout(st.adv); st.adv = setTimeout(() => { st.playingUri = "spotify:track:t0"; st.playing = "t0"; }, 1200);
      } else { log.push({play: b.uris[0], pos: b.position_ms, dev: u.searchParams.get("device_id")}); clearTimeout(st.adv); st.playing = b.uris[0].split(":")[2]; st.playingUri = b.uris[0]; }
      return route.fulfill({status: 204});
    }
    if (p === "/v1/me/player/pause") { log.push({pause: true}); st.playing = null; st.playingUri = null; clearTimeout(st.adv); return route.fulfill({status: 204}); }
    if (p === "/v1/me/player/volume") { const v = +u.searchParams.get("volume_percent"); log.push({vol: v}); st.vol = v; return route.fulfill({status: 204}); }
    if (p === "/v1/me/player") return json({is_playing: !!st.playing, device: {id: "d1", supports_volume: true, volume_percent: st.vol}});
    if (p === "/v1/me/player/currently-playing") return json({is_playing: !!st.playing, item: st.playing ? {id: st.playing === "local" ? null : st.playing, uri: st.playingUri} : null, progress_ms: 75400});
    return json({error: {status: 404, message: "not mocked " + p}}, 404);
  };
}

async function phone(browser, log) {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
  await ctx.route(/https:\/\/(api|accounts)\.spotify\.com\/.*/, fakeSpotify(log));
  await ctx.route(/https:\/\/(fonts\.|i\.scdn)/, r => r.fulfill({status: 200, body: ""}));
  // Test the "type your Client ID" path: serve config.js with the ID left blank.
  const cfg = require("fs").readFileSync(require("path").join(__dirname, "..", "config.js"), "utf8").replace(/SPOTIFY_CLIENT_ID: "[^"]*"/, 'SPOTIFY_CLIENT_ID: ""');
  await ctx.route(/\/config\.js$/, r => r.fulfill({status: 200, contentType: "text/javascript", body: cfg}));
  const page = await ctx.newPage();
  page.on("pageerror", e => { console.log("PAGE ERROR", e.message); fails++; });
  await page.goto(BASE);
  return page;
}
const plays = log => log.filter(x => x.play);
const toastText = page => page.locator("#toast").textContent();

(async () => {
  const browser = await chromium.launch();
  const logA = [], A = await phone(browser, logA);

  // Connect Spotify
  ok(await A.locator(".banner").isVisible(), "shows Connect Spotify banner at first");
  await A.click('.tab[data-view="settings"]');
  await A.fill("#cid", "0123456789abcdef0123456789abcdef");
  await A.click('[data-act="savecid"]');
  await A.click('.card [data-act="login"]');
  await A.waitForFunction(() => document.querySelector("#toast").textContent.includes("Connected"));
  const a = logA.find(x => x.auth).auth;
  ok(a.code_challenge_method === "S256" && a.redirect_uri === BASE && a.scope.includes("user-modify-playback-state"), "sign-in uses PKCE with the right redirect URI and scopes");
  ok(/code_verifier=/.test(logA.find(x => x.token).token), "token exchange sends the code verifier");
  ok(!(await A.url()).includes("code="), "sign-in code is cleared from the address bar");

  // Import playlist
  await A.click('.tab[data-view="songs"]');
  await A.click('[data-act="import"]');
  ok(await A.locator('#plList [data-i="1"]').isDisabled(), "playlists made by others are greyed out");
  await A.click('#plList [data-i="0"]');
  await A.waitForFunction(() => window.__sb.board.songs.length === 56);
  ok(/56 new songs \(1 local\).*1 skipped/.test(await toastText(A)), "imports all 56 songs across pages, including the local file, and skips the empty slot");
  await A.click('.tab[data-view="songs"]'); await A.click('[data-act="import"]'); await A.click('#plList [data-i="0"]');
  await A.waitForTimeout(400);
  ok((await A.evaluate(() => window.__sb.board.songs.length)) === 56 && /56 already here/.test(await toastText(A)), "re-importing doesn't duplicate songs");

  // Song editor: goal + start time
  await A.click('[data-filter="all"]');
  await A.click('[data-edit="t0"]');
  await A.click('#edCats [data-k="goal"]');
  await A.fill("#edStart", "1:15"); await A.press("#edStart", "Tab");
  await A.click('[data-nudge="1000"]');
  ok((await A.evaluate(() => window.__sb.board.songs[0].start)) === 76000, "start time typed as 1:15 then +1s = 1:16");
  await A.click(".sheet [data-close].btn");
  await A.click('[data-edit="t1"]'); await A.click('#edCats [data-k="goal"]'); await A.click(".sheet [data-close].btn");
  ok((await A.evaluate(() => window.__sb.board.songs.filter(s => s.cats.includes("goal")).map(s => s.id).join())) === "t1", "only one goal song: choosing a new one replaces the old");
  await A.click('[data-edit="t1"]'); await A.click('#edCats [data-k="goal"]'); await A.click(".sheet [data-close].btn");
  await A.click('[data-edit="t0"]'); await A.click('#edCats [data-k="goal"]'); await A.click(".sheet [data-close].btn");

  // Put songs on the other buttons
  await A.evaluate(() => {
    const b = window.__sb.board, set = (ids, k) => ids.forEach(i => b.songs[i].cats.push(k));
    set([2, 3], "penalty"); set([4, 5, 6, 7, 8], "skate"); set([10, 11, 12], "inter"); set([20, 21, 22, 23, 24], "stop");
    b.songs.forEach((s, i) => { if (i >= 2) s.start = i * 1000; });
    window.__sb.changed();
  });

  // Goal → asks for device first, then plays from start time
  await A.click('.tab[data-view="game"]');
  await A.click('[data-press="goal"]');
  await A.click('#devList .dev');
  await A.waitForFunction(() => document.querySelector("#now .nowtxt"));
  let p = plays(logA).pop();
  ok(p.play === "spotify:track:t0" && p.pos === 76000 && p.dev === "d1", "Goal plays the goal song at 1:16 on the chosen device");
  ok((await A.textContent("#now")).includes("Song 0"), "Now Playing shows the song");

  // Penalty never repeats back-to-back
  logA.length = 0;
  for (let i = 0; i < 6; i++) { await A.click('[data-press="penalty"]'); await A.waitForTimeout(60); }
  const pen = plays(logA).map(x => x.play);
  ok(pen.length === 6 && pen.every((x, i) => i === 0 || x !== pen[i - 1]) && pen.every(x => /t[23]$/.test(x)), "Penalty picks from its songs and never the same twice in a row");

  // Intermission: no repeats within a game
  logA.length = 0;
  for (let i = 0; i < 3; i++) { await A.click('[data-press="inter"]'); await A.waitForTimeout(60); }
  const inter = plays(logA).map(x => x.play);
  ok(new Set(inter).size === 3, "Intermission plays 3 different songs");
  ok((await A.textContent('[data-press="inter"] small')).includes("0 left"), "Intermission button shows 0 left");
  await A.click('[data-press="inter"]'); await A.waitForTimeout(100);
  ok(/repeating/.test(await toastText(A)), "after every intermission song has played, it says one is repeating");
  ok(plays(logA).pop().pos === 12000 || plays(logA).pop().pos === 10000 || plays(logA).pop().pos === 11000, "intermission songs start at their own start times");

  // Stoppage with no queue: random, no repeats
  logA.length = 0;
  for (let i = 0; i < 5; i++) { await A.click('[data-press="stop"]'); await A.waitForTimeout(60); }
  ok(new Set(plays(logA).map(x => x.play)).size === 5, "Stoppage with no queue plays 5 different songs");

  // Skate-out: pick from list
  logA.length = 0;
  await A.click('[data-press="skate"]');
  ok((await A.locator(".sheet [data-id]").count()) === 5, "Skate-out lists its 5 songs");
  await A.click('.sheet [data-id="t6"]'); await A.waitForTimeout(100);
  ok(plays(logA).pop().play === "spotify:track:t6", "Skate-out plays the song you pick");

  // New game resets
  await A.click('[data-act="newgame"]'); await A.click("#okBtn");
  ok((await A.evaluate(() => window.__sb.board.game.played.length)) === 0, "New game clears the played list");

  // Build a queue: t30, t31, t20 then reorder t20 to the top
  await A.click('.tab[data-view="queue"]');
  await A.click('[data-act="qadd"]');
  await A.click('#qaF [data-f="all"]');
  for (const id of ["t30", "t31", "t20"]) await A.click(`#qaList [data-id="${id}"]`);
  await A.click(".sheet .btn.red[data-close]");
  await A.click('[data-up="2"]'); await A.click('[data-up="1"]');
  ok((await A.evaluate(() => window.__sb.board.game.queue.join())) === "t20,t30,t31", "queue built and reordered");
  await A.click('.tab[data-view="game"]');
  ok((await A.textContent('[data-press="stop"] small')).includes("Queue · 1 of 3"), "Stoppage button shows Queue 1 of 3");
  logA.length = 0;
  for (let i = 0; i < 5; i++) { await A.click('[data-press="stop"]'); await A.waitForTimeout(80); }
  const st = plays(logA).map(x => x.play.split(":")[2]);
  ok(st.slice(0, 3).join() === "t20,t30,t31", "Stoppage plays the queue in order");
  ok(st.slice(3).every(x => ["t21", "t22", "t23", "t24"].includes(x)) && new Set(st).size === 5, "after the queue, Stoppage picks at random and skips songs already played");

  // Next button on Now Playing
  logA.length = 0;
  await A.click('#now [data-act2="next"]'); await A.waitForTimeout(100);
  ok(plays(logA).length === 1, "Next plays another song from the same button");

  // Fade out
  logA.length = 0;
  await A.evaluate(() => { const b = window.__sb.board; });
  await A.click('.tab[data-view="settings"]'); await A.locator("#fadeLen").fill("1"); await A.click('.tab[data-view="game"]');
  await A.click('#now [data-act2="fade"]');
  await A.waitForFunction(() => document.querySelector("#now").classList.contains("idle"), null, {timeout: 5000});
  const vols = logA.filter(x => "vol" in x).map(x => x.vol);
  ok(vols.slice(0, 6).every((v, i) => i === 0 || v < vols[i - 1]) && logA.some(x => x.pause) && vols[vols.length - 1] === 80, "Fade lowers the volume, pauses, then puts the volume back");

  // Use the spot playing now
  await A.click('.tab[data-view="songs"]'); await A.click('[data-filter="all"]'); await A.click('[data-edit="t40"]');
  await A.click("#edPlay0");
  ok(plays(logA).pop().pos === 0, "Preview from the beginning starts at 0:00");
  await A.click("#edHere"); await A.waitForTimeout(150);
  ok((await A.evaluate(() => window.__sb.board.songs.find(s => s.id === "t40").start)) === 75000, "Use the spot playing now sets 1:15");
  await A.click(".sheet .btn.red[data-close]");
  ok((await A.evaluate(() => window.__sb.board.game.played.includes("t40"))) === false, "previews don't count as played");

  // Local file: plays from its playlist position, at its start time, and stops when it ends
  const LOCAL = "spotify:local:Rink+Band::Rangers+Anthem:3";
  const lsong = await A.evaluate(L => { const s = window.__sb.board.songs.find(x => x.id === L); return s && {local: s.local, idx: s.idx, pl: s.pl, name: s.name, artist: s.artist, dur: s.dur}; }, LOCAL);
  ok(lsong && lsong.local && lsong.idx === 55 && lsong.pl === "p1" && lsong.artist === "Rink Band" && lsong.dur === 3000, "local song saved with its playlist and position");
  ok((await A.textContent(`[data-edit="${LOCAL}"]`)).includes("local file"), "song list marks it as a local file");
  await A.evaluate(L => { const s = window.__sb.board.songs.find(x => x.id === L); s.cats = ["goal"]; s.start = 500; window.__sb.board.songs.forEach(o => { if (o !== s) o.cats = o.cats.filter(c => c !== "goal"); }); window.__sb.changed(); }, LOCAL);
  await A.click('.tab[data-view="game"]');
  logA.length = 0;
  await A.click('[data-press="goal"]'); await A.waitForTimeout(150);
  let lp = plays(logA).pop();
  ok(lp && lp.ctx === "spotify:playlist:p1" && lp.off === 55 && lp.pos === 500 && lp.play === LOCAL, "Goal plays the local song from its playlist position at its start time");
  await A.waitForTimeout(4800);
  ok(logA.some(x => x.pause) && (await A.locator("#now").getAttribute("class")).includes("idle"), "when the local song ends, the app stops Spotify before the next playlist song carries on");
  // Playlist rearranged: the saved position is wrong, so the app finds the song again
  await A.evaluate(L => { window.__sb.board.songs.find(x => x.id === L).idx = 3; window.__sb.changed(); }, LOCAL);
  logA.length = 0;
  await A.click('[data-press="goal"]'); await A.waitForTimeout(250);
  lp = plays(logA).pop();
  ok(lp && lp.off === 55 && (await A.evaluate(L => window.__sb.board.songs.find(x => x.id === L).idx, LOCAL)) === 55, "if the playlist was rearranged, it finds the local song's new position");
  await A.click('#now [data-act2="stop"]');
  await A.evaluate(L => { const b = window.__sb.board; b.songs.find(x => x.id === L).cats = []; b.songs[0].cats.push("goal"); window.__sb.changed(); }, LOCAL);

  // Sync between two devices
  await A.click('.tab[data-view="settings"]');
  await A.click('[data-act="synccreate"]');
  await A.waitForFunction(() => window.__sb.sync.state === "on");
  const code = await A.evaluate(() => window.__sb.sync.code);
  ok(/^kjr-[a-z0-9]{6}$/.test(code), "sync code created: " + code);
  const logB = [], B = await phone(browser, logB);
  await B.click('.tab[data-view="settings"]');
  await B.fill("#joinCode", code); await B.click('[data-act="syncjoin"]');
  await B.waitForFunction(() => window.__sb.board.songs.length === 56);
  ok(true, "second phone joins and gets all 56 songs");
  await A.evaluate(() => { window.__sb.board.songs[2].start = 99000; window.__sb.changed(); });
  await B.waitForFunction(() => window.__sb.board.songs[2].start === 99000, null, {timeout: 4000});
  ok(true, "a start-time change on phone A shows up on phone B");
  await B.fill("#joinCode", "").catch(() => {});

  // Reload keeps everything
  await A.reload();
  ok((await A.evaluate(() => window.__sb.board.songs.length)) === 56 && (await A.textContent('[data-press="goal"] small')).includes("Song 0"), "after reload, songs and buttons are still there");

  await A.click('.tab[data-view="game"]');
  await A.evaluate(() => window.scrollTo(0, 0));
  await A.screenshot({path: "test/shot-game.png"});
  await A.click('.tab[data-view="songs"]'); await A.screenshot({path: "test/shot-songs.png"});
  await A.click('.tab[data-view="queue"]'); await A.screenshot({path: "test/shot-queue.png"});
  await A.click('.tab[data-view="songs"]'); await A.click('[data-edit="t0"]'); await A.waitForTimeout(300); await A.screenshot({path: "test/shot-editor.png"});

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
