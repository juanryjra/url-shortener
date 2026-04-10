import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "false");

  if (req.method === "OPTIONS") return res.status(200).end();

  const auth = req.headers.authorization;
  const { action, slug, url } = req.method === "POST" ? req.body : req.query;

  if (req.method === "GET" && !action) {
    if (!slug) return res.status(400).json({ error: "Slug requerido" });
    const target = await redis.get(`url:${slug}`);
    if (!target) return res.status(404).json({ error: "Enlace no encontrado" });
    return res.redirect(301, target);
  }

  if (req.method === "GET" && action === "redirect") {
    if (!slug) return res.status(400).json({ error: "Slug requerido" });
    const target = await redis.get(`url:${slug}`);
    if (!target) return res.status(404).json({ error: "Enlace no encontrado" });
    return res.redirect(301, target);
  }

  if (!auth || auth !== `Bearer ${process.env.APP_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (action === "create") {
    if (!slug || !url) return res.status(400).json({ error: "Slug y URL requeridos" });
    const exists = await redis.get(`url:${slug}`);
    if (exists) return res.status(409).json({ error: "Ese alias ya existe" });
    await redis.set(`url:${slug}`, url);
    await redis.lpush("slugs", slug);
    return res.status(200).json({ short: `${process.env.APP_URL}/${slug}` });
  }

  if (action === "list") {
    const slugs = await redis.lrange("slugs", 0, -1);
    const links = await Promise.all(
      slugs.map(async (s) => ({ slug: s, url: await redis.get(`url:${s}`) }))
    );
    return res.status(200).json(links.filter(l => l.url));
  }

  if (action === "delete") {
    if (!slug) return res.status(400).json({ error: "Slug requerido" });
    await redis.del(`url:${slug}`);
    await redis.lrem("slugs", 0, slug);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Acción no válida" });
}
