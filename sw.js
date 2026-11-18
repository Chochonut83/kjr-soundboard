// Lets the soundboard open with a weak signal at the rink. When you upload a new version,
// change the number below so phones pick it up.
const VERSION = "kjr-sb-3";
const CORE = ["./", "./index.html", "./app.js", "./config.js", "./firebase-glue.js", "./manifest.webmanifest", "./logo-240.png", "./soundboard-art.jpg", "./favicon.png", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // App files: network first so updates show up, saved copy when there's no signal.
    // "no-cache" asks GitHub whether the file changed instead of using the browser's
    // 10-minute copy, so a new version shows up the next time the app opens.
    // (A page load can't be copied with new options, so it is fetched by its address.)
    const net = req.mode === "navigate" ? fetch(req.url, {cache: "no-cache", credentials: "same-origin", redirect: "manual"}) : fetch(req, {cache: "no-cache"});
    e.respondWith(net.then(res => {
      if (res.ok && !url.search) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined))));
    return;
  }
  if (url.href.startsWith("https://www.gstatic.com/firebasejs/") || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
    })));
  }
  // Spotify and the database always go straight to the network.
});
