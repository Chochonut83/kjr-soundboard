/* KJR Game Day Soundboard
   Plays songs from your Spotify playlists, each from its own start time, with one
   button per game moment. Settings save on the device and sync through Firebase. */
(() => {
"use strict";

// ---------- small helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS = "kjr-sb-";
const store = {
  get(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(LS + k); } catch (e) {} }
};
const fmt = ms => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const parseTime = t => {
  t = String(t || "").trim(); if (!t) return 0;
  const m = t.match(/^(\d+):(\d{1,2})$/); if (m) return (+m[1] * 60 + +m[2]) * 1000;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(+t * 1000);
  return null;
};
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const CATS = [
  {k: "goal", label: "Goal", one: true},
  {k: "penalty", label: "Penalty"},
  {k: "skate", label: "Skate-out"},
  {k: "inter", label: "Intermission"},
  {k: "stop", label: "Stoppage"}
];
const CAT = Object.fromEntries(CATS.map(c => [c.k, c]));
// Line icons for the game buttons and the speaker pill (24×24, drawn with the text colour).
const ICONS = {
  goal: '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14v-3H5z"/><path d="M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4M2 12h2M20 12h2"/>',
  penalty: '<circle cx="12" cy="14" r="7"/><path d="M12 10v4l2.5 2M10 2h4M12 2v3"/>',
  skate: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  inter: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2v3M12 2v3"/>',
  stop: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'
};
const icon = k => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
// Which game button the song playing now came from (it shows ON AIR). Queue songs come from Stoppage.
const liveKey = () => now && now.src !== "preview" ? (now.src === "queue" ? "stop" : now.src) : "";
const SRC_LABEL = {goal: "Goal", penalty: "Penalty", skate: "Skate-out", inter: "Intermission", stop: "Stoppage", queue: "Game queue", preview: "Preview"};

// ---------- saved state ----------
const newGame = () => ({id: rid(8), at: Date.now(), played: [], queue: [], qpos: 0, last: {}});
let board = store.get("board", null) || {songs: [], game: newGame(), playlists: [], updatedAt: 0};
if (!board.game) board.game = newGame();
if (!board.playlists) board.playlists = [];
let settings = Object.assign({fade: 3, device: null}, store.get("settings", {}));
const deviceKey = store.get("deviceKey", null) || (() => { const k = rid(10); store.set("deviceKey", k); return k; })();
let view = "game", songFilter = "all", now = null, busy = false;

function saveLocal() { store.set("board", board); }
function changed(opts) {
  board.updatedAt = Date.now();
  saveLocal();
  sync.push();
  if (!opts || opts.render !== false) render();
}
function saveSettings() { store.set("settings", settings); }
const songById = id => board.songs.find(s => s.id === id);
const songsIn = k => board.songs.filter(s => (s.cats || []).includes(k));

// ---------- toast and sheets ----------
let toastTimer;
function toast(msg, kind) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast show " + (kind || "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = "toast", kind === "err" ? 6000 : 3000);
}
function sheet(html, onOpen) {
  closeSheet();
  const w = document.createElement("div"); w.className = "sheet-wrap"; w.id = "sheet";
  w.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  w.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.body.appendChild(w);
  requestAnimationFrame(() => w.classList.add("open"));
  if (onOpen) onOpen(w);
  return w;
}
function closeSheet() { const s = $("#sheet"); if (s) s.remove(); }
function confirmSheet(title, body, okLabel, ok) {
  sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
    <div class="row gap"><button class="btn ghost grow" data-close>Cancel</button><button class="btn red grow" id="okBtn">${esc(okLabel)}</button></div>`,
    w => w.querySelector("#okBtn").onclick = () => { closeSheet(); ok(); });
}

// ---------- Spotify sign-in (Authorization Code with PKCE) ----------
const SCOPES = "playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state user-read-currently-playing";
const clientId = () => ((window.SB_CONFIG || {}).SPOTIFY_CLIENT_ID || store.get("clientId", "") || "").trim();
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");
let auth = store.get("auth", null); // {access, refresh, exp}
let me = store.get("me", null);

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function login() {
  if (!clientId()) { view = "settings"; render(); toast("Add your Spotify Client ID first.", "err"); return; }
  const verifier = rid(64), state = rid(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  store.set("pkce", {verifier, state});
  const q = new URLSearchParams({response_type: "code", client_id: clientId(), scope: SCOPES, code_challenge_method: "S256", code_challenge: challenge, redirect_uri: redirectUri(), state});
  location.href = "https://accounts.spotify.com/authorize?" + q;
}
async function tokenRequest(params) {
  const r = await fetch("https://accounts.spotify.com/api/token", {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams(params)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || ("Sign-in failed (" + r.status + ")")); e.code = j.error; throw e; }
  return j;
}
function keepTokens(j) {
  auth = {access: j.access_token, refresh: j.refresh_token || (auth && auth.refresh), exp: Date.now() + (j.expires_in || 3600) * 1000};
  store.set("auth", auth);
}
async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return;
  history.replaceState(null, "", redirectUri());
  if (q.get("error")) { toast(q.get("error") === "access_denied" ? "Spotify sign-in was cancelled." : "Spotify sign-in error: " + q.get("error"), "err"); return; }
  const p = store.get("pkce", null); store.del("pkce");
  if (!p || p.state !== q.get("state")) { toast("Sign-in finished in a different window. Tap Connect Spotify again from here.", "err"); return; }
  try {
    keepTokens(await tokenRequest({grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), client_id: clientId(), code_verifier: p.verifier}));
    await loadMe();
    toast("Connected to Spotify" + (me ? " as " + me.display_name : "") + ".", "ok");
  } catch (e) { toast("Couldn't finish Spotify sign-in: " + e.message, "err"); }
}
let refreshing = null;
async function accessToken(force) {
  if (!auth) throw Object.assign(new Error("Not connected to Spotify."), {status: 0, reason: "NO_AUTH"});
  if (!force && auth.exp - 60000 > Date.now()) return auth.access;
  if (!refreshing) refreshing = tokenRequest({grant_type: "refresh_token", refresh_token: auth.refresh, client_id: clientId()})
    .then(keepTokens)
    .catch(e => { if (e.code === "invalid_grant") { auth = null; store.del("auth"); render(); } throw e; })
    .finally(() => refreshing = null);
  await refreshing;
  return auth.access;
}
function logout() { auth = null; me = null; store.del("auth"); store.del("me"); render(); }

async function sp(method, path, body, query, retried) {
  const url = "https://api.spotify.com/v1" + path + (query ? "?" + new URLSearchParams(query) : "");
  const r = await fetch(url, {method, headers: Object.assign({Authorization: "Bearer " + await accessToken()}, body ? {"Content-Type": "application/json"} : {}), body: body ? JSON.stringify(body) : undefined});
  if (r.status === 401 && !retried) { await accessToken(true); return sp(method, path, body, query, true); }
  if (r.status === 429 && !retried) { await sleep(Math.min(5, +(r.headers.get("Retry-After") || 1)) * 1000); return sp(method, path, body, query, true); }
  if (r.status === 204 || r.status === 202) return null;
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) {
    const er = (j && j.error) || {};
    const e = new Error(er.message || ("Spotify error " + r.status)); e.status = r.status; e.reason = er.reason || ""; throw e;
  }
  return j;
}
async function loadMe() { try { me = await sp("GET", "/me"); store.set("me", {id: me.id, display_name: me.display_name}); } catch (e) { if (e.status === 403) throw new Error("This Spotify account isn't on the app's user list. Add it under User Management in the Spotify Developer Dashboard."); throw e; } }
function spotifyError(e) {
  if (e.reason === "PREMIUM_REQUIRED" || /premium/i.test(e.message)) return "Spotify Premium is needed to play songs from the app.";
  if (e.reason === "NO_ACTIVE_DEVICE" || e.status === 404) return "Spotify isn't open on the speaker device. Open Spotify there, then try again.";
  if (e.reason === "NO_AUTH") return "Connect Spotify first (Settings).";
  if (e.status === 403) return "Spotify refused: " + e.message;
  if (e instanceof TypeError) return "No internet connection to Spotify.";
  return e.message;
}

// ---------- devices and playback ----------
async function getDevices() { const j = await sp("GET", "/me/player/devices"); return (j && j.devices) || []; }
function chooseDevice(after) {
  sheet(`<h3>Play music on</h3><p class="muted">Open Spotify on the phone, tablet or speaker that's connected to the rink sound. It shows up here.</p><div id="devList" class="list"><div class="muted pad">Looking for devices…</div></div>
    <button class="btn ghost full" id="devRefresh">Look again</button>`, async w => {
    const load = async () => {
      const box = w.querySelector("#devList"); box.innerHTML = `<div class="muted pad">Looking for devices…</div>`;
      try {
        const ds = await getDevices();
        if (!ds.length) { box.innerHTML = `<div class="empty">No devices found. Open the Spotify app on the device you want to play from (play any song for a second if it still doesn't show), then tap <b>Look again</b>.</div>`; return; }
        box.innerHTML = ds.map((d, i) => `<button class="item dev" data-i="${i}"><span class="dev-ico">${d.type === "Smartphone" ? "📱" : d.type === "Computer" ? "💻" : "🔊"}</span><span class="grow"><b>${esc(d.name)}</b><small>${esc(d.type)}${d.is_active ? " · playing now" : ""}${settings.device && settings.device.id === d.id ? " · chosen" : ""}</small></span></button>`).join("");
        box.querySelectorAll(".dev").forEach(b => b.onclick = () => {
          const d = ds[+b.dataset.i]; settings.device = {id: d.id, name: d.name}; saveSettings(); closeSheet(); render();
          toast("Music will play on " + d.name + ".", "ok"); if (after) after();
        });
      } catch (e) { box.innerHTML = `<div class="empty">${esc(spotifyError(e))}</div>`; }
    };
    w.querySelector("#devRefresh").onclick = load; load();
  });
}

