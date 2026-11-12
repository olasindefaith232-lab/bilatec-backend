import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from './config.js'
import { pool } from './db.js'
import { login, requireAdmin } from './auth.js'

export const app = express()
const collections = ['settings', 'services', 'products', 'courses', 'projects', 'stats', 'siteContent', 'heroSlides']
const collectionSchema = z.enum(collections)
const idSchema = z.string().uuid()
const contentSchema = z.record(z.string(), z.unknown()).refine((data) => Object.keys(data).length > 0, 'Content cannot be empty.')
const inquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(5).max(5000),
})

app.disable('x-powered-by')
app.use(helmet())
const allowedOrigins = new Set([config.CLIENT_ORIGIN, config.ADMIN_ORIGIN, ...config.ADMIN_ORIGINS])
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '100kb' }))

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })
const inquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function validCollection(req, res, next) {
  const parsed = collectionSchema.safeParse(req.params.collection)
  if (!parsed.success) return res.status(404).json({ error: 'Content collection not found.' })
  req.collection = parsed.data
  return next()
}

function validId(req, res, next) {
  const parsed = idSchema.safeParse(req.params.id)
  if (!parsed.success) return res.status(400).json({ error: 'Content item ID must be a UUID.' })
  req.recordId = parsed.data
  return next()
}

async function listRecords(collection, includeUnpublished = false) {
  const query = includeUnpublished
    ? 'SELECT id, data, sort_order AS "sortOrder", published, created_at AS "createdAt", updated_at AS "updatedAt" FROM content_records WHERE collection = $1 ORDER BY sort_order, created_at'
    : 'SELECT id, data, sort_order AS "sortOrder" FROM content_records WHERE collection = $1 AND published = true ORDER BY sort_order, created_at'
  const { rows } = await pool.query(query, [collection])
  return rows
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok' })
}))

app.get('/api/site', asyncRoute(async (_req, res) => {
  const data = Object.fromEntries(await Promise.all(
    collections.map(async (collection) => [collection, (await listRecords(collection)).map((record) => record.data)]),
  ))
  res.json(data)
}))

app.post('/api/inquiries', inquiryLimiter, asyncRoute(async (req, res) => {
  const parsed = inquirySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Please check the enquiry details and try again.', details: parsed.error.issues })
  const { name, phone, email, subject, message } = parsed.data
  const { rows } = await pool.query(
    'INSERT INTO inquiries (name, phone, email, subject, message) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at AS "createdAt"',
    [name, phone, email, subject, message],
  )
  res.status(201).json({ message: 'Your enquiry has been sent.', inquiry: rows[0] })
}))

app.post('/api/admin/login', loginLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address and password.' })
  const token = await login(parsed.data.email, parsed.data.password)
  if (!token) return res.status(401).json({ error: 'Email or password is incorrect.' })
  res.json({ token })
}))

app.use('/api/admin', requireAdmin)

app.get('/api/admin/content/:collection', validCollection, asyncRoute(async (req, res) => {
  res.json(await listRecords(req.collection, true))
}))

app.post('/api/admin/content/:collection', validCollection, asyncRoute(async (req, res) => {
  const parsed = contentSchema.safeParse(req.body.data)
  if (!parsed.success) return res.status(400).json({ error: 'Provide a non-empty content object.' })
  const sortOrder = z.coerce.number().int().safeParse(req.body.sortOrder ?? 0)
  if (!sortOrder.success) return res.status(400).json({ error: 'Sort order must be a whole number.' })
  const published = z.boolean().safeParse(req.body.published ?? true)
  if (!published.success) return res.status(400).json({ error: 'Published must be true or false.' })
  const { rows } = await pool.query(
    'INSERT INTO content_records (collection, data, sort_order, published) VALUES ($1, $2, $3, $4) RETURNING id, data, sort_order AS "sortOrder", published, created_at AS "createdAt", updated_at AS "updatedAt"',
    [req.collection, parsed.data, sortOrder.data, published.data],
  )
  res.status(201).json(rows[0])
}))

app.put('/api/admin/content/:collection/:id', validCollection, validId, asyncRoute(async (req, res) => {
  const parsed = contentSchema.safeParse(req.body.data)
  if (!parsed.success) return res.status(400).json({ error: 'Provide a non-empty content object.' })
  const sortOrder = z.coerce.number().int().safeParse(req.body.sortOrder ?? 0)
  const published = z.boolean().safeParse(req.body.published ?? true)
  if (!sortOrder.success || !published.success) return res.status(400).json({ error: 'Invalid ordering or published value.' })
  const { rows } = await pool.query(
    'UPDATE content_records SET data = $1, sort_order = $2, published = $3, updated_at = now() WHERE collection = $4 AND id = $5 RETURNING id, data, sort_order AS "sortOrder", published, created_at AS "createdAt", updated_at AS "updatedAt"',
    [parsed.data, sortOrder.data, published.data, req.collection, req.recordId],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Content item not found.' })
  res.json(rows[0])
}))

app.delete('/api/admin/content/:collection/:id', validCollection, validId, asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM content_records WHERE collection = $1 AND id = $2', [req.collection, req.recordId])
  if (!rowCount) return res.status(404).json({ error: 'Content item not found.' })
  res.status(204).end()
}))

app.get('/api/admin/inquiries', asyncRoute(async (req, res) => {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'Page must be positive and pageSize must be between 1 and 100.' })

  const { pageSize } = parsed.data
  const countResult = await pool.query('SELECT count(*)::int AS total FROM inquiries')
  const total = countResult.rows[0].total
  const totalPages = Math.ceil(total / pageSize)
  const page = totalPages ? Math.min(parsed.data.page, totalPages) : 1
  const offset = (page - 1) * pageSize
  const inquiriesResult = await pool.query(
    'SELECT id, name, phone, email, subject, message, status, created_at AS "createdAt" FROM inquiries ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2',
    [pageSize, offset],
  )
  res.json({ items: inquiriesResult.rows, total, page, pageSize, totalPages })
}))

app.patch('/api/admin/inquiries/:id', validId, asyncRoute(async (req, res) => {
  const parsed = z.object({ status: z.enum(['new', 'in-progress', 'closed']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Status must be new, in-progress, or closed.' })
  const { rows } = await pool.query(
    'UPDATE inquiries SET status = $1 WHERE id = $2 RETURNING id, name, phone, email, subject, message, status, created_at AS "createdAt"',
    [parsed.data.status, req.recordId],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Enquiry not found.' })
  res.json(rows[0])
}))

app.delete('/api/admin/inquiries/:id', validId, asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM inquiries WHERE id = $1', [req.recordId])
  if (!rowCount) return res.status(404).json({ error: 'Enquiry not found.' })
  res.status(204).end()
}))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'An unexpected server error occurred.' })
})
