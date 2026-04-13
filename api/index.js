import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 1. Las palabras reservadas se quedan aquí arriba (Global)
const RESERVED_SLUGS = ['acortador', 'api', 'public', 'static', 'index'];

export default async function handler(req, res) {
  // Configuración de CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const isGet = req.method === "GET";
  const isPost = req.method === "POST";

  let { action, slug, url } = isPost 
    ? (typeof req.body === "string" ? JSON.parse(req.body) : req.body)
    : req.query;

  // 2. LA VALIDACIÓN DEBE IR AQUÍ (Dentro del handler)
  if (slug && RESERVED_SLUGS.includes(slug.toLowerCase())) {
    // Si es una petición GET normal (navegador), no respondemos nada para que Vercel 
    // siga buscando en la carpeta /public. Si es API, avisamos.
    if (action) return res.status(400).json({ error: "Ruta reservada" });
    return; 
  }

  // --- LÓGICA DE REDIRECCIÓN ---
  if (isGet && !action && slug) {
    const target = await redis.get(`url:${slug.toLowerCase()}`);
    if (!target) return res.status(404).json({ error: "Enlace no encontrado" });
    return res.redirect(301, target);
  }

  // Raíz de la API
  if (isGet && !action && !slug) {
    return res.status(200).json({ ok: true, message: "juteach.org API activa" });
  }

  // --- SEGURIDAD ---
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.APP_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  // ACCIÓN: LISTAR
  if (action === "list") {
    try {
      const slugs = await redis.lrange("slugs", 0, -1);
      if (slugs.length === 0) return res.status(200).json([]);
      const keys = slugs.map(s => `url:${s}`);
      const values = await redis.mget(...keys);
      const links = slugs.map((s, index) => ({ slug: s, url: values[index] })).filter(l => l.url);
      return res.status(200).json(links);
    } catch (e) {
      return res.status(500).json({ error: "Error al listar", detail: e.message });
    }
  }

  // ACCIÓN: CREAR
  if (action === "create") {
    if (!slug || !url) return res.status(400).json({ error: "Faltan datos" });
    const lowSlug = slug.toLowerCase();
    
    if (RESERVED_SLUGS.includes(lowSlug)) {
      return res.status(400).json({ error: "Este nombre está reservado" });
    }

    const exists = await redis.get(`url:${lowSlug}`);
    if (exists) return res.status(409).json({ error: "El alias ya existe" });

    await redis.set(`url:${lowSlug}`, url);
    await redis.lpush("slugs", lowSlug);
    
    return res.status(200).json({ 
      short: `https://juteach.org/${lowSlug}`
    });
  }

  // ACCIÓN: ELIMINAR
  if (action === "delete") {
    if (!slug) return res.status(400).json({ error: "Slug requerido" });
    await redis.del(`url:${slug.toLowerCase()}`);
    await redis.lrem("slugs", 0, slug.toLowerCase());
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Acción no válida" });
}