let fadeRun = null; // {devId, vol, cancelled}
// Ends a fade early and puts the volume back. Pass pauseFirst when the music is stopping,
// so the song doesn't jump back to full volume for a moment before it stops.
async function stopFade(pauseFirst) {
  if (!fadeRun) return;
  const f = fadeRun; fadeRun = null; f.cancelled = true;
  if (pauseFirst) { try { await pauseNow(f.devId); } catch (e) {} }
  if (f.devId && f.vol != null) { try { await sp("PUT", "/me/player/volume", null, {volume_percent: f.vol, device_id: f.devId}); } catch (e) {} }
}
const pauseNow = devId => sp("PUT", "/me/player/pause", null, devId ? {device_id: devId} : settings.device ? {device_id: settings.device.id} : null);

async function playSong(song, src, opts) {
  if (!song) return false;
  if (!auth) { toast("Connect Spotify first.", "err"); return false; }
  if (!settings.device) { chooseDevice(() => playSong(song, src, opts)); return false; }
  await stopFade();
  const position_ms = (opts && opts.fromStart) ? 0 : (song.start || 0);
  let body = {uris: [song.uri], position_ms};
  const go = () => sp("PUT", "/me/player/play", body, {device_id: settings.device.id});
  try {
    if (song.local) {
      // Spotify only plays a local file from inside its playlist, by its position there.
      const idx = await findLocal(song);
      if (idx == null) { toast(`"${song.name}" isn't in its playlist anymore. Add it back in Spotify, then import the playlist again.`, "err"); return false; }
      body = {context_uri: "spotify:playlist:" + song.pl, offset: {position: idx}, position_ms};
    }
    try { await go(); }
    catch (e) {
      if (e.status !== 404 && e.reason !== "NO_ACTIVE_DEVICE") throw e;
      // The chosen device went to sleep or changed: find it again, or ask.
      const ds = await getDevices();
      const same = ds.find(d => d.id === settings.device.id) || ds.find(d => d.name === settings.device.name);
      if (same) { settings.device = {id: same.id, name: same.name}; saveSettings(); await go(); }
      else { chooseDevice(() => playSong(song, src, opts)); return false; }
    }
  } catch (e) { toast(spotifyError(e), "err"); return false; }
  now = {id: song.id, src, at: Date.now(), from: body.position_ms};
  if (src !== "preview") store.set("now", now);
  renderNow();
  ensureStart(song, now);
  if (song.local) watchLocal(song, now);
  return true;
}

