// Stand-in for firebase-glue.js used by the tests: same functions, backed by test/server.js.
const get = async p => (await fetch("/__db/" + encodeURIComponent(p))).json();
window.__sbDB({
  ready: Promise.resolve({uid: "test"}),
  get,
  set: async (p, d) => { const r = await fetch("/__db/" + encodeURIComponent(p), {method: "PUT", body: JSON.stringify(d)}); if (!r.ok) throw Object.assign(new Error("Missing or insufficient permissions."), {code: "permission_denied"}); },
  watchDoc: (p, cb) => {
    let last = "", stop = false;
    (async function loop() { while (!stop) { try { const d = await get(p); const s = JSON.stringify(d); if (s !== last) { last = s; cb(d, {fromCache: false, pending: false}); } } catch (e) {} await new Promise(r => setTimeout(r, 200)); } })();
    return () => stop = true;
  }
});
