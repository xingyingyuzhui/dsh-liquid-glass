// dsh-liquid-glass —— Node host half
// Serves the bundled preview wallpaper without exposing arbitrary filesystem paths.
// Also serves the settings document: browser localStorage is per-origin and the
// DSH web server listens on a fresh port every launch, so browser storage loses
// the skin settings on each restart. The host keeps them in one JSON file at a
// stable path instead (atomic tmp+rename writes, flat string map only).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-liquid-glass'
export const inject = ['webServer']

export const WALLPAPER_CONTENT_HASH = 'b209a409aea86fd6f572b3ac6025b8370e5e925533215a1414df8e432e5eab31'
export const WALLPAPER_HASH_PREFIX = WALLPAPER_CONTENT_HASH.slice(0, 16)
const WALLPAPER_PATH = new URL('./assets/liquid-glass-deepwater.jpg', import.meta.url)
export const WALLPAPER_ROUTE_LEGACY = '/dsh-liquid-glass/assets/liquid-glass-deepwater.jpg'
export const WALLPAPER_ROUTE = '/dsh-liquid-glass/assets/liquid-glass-deepwater.' + WALLPAPER_HASH_PREFIX + '.jpg'

export const ICE_WALLPAPER_CONTENT_HASH = 'f25a2221e0e8910761b52df1f43b77ec79c8f8b7e917fbdd5ce1696ba921b2eb'
export const ICE_WALLPAPER_HASH_PREFIX = ICE_WALLPAPER_CONTENT_HASH.slice(0, 16)
const ICE_WALLPAPER_PATH = new URL('./assets/liquid-glass-ice.jpg', import.meta.url)
export const ICE_WALLPAPER_ROUTE_LEGACY = '/dsh-liquid-glass/assets/liquid-glass-ice.jpg'
export const ICE_WALLPAPER_ROUTE = '/dsh-liquid-glass/assets/liquid-glass-ice.' + ICE_WALLPAPER_HASH_PREFIX + '.jpg'

export const WALLPAPER_ROUTES = [
  WALLPAPER_ROUTE,
  WALLPAPER_ROUTE_LEGACY,
  ICE_WALLPAPER_ROUTE,
  ICE_WALLPAPER_ROUTE_LEGACY,
]

function createStaticImageHandler({ read, contentHash, hashedRoute }) {
  let cachedBuffer = null
  let inflightRead = null
  const etag = '"' + contentHash + '"'

  function loadImage() {
    if (cachedBuffer !== null) return Promise.resolve(cachedBuffer)
    if (inflightRead !== null) return inflightRead
    inflightRead = Promise.resolve()
      .then(() => read())
      .then((buffer) => {
        cachedBuffer = buffer
        inflightRead = null
        return buffer
      }, (error) => {
        inflightRead = null
        throw error
      })
    return inflightRead
  }

  function requestPath(req) {
    const raw = req && (req.url || req.path) ? String(req.url || req.path) : hashedRoute
    return raw.split('?')[0]
  }

  function cacheControl(path) {
    if (path === hashedRoute) return 'public, max-age=31536000, immutable'
    return 'no-cache, max-age=0, must-revalidate'
  }

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    try {
      const cached = await loadImage()
      const path = requestPath(req)
      const headers = {
        'content-type': 'image/jpeg',
        'cache-control': cacheControl(path),
        'etag': etag,
        'content-length': String(cached.byteLength),
      }
      const match = req.headers && (req.headers['if-none-match'] || req.headers['If-None-Match'])
      if (match === etag) {
        res.writeHead(304, headers)
        res.end()
        return
      }
      res.writeHead(200, headers)
      res.end(req.method === 'HEAD' ? undefined : cached)
    } catch (_error) {
      cachedBuffer = null
      inflightRead = null
      res.writeHead(404)
      res.end()
    }
  }
}

