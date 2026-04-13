import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Palabras que nadie puede usar como link corto para no romper tu web
const RESERVED_SLUGS = ['acortador', 'api', 'public', 'static', 'admin', 'index'];

export default async function handler(req, res) {
  // Configuración de CORS para que tu frontend pueda hablar con la API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const isGet = req.method === "GET";
  const isPost = req.method === "POST";

  // Capturar datos sin importar si vienen por URL o por el cuerpo del mensaje
  let { action, slug, url } = isPost 
    ? (typeof req.body === "string" ? JSON.parse(req.body) : req.body)
    : req.query;

  // --- 1. LÓGICA DE REDIRECCIÓN (Público) ---
  if (isGet && !action && slug) {
    const lowerSlug = slug.toLowerCase();
    
    // Si intentan usar una palabra reservada, no hacemos nada
    if (RESERVED_SLUGS.includes(lowerSlug)) return;

    const target = await redis.get(`url:${lowerSlug}`);
    if (!target) return res.status(404).json({ error: "Enlace no encontrado" });
    
    // Redirección permanente (301) para máxima velocidad
    return res.redirect(301, target);
  }

  // Respuesta simple si entran a la API directamente
  if (isGet && !action && !slug) {
    return res.status(200).json({ ok: true, message: "juteach.org API activa" });
  }

  // --- 2. LÓGICA ADMINISTRATIVA (Requiere Contraseña) ---
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.APP_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  // ACCIÓN: LISTAR ENLACES (Optimizado con MGET)
  if (action === "list") {
    try {
      const slugs = await redis.lrange("slugs", 0, -1);
      if (slugs.length === 0) return res.status(200).json([]);

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

  // ACCIÓN: CREAR ENLACE
  if (action === "create") {
    if (!slug || !url) return res.status(400).json({ error: "Faltan datos" });
    const cleanSlug = slug.toLowerCase().replace(/[^a-zA-Z0-9-_]/g, "");

    if (RESERVED_SLUGS.includes(cleanSlug)) {
      return res.status(400).json({ error: "Este nombre está reservado" });
    }

    const exists = await redis.get(`url:${cleanSlug}`);
    if (exists) return res.status(409).json({ error: "El alias ya existe" });

    await redis.set(`url:${cleanSlug}`, url);
    await redis.lpush("slugs", cleanSlug);
    
    return res.status(200).json({ 
      short: `https://juteach.org/${cleanSlug}`
    });
  }

  // ACCIÓN: ELIMINAR ENLACE
  if (action === "delete") {
    if (!slug) return res.status(400).json({ error: "Slug requerido" });
    await redis.del(`url:${slug}`);
    await redis.lrem("slugs", 0, slug);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Acción no válida" });
}
