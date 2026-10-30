// dsh-liquid-glass —— Node host half
// Serves the bundled preview wallpaper without exposing arbitrary filesystem paths.

import { readFile, mkdir, rename, writeFile, readdir, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-liquid-glass'
/* 依赖声明放在 apply 内用 ctx.inject() —— 与 dsh-global-prompt 同构。
 * 模块级 inject 会让插件在服务就绪前就被调度，pluginConfig 拿不到已解析的 config。 */

/* 服务端持久化配置(20261027)
 *
 * 背景：插件原本把全部配置放在浏览器 localStorage（9 个键），
 * 导致每个客户端都要各配一遍、换浏览器/清缓存即丢失。
 *
 * 方案：用 Cordis 的 Config 声明 + settings.update 持久化到 profile 配置文件，
 * 所有客户端共享同一份。范式同 dsh-global-prompt（已验证可用）。
 *
 * 分层原则：
 *   - 服务端：effect / skin / blur / opacity 等「统一风格」项
 *   - 本地保留：自定义壁纸图片（background.custom*，体积大且与设备相关）
 */
const configSchema = z.object({
  effect: z.union([z.const('on'), z.const('off'), z.const('')]).default(''),
  skin: z.string().default('ice'),
  wallpaper: z.string().default('ice'),
  glassBlur: z.number().default(20),
  backgroundOpacity: z.number().default(0.88),
})

/* ⚠️ 不要给 schema 标 meta.volatile（20261027 实测踩坑）。
 * 起因：settings.update() 对未标 volatile 的字段报
 *   Plugin entry "dsh-liquid-glass" has no volatile fields
 * 但标法是陷阱 —— volatile 的语义是「整个 schema 作为一个不透明块」，
 * 标在 object schema 根上会让 schemastery 校验返回空对象：
 *   validate({}) = {"value":{}}      ← 默认值全被丢弃
 *   （未标时：{"value":{"a":"x","b":3}}）
 * 结果 apply 收到的 pluginConfig 恒为 {}，配置文件里的值被无声丢弃。
 *
 * ⇒ 放弃 settings.update，改为 host 侧自己管理 JSON 配置文件（见 CONFIG_FILE）。 */
export const Config = configSchema

// PUT 白名单：只接受这些键，防止客户端把响应里附带的服务端字段透传回来。
const CONFIG_KEYS = ['effect', 'skin', 'wallpaper', 'glassBlur', 'backgroundOpacity']
const pickConfigKeys = (input) => {
  const picked = {}
  if (input === null || typeof input !== 'object') return picked
  for (const k of CONFIG_KEYS) if (k in input) picked[k] = input[k]
  return picked
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
}
function mimeForExt(ext) {
  return MIME_BY_EXT[String(ext).toLowerCase()] || 'application/octet-stream'
}

const CONFIG_ROUTE = '/api/dsh-liquid-glass/config'
export const GALLERY_INDEX_ROUTE = '/api/dsh-liquid-glass/wallpapers/index'
export const GALLERY_UPLOAD_ROUTE = '/api/dsh-liquid-glass/wallpapers/upload'
export const GALLERY_FILE_PREFIX = '/api/dsh-liquid-glass/wallpapers/file/'
export const REVISION_ROUTE = '/api/dsh-liquid-glass/revision'

/* 配置持久化：$DSH_HOME/liquid-glass/config.json
 *
 * 为什么不用 settings.update()：见上方 Config 注释 —— volatile 语义会清空
 * object schema 的默认值，导致 pluginConfig 恒为 {}。
 * 这里自己管一个 JSON 文件，不依赖 DSH 内部 API，升级不易坏。
 * 做法与 dsh-global-prompt 管理 AGENTS.md 同构。 */
export function configFilePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'liquid-glass', 'config.json')
}

async function readConfigFile() {
  try {
    const raw = await readFile(configFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_error) {
    return {}  // 文件不存在 / 损坏 → 视为空，走默认值
  }
}

/* ===== 图库持久化(20261027) =====
 *
 * 自定义壁纸图片存服务端，跨设备共享。为避免每次全量下载，采用：
 *   ① 图片按内容 sha256 前缀命名 ⇒ URL 内含内容指纹
 *   ② 该 URL 设 cache-control: immutable（照抄本插件预设壁纸的做法）
 *   ③ 内容变 ⇒ 哈希变 ⇒ URL 变 ⇒ 浏览器自动失效重取
 *   ④ 客户端另留一份 localStorage 副本，服务端不可达时仍可渲染
 *
 * 目录结构：
 *   $DSH_HOME/liquid-glass/wallpapers/
 *     ├── index.json          { "<id>": { "hash": "...", "ext": "jpg" } }
 *     └── <hash>.<ext>        原图
 */
export function wallpapersDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'liquid-glass', 'wallpapers')
}

function galleryIndexPath() {
  return join(wallpapersDir(), 'index.json')
}

