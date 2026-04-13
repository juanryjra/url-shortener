import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export default async function handler(req, res) {
  // 1. Configurar encabezados para evitar problemas de acceso
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug, action } = req.query;

  // --- LÓGICA DE REDIRECCIÓN (Cuando alguien entra a juteach.org/algo) ---
  if (req.method === 'GET' && slug && !action) {
    const cleanSlug = slug.toLowerCase().trim();
    // BUSCAMOS CON EL PREFIJO "url:" QUE ES COMO SE GUARDA EN UPSTASH
    const targetUrl = await redis.get(`url:${cleanSlug}`);

    if (targetUrl) {
      return res.redirect(301, targetUrl);
    } else {
      return res.status(404).json({ error: "Enlace no encontrado", buscado: cleanSlug });
    }
  }

  // --- LÓGICA DEL PANEL (Crear, Listar, Borrar) ---
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.APP_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (req.method === 'GET' && action === 'list') {
    const keys = await redis.keys('url:*');
    if (keys.length === 0) return res.json([]);
    
    const pipeline = redis.pipeline();
    keys.forEach(k => pipeline.get(k));
    const results = await pipeline.exec();
    
    const links = keys.map((k, i) => ({
      slug: k.replace('url:', ''),
      url: results[i]
    }));
    return res.json(links);
  }

  if (req.method === 'POST') {
    const { action, url, slug: newSlug } = await req.body;
    const cleanNewSlug = newSlug.toLowerCase().trim();

    if (action === 'create') {
      await redis.set(`url:${cleanNewSlug}`, url);
      return res.json({ success: true, short: `https://juteach.org/${cleanNewSlug}` });
    }

    if (action === 'delete') {
      await redis.del(`url:${cleanNewSlug}`);
      return res.json({ success: true });
    }
  }

  return res.status(400).json({ error: "Petición no válida" });
}
