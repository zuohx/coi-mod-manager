import fs from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { HUB_BASE, ensureHubCookies, extractChangelogFromHtml, fetchText } from './hub'
import { upgradeMod } from './installer'
import {
  collectLocalMods,
  ensurePathInside,
  findManifestPath,
  getDefaultModsDir,
  getManifestAuthors,
  getManifestDisplayName,
  getManifestUrl,
  enrichMod,
  sortModRecords,
  sortScanResponse,
  toPendingMod,
} from './mods'
import { mapWithConcurrency } from './util'
import type { NextFunction, UpgradeProgress, UpgradeRequest } from './types'

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFunction
) {
  applyCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (!req.url) {
    next()
    return
  }

  const url = new URL(req.url, 'http://localhost')

  const knownRoutes = ['/api/mods/scan', '/api/mods/upgrade', '/api/mods/local', '/api/mods/check', '/api/mods/changelog']
  if (!knownRoutes.includes(url.pathname)) {
    next()
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/mods/scan') {
      await streamScan(res)
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/mods/local') {
      await handleLocalScan(res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/mods/check') {
      const body = await readJsonBody<{ installDir: string }>(req)
      await handleCheckMod(res, body)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/mods/upgrade') {
      const body = await readJsonBody<UpgradeRequest>(req)
      await streamUpgrade(res, body)
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/mods/changelog') {
      const hubUrl = url.searchParams.get('url') ?? ''
      await handleChangelog(res, hubUrl)
      return
    }

    sendJson(res, 405, { message: 'Method not allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { message })
  }
}

async function streamScan(res: ServerResponse) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    await ensureHubCookies(true)
    const dirPath = getDefaultModsDir()
    const localMods = await collectLocalMods(dirPath)
    const pending = sortModRecords(localMods.map(toPendingMod))

    writeEvent(res, {
      type: 'start',
      dirPath,
      mods: pending,
    })

    const enriched: Awaited<ReturnType<typeof enrichMod>>[] = []
    await mapWithConcurrency(localMods, 4, async (localMod) => {
      const mod = await enrichMod(localMod, true)
      enriched.push(mod)
      writeEvent(res, { type: 'mod', mod })
    })

    const result = sortScanResponse(dirPath, enriched)
    writeEvent(res, {
      type: 'complete',
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeEvent(res, {
      type: 'error',
      message,
    })
  } finally {
    res.end()
  }
}

async function handleLocalScan(res: ServerResponse) {
  const dirPath = getDefaultModsDir()
  const localMods = await collectLocalMods(dirPath)
  const pending = sortModRecords(localMods.map(toPendingMod))
  sendJson(res, 200, { dirPath, mods: pending })
}

async function handleCheckMod(res: ServerResponse, body: { installDir: string }) {
  const dirPath = getDefaultModsDir()
  const installDir = body.installDir ? path.resolve(body.installDir) : ''
  if (!installDir) {
    sendJson(res, 400, { message: 'Missing installDir' })
    return
  }

  ensurePathInside(dirPath, installDir)

  const manifestPath = await findManifestPath(installDir)
  if (!manifestPath) {
    sendJson(res, 404, { message: 'Manifest not found' })
    return
  }

  const manifestText = await fs.readFile(manifestPath, 'utf8')
  const parsed = JSON.parse(manifestText)
  const displayName = getManifestDisplayName(parsed) ?? String(parsed.id ?? '')
  const authors = getManifestAuthors(parsed)

  const localMod = {
    id: String(parsed.id ?? ''),
    version: String(parsed.version ?? ''),
    displayName,
    sizeText: '-',
    authors,
    manifestPath,
    installDir,
    hubUrl: getManifestUrl(parsed, ['hubUrl', '_hubUrl']),
    hubVersion: getManifestUrl(parsed, ['hubVersion', '_hubVersion']),
  }

  const enriched = await enrichMod(localMod, true)
  sendJson(res, 200, enriched)
}

async function handleChangelog(res: ServerResponse, hubUrl: string) {
  if (!hubUrl || !hubUrl.startsWith(`${HUB_BASE}/Mod/`)) {
    sendJson(res, 400, { message: 'Missing or invalid Hub URL' })
    return
  }

  const html = await fetchText(hubUrl)
  const entries = extractChangelogFromHtml(html)
  sendJson(res, 200, entries)
}

async function streamUpgrade(res: ServerResponse, body: UpgradeRequest) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')

  const sendProgress = (progress: UpgradeProgress) => {
    writeEvent(res, {
      type: 'progress',
      progress,
    })
  }

  try {
    const result = await upgradeMod(body, sendProgress)
    writeEvent(res, {
      type: 'complete',
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeEvent(res, {
      type: 'error',
      message,
    })
  } finally {
    res.end()
  }
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const text = Buffer.concat(chunks).toString('utf8')
  return text ? (JSON.parse(text) as T) : ({} as T)
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function writeEvent(res: ServerResponse, payload: unknown) {
  res.write(`${JSON.stringify(payload)}\n`)
}