async function readGalleryIndex() {
  try {
    const raw = await readFile(galleryIndexPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_error) {
    return {}
  }
}

async function writeGalleryIndex(index) {
  await mkdir(wallpapersDir(), { recursive: true })
  const target = galleryIndexPath()
  const tmp = target + '.' + process.pid + '.' + Date.now() + '.tmp'
  await writeFile(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
}

/** 从 data URL 解析出 mime 与二进制。返回 null 表示格式不认识。 */
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:image\/([a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl)
  if (match === null) return null
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg')
  return { ext, buffer: Buffer.from(match[2], 'base64') }
}

/** 存一张图，返回 { hash, ext }。同内容重复上传会复用同一文件。 */
async function storeWallpaper(dataUrl) {
  const decoded = decodeDataUrl(dataUrl)
  if (decoded === null) throw new Error('invalid image data url')
  const hash = createHash('sha256').update(decoded.buffer).digest('hex').slice(0, 32)
  const dir = wallpapersDir()
  await mkdir(dir, { recursive: true })
  const file = join(dir, hash + '.' + decoded.ext)
  try {
    await readFile(file)   // 已存在则跳过写盘
  } catch (_error) {
    const tmp = file + '.' + process.pid + '.tmp'
    await writeFile(tmp, decoded.buffer)
    await rename(tmp, file)
  }
  return { hash, ext: decoded.ext }
}

async function readWallpaperBytes(hash, ext) {
  // hash 只允许十六进制，防止路径穿越
  if (!/^[a-f0-9]{8,64}$/.test(hash)) return null
  if (!/^(png|jpg|jpeg|gif|webp|avif|bmp|svg)$/.test(ext)) return null
  try {
    return await readFile(join(wallpapersDir(), hash + '.' + ext))
  } catch (_error) {
    return null
  }
}

async function writeConfigFile(value) {
  const target = configFilePath()
  await mkdir(dirname(target), { recursive: true })
  const tmp = target + '.' + process.pid + '.' + Date.now() + '.tmp'
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, target)   // 原子替换
}

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

/* Config 字段的代码内默认值。
 * ⚠️ 不能依赖 schema 的 .default() —— 实测：当 profile 配置文件中没有该插件的
 * config 段时，apply 的第二参 pluginConfig 是 undefined，schema 默认值不会注入。
 * 因此这里显式给出默认值，pluginConfig 只作为「用户已配置过」时的覆盖层。 */
const CONFIG_DEFAULTS = {
  effect: '',
  skin: 'ice',
  wallpaper: 'ice',
  glassBlur: 20,
  backgroundOpacity: 0.88,
}

export function apply(ctx, pluginConfig) {
  const initial = { ...CONFIG_DEFAULTS, ...(pluginConfig || {}) }
  ctx.inject(['webServer', 'settings'], (sctx) => {
    install(sctx, initial, pluginConfig)
  })
}

function install(ctx, initial, pluginConfig) {
  let current = { ...initial }
  // 异步载入磁盘配置（不阻塞路由注册；载入完成后覆盖内存值与 initial）
  readConfigFile().then((saved) => {
    const merged = { ...CONFIG_DEFAULTS, ...(pluginConfig || {}) }
    for (const k of CONFIG_KEYS) if (saved[k] !== undefined) merged[k] = saved[k]
    current = merged
  }).catch(() => {})

  /* 配置读写 REST 路由。
   * GET  返回当前生效配置（供 client 初始化）
   * PUT  合并 patch 并持久化到 profile 配置（settings.update）
   * 说明：client 侧仍需保留 localStorage 作为「旧配置迁移」与「读取失败时的回退」。 */
  /* ===== 轻量版本号轮询(20261027) =====
   * 目标：设备 A 改配置 → 设备 B 不刷新也能生效。
   * 做法：服务端维护一个单调递增的 revision；客户端每 2s 用 GET 探测，
   *       值变了才去拉全量配置（几十字节 vs 全量 JSON）。
   * 为什么不用 SSE：移动端切后台/切网络会断长连接，需写重连逻辑；
   *                 轮询更简单稳当，空闲开销也可接受（每 2s 一次 304 级响应）。
   */
  let configRevision = 1

  const revisionHandler = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    // 只回一个整数，体积可忽略；no-store 防止中间层缓存导致轮询失效
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify({ revision: configRevision }))
  }

  const configHandler = async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      send(200, { ...current, __revision: configRevision })
      return
    }
    if (req.method !== 'PUT') {
      res.writeHead(405, { allow: 'GET, HEAD, PUT' })
      res.end()
      return
    }
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        // 20261027：原 64KB 过小。自定义壁纸是 base64 data URL（单张上限 2MB，
        // 图库总上限 4MB），此处放宽到 8MB 留余量。仅本插件配置，不影响其他接口。
        if (size > 8 * 1024 * 1024) throw new Error('payload too large')
        chunks.push(chunk)
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const patch = pickConfigKeys(parsed)
      if (Object.keys(patch).length === 0) {
        send(400, { error: 'no recognised config keys' })
        return
      }
      current = { ...current, ...patch }
      await writeConfigFile(current)
      configRevision += 1   // 让其他客户端的轮询探测到变更
      send(200, current)
    } catch (error) {
      send(400, { error: String(error && error.message ? error.message : error) })
    }
  }

  /* 图库索引：{ "<id>": { hash, ext, url } }。体积小，每次启动拉一次。 */
  const galleryIndexHandler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    const index = await readGalleryIndex()
    const out = {}
    for (const [id, entry] of Object.entries(index)) {
      if (entry && typeof entry.hash === 'string' && typeof entry.ext === 'string') {
        out[id] = { hash: entry.hash, ext: entry.ext, url: GALLERY_FILE_PREFIX + entry.hash + '.' + entry.ext }
        if (typeof entry.luminance === 'number') out[id].luminance = entry.luminance
      }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(out))
  }

  /* 取图。URL 内含内容哈希 ⇒ 可长期强缓存；内容变了 URL 就变，自动失效。 */
  const galleryFileHandler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    const rawPath = String((req.url || req.path || '/')).split('?')[0]
    const tail = rawPath.slice(GALLERY_FILE_PREFIX.length)
    const dot = tail.lastIndexOf('.')
    if (dot === -1) {
      res.writeHead(404)
      res.end()
      return
    }
    const buffer = await readWallpaperBytes(tail.slice(0, dot), tail.slice(dot + 1))
    if (buffer === null) {
      res.writeHead(404)
      res.end()
      return
    }
    const etag = '"' + tail + '"'
    const headers = {
      'content-type': mimeForExt(tail.slice(dot + 1)),
      'cache-control': 'public, max-age=31536000, immutable',
      'etag': etag,
      'content-length': String(buffer.byteLength),
    }
    const match = req.headers && (req.headers['if-none-match'] || req.headers['If-None-Match'])
    if (match === etag) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : buffer)
  }

  /* 上传图库条目。body: { "<id>": "<data:image/...;base64,...>", ... }
   * 同 id 重复上传会覆盖；内容相同则复用同一文件（按内容哈希）。 */
  const galleryUploadHandler = async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    if (req.method !== 'PUT' && req.method !== 'POST') {
      res.writeHead(405, { allow: 'PUT, POST' })
      res.end()
      return
    }
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 12 * 1024 * 1024) throw new Error('payload too large')
        chunks.push(chunk)
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (parsed === null || typeof parsed !== 'object') throw new Error('expected object of id -> dataUrl')
      const index = await readGalleryIndex()
      const changed = {}
      // 客户端把图片亮度以 "<id>__lum" 附加在同一 payload 里（20261027）。
 // 单独摘出来，不当作图片条目处理。
      // 客户端把图片亮度以 "<id>__lum" 附加在 payload 里（20261027 方案 B）。
      // 存亮度而非 tone：tone 依赖用户当前的不透明度，只能在渲染时才算得准。
      const lums = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (key.endsWith('__lum')) {
          const id = key.slice(0, -5)
          if (/^[A-Za-z0-9_-]{1,64}$/.test(id) && typeof value === 'number' && isFinite(value)) {
            lums[id] = Math.min(1, Math.max(0, value))
          }
        }
      }
      for (const [id, dataUrl] of Object.entries(parsed)) {
        if (id.endsWith('__lum') || id.endsWith('__tone')) continue
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue
        const stored = await storeWallpaper(dataUrl)
        // 保留已有 tone（客户端没传时不要抹掉，否则重传会丢色调）
        const luminance = (typeof lums[id] === 'number')
          ? lums[id]
          : (index[id] && typeof index[id].luminance === 'number' ? index[id].luminance : undefined)
        index[id] = (typeof luminance === 'number') ? { ...stored, luminance } : stored
        changed[id] = { ...index[id], url: GALLERY_FILE_PREFIX + stored.hash + '.' + stored.ext }
      }
      await writeGalleryIndex(index)
      send(200, changed)
    } catch (error) {
      send(400, { error: String(error && error.message ? error.message : error) })
    }
  }

  const deepwater = createWallpaperHandler()
  const ice = createIceWallpaperHandler()
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
    ctx.webServer.register({ kind: 'exact', path: CONFIG_ROUTE, handler: configHandler }),
    ctx.webServer.register({ kind: 'exact', path: REVISION_ROUTE, handler: revisionHandler }),
    ctx.webServer.register({ kind: 'exact', path: GALLERY_INDEX_ROUTE, handler: galleryIndexHandler }),
    ctx.webServer.register({ kind: 'exact', path: GALLERY_UPLOAD_ROUTE, handler: galleryUploadHandler }),
    // 取图用 prefix：URL 含内容哈希，路径无法预先枚举
    ctx.webServer.register({ kind: 'prefix', path: GALLERY_FILE_PREFIX.replace(/\/$/, ''), handler: galleryFileHandler }),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