// Many Spotify devices (phones especially, and any device that was asleep) ignore the start
// position in the play request and begin at 0:00. So once the song is really playing, the app
// checks where it is and jumps it to the start time if it began from the top.
async function ensureStart(song, started) {
  const want = started.from || 0;
  if (want < 1500) return;
  const mine = it => it && (it.uri === song.uri || (!song.local && it.id === song.id));
  let seeks = 0;
  for (let n = 0; n < 10; n++) {
    await sleep(n < 4 ? 350 : 600);
    if (now !== started) return; // another song or Stop was pressed
    let st;
    try { st = await sp("GET", "/me/player/currently-playing"); } catch (e) { continue; }
    if (now !== started) return;
    if (!st || !mine(st.item || st.track)) continue; // the song hasn't started on the device yet
    if ((st.progress_ms || 0) >= want - 2500) return; // it started at the right spot
    if (seeks >= 2) return;
    seeks++;
    try { await sp("PUT", "/me/player/seek", null, {position_ms: want, device_id: settings.device.id}); } catch (e) { return; }
    await sleep(500);
  }
}

// Where a local song sits in its playlist right now. Checks the saved spot first (one quick request),
// and looks through the playlist only if the playlist was rearranged.
async function findLocal(song) {
  const at = j => { const it = j && j.items && j.items[0]; const t = it && (it.item || it.track); return t && t.uri; };
  if (song.idx != null) {
    const j = await sp("GET", `/playlists/${song.pl}/items`, null, {limit: 1, offset: song.idx});
    if (at(j) === song.uri) return song.idx;
  }
  const q = {limit: 50, offset: 0};
  for (let n = 0; n < 40; n++) {
    const j = await sp("GET", `/playlists/${song.pl}/items`, null, q);
    const k = ((j && j.items) || []).findIndex(it => { const t = it && (it.item || it.track); return t && t.uri === song.uri; });
    if (k >= 0) { song.idx = q.offset + k; changed({render: false}); return song.idx; }
    if (!j || !j.next) break; q.offset += 50;
  }
  return null;
}

// A local song plays inside its playlist, so Spotify would carry on into the next playlist song.
// The app stops it when the local song ends, and warns if Spotify couldn't play the file at all.
let localWatch = 0;
function watchLocal(song, started) {
  const id = ++localWatch;
  const stillOurs = () => id === localWatch && now === started;
  const playingUri = async () => { const st = await sp("GET", "/me/player/currently-playing"); return st && st.is_playing !== false ? ((st.item || st.track || {}).uri || "") : null; };
  setTimeout(async () => {
    if (!stillOurs()) return;
    try { const u = await playingUri(); if (u != null && u !== song.uri && stillOurs()) toast(`Spotify skipped "${song.name}". The local file isn't on ${settings.device ? settings.device.name : "that device"}: see the setup guide.`, "err"); } catch (e) {}
  }, 2500);
  const left = Math.max(1000, (song.dur || 0) - (started.from || 0));
  setTimeout(async () => {
    if (!stillOurs()) return;
    try {
      const u = await playingUri();
      if (u && u !== song.uri && stillOurs()) {
        await sp("PUT", "/me/player/pause", null, {device_id: settings.device.id});
        now = null; store.del("now"); renderNow();
      }
    } catch (e) {}
  }, left + 1500);
}

async function stopMusic() {
  // Hide the Stop button straight away so it feels instant; Spotify gets the pause right after.
  now = null; store.del("now"); renderNow();
  if (fadeRun) return stopFade(true);
  try { await pauseNow(); }
  catch (e) { if (e.status !== 403 && e.status !== 404) toast(spotifyError(e), "err"); }
}

// While a song is on, checks every few seconds whether Spotify is still playing, so the
// Now Playing bar and the big Stop button go away when the song ends or is paused in Spotify.
let nowTimer = null;
function watchPlayback() {
  clearTimeout(nowTimer);
  if (!now || !auth) return;
  nowTimer = setTimeout(async () => {
    const started = now;
    if (!started) return;
    if (document.visibilityState === "visible" && Date.now() - started.at > 4000 && !fadeRun) {
      try {
        const st = await sp("GET", "/me/player/currently-playing");
        if (now === started && (!st || st.is_playing === false)) { now = null; store.del("now"); renderNow(); return; }
      } catch (e) {}
    }
    if (now) watchPlayback();
  }, 5000);
}

async function fadeOut() {
  if (fadeRun) return;
  let st;
  try { st = await sp("GET", "/me/player"); } catch (e) { toast(spotifyError(e), "err"); return; }
  if (!st || !st.is_playing) { now = null; store.del("now"); renderNow(); return; }
  const d = st.device || {};
  if (!d.supports_volume || d.volume_percent == null) { toast("This device can't fade from the app, so the song stopped.", ""); return stopMusic(); }
  const run = {devId: d.id, vol: d.volume_percent}; fadeRun = run; renderNow();
  const steps = 6, total = Math.max(1, settings.fade || 3) * 1000;
  try {
    // If Stop (or a new song) interrupts the fade while a volume change is on its way,
    // put the volume back again so the next song isn't quiet.
    const restoreIfCancelled = async () => { if (run.cancelled) { try { await sp("PUT", "/me/player/volume", null, {volume_percent: run.vol, device_id: d.id}); } catch (e) {} return true; } return false; };
    for (let i = 1; i <= steps; i++) {
      if (run.cancelled) return;
      await sp("PUT", "/me/player/volume", null, {volume_percent: Math.round(run.vol * (1 - i / steps)), device_id: d.id});
      if (await restoreIfCancelled()) return;
      await sleep(total / steps);
    }
    if (run.cancelled) return;
    await sp("PUT", "/me/player/pause", null, {device_id: d.id});
    await sp("PUT", "/me/player/volume", null, {volume_percent: run.vol, device_id: d.id});
  } catch (e) { toast(spotifyError(e), "err"); }
  if (fadeRun === run) fadeRun = null;
  now = null; store.del("now"); renderNow();
}

