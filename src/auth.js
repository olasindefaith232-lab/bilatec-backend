import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

const passwordHash = bcrypt.hashSync(config.ADMIN_PASSWORD, 12)

export async function login(email, password) {
  const passwordMatches = await bcrypt.compare(password, passwordHash)
  if (email.toLowerCase() !== config.ADMIN_EMAIL.toLowerCase() || !passwordMatches) return null
  return jwt.sign({ sub: config.ADMIN_EMAIL, role: 'admin' }, config.JWT_SECRET, { expiresIn: '8h' })
}

export function requireAdmin(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Admin authentication required.' })
  try {
    const payload = jwt.verify(token, config.JWT_SECRET)
    if (payload.role !== 'admin' || payload.sub !== config.ADMIN_EMAIL) throw new Error('Invalid admin token')
    return next()
  } catch {
    return res.status(401).json({ error: 'Your admin session is invalid or expired.' })
  }
}
