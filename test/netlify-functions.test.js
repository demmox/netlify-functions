const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const app = require('../app')
const { handler } = require('../netlify/functions/api')

function event(path, overrides = {}) {
  return {
    httpMethod: 'GET',
    path,
    headers: { host: 'example.netlify.app' },
    queryStringParameters: {},
    multiValueQueryStringParameters: {},
    requestContext: { identity: { sourceIp: '127.0.0.1' } },
    body: null,
    isBase64Encoded: false,
    ...overrides
  }
}

function body(response) {
  return response.isBase64Encoded
    ? Buffer.from(response.body, 'base64').toString('utf8')
    : response.body
}

test('Netlify function serves the Express health route', async () => {
  const response = await handler(event('/api/health'), {})

  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(body(response)), {
    status: 'ok', service: 'express-hello-world'
  })
})

test('direct Netlify function URLs reach the same Express routes', async () => {
  const response = await handler(event('/.netlify/functions/api/api/health'), {})

  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(body(response)), {
    status: 'ok', service: 'express-hello-world'
  })
})

test('Netlify function preserves backend methods, routes and repeated query values', async () => {
  const response = await handler(event('/inspect', {
    httpMethod: 'POST',
    queryStringParameters: { single: 'value', q: 'second' },
    multiValueQueryStringParameters: { q: ['first', 'second'], single: ['value'] }
  }), {})
  const result = JSON.parse(body(response))

  assert.equal(response.statusCode, 200)
  assert.equal(result.method, 'POST')
  assert.deepEqual(result.query, { q: ['first', 'second'], single: 'value' })
})

test('Netlify function can serve the existing homepage', async () => {
  const response = await handler(event('/'), {})

  assert.equal(response.statusCode, 200)
  assert.match(body(response), /Hello World!/)
})

test('the local Express app serves both frontend assets and backend routes', async () => {
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}`
    const health = await fetch(`${base}/api/health`)
    const css = await fetch(`${base}/main.css`)

    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok', service: 'express-hello-world' })
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type'), /text\/css/)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
