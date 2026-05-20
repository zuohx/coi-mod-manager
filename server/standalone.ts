import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRequestHandler } from './mod-api.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.resolve(rootDir, 'dist')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const PORT = Number.parseInt(process.env.PORT ?? '5174', 10)

async function serveStatic(urlPath: string, res: ServerResponse) {
  // Normalize and prevent directory traversal
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  const filePath = normalized === '/' || normalized === ''
    ? path.join(distDir, 'index.html')
    : path.join(distDir, normalized)

  try {
    const stat = await fs.stat(filePath)
    if (stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
      const content = await fs.readFile(filePath)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
      return
    }
  } catch {
    // File not found, fall through to SPA fallback
  }

  // SPA fallback: always serve index.html for unrecognized paths
  try {
    const indexPath = path.join(distDir, 'index.html')
    const indexContent = await fs.readFile(indexPath)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(indexContent)
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Frontend not built. Run `pnpm build` first.')
  }
}

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  void handleRequestOrStatic(req, res)
})

async function handleRequestOrStatic(req: IncomingMessage, res: ServerResponse) {
  // Pass a next() that falls through to static file serving
  const requestHandler = getRequestHandler()
  
  // We create a promisified version: call handleRequest with a next that serves static
  return new Promise<void>((resolve) => {
    requestHandler(req, res, async (error?: unknown) => {
      if (error) {
        console.error('[standalone] API handler error:', error)
      }
      // Fall through to static file serving
      const url = req.url ?? '/'
      await serveStatic(url, res)
      resolve()
    })
  })
}

server.listen(PORT, () => {
  console.log(`[coi-mod-api] Standalone server running on http://localhost:${PORT}`)
})

// Handle graceful shutdown
process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
