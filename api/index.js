import { randomBytes } from 'crypto'
import { Redis } from '@upstash/redis'
import admin from 'firebase-admin'

const MAX_LINKS_PER_USER = Number(process.env.MAX_LINKS_PER_USER || 100)
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://juteach.org'
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim()

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const firebaseApiKey = process.env.FIREBASE_API_KEY
const firebaseAuthDomain = process.env.FIREBASE_AUTH_DOMAIN
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
const firebaseAppId = process.env.FIREBASE_APP_ID

let db = null

if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
    }
    db = admin.firestore()
  } catch {
    db = null
  }
}

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

function requireFirebase(res) {
  if (!db) {
    res.status(500).json({
      error: 'Falta conectar Firebase. Revisa FIREBASE_SERVICE_ACCOUNT_KEY en Vercel.',
    })
    return false
  }
  return true
}

async function isAdmin(req, res) {
  // El Bearer token debe ser un ID token de Firebase con el correo admin verificado
  if (!ADMIN_EMAIL) {
    if (res) res.status(500).json({ error: 'Falta configurar ADMIN_EMAIL en Vercel.' })
    return false
  }

  const token = getBearerToken(req)
  if (!token) {
    if (res) res.status(401).json({ error: 'Se requiere sesión activa para acciones de admin.' })
    return false
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token)
    if (!decoded.email_verified || (decoded.email || '').toLowerCase() !== ADMIN_EMAIL) {
      if (res) res.status(403).json({ error: 'No tienes permisos de administrador.' })
      return false
    }
  } catch {
    if (res) res.status(401).json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' })
    return false
  }

  return true
}

async function getUser(req, res) {
  if (!requireFirebase(res)) return null

  const token = getBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Inicia sesión para continuar.' })
    return null
  }

  let decoded
  try {
    decoded = await admin.auth().verifyIdToken(token)
  } catch {
    res.status(401).json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' })
    return null
  }

  if (!decoded.email_verified) {
    res.status(403).json({ error: 'Verifica tu correo antes de continuar. Revisa tu bandeja de entrada.' })
    return null
  }

  return { uid: decoded.uid, email: decoded.email }
}

function toIso(timestamp) {
  return timestamp?.toDate?.().toISOString() || null
}

async function getInviteForUser(user) {
  const snapshot = await db.collection('invites').where('claimedBy', '==', user.uid).limit(1).get()
  if (snapshot.empty) return null
  const doc = snapshot.docs[0]
  return { id: doc.id, ...doc.data() }
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
  const snapshot = await db.collection('links').where('userId', '==', user.uid).get()
  const links = snapshot.docs
    .map((doc) => ({ slug: doc.id, url: doc.data().url, created_at: toIso(doc.data().createdAt) }))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  return res.json(links)
}

