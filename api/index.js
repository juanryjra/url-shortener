import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Lista de rutas que el acortador NO debe intentar procesar como links
const RESERVED_SLUGS = ['acortador', 'api', 'public', 'static'];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const isGet = req.method === "GET";
  const isPost = req.method === "POST";

  let { action, slug, url } = isPost 
    ? (typeof req.body === "string" ? JSON.parse(req.body) : req.body)
    : req.query;

  // 1. Lógica de Redirección (Público)
  if (isGet && !action && slug) {
    // Si es una palabra reservada, salimos para no gastar recursos
    if (RESERVED_SLUGS.includes(slug.toLowerCase())) return;

    const target = await redis.get(`url:${slug}`);
    if (!target) return res.status(404).json({ error: "Enlace no encontrado" });
    
    // 301 es mejor para SEO y velocidad
    return res.redirect(301, target);
  }

  // Si entran a la raíz de la API sin slug
  if (isGet && !action && !slug) {
    return res.status(200).json({ ok: true, message: "juteach.org API activa" });
  }

  // 2. Lógica Administrativa (Requiere Auth)
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.APP_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  // ACCIÓN: LISTAR (Optimizado con MGET)
  if (action === "list") {
    try {
      const slugs = await redis.lrange("slugs", 0, -1);
      if (slugs.length === 0) return res.status(200).json([]);

      // Traemos todos los valores de una sola vez
      const keys = slugs.map(s => `url:${s}`);
      const values = await redis.mget(...keys);

      const links = slugs.map((s, index) => ({
        slug: s,
        url: values[index]
      })).filter(l => l.url);

      return res.status(200).json(links);
    } catch (e) {
      return res.status(500).json({ error: "Error al listar", detail: e.message });
    }
  }

  // ACCIÓN: CREAR
  if (action === "create") {
    if (!slug || !url) return res.status(400).json({ error: "Faltan datos" });
    
    if (RESERVED_SLUGS.includes(slug.toLowerCase())) {
      return res.status(400).json({ error: "Este nombre está reservado" });
    }

    const exists = await redis.get(`url:${slug}`);
    if (exists) return res.status(409).json({ error: "El alias ya existe" });

    await redis.set(`url:${slug}`, url);
    await redis.lpush("slugs", slug);
    
    return res.status(200).json({ 
      short: `https://juteach.org/${slug}`,
      qr: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://juteach.org/${slug}`
    });
  }

  // ACCIÓN: ELIMINAR
  if (action === "delete") {
    if (!slug) return res.status(400).json({ error: "Slug requerido" });
    await redis.del(`url:${slug}`);
    await redis.lrem("slugs", 0, slug);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Acción no válida" });
}
