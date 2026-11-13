# Cyclic - Express Hello World

This is a basic starter Expressjs app with:

- Static file hosting
- Logging Middleware
- Catch-all handler that echoes request info

## Local Quick Start

- Clone to your local
- Install dependencies `npm install`
- Run locally `npm run serve` or `npm start`
- Make requests
  - Browser: `http://localhost:3000/some/path?q=query+one&q=second+query&single=value`
  - Command line: `curl -i -XGET "http://localhost:3000/cmd/line-curl"`

## Netlify Functions

This branch runs the full Express backend through a Netlify Function. The existing
public folder is served by Netlify's CDN; routes without a matching static file
are rewritten to the Express function. Local `npm start` continues to use server.js.

```sh
npm ci
npm test
npm run build
```

Connect this branch in Netlify with the repository root as the base directory.
The committed netlify.toml sets the build command, public publish folder, function
directory and Node 22 version. It replaces the earlier static-only base of public.
Check `/` for the frontend and `/api/health` for a JSON response from Express.

The adapter uses serverless-http as described in the
[Netlify Express guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/).
Netlify's function execution/memory limits apply, and in-memory state/files are not
durable. The original diagnostic catch-all reflects request information; use only
test values when exercising it.

## Cyclic deployment

[![Deploy to Cyclic](https://deploy.cyclic.app/button.svg)](https://deploy.cyclic.app/)
- Sets up instant continuous deployment on `git push`
- Realtime backend logs and API request monitoring

### Cyclic Runtime

- Cyclic hosts your app on serverless infrastructure. That means there is no guarantee of memory or file system persistence between requests.
- The runtime expects a nodejs entry point defined as:
  - package.json "main" field defines the entry point file (if missing uses index.js)
  - Entry point starts a server on `process.env.PORT`

## Say Hi

Ask a question or give us a shout out:

- 💌 hello@cyclic.sh
- 🐣 https://twitter.com/cyclicsoftware
