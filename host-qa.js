const express = require('express')
const crypto = require('node:crypto')
const { Pool } = require('pg')

function createQaRouter({ environment = process.env, poolFactory = config => new Pool(config) } = {}) {
  const router = express.Router()
  let pool
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const token = environment.HOST_QA_PROBE_TOKEN || ''
    const supplied = req.get('Authorization') || ''
    if (environment.HOST_QA_PROBE_ENABLED !== 'true' || ! /^[a-f0-9]{64}$/.test(token) || supplied.length > 256 ||
      ! crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(), crypto.createHash('sha256').update(`Bearer ${token}`).digest())) {
      return res.sendStatus(404)
    }
    next()
  })
  router.post('/check', express.json({ limit: '1kb' }), async (req, res) => {
    const { nonce, database = false, mode = 'read' } = req.body || {}
    if (typeof nonce !== 'string' || ! /^[a-f0-9]{64}$/.test(nonce) || ! ['read', 'write'].includes(mode) || typeof database !== 'boolean') {
      return res.status(400).json({ ok: false, message: 'Invalid QA request.' })
    }
    if (! /^[a-f0-9]{64}$/.test(environment.HOST_QA_PRIVATE_MARKER || '') || ! /^[a-f0-9]{64}$/.test(environment.HOST_QA_PUBLIC_MARKER || '')) {
      return res.status(503).json({ ok: false, message: 'QA configuration is incomplete.' })
    }
    const response = {
      ok: true,
      runtime: { node: process.versions.node },
      configuration: {
        privateProof: crypto.createHmac('sha256', environment.HOST_QA_PRIVATE_MARKER).update(nonce).digest('hex'),
        publicMarker: environment.HOST_QA_PUBLIC_MARKER
      },
      database: { checked: false }
    }
    if (! database) return res.json(response)
    if (environment.DB_NAME !== 'host_qa_express' || ! environment.DB_HOST || ! environment.DB_USERNAME || ! environment.DB_PASSWORD) {
      return res.status(503).json({ ok: false, message: 'QA database configuration is incomplete.' })
    }
    try {
      if (! pool) {
        pool = poolFactory({
        host: environment.DB_HOST,
        port: Number(environment.DB_PORT || 5432),
        database: environment.DB_NAME,
        user: environment.DB_USERNAME,
        password: environment.DB_PASSWORD,
        // Wasmer's managed database uses its private CA. TLS remains required.
        ssl: { rejectUnauthorized: false },
        max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
        statement_timeout: 5000, query_timeout: 6000, allowExitOnIdle: true
        })
        pool.on?.('error', () => {})
      }
      const client = await pool.connect()
      try {
        const session = await client.query('SELECT current_database() AS database, ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
        if (session.rows[0]?.database !== 'host_qa_express' || session.rows[0]?.ssl !== true) throw new Error('QA database scope or TLS check failed')
        await client.query('CREATE TABLE IF NOT EXISTS host_qa_probe (id integer PRIMARY KEY CHECK (id = 1), marker text NOT NULL)')
        if (mode === 'write') {
          await client.query('INSERT INTO host_qa_probe (id, marker) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker', [nonce])
        }
        const stored = await client.query('SELECT marker FROM host_qa_probe WHERE id = 1')
        response.database = { checked: true, tls: true, persisted: stored.rows[0]?.marker === nonce }
      } finally {
        client.release()
      }
      return res.json(response)
    } catch {
      return res.status(503).json({ ok: false, message: 'QA database check failed.' })
    }
  })
  router.use((_req, res) => res.sendStatus(404))
  router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ ok: false, message: 'Invalid QA request.' }))
  router.closeQa = async () => { if (pool) await pool.end() }
  return router
}

module.exports = { createQaRouter }
