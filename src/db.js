import pg from 'pg'
import { config } from './config.js'
import { seedData } from './seedData.js'

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL })

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      collection text NOT NULL,
      data jsonb NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      published boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS content_records_collection_order_idx
      ON content_records (collection, sort_order, created_at);
    CREATE TABLE IF NOT EXISTS inquiries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      phone text NOT NULL,
      email text NOT NULL,
      subject text NOT NULL,
      message text NOT NULL,
      status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in-progress', 'closed')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS inquiries_created_at_idx ON inquiries (created_at DESC);
  `)
  await seedContent()
}

async function seedContent() {
  for (const [collection, records] of Object.entries(seedData)) {
    const { rowCount } = await pool.query('SELECT 1 FROM content_records WHERE collection = $1 LIMIT 1', [collection])
    if (rowCount > 0) continue
    for (const [index, data] of records.entries()) {
      await pool.query(
        'INSERT INTO content_records (collection, data, sort_order) VALUES ($1, $2, $3)',
        [collection, data, index],
      )
    }
  }
}
