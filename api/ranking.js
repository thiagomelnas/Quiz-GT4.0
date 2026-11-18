const crypto = require("crypto");

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN_ = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const redis = async (cmd) => {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN_, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
};

let certs = null, certsAt = 0;
const getCerts = async () => {
  if (!certs || Date.now() - certsAt > 3600000) {
    certs = (await (await fetch("https://www.googleapis.com/oauth2/v3/certs")).json()).keys;
    certsAt = Date.now();
  }
  return certs;
};

// Valida o token do Google (assinatura, app, emissor e validade)
const verify = async (tok) => {
  try {
    const [h, p, s] = String(tok || "").split(".");
    if (!s) return null;
    const head = JSON.parse(Buffer.from(h, "base64url"));
    const pay = JSON.parse(Buffer.from(p, "base64url"));
    const key = (await getCerts()).find((k) => k.kid === head.kid);
    if (!key || head.alg !== "RS256") return null;
    const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(h + "." + p),
      crypto.createPublicKey({ key, format: "jwk" }),
      Buffer.from(s, "base64url")
    );
    const issOk = ["accounts.google.com", "https://accounts.google.com"].includes(pay.iss);
    if (!ok || !issOk || !CLIENT_ID || pay.aud !== CLIENT_ID || pay.exp * 1000 < Date.now()) return null;
    return pay;
  } catch (e) {
    return null;
  }
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const user = await verify(b.token);
      if (!user) return res.status(401).json({ error: "auth" });
      const name = String(b.name || "").trim().slice(0, 20);
      const score = Math.floor(Number(b.score));
      if (!name || !(score >= 0 && score <= 3450)) {
        return res.status(400).json({ error: "invalid" });
      }
      await redis(["ZADD", "ranking:g", "GT", String(score), user.sub]);
      await redis(["HSET", "names:g", user.sub, name]);
      return res.json({ ok: true });
    }
    if (req.query && req.query.config) {
      return res.json({ clientId: CLIENT_ID || null });
    }
    const a = await redis(["ZREVRANGE", "ranking:g", "0", "49", "WITHSCORES"]);
    const ids = [], scores = [];
    for (let i = 0; i < a.length; i += 2) { ids.push(a[i]); scores.push(Number(a[i + 1])); }
    const names = ids.length ? await redis(["HMGET", "names:g", ...ids]) : [];
    res.json(ids.map((_, i) => ({ name: names[i] || "Jogador", score: scores[i] })));
  } catch (e) {
    res.status(500).json({ error: "server" });
  }
};
