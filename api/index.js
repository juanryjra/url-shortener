import { randomBytes } from 'crypto'
import { Redis } from '@upstash/redis'
import { createClient } from '@supabase/supabase-js'

const MAX_LINKS_PER_USER = Number(process.env.MAX_LINKS_PER_USER || 100)
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://juteach.org'
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim()

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

/* ── Rate limiting: máx intentos por IP en ventana de tiempo ── */
async function checkRateLimit(req, res, key, maxRequests = 20, windowSecs = 60) {
  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
  const rateKey = `rl:${key}:${ip}`
  const count = await redis.incr(rateKey)
  if (count === 1) await redis.expire(rateKey, windowSecs)
  if (count > maxRequests) {
    res.status(429).json({ error: `Demasiados intentos. Espera ${windowSecs} segundos antes de intentar de nuevo.` })
    return false
  }
  return true
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function readBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'object') return req.body

  try {
    return JSON.parse(req.body)
  } catch {
    return {}
  }
}

function normalizeSlug(slug = '') {
  return String(slug)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeUrl(url = '') {
  const cleanUrl = String(url).trim()
  if (!/^https?:\/\//i.test(cleanUrl)) return ''
  return cleanUrl
}

function getBearerToken(req) {
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) return ''
  return auth.slice(7).trim()
}

async function isAdmin(req, res) {
  // Capa 1: APP_PASSWORD en header X-Admin-Key
  const adminKey = (req.headers['x-admin-key'] || '').trim()
  if (!process.env.APP_PASSWORD || adminKey !== process.env.APP_PASSWORD) {
    if (res) res.status(401).json({ error: 'Clave de administrador no válida.' })
    return false
  }

  // Capa 2: el Bearer token debe ser un JWT de Supabase con el correo admin
  if (ADMIN_EMAIL) {
    const token = getBearerToken(req)
    if (!token) {
      if (res) res.status(401).json({ error: 'Se requiere sesión activa para acciones de admin.' })
      return false
    }
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      if (res) res.status(401).json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' })
      return false
    }
    if (data.user.email.toLowerCase() !== ADMIN_EMAIL) {
      if (res) res.status(403).json({ error: 'No tienes permisos de administrador.' })
      return false
    }
  }

  return true
}

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({
      error:
        'Falta conectar Supabase. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Vercel.',
    })
    return false
  }
  return true
}

async function getUser(req, res) {
  if (!requireSupabase(res)) return null

  const token = getBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Inicia sesión para continuar.' })
    return null
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    res.status(401).json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' })
    return null
  }

  return data.user
}

async function getInviteForUser(user) {
  const { data, error } = await supabase
    .from('invites')
    .select('id,email,claimed_at')
    .eq('claimed_by', user.id)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

async function requireInvitedUser(user, res) {
  const invite = await getInviteForUser(user)
  if (!invite) {
    res.status(403).json({
      error:
        'Esta cuenta todavía no tiene permiso. Abre tu enlace de invitación o pídele acceso al administrador.',
    })
    return null
  }
  return invite
}

async function listLinks(user, res) {
  const { data, error } = await supabase
    .from('links')
    .select('slug,url,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  return res.json(data || [])
}

async function createLink(user, body, res) {
  const url = normalizeUrl(body.url)
  const slug = normalizeSlug(body.slug)

  if (!url) return res.status(400).json({ error: 'La URL debe comenzar con http:// o https://.' })
  if (!slug) return res.status(400).json({ error: 'Escribe un alias válido.' })
  if (slug.length > 60) return res.status(400).json({ error: 'El alias es demasiado largo.' })

  const { count, error: countError } = await supabase
    .from('links')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if (countError) return res.status(500).json({ error: countError.message })
  if ((count || 0) >= MAX_LINKS_PER_USER) {
    return res.status(403).json({
      error: `Llegaste al límite de ${MAX_LINKS_PER_USER} enlaces activos. Borra uno antiguo para crear otro.`,
    })
  }

  const currentTarget = await redis.get(`url:${slug}`)
  if (currentTarget) {
    return res.status(409).json({ error: 'Ese alias ya existe. Prueba con otro.' })
  }

  const { error } = await supabase.from('links').insert({
    user_id: user.id,
    slug,
    url,
  })

  if (error) {
    const duplicate = error.code === '23505'
    return res.status(duplicate ? 409 : 500).json({
      error: duplicate ? 'Ese alias ya existe. Prueba con otro.' : error.message,
    })
  }

  await redis.set(`url:${slug}`, url)

  return res.json({ success: true, short: `${SITE_URL}/${slug}` })
}

async function deleteLink(user, body, res) {
  const slug = normalizeSlug(body.slug)
  if (!slug) return res.status(400).json({ error: 'Alias no válido.' })

  const { data, error } = await supabase
    .from('links')
    .delete()
    .eq('user_id', user.id)
    .eq('slug', slug)
    .select('slug')
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'No encontré ese enlace en tu cuenta.' })

  await redis.del(`url:${slug}`)
  return res.json({ success: true })
}