// ---------- what each button plays ----------
// Intermission and Stoppage never repeat a song in the same game. Penalty avoids the last one played.
function freshPick(k) {
  const list = songsIn(k); if (!list.length) return {song: null};
  const g = board.game;
  const left = list.filter(s => !g.played.includes(s.id));
  if (left.length) return {song: pick(left)};
  const notLast = list.length > 1 ? list.filter(s => s.id !== g.last[k]) : list;
  return {song: pick(notLast), recycled: true};
}
function stoppageInfo() {
  const g = board.game, q = g.queue.filter(songById);
  if (g.qpos < g.queue.length && q.length) return {mode: "queue", text: `Queue · ${Math.min(g.qpos + 1, g.queue.length)} of ${g.queue.length}`};
  const n = songsIn("stop").filter(s => !board.game.played.includes(s.id)).length;
  if (!songsIn("stop").length) return {mode: "none", text: "No songs yet"};
  return {mode: "random", text: g.queue.length ? `Queue done · random · ${n} left` : `Random · ${n} left`};
}
async function press(k) {
  if (busy) return; busy = true; setBusy(k);
  try {
    const g = board.game;
    let song = null, src = k, note = "";
    if (k === "goal") {
      song = songsIn("goal")[0];
      if (!song) return emptyCat(k);
    } else if (k === "penalty") {
      const list = songsIn("penalty"); if (!list.length) return emptyCat(k);
      const opts = list.length > 1 ? list.filter(s => s.id !== g.last.penalty) : list;
      song = pick(opts);
    } else if (k === "skate") {
      return skateSheet();
    } else if (k === "inter") {
      const r = freshPick("inter"); if (!r.song) return emptyCat(k);
      song = r.song; if (r.recycled) note = "Every intermission song has played this game, so one is repeating.";
    } else if (k === "stop") {
      while (g.qpos < g.queue.length && !songById(g.queue[g.qpos])) g.qpos++; // skip songs that were removed
      if (g.qpos < g.queue.length) {
        song = songById(g.queue[g.qpos]); src = "queue";
        if (await playSong(song, src)) { g.qpos++; markPlayed(song, "stop"); if (g.qpos >= g.queue.length) note = "That was the last song in the queue. Stoppage picks at random now."; changed(); }
        if (note) toast(note);
        return;
      }
      const r = freshPick("stop"); if (!r.song) return emptyCat(k);
      song = r.song; if (r.recycled) note = "Every stoppage song has played this game, so one is repeating.";
    }
    if (await playSong(song, src)) {
      markPlayed(song, k); changed();
      if (note) toast(note);
    }
  } finally { busy = false; setBusy(null); }
}
function markPlayed(song, k) {
  const g = board.game;
  if ((k === "inter" || k === "stop") && !g.played.includes(song.id)) g.played.push(song.id);
  g.last[k] = song.id;
}
function emptyCat(k) {
  toast(`No ${CAT[k].label.toLowerCase()} songs yet. Add some in Songs.`, "err");
  songFilter = k; view = "songs"; render();
}
function skateSheet() {
  const list = songsIn("skate");
  if (!list.length) return emptyCat("skate");
  sheet(`<h3>Skate-out song</h3><div class="list">${list.map(s => `<button class="item" data-id="${esc(s.id)}">${art(s)}<span class="grow"><b>${esc(s.name)}</b><small>${esc(s.artist)} · from ${fmt(s.start)}</small></span><span class="play-ico">▶</span></button>`).join("")}</div>`,
    w => w.querySelectorAll("[data-id]").forEach(b => b.onclick = async () => { closeSheet(); const s = songById(b.dataset.id); if (await playSong(s, "skate")) { markPlayed(s, "skate"); changed(); } }));
}
function newGameFlow() {
  confirmSheet("Start a new game?", "This clears the list of songs already played and empties the game queue, so every song is available again.", "New game", () => {
    board.game = newGame(); changed(); toast("New game. Every song is ready to play.", "ok");
  });
}

// ---------- playlists ----------
async function importSheet() {
  if (!auth) { toast("Connect Spotify first.", "err"); return; }
  sheet(`<h3>Import a playlist</h3><p class="muted">Pick one of your Spotify playlists. Songs you've already set up keep their buttons and start times.</p><div id="plList" class="list"><div class="muted pad">Loading your playlists…</div></div>`, async w => {
    const box = w.querySelector("#plList");
    try {
      let lists = [], url = "/me/playlists", q = {limit: 50, offset: 0};
      for (let n = 0; n < 10; n++) {
        const j = await sp("GET", url, null, q); lists = lists.concat((j && j.items) || []);
        if (!j || !j.next) break; q.offset += 50;
      }
      lists = lists.filter(Boolean);
      if (!lists.length) { box.innerHTML = `<div class="empty">No playlists found on this Spotify account.</div>`; return; }
      box.innerHTML = lists.map((p, i) => {
        const total = (p.items && p.items.total) != null ? p.items.total : (p.tracks && p.tracks.total);
        const mine = !me || !p.owner || p.owner.id === me.id || p.collaborative;
        const img = p.images && p.images.length ? p.images[p.images.length - 1].url : "";
        return `<button class="item" data-i="${i}" ${mine ? "" : "disabled"}>${img ? `<img class="art" src="${esc(img)}" alt="">` : `<span class="art blank">♪</span>`}<span class="grow"><b>${esc(p.name)}</b><small>${total != null ? total + " songs" : ""}${mine ? "" : " · made by someone else, Spotify won't share its songs"}</small></span></button>`;
      }).join("");
      box.querySelectorAll("[data-i]").forEach(b => b.onclick = () => importPlaylist(lists[+b.dataset.i]));
    } catch (e) { box.innerHTML = `<div class="empty">${esc(spotifyError(e))}</div>`; }
  });
}
async function importPlaylist(p) {
  closeSheet(); toast("Importing " + p.name + "…");
  try {
    let items = [], q = {limit: 50, offset: 0};
    for (let n = 0; n < 40; n++) {
      const j = await sp("GET", `/playlists/${p.id}/items`, null, q);
      items = items.concat((j && j.items) || []);
      if (!j || !j.next) break; q.offset += 50;
    }
    let added = 0, have = 0, skipped = 0, locals = 0, badLocal = 0;
    items.forEach((it, i) => {
      const t = it && (it.item || it.track);
      // Spotify marks local files on the playlist entry (is_local) and sometimes on the song too.
      const local = !!((it && it.is_local) || (t && (t.is_local || /^spotify:local:/.test(t.uri || ""))));
      if (local && (!t || !t.uri)) { badLocal++; skipped++; return; }
      if (!t || (!local && (t.type !== "track" || !t.id))) { skipped++; return; }
      const id = local ? t.uri : t.id;
      const old = songById(id);
      // Local files can only be played from their playlist, by position, so remember where they are.
      if (local && old) { if (!old.pl || old.pl === p.id) { old.pl = p.id; old.idx = i; } }
      if (old) { have++; return; }
      const imgs = (t.album && t.album.images) || [];
      const dur = t.duration_ms || (local ? (+String(t.uri).split(":").pop() || 0) * 1000 : 0);
      const artist = (t.artists || []).map(a => a && a.name).filter(Boolean).join(", ") || (local ? decodeLocal(t.uri, 2) : "");
      const s = {id, uri: t.uri, name: t.name || (local ? decodeLocal(t.uri, 4) : "Untitled"), artist, img: imgs.length ? imgs[imgs.length - 1].url : "", dur, start: 0, cats: []};
      if (local) { s.local = true; s.pl = p.id; s.idx = i; locals++; }
      board.songs.push(s); added++;
    });
    if (!board.playlists.find(x => x.id === p.id)) board.playlists.push({id: p.id, name: p.name});
    songFilter = added ? "unsorted" : songFilter; view = "songs"; changed();
    toast(`${p.name}: ${added} new song${added === 1 ? "" : "s"}${locals ? ` (${locals} local)` : ""}${have ? `, ${have} already here` : ""}${skipped - badLocal ? `, ${skipped - badLocal} skipped (podcasts or missing songs)` : ""}${badLocal ? `. Spotify didn't send the details of ${badLocal} local file${badLocal === 1 ? "" : "s"}, so ${badLocal === 1 ? "it" : "they"} couldn't be added` : ""}.`, badLocal ? "err" : "ok");
  } catch (e) { toast(spotifyError(e), "err"); }
}

