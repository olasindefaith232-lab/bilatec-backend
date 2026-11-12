import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(5).max(5000),
})

test('accepts a complete enquiry and trims surrounding whitespace', () => {
  const result = inquirySchema.parse({ name: ' Ada ', phone: '08012345678', email: 'ada@example.com', subject: 'Quote request', message: 'Please call me.' })
  assert.equal(result.name, 'Ada')
})

test('rejects invalid email addresses and missing enquiry fields', () => {
  assert.equal(inquirySchema.safeParse({ name: 'A', phone: '', email: 'not-an-email', subject: '', message: '' }).success, false)
})
