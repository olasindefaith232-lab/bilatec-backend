import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters'
process.env.ADMIN_EMAIL = 'admin@example.com'
process.env.ADMIN_PASSWORD = 'a-test-password-longer-than-twelve'
process.env.CLIENT_ORIGIN = 'http://localhost:5173'
process.env.ADMIN_ORIGIN = 'http://localhost:5174'

const { app } = await import('../src/app.js')
let server
let baseUrl

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('admin login issues a token and rejects invalid credentials', async () => {
  const valid = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'a-test-password-longer-than-twelve' }),
  })
  assert.equal(valid.status, 200)
  assert.ok((await valid.json()).token)

  const invalid = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'incorrect-password' }),
  })
  assert.equal(invalid.status, 401)
})

test('admin content and enquiry submissions require valid input and authentication', async () => {
  const protectedResponse = await fetch(`${baseUrl}/api/admin/content/services`)
  assert.equal(protectedResponse.status, 401)

  const tokenResponse = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'a-test-password-longer-than-twelve' }),
  })
  const { token } = await tokenResponse.json()
  const invalidId = await fetch(`${baseUrl}/api/admin/content/services/not-a-uuid`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(invalidId.status, 400)

  const invalidInquiry = await fetch(`${baseUrl}/api/inquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'A', email: 'bad', message: '' }),
  })
  assert.equal(invalidInquiry.status, 400)
})
