import { app } from './app.js'
import { config } from './config.js'
import { initializeDatabase, pool } from './db.js'

try {
  await initializeDatabase()
  const server = app.listen(config.PORT, () => {
    console.log(`Bilatec API listening on port ${config.PORT}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(async () => {
        await pool.end()
        process.exit(0)
      })
    })
  }
} catch (error) {
  console.error('Unable to start Bilatec API:', error)
  await pool.end()
  process.exitCode = 1
}