async function createLink(user, body, res) {
  const url = normalizeUrl(body.url)
  const slug = normalizeSlug(body.slug)

  if (!url) return res.status(400).json({ error: 'La URL debe comenzar con http:// o https://.' })
  if (!slug) return res.status(400).json({ error: 'Escribe un alias válido.' })
  if (slug.length > 60) return res.status(400).json({ error: 'El alias es demasiado largo.' })

  const countSnapshot = await db.collection('links').where('userId', '==', user.uid).count().get()
  if (countSnapshot.data().count >= MAX_LINKS_PER_USER) {
    return res.status(403).json({
      error: `Llegaste al límite de ${MAX_LINKS_PER_USER} enlaces activos. Borra uno antiguo para crear otro.`,
    })
  }

  const currentTarget = await redis.get(`url:${slug}`)
  if (currentTarget) {
    return res.status(409).json({ error: 'Ese alias ya existe. Prueba con otro.' })
  }

  try {
    // .create() en vez de .set() para que falle si el slug ya existe como documento (uniqueness atómica)
    await db.collection('links').doc(slug).create({
      userId: user.uid,
      url,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const duplicate = error.code === 6 // gRPC ALREADY_EXISTS
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

  const ref = db.collection('links').doc(slug)
  const doc = await ref.get()
  if (!doc.exists || doc.data().userId !== user.uid) {
    return res.status(404).json({ error: 'No encontré ese enlace en tu cuenta.' })
  }

  await ref.delete()
  await redis.del(`url:${slug}`)
  return res.json({ success: true })
}

async function claimInvite(user, body, res) {
  const token = String(body.invite || '').trim()
  if (!token) return res.status(400).json({ error: 'Falta el código de invitación.' })

  const ref = db.collection('invites').doc(token)
  const doc = await ref.get()
  if (!doc.exists) return res.status(404).json({ error: 'La invitación no existe o ya fue eliminada.' })

  const invite = doc.data()
  if (invite.claimedBy && invite.claimedBy !== user.uid) {
    return res.status(409).json({ error: 'Esta invitación ya fue usada por otra cuenta.' })
  }
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return res.status(403).json({
      error: `Esta invitación es para ${invite.email}. Inicia sesión con ese correo.`,
    })
  }

  await ref.update({ claimedBy: user.uid, claimedAt: admin.firestore.FieldValue.serverTimestamp() })
  return res.json({ success: true })
}

async function createInvite(body, res) {
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Escribe un correo válido.' })
  }

  const existing = await db.collection('invites').where('email', '==', email).limit(1).get()
  if (!existing.empty) {
    return res.status(409).json({ error: 'Ese correo ya tiene una invitación.' })
  }

  const token = randomBytes(24).toString('hex')

  try {
    await db.collection('invites').doc(token).create({
      email,
      claimedBy: null,
      claimedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const duplicate = error.code === 6 // gRPC ALREADY_EXISTS
    return res.status(duplicate ? 409 : 500).json({
      error: duplicate ? 'Ese correo ya tiene una invitación.' : error.message,
    })
  }

  return res.json({
    success: true,
    id: token,
    invite: `${SITE_URL}/Acortador?invite=${token}`,
    email,
  })
}

async function sendInviteEmail(email, inviteUrl, res) {
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar RESEND_API_KEY en Vercel.' })
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'juteach.org <onboarding@resend.dev>',
      to: email,
      subject: 'Tu invitación a juteach.org',
      html: `
        <p>¡Hola!</p>
        <p>Te invitaron a crear tu cuenta en <strong>juteach.org</strong>, el acortador de enlaces y QR privado para docentes.</p>
        <p><a href="${inviteUrl}">Haz clic aquí para crear tu cuenta</a></p>
        <p style="color:#888;font-size:12px">Este enlace es personal e intransferible. Si no esperabas este correo, puedes ignorarlo.</p>
      `,
    }),
  })

  if (!emailRes.ok) {
    const body = await emailRes.json().catch(() => ({}))
    return res.status(502).json({ error: body.message || 'No se pudo enviar el correo.' })
  }

  return res.json({ success: true })
}

async function sendInvite(body, res) {
  const id = String(body.id || '').trim()
  if (!id) return res.status(400).json({ error: 'Falta la invitación.' })

  const doc = await db.collection('invites').doc(id).get()
  if (!doc.exists) return res.status(404).json({ error: 'La invitación no existe o ya fue eliminada.' })

  const inviteUrl = `${SITE_URL}/Acortador?invite=${id}`
  return sendInviteEmail(doc.data().email, inviteUrl, res)
}

async function listInvites(res) {
  const snapshot = await db.collection('invites').get()
  const invites = snapshot.docs
    .map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        email: data.email,
        claimed_at: toIso(data.claimedAt),
        created_at: toIso(data.createdAt),
        invite: `${SITE_URL}/Acortador?invite=${doc.id}`,
      }
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  return res.json(invites)
}

async function deleteInvite(body, res) {
  const id = String(body.id || '').trim()
  if (!id) return res.status(400).json({ error: 'Falta la invitación.' })

  await db.collection('invites').doc(id).delete()
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
      firebaseApiKey,
      firebaseAuthDomain,
      firebaseProjectId,
      firebaseAppId,
      siteUrl: SITE_URL,
      maxLinksPerUser: MAX_LINKS_PER_USER,
    })
  }

  if (!requireFirebase(res)) return

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

  if (req.method === 'POST' && body.action === 'admin-send-invite') {
    if (!await checkRateLimit(req, res, 'admin', 10, 60)) return
    if (!await isAdmin(req, res)) return
    return sendInvite(body, res)
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
