import 'dotenv/config'
import { z } from 'zod'

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  ADMIN_ORIGIN: z.string().url().default('http://localhost:5174'),
})

const parsedConfig = configSchema.safeParse(process.env)

if (!parsedConfig.success) {
  const missing = parsedConfig.error.issues.map((issue) => issue.path.join('.')).join(', ')
  throw new Error(`Invalid backend environment configuration: ${missing}`)
}

export const config = parsedConfig.data