async function claimInvite(user, body, res) {
  const token = String(body.invite || '').trim()
  if (!token) return res.status(400).json({ error: 'Falta el código de invitación.' })

  const { data: invite, error: findError } = await supabase
    .from('invites')
    .select('id,email,claimed_by')
    .eq('token', token)
    .maybeSingle()

  if (findError) return res.status(500).json({ error: findError.message })
  if (!invite) return res.status(404).json({ error: 'La invitación no existe o ya fue eliminada.' })
  if (invite.claimed_by && invite.claimed_by !== user.id) {
    return res.status(409).json({ error: 'Esta invitación ya fue usada por otra cuenta.' })
  }
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return res.status(403).json({
      error: `Esta invitación es para ${invite.email}. Inicia sesión con ese correo.`,
    })
  }

  const { error } = await supabase
    .from('invites')
    .update({ claimed_by: user.id, claimed_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ success: true })
}

async function createInvite(body, res) {
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Escribe un correo válido.' })
  }

  const token = randomBytes(24).toString('hex')
  const { error } = await supabase.from('invites').insert({ email, token })

  if (error) {
    const duplicate = error.code === '23505'
    return res.status(duplicate ? 409 : 500).json({
      error: duplicate ? 'Ese correo ya tiene una invitación.' : error.message,
    })
  }

  return res.json({
    success: true,
    invite: `${SITE_URL}/Acortador?invite=${token}`,
    email,
  })
}

async function listInvites(res) {
  const { data, error } = await supabase
    .from('invites')
    .select('id,email,token,claimed_at,created_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  return res.json(
    (data || []).map((invite) => ({
      ...invite,
      invite: `${SITE_URL}/Acortador?invite=${invite.token}`,
    })),
  )
}

async function deleteInvite(body, res) {
  const id = String(body.id || '').trim()
  if (!id) return res.status(400).json({ error: 'Falta la invitación.' })

  const { error } = await supabase.from('invites').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ success: true })
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { slug, action } = req.query

  if (req.method === 'GET' && slug && !action) {
    const cleanSlug = normalizeSlug(slug)
    const targetUrl = await redis.get(`url:${cleanSlug}`)

    if (targetUrl) return res.redirect(301, targetUrl)
    return res.status(404).json({ error: 'Enlace no encontrado', buscado: cleanSlug })
  }

  if (req.method === 'GET' && action === 'config') {
    return res.json({
      supabaseUrl,
      supabaseAnonKey,
      siteUrl: SITE_URL,
      maxLinksPerUser: MAX_LINKS_PER_USER,
    })
  }

  if (!requireSupabase(res)) return

  if (action === 'admin-invites') {
    if (!await checkRateLimit(req, res, 'admin', 10, 60)) return
    if (!await isAdmin(req, res)) return
    return listInvites(res)
  }

  const body = await readBody(req)

  if (req.method === 'POST' && body.action === 'admin-create-invite') {
    if (!await checkRateLimit(req, res, 'admin', 10, 60)) return
    if (!await isAdmin(req, res)) return
    return createInvite(body, res)
  }

  if (req.method === 'POST' && body.action === 'admin-delete-invite') {
    if (!await checkRateLimit(req, res, 'admin', 10, 60)) return
    if (!await isAdmin(req, res)) return
    return deleteInvite(body, res)
  }

  const user = await getUser(req, res)
  if (!user) return

  if (req.method === 'POST' && body.action === 'claim-invite') {
    return claimInvite(user, body, res)
  }

  if (req.method === 'GET' && action === 'me') {
    const invite = await getInviteForUser(user)
    return res.json({ email: user.email, invited: Boolean(invite), maxLinksPerUser: MAX_LINKS_PER_USER })
  }

  const invite = await requireInvitedUser(user, res)
  if (!invite) return

  if (req.method === 'GET' && action === 'list') return listLinks(user, res)

  if (req.method === 'POST' && body.action === 'create') {
    if (!await checkRateLimit(req, res, 'create', 30, 60)) return
    return createLink(user, body, res)
  }
  if (req.method === 'POST' && body.action === 'delete') return deleteLink(user, body, res)

  return res.status(400).json({ error: 'Petición no válida' })
}
