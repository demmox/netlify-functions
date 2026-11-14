const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const express = require('express')
const { createQaRouter } = require('../host-qa')

const token = 'a'.repeat(64)
const privateMarker = 'b'.repeat(64)
const publicMarker = 'c'.repeat(64)
const nonce = 'd'.repeat(64)
const configured = () => ({ HOST_QA_PROBE_ENABLED: 'true', HOST_QA_PROBE_TOKEN: token, HOST_QA_PRIVATE_MARKER: privateMarker, HOST_QA_PUBLIC_MARKER: publicMarker })

async function serve(environment, poolFactory, action) {
  const app = express()
  const router = createQaRouter({ environment, poolFactory })
  app.use('/__host-qa', router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try { await action(`http://127.0.0.1:${server.address().port}/__host-qa/check`) }
  finally { await router.closeQa(); await new Promise(resolve => server.close(resolve)) }
}
const send = (url, body = { nonce }, authorization = `Bearer ${token}`) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body) })

test('disabled, unauthorized and unknown QA routes do not expose configuration or open a database', async () => {
  const unusedPool = () => { throw new Error('Must not connect') }
  await serve({}, unusedPool, async url => assert.equal((await send(url)).status, 404))
  await serve(configured(), unusedPool, async url => {
    assert.equal((await send(url, { nonce }, 'Bearer wrong')).status, 404)
    assert.equal((await send(url + '/unknown')).status, 404)
    assert.equal((await send(url, { nonce: '../bad' })).status, 400)
    assert.equal((await send(url, { nonce: [nonce] })).status, 400)
  })
})

test('authenticated runtime proof verifies private configuration without returning its value', async () => {
  await serve(configured(), () => { throw new Error('No DB requested') }, async url => {
    const r = await send(url)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    const body = await r.json()
    assert.equal(body.configuration.privateProof, crypto.createHmac('sha256', privateMarker).update(nonce).digest('hex'))
    assert.equal(body.configuration.publicMarker, publicMarker)
    assert.equal(body.database.checked, false)
    assert.equal(JSON.stringify(body).includes(privateMarker), false)
    assert.equal(JSON.stringify(body).includes(token), false)
  })
})

test('database check is restricted to the QA database, requires TLS and reads back a parameterized write', async () => {
  const environment = { ...configured(), DB_HOST: 'db.example.test', DB_NAME: 'host_qa_express', DB_USERNAME: 'qa_user', DB_PASSWORD: 'private-db-password' }
  const queries = []
  let stored
  let released = 0
  await serve(environment, config => {
    assert.equal(config.ssl.rejectUnauthorized, false)
    assert.equal(config.database, 'host_qa_express')
    return { connect: async () => ({ query: async (sql, values) => {
      queries.push(sql)
      if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'host_qa_express', ssl: true }] }
      if (sql.startsWith('INSERT')) { assert.deepEqual(values, [nonce]); stored = values[0] }
      return { rows: sql.startsWith('SELECT marker') && stored ? [{ marker: stored }] : [] }
    }, release: () => released++ }), end: async () => {} }
  }, async url => {
    const written = await (await send(url, { nonce, database: true, mode: 'write' })).json()
    assert.deepEqual(written.database, { checked: true, tls: true, persisted: true })
    const read = await (await send(url, { nonce, database: true })).json()
    assert.equal(read.database.persisted, true)
    assert.equal(JSON.stringify(read).includes('private-db-password'), false)
  })
  assert.equal(released, 2)
  assert.equal(queries.filter(sql => sql.startsWith('INSERT')).length, 1)
  environment.DB_NAME = 'production'
  await serve(environment, () => { throw new Error('Must not connect') }, async url => assert.equal((await send(url, { nonce, database: true })).status, 503))
})

test('database errors and missing settings do not expose credentials', async () => {
  const environment = { ...configured(), DB_HOST: 'db.example.test', DB_NAME: 'host_qa_express', DB_USERNAME: 'qa_user', DB_PASSWORD: 'private-db-password' }
  await serve(environment, () => ({ connect: async () => { throw new Error('private-db-password') }, end: async () => {} }), async url => {
    const response = await send(url, { nonce, database: true })
    assert.equal(response.status, 503)
    assert.equal((await response.text()).includes('private-db-password'), false)
  })
  await serve(configured(), () => { throw new Error('Must not connect') }, async url => assert.equal((await send(url, { nonce, database: true })).status, 503))
})

test('build rejects private runtime values and requires the enabled public build marker', () => {
  const environment = { ...process.env }
  for (const name of ['HOST_QA_PRIVATE_MARKER', 'HOST_QA_PROBE_TOKEN', 'HOST_QA_PUBLIC_MARKER', 'HOST_QA_BUILD_CHECK']) delete environment[name]
  const run = extra => spawnSync(process.execPath, ['host-qa-build-check.js'], { cwd: require('node:path').join(__dirname, '..'), env: { ...environment, ...extra }, encoding: 'utf8' })
  assert.equal(run({}).status, 0)
  assert.equal(run({ HOST_QA_BUILD_CHECK: 'true', HOST_QA_PUBLIC_MARKER: publicMarker }).status, 0)
  assert.notEqual(run({ HOST_QA_BUILD_CHECK: 'true' }).status, 0)
  const unsafe = run({ HOST_QA_PRIVATE_MARKER: privateMarker })
  assert.notEqual(unsafe.status, 0)
  assert.equal(unsafe.stderr.includes(privateMarker), false)
})