// Local file URIs look like spotify:local:Artist:Album:Title:Seconds, with + for spaces.
function decodeLocal(uri, part) { try { return decodeURIComponent((String(uri).split(":")[part] || "").replace(/\+/g, " ")); } catch (e) { return ""; } }

// ---------- song editor ----------
function art(s) { return s.img ? `<img class="art" src="${esc(s.img)}" alt="" loading="lazy">` : `<span class="art blank">♪</span>`; }
function editSong(id) {
  const s = songById(id); if (!s) return;
  const w = sheet(`<div class="ed-head">${art(s)}<div class="grow"><b>${esc(s.name)}</b><small>${esc(s.artist)} · ${fmt(s.dur)}${s.local ? " · local file" : ""}</small></div></div>${s.local ? `<p class="tiny muted">Local file: Spotify plays it from your playlist, so the file must be on the speaker device's Spotify too.</p>` : ""}
    <label class="lbl">Buttons</label>
    <div class="chips" id="edCats">${CATS.map(c => `<button class="chip ${s.cats.includes(c.k) ? "on" : ""} c-${c.k}" data-k="${c.k}">${c.label}</button>`).join("")}</div>
    <p class="tiny muted">Goal has one song. Choosing Goal here replaces the current goal song.</p>
    <label class="lbl" for="edStart">Start at</label>
    <div class="row gap center">
      <button class="btn ghost sm" data-nudge="-5000">−5s</button><button class="btn ghost sm" data-nudge="-1000">−1s</button>
      <input id="edStart" class="time" inputmode="numeric" value="${fmt(s.start)}" aria-label="Start time, minutes and seconds">
      <button class="btn ghost sm" data-nudge="1000">+1s</button><button class="btn ghost sm" data-nudge="5000">+5s</button>
    </div>
    <div class="row gap wrap">
      <button class="btn blue grow" id="edPlay">▶ Play from ${fmt(s.start)}</button>
      <button class="btn ghost grow" id="edPlay0">▶ From the beginning</button>
    </div>
    <button class="btn ghost full" id="edHere">📍 Use the spot playing now</button>
    <p class="tiny muted">Tip: play it from the beginning, pause Spotify at the moment you want, then tap "Use the spot playing now".</p>
    <div class="row gap"><button class="btn ghost danger" id="edDel">Remove song</button><button class="btn red grow" data-close>Done</button></div>`);
  const input = w.querySelector("#edStart");
  const setStart = ms => {
    ms = Math.max(0, Math.min(ms, Math.max(0, (s.dur || 1e9) - 1000)));
    s.start = ms; input.value = fmt(ms); w.querySelector("#edPlay").textContent = "▶ Play from " + fmt(ms); changed({render: false});
  };
  input.onchange = () => { const v = parseTime(input.value); if (v == null) { toast("Type the time as minutes:seconds, like 1:15.", "err"); input.value = fmt(s.start); } else setStart(v); };
  w.querySelectorAll("[data-nudge]").forEach(b => b.onclick = () => setStart((s.start || 0) + +b.dataset.nudge));
  w.querySelectorAll("#edCats .chip").forEach(b => b.onclick = () => {
    const k = b.dataset.k, on = !s.cats.includes(k);
    if (on && CAT[k].one) board.songs.forEach(o => { if (o !== s) o.cats = o.cats.filter(x => x !== k); });
    s.cats = on ? s.cats.concat(k) : s.cats.filter(x => x !== k);
    b.classList.toggle("on", on); changed({render: false});
  });
  w.querySelector("#edPlay").onclick = () => playSong(s, "preview");
  w.querySelector("#edPlay0").onclick = () => playSong(s, "preview", {fromStart: true});
  w.querySelector("#edHere").onclick = async () => {
    try {
      const st = await sp("GET", "/me/player/currently-playing");
      const item = st && (st.item || st.track);
      if (!item || (s.local ? item.uri !== s.uri : item.id !== s.id)) { toast("Play this song first, then pause it at the right moment.", "err"); return; }
      setStart(Math.round(st.progress_ms / 1000) * 1000); toast("Start time set to " + fmt(s.start) + ".", "ok");
    } catch (e) { toast(spotifyError(e), "err"); }
  };
  w.querySelector("#edDel").onclick = () => {
    board.songs = board.songs.filter(o => o !== s);
    board.game.queue = board.game.queue.filter(x => x !== s.id);
    closeSheet(); changed(); toast("Removed " + s.name + ".");
  };
  const obs = new MutationObserver(() => { if (!document.body.contains(w)) { obs.disconnect(); render(); } });
  obs.observe(document.body, {childList: true});
}

// ---------- queue ----------
function addToQueueSheet() {
  let f = songsIn("stop").length ? "stop" : "all";
  const draw = w => {
    const list = f === "all" ? board.songs : songsIn(f);
    w.querySelector("#qaF").innerHTML = [["stop", "Stoppage"], ["all", "All songs"], ["inter", "Intermission"]].map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("");
    w.querySelector("#qaList").innerHTML = list.length ? list.map(s => {
      const n = board.game.queue.filter(x => x === s.id).length;
      return `<button class="item" data-id="${esc(s.id)}">${art(s)}<span class="grow"><b>${esc(s.name)}</b><small>${esc(s.artist)} · from ${fmt(s.start)}</small></span><span class="qcount">${n ? "✓" + (n > 1 ? n : "") : "+"}</span></button>`;
    }).join("") : `<div class="empty">No songs here yet.</div>`;
    w.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { f = b.dataset.f; draw(w); });
    w.querySelectorAll("#qaList [data-id]").forEach(b => b.onclick = () => { board.game.queue.push(b.dataset.id); changed({render: false}); draw(w); });
  };
  const w = sheet(`<h3>Add to the game queue</h3><p class="muted">Tap songs in the order you want them. Each tap adds one to the end.</p><div class="chips" id="qaF"></div><div class="list" id="qaList"></div><button class="btn red full" data-close>Done</button>`, draw);
  const obs = new MutationObserver(() => { if (!document.body.contains(w)) { obs.disconnect(); render(); } });
  obs.observe(document.body, {childList: true});
}

// ---------- rendering ----------
function render() {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.view === view));
  const main = $("#main");
  main.innerHTML = view === "game" ? gameView() : view === "songs" ? songsView() : view === "queue" ? queueView() : settingsView();
  bind(main);
  renderNow();
  renderSync();
  wake(view === "game");
}
function connectBanner() {
  if (auth) return "";
  return `<div class="banner"><img class="hero" src="soundboard-art.jpg" alt="KJR Soundboard"><b>Connect Spotify to start.</b><span>You'll need Spotify Premium and the Spotify app open on the device that plays to the speakers.</span><button class="btn green" data-act="login">Connect Spotify</button></div>`;
}
function gameView() {
  const g = board.game, si = stoppageInfo();
  const n = k => songsIn(k).length;
  const sub = {
    goal: n("goal") ? esc(songsIn("goal")[0].name) : "No goal song yet",
    penalty: n("penalty") ? `Random · ${n("penalty")} songs` : "No songs yet",
    skate: n("skate") ? `Pick from ${n("skate")}` : "No songs yet",
    inter: n("inter") ? `Random · ${songsIn("inter").filter(s => !g.played.includes(s.id)).length} left` : "No songs yet",
    stop: si.text
  };
  const t = new Date(g.at), live = liveKey();
  const pad = (k, label, extra) => `<button class="pad-btn ${k}${extra ? " " + extra : ""}${live === k ? " live" : ""}" data-press="${k}"><span class="onair"><i></i>ON AIR</span>${icon(k)}<span class="txt"><span class="big">${label}</span><small>${sub[k]}</small></span></button>`;
  return `${connectBanner()}
    <div class="board">
      ${pad("goal", "GOAL!")}
      ${pad("penalty", "PENALTY")}
      ${pad("skate", "SKATE-OUT")}
      ${pad("inter", "INTERMISSION")}
      ${pad("stop", "STOPPAGE", si.mode === "queue" ? "queued" : "")}
    </div>
    <div class="game-foot">
      <span class="muted">Game started ${t.toLocaleDateString([], {month: "short", day: "numeric"})}, ${t.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})} · ${g.played.length} played</span>
      <button class="btn ghost" data-act="newgame">New game</button>
    </div>`;
}
function songsView() {
  const counts = {all: board.songs.length, unsorted: board.songs.filter(s => !s.cats.length).length};
  CATS.forEach(c => counts[c.k] = songsIn(c.k).length);
  const filters = [["all", "All"], ["unsorted", "Not on a button"], ...CATS.map(c => [c.k, c.label])];
  const list = songFilter === "all" ? board.songs : songFilter === "unsorted" ? board.songs.filter(s => !s.cats.length) : songsIn(songFilter);
  return `${connectBanner()}
    <div class="row between center"><h2>Songs</h2><button class="btn blue" data-act="import">+ Import playlist</button></div>
    ${board.playlists.length ? `<p class="tiny muted">Imported: ${board.playlists.map(p => esc(p.name)).join(", ")}</p>` : ""}
    <div class="chips scroll">${filters.map(([k, l]) => `<button class="chip ${songFilter === k ? "on" : ""} ${CAT[k] ? "c-" + k : ""}" data-filter="${k}">${l} <span class="cnt">${counts[k]}</span></button>`).join("")}</div>
    <div class="list">${list.length ? list.map(s => `<button class="item" data-edit="${esc(s.id)}">${art(s)}<span class="grow"><b>${esc(s.name)}</b><small>${esc(s.artist)}${s.local ? " · local file" : ""}</small><span class="tags">${s.cats.map(k => `<i class="tag c-${k}">${CAT[k].label}</i>`).join("")}</span></span><span class="start">${fmt(s.start)}</span></button>`).join("")
      : `<div class="empty">${board.songs.length ? "No songs in this list yet. Tap a song to choose its buttons." : "Import a Spotify playlist to get started. Then tap each song to put it on a button and set where it starts."}</div>`}</div>`;
}
function queueView() {
  const g = board.game;
  const rows = g.queue.map((id, i) => {
    const s = songById(id); if (!s) return "";
    const st = i < g.qpos ? "done" : i === g.qpos ? "next" : "";
    return `<div class="item q ${st}"><span class="qn">${i < g.qpos ? "✓" : i + 1}</span>${art(s)}<span class="grow"><b>${esc(s.name)}</b><small>${esc(s.artist)} · from ${fmt(s.start)}${st === "next" ? " · <b>next</b>" : ""}</small></span>
      ${st === "done" ? "" : `<span class="qbtns"><button class="mini" data-up="${i}" ${i <= g.qpos ? "disabled" : ""} aria-label="Move up">▲</button><button class="mini" data-down="${i}" ${i === g.queue.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button><button class="mini x" data-rm="${i}" aria-label="Remove">✕</button></span>`}</div>`;
  }).join("");
  return `<div class="row between center"><h2>Game queue</h2><button class="btn blue" data-act="qadd">+ Add songs</button></div>
    <p class="muted">When there's a queue, the Stoppage button plays it in this order. With no queue, or once it runs out, Stoppage picks at random. Intermission always picks at random.</p>
    <div class="list">${rows || `<div class="empty">No queue for this game. Tap <b>Add songs</b> to build one before puck drop.</div>`}</div>
    ${g.queue.length ? `<div class="row gap"><button class="btn ghost grow" data-act="qrestart">Restart from the top</button><button class="btn ghost danger grow" data-act="qclear">Clear queue</button></div>` : ""}`;
}
function settingsView() {
  const cid = clientId(), fromCfg = !!((window.SB_CONFIG || {}).SPOTIFY_CLIENT_ID);
  return `<h2>Settings</h2>
    <section class="card">
      <h4>Spotify</h4>
      ${auth ? `<p>Connected${me ? " as <b>" + esc(me.display_name || me.id) + "</b>" : ""}.</p><button class="btn ghost" data-act="logout">Disconnect</button>`
        : `<p class="muted">${cid ? "Ready to connect." : "First add your Spotify app's Client ID (setup guide, step 1)."}</p>`}
      ${fromCfg ? "" : `<label class="lbl" for="cid">Client ID</label><div class="row gap"><input id="cid" class="grow" value="${esc(cid)}" placeholder="32 letters and numbers" autocomplete="off" spellcheck="false"><button class="btn ghost" data-act="savecid">Save</button></div>`}
      <label class="lbl">Redirect URI for the Spotify dashboard</label>
      <div class="row gap"><code class="grow mono" id="ruri">${esc(redirectUri())}</code><button class="btn ghost sm" data-act="copyuri">Copy</button></div>
      ${!auth && cid ? `<button class="btn green full" data-act="login">Connect Spotify</button>` : ""}
    </section>
    <section class="card">
      <h4>Speaker</h4>
      <p>${settings.device ? "Music plays on <b>" + esc(settings.device.name) + "</b>." : "No device chosen yet."}</p>
      <button class="btn ghost" data-act="device" ${auth ? "" : "disabled"}>Choose device</button>
    </section>
    <section class="card">
      <h4>Fade out</h4>
      <div class="row gap center"><input type="range" min="1" max="8" step="1" id="fadeLen" value="${settings.fade}" class="grow"><b id="fadeVal">${settings.fade} s</b></div>
      <p class="tiny muted">iPhones don't let apps change Spotify's volume, so Fade just stops the song there.</p>
    </section>
    <section class="card">
      <h4>Sync between devices</h4>
      <p class="muted">Use the same sync code on your phone, tablet or laptop to share your songs, start times and the current game. Anyone with the code can change them.</p>
      ${sync.code ? `<p>Sync code: <b class="mono">${esc(sync.code)}</b></p><p class="tiny" id="syncState"></p><div class="row gap"><button class="btn ghost" data-act="copycode">Copy code</button><button class="btn ghost danger" data-act="syncoff">Stop syncing</button></div>`
        : `<div class="row gap"><button class="btn blue grow" data-act="synccreate">Create a sync code</button></div>
           <label class="lbl" for="joinCode">Or enter a code from your other device</label>
           <div class="row gap"><input id="joinCode" class="grow mono" placeholder="kjr-…" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn ghost" data-act="syncjoin">Join</button></div>`}
    </section>
    <section class="card">
      <h4>Back up</h4>
      <div class="row gap"><button class="btn ghost grow" data-act="export">Save a backup file</button><label class="btn ghost grow">Load a backup<input type="file" accept="application/json" id="importFile" hidden></label></div>
    </section>
    <div class="about"><img src="soundboard-art.jpg" alt="KJR Soundboard" loading="lazy"><p class="tiny muted">KJR Game Day Soundboard · v1.4</p></div>`;
}

function bind(root) {
  root.querySelectorAll("[data-press]").forEach(b => b.onclick = () => press(b.dataset.press));
  root.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editSong(b.dataset.edit));
  root.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { songFilter = b.dataset.filter; render(); });
  const q = board.game.queue;
  root.querySelectorAll("[data-up]").forEach(b => b.onclick = () => { const i = +b.dataset.up; [q[i - 1], q[i]] = [q[i], q[i - 1]]; changed(); });
  root.querySelectorAll("[data-down]").forEach(b => b.onclick = () => { const i = +b.dataset.down; [q[i + 1], q[i]] = [q[i], q[i + 1]]; changed(); });
  root.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const i = +b.dataset.rm; q.splice(i, 1); if (i < board.game.qpos) board.game.qpos--; changed(); });
  root.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act));
  const fl = root.querySelector("#fadeLen");
  if (fl) fl.oninput = () => { settings.fade = +fl.value; saveSettings(); root.querySelector("#fadeVal").textContent = fl.value + " s"; };
  const imp = root.querySelector("#importFile");
  if (imp) imp.onchange = () => loadBackup(imp.files[0]);
}

async function act(a) {
  switch (a) {
    case "login": return login();
    case "logout": return confirmSheet("Disconnect Spotify?", "Your songs and start times stay saved.", "Disconnect", logout);
    case "import": return importSheet();
    case "newgame": return newGameFlow();
    case "qadd": return addToQueueSheet();
    case "qclear": return confirmSheet("Clear the queue?", "Stoppage will pick at random.", "Clear", () => { board.game.queue = []; board.game.qpos = 0; changed(); });
    case "qrestart": board.game.qpos = 0; changed(); return toast("The queue starts from the top again.");
    case "device": return chooseDevice();
    case "savecid": {
      const v = $("#cid").value.trim();
      if (v && !/^[0-9a-f]{32}$/i.test(v)) return toast("A Client ID is 32 letters and numbers. Copy it from the Spotify dashboard.", "err");
      store.set("clientId", v); render(); return toast(v ? "Client ID saved." : "Client ID cleared.", "ok");
    }
    case "copyuri": return copy(redirectUri());
    case "copycode": return copy(sync.code);
    case "synccreate": return sync.start("kjr-" + rid(6), true);
    case "syncjoin": {
      const c = ($("#joinCode").value || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{6,40}$/.test(c)) return toast("Sync codes look like kjr-ab12cd.", "err");
      return sync.start(c, false);
    }
    case "syncoff": return confirmSheet("Stop syncing on this device?", "Your songs stay on this device. Other devices keep the code.", "Stop syncing", () => sync.stop());
    case "export": {
      const blob = new Blob([JSON.stringify({kind: "kjr-soundboard", v: 1, board}, null, 1)], {type: "application/json"});
      const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob); a2.download = "kjr-soundboard-backup.json"; a2.click();
      return;
    }
  }
}
async function loadBackup(file) {
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!j || j.kind !== "kjr-soundboard" || !j.board || !Array.isArray(j.board.songs)) throw new Error("bad");
    confirmSheet("Load this backup?", `It has ${j.board.songs.length} songs. It replaces the songs on this device${sync.code ? " and on synced devices" : ""}.`, "Load backup", () => {
      board = Object.assign({playlists: []}, j.board); if (!board.game) board.game = newGame(); changed(); toast("Backup loaded.", "ok");
    });
  } catch (e) { toast("That file isn't a soundboard backup.", "err"); }
}
async function copy(t) { try { await navigator.clipboard.writeText(t); toast("Copied.", "ok"); } catch (e) { toast(t); } }

function renderNow() {
  const bar = $("#now");
  const s = now && songById(now.id);
  // The big red Stop button floats over every tab and sheet while a song is on.
  document.body.classList.toggle("playing", !!s);
  bigStop().hidden = !s;
  watchPlayback();
  const live = s ? liveKey() : "";
  document.querySelectorAll("[data-press]").forEach(b => b.classList.toggle("live", b.dataset.press === live));
  if (!s) { bar.className = "now idle"; bar.innerHTML = `<span class="muted">Nothing playing</span>${settings.device ? `<button class="devpill" data-act2="device">${icon("speaker")}${esc(settings.device.name)}</button>` : auth ? `<button class="devpill warn" data-act2="device">Choose speaker</button>` : ""}`; }
  else {
    bar.className = "now";
    bar.innerHTML = `${art(s)}<div class="grow nowtxt"><b>${esc(s.name)}</b><small>${esc(SRC_LABEL[now.src] || "")} · from ${fmt(now.from)}</small></div>
      ${fadeRun ? "" : `<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`}
      <button class="nbtn" data-act2="fade" ${fadeRun ? "disabled" : ""}>${fadeRun ? "Fading…" : "Fade"}</button>
      ${["penalty", "inter", "stop", "queue", "skate"].includes(now.src) ? `<button class="nbtn" data-act2="next" title="Play a different song from the same button">Next</button>` : ""}`;
  }
  bar.querySelectorAll("[data-act2]").forEach(b => b.onclick = () => {
    const a = b.dataset.act2;
    if (a === "device") chooseDevice(); else if (a === "fade") fadeOut(); else if (a === "stop") stopMusic();
    else if (a === "next") press(now.src === "queue" ? "stop" : now.src);
  });
}
function setBusy(k) { document.querySelectorAll("[data-press]").forEach(b => b.classList.toggle("busy", b.dataset.press === k)); }

let wakeLock = null;
async function wake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && view === "game") wake(true); });

// ---------- Firebase sync ----------
const sync = {
  code: store.get("sync", ""), db: null, unsub: null, state: "off", timer: null, lastSent: 0,
  attach(db) { this.db = db; if (this.code) this.listen(); else this.setState("off"); },
  setState(s, msg) { this.state = s; this.msg = msg || ""; renderSync(); },
  async start(code, create) {
    if (!this.db || this.db.noConfig) return toast("Sync isn't available: the Firebase settings are missing.", "err");
    this.setState("connecting");
    try {
      await this.db.ready;
      const remote = await this.db.get("soundboards/" + code);
      if (create && remote) return toast("That code is taken. Try again.", "err");
      if (!create && !remote) { this.setState("off"); return toast("No soundboard uses that code. Check it on your other device.", "err"); }
      if (remote && remote.board) { board = remote.board; saveLocal(); }
      this.code = code; store.set("sync", code);
      if (!remote) await this.write();
      this.listen(); render();
      toast(create ? "Sync code created. Enter it on your other devices." : "Joined. Your songs are synced.", "ok");
    } catch (e) { this.fail(e); }
  },
  stop() { if (this.unsub) this.unsub(); this.unsub = null; this.code = ""; store.del("sync"); this.setState("off"); render(); },
  listen() {
    if (!this.db || this.db.noConfig || !this.code) return;
    if (this.unsub) this.unsub();
    this.setState("connecting");
    this.db.ready.then(() => {
      this.unsub = this.db.watchDoc("soundboards/" + this.code, (d, meta) => {
        if (d && d.board && d.by !== deviceKey && (d.board.updatedAt || 0) > (board.updatedAt || 0)) {
          board = d.board; saveLocal();
          if (!$("#sheet")) render(); else renderNow();
        }
        this.setState(meta && meta.fromCache ? "offline" : meta && meta.pending ? "saving" : "on");
      }, e => this.fail(e));
      if ((board.updatedAt || 0) > (store.get("syncedAt", 0))) this.push();
    }).catch(e => this.fail(e));
  },
  push() {
    if (!this.code || !this.db || this.db.noConfig) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.write().catch(e => this.fail(e)), 500);
  },
  async write() {
    await this.db.ready;
    await this.db.set("soundboards/" + this.code, {board, by: deviceKey, at: Date.now()});
    store.set("syncedAt", board.updatedAt || 0);
  },
  fail(e) {
    const denied = e && /permission/i.test(e.code + " " + e.message);
    this.setState("error", denied ? "Firebase refused. The soundboard rules need adding (setup guide, step 3)." : "Sync problem: " + (e && e.message));
  }
};
function renderSync() {
  const dot = $("#syncDot"); if (!dot) return;
  const labels = {off: "", connecting: "Connecting…", on: "Synced", saving: "Saving…", offline: "Offline · saved on this device", error: sync.msg};
  dot.className = "sync-dot " + (sync.code ? sync.state : "off"); dot.title = labels[sync.state] || "";
  const el = $("#syncState"); if (el) el.textContent = labels[sync.state] || "";
}
window.__sbDB = db => sync.attach(db);

// ---------- start ----------
document.querySelectorAll(".tab").forEach(t => t.onclick = () => { view = t.dataset.view; closeSheet(); render(); window.scrollTo(0, 0); });
function bigStop() {
  let b = $("#bigStop");
  if (!b) { b = document.createElement("button"); b.id = "bigStop"; b.className = "big-stop"; b.hidden = true; b.setAttribute("aria-label", "Stop the music"); b.innerHTML = `<span class="sq"></span>STOP`; document.body.appendChild(b); }
  if (!b.onclick) b.onclick = () => stopMusic();
  return b;
}
const savedNow = store.get("now", null);
if (savedNow && Date.now() - savedNow.at < 10 * 60000) now = savedNow;
render();
handleRedirect().then(() => { render(); if (auth && !me) loadMe().then(render).catch(() => {}); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.__sb = {get board() { return board; }, press, playSong, sync, changed}; // for testing
})();
