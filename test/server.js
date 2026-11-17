// Test server: serves the app and a stand-in database (no real Firebase or Spotify needed).
// node test/server.js <appDir>   → http://localhost:8790
const http = require("http"), fs = require("fs"), path = require("path");
const dir = path.resolve(process.argv[2] || ".");
const mockGlue = fs.readFileSync(path.join(__dirname, "mock-glue.js"));
const db = {};
const types = {".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json"};
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/__db/")) {
    const key = decodeURIComponent(u.pathname.slice(6));
    if (req.method === "GET") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(db[key] || null)); }
    let b = ""; req.on("data", c => b += c); req.on("end", () => {
      if (!/^soundboards\/[a-z0-9-]{6,40}$/.test(key)) { res.statusCode = 403; return res.end("permission-denied"); }
      db[key] = JSON.parse(b); res.end("ok");
    });
    return;
  }
  if (u.pathname === "/firebase-glue.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(mockGlue); }
  let f = path.join(dir, u.pathname === "/" ? "index.html" : u.pathname);
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader("Content-Type", types[path.extname(f)] || "application/octet-stream"); res.end(d); });
}).listen(8790, () => console.log("test server on :8790"));
