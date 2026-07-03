import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

import { buildDownloadSegments, downloadArchive, probeDownloadMeta } from './downloader'
import { handleRequest } from './routes'
import { collectLocalMods, enrichMod } from './mods'
import {
  HUB_MODS_LIST_URL,
  applyHubCookiesFromString,
  buildHubBrowserHeaders,
  ensureHubCookies,
  extractChangelogFromHtml,
  extractDownloadUrlFromDetailHtml,
  extractFileSizeFromDetailHtml,
  getHubConfigPath,
  getHubCookieHeader,
  loadHubCookiesFromConfig,
  readHubConfigCookie,
  resetHubCookies,
  resetHubSearchCache,
  searchHub,
  warmHubPage,
} from './hub'

export function createModApiPlugin(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    void handleRequest(req, res, next)
  }

  return {
    name: 'coi-mod-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export function getRequestHandler() {
  return handleRequest
}

export const __test = {
  collectLocalMods,
  extractDownloadUrlFromDetailHtml,
  extractFileSizeFromDetailHtml,
  extractChangelogFromHtml,
  enrichMod,
  downloadArchive,
  buildDownloadSegments,
  probeDownloadMeta,
  ensureHubCookies,
  getHubCookieHeader,
  resetHubCookies,
  resetHubSearchCache,
  searchHub,
  applyHubCookiesFromString,
  buildHubBrowserHeaders,
  warmHubPage,
  HUB_MODS_LIST_URL,
  getHubConfigPath,
  loadHubCookiesFromConfig,
  readHubConfigCookie,
}