export function createWallpaperHandler(readWallpaper = () => readFile(WALLPAPER_PATH)) {
  return createStaticImageHandler({
    read: readWallpaper,
    contentHash: WALLPAPER_CONTENT_HASH,
    hashedRoute: WALLPAPER_ROUTE,
  })
}

export function createIceWallpaperHandler(readWallpaper = () => readFile(ICE_WALLPAPER_PATH)) {
  return createStaticImageHandler({
    read: readWallpaper,
    contentHash: ICE_WALLPAPER_CONTENT_HASH,
    hashedRoute: ICE_WALLPAPER_ROUTE,
  })
}

export const SETTINGS_ROUTE = '/dsh-liquid-glass/settings.json'
// 6 imported wallpapers × 4 MB data-URL budget plus JSON overhead.
export const MAX_SETTINGS_BODY_BYTES = 8 * 1024 * 1024
const EMPTY_SETTINGS = '{}'
const SETTINGS_PATH = resolveSettingsPath()

/** Stable settings path, independent of the per-launch listen port. */
export function resolveSettingsPath(env = process.env, home = homedir()) {
  const root = env.DSH_HOME || join(home, '.dsh')
  return join(root, 'plugins', 'dsh-liquid-glass', 'settings.json')
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        fail(new Error('payload too large'))
        if (typeof req.destroy === 'function') req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', fail)
  })
}

/** Accept only a flat settings map: short string keys, string-or-null values. */
export function isPlainSettingsMap(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length > 32) return false
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) return false
    const item = value[key]
    if (typeof item !== 'string' && item !== null) return false
  }
  return true
}

/**
 * Settings route handler. `io` is injectable for tests; the default keeps the
 * document in memory after the first read and serialises writes through one
 * chain so concurrent PUTs can never interleave tmp-file renames.
 */
export function createSettingsHandler(io) {
  const readText = io ? io.read : null
  const writeText = io ? io.write : null
  let cached = null
  let writeChain = Promise.resolve()

  const defaultRead = () => {
    if (cached !== null) return Promise.resolve(cached)
    return readFile(SETTINGS_PATH, 'utf8')
      .catch(() => EMPTY_SETTINGS)
      .then((text) => {
        cached = text
        return text
      })
  }

  const defaultWrite = (text) => {
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(SETTINGS_PATH), { recursive: true })
      const tmp = SETTINGS_PATH + '.tmp'
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, SETTINGS_PATH)
    })
    return writeChain
  }

  const doRead = readText || defaultRead
  const doWrite = writeText || defaultWrite

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'PUT') {
      res.writeHead(405, { allow: 'GET, HEAD, PUT' })
      res.end()
      return
    }
    try {
      if (req.method === 'PUT') {
        const raw = await readRequestBody(req, MAX_SETTINGS_BODY_BYTES)
        let parsed
        try { parsed = JSON.parse(raw.toString('utf8')) } catch (_error) { parsed = null }
        if (!isPlainSettingsMap(parsed)) {
          res.writeHead(400)
          res.end()
          return
        }
        await doWrite(raw.toString('utf8'))
        if (cached !== null) cached = raw.toString('utf8')
        res.writeHead(204)
        res.end()
        return
      }
      const text = await doRead()
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : text)
    } catch (error) {
      const tooLarge = error && error.message === 'payload too large'
      res.writeHead(tooLarge ? 413 : 500)
      res.end()
    }
  }
}


export function apply(ctx) {
  const deepwater = createWallpaperHandler()
  const ice = createIceWallpaperHandler()
  const settings = createSettingsHandler()
  const disposers = [
    ...[WALLPAPER_ROUTE, WALLPAPER_ROUTE_LEGACY].map((path) => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: deepwater,
    })),
    ...[ICE_WALLPAPER_ROUTE, ICE_WALLPAPER_ROUTE_LEGACY].map((path) => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: ice,
    })),
    ctx.webServer.register({
      kind: 'exact',
      path: SETTINGS_ROUTE,
      handler: settings,
    }),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
