const U = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const K = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = async (cmd) => {
  const r = await fetch(U, {
    method: "POST",
    headers: { Authorization: "Bearer " + K, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const name = String(b.name || "").trim().slice(0, 20);
      const score = Math.floor(Number(b.score));
      if (!name || !(score >= 0 && score <= 3450)) {
        return res.status(400).json({ error: "invalid" });
      }
      await redis(["ZADD", "ranking", "GT", String(score), name]);
      return res.json({ ok: true });
    }
    const a = await redis(["ZREVRANGE", "ranking", "0", "49", "WITHSCORES"]);
    const out = [];
    for (let i = 0; i < a.length; i += 2) out.push({ name: a[i], score: Number(a[i + 1]) });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "server" });
  }
};
