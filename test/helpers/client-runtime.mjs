import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

export const clientSource = await readFile(new URL('../../client.js', import.meta.url), 'utf8')

export function createFakeTimers() {
  let nextId = 1
  let now = 0
  const pending = new Map()
  const stats = {
    timeoutsCreated: 0,
    rafRequested: 0,
    rafCancelled: 0,
    rafExecuted: 0,
    layoutReads: 0,
    cssWrites: 0,
    queries: 0,
  }

  function setTimeout(fn, ms) {
    const id = nextId++
    stats.timeoutsCreated += 1
    pending.set(id, { type: 'timeout', fn, due: now + Math.max(0, Number(ms) || 0), id })
    return id
  }

  function clearTimeout(id) {
    pending.delete(id)
  }

  function requestAnimationFrame(fn) {
    const id = nextId++
    stats.rafRequested += 1
    pending.set(id, { type: 'raf', fn, id })
    return id
  }

  function cancelAnimationFrame(id) {
    const item = pending.get(id)
    if (item && item.type === 'raf') {
      stats.rafCancelled += 1
      pending.delete(id)
    }
  }

  function pendingOf(type) {
    let count = 0
    for (const item of pending.values()) {
      if (item.type === type) count += 1
    }
    return count
  }

  function flushRaf() {
    const frames = [...pending.values()].filter(item => item.type === 'raf')
    for (const item of frames) pending.delete(item.id)
    for (const item of frames) {
      stats.rafExecuted += 1
      item.fn(now)
    }
    return frames.length
  }

  function advance(ms) {
    now += Math.max(0, Number(ms) || 0)
    const due = [...pending.values()]
      .filter(item => item.type === 'timeout' && item.due <= now)
      .sort((a, b) => a.due - b.due || a.id - b.id)
    for (const item of due) {
      if (!pending.has(item.id)) continue
      pending.delete(item.id)
      item.fn()
    }
  }

  function runAllTimeouts() {
    const seen = new Set()
    while (true) {
      const due = [...pending.values()].filter(item => item.type === 'timeout' && !seen.has(item.id))
      if (due.length === 0) break
      for (const item of due) {
        seen.add(item.id)
        pending.delete(item.id)
        item.fn()
      }
    }
  }

  return {
    setTimeout,
    clearTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,
    stats,
    now: () => now,
    pendingTimeouts: () => pendingOf('timeout'),
    pendingFrames: () => pendingOf('raf'),
    flushRaf,
    advance,
    runAllTimeouts,
  }
}

function attachListenerApi(target) {
  target.listeners = new Map()
  target.listenerFns = new Map()
  target.addEventListener = function (name, fn) {
    const list = this.listenerFns.get(name) || []
    list.push(fn)
    this.listenerFns.set(name, list)
    this.listeners.set(name, fn)
  }
  target.removeEventListener = function (name, fn) {
    const list = this.listenerFns.get(name) || []
    const next = fn === undefined ? [] : list.filter(item => item !== fn)
    if (next.length > 0) {
      this.listenerFns.set(name, next)
      this.listeners.set(name, next[next.length - 1])
    } else {
      this.listenerFns.delete(name)
      this.listeners.delete(name)
    }
  }
  target.dispatch = function (name, event) {
    const list = [...(this.listenerFns.get(name) || [])]
    for (const fn of list) fn(event)
  }
  return target
}

export function createStyleMap(values = new Map(), stats = null) {
  return {
    props: values,
    filter: '',
    getPropertyValue(name) { return values.get(name) || '' },
    setProperty(name, value) {
      if (stats) stats.cssWrites += 1
      values.set(name, String(value))
    },
    removeProperty(name) { values.delete(name) },
  }
}

export function createRectNode(rect, stats = null) {
  const values = new Map()
  return attachListenerApi({
    style: createStyleMap(values, stats),
    getBoundingClientRect() {
      if (stats) stats.layoutReads += 1
      return rect
    },
  })
}

/** Let pending microtask chains (settings hydration, PUT queue) settle. */
export function flushMicrotasks(rounds = 12) {
  let chain = Promise.resolve()
  for (let i = 0; i < rounds; i++) chain = chain.then(() => {})
  return chain
}

export function loadClient(requireReact = undefined, storage = new Map(), options = {}) {
  let plugin
  const timers = options.timers || null
  const stats = timers ? timers.stats : (options.stats || { queries: 0, layoutReads: 0, cssWrites: 0 })
  const nodes = options.nodes || {}
  const head = {
    tags: [],
    append(tag) {
      tag.parentNode = this
      this.tags.push(tag)
    },
  }
  const body = attachListenerApi({
    attributes: new Map(),
    children: [],
    style: createStyleMap(new Map(), stats),
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null },
    setAttribute(name, value) { this.attributes.set(name, value) },
    removeAttribute(name) { this.attributes.delete(name) },
    prepend(element) { element.parentNode = this; this.children.unshift(element) },
    contains(element) { return this.children.includes(element) },
    querySelectorAll() { return [] },
  })
  const localStorage = options.brokenStorage
    ? {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    : {
      values: storage,
      getItem(name) { return this.values.has(name) ? this.values.get(name) : null },
      setItem(name, value) { this.values.set(name, String(value)) },
      removeItem(name) { this.values.delete(name) },
    }
  const document = attachListenerApi({
    head,
    visibilityState: 'visible',
    documentElement: { lang: 'zh-CN', style: { colorScheme: 'dark' } },
    querySelector(selector) {
      stats.queries += 1
      if (String(selector).includes('data-plugin-css')) {
        return head.tags.find(tag => tag.dataset?.pluginCss) ?? null
      }
      return nodes[selector] ?? null
    },
    querySelectorAll() { return [] },
    createElement(tagName) {
      if (tagName === 'style') {
        return {
          dataset: {},
          textContent: '',
          parentNode: null,
          remove() {
            if (this.parentNode !== null) {
              this.parentNode.tags = this.parentNode.tags.filter(item => item !== this)
              this.parentNode = null
            }
          },
        }
      }
      if (tagName === 'div') {
        return {
          attributes: new Map(),
          style: { cssText: '', backgroundImage: '', filter: '', opacity: '' },
          parentNode: null,
          setAttribute(name, value) { this.attributes.set(name, value) },
          removeAttribute(name) { this.attributes.delete(name) },
          remove() {
            if (this.parentNode !== null) {
              this.parentNode.children = this.parentNode.children.filter(item => item !== this)
              this.parentNode = null
            }
          },
        }
      }
      if (tagName === 'canvas') {
        stats.canvasCreates = (stats.canvasCreates || 0) + 1
        if (typeof options.createCanvas === 'function') return options.createCanvas()
        if (options.Image) {
          return {
            width: 0,
            height: 0,
            getContext() {
              return {
                fillStyle: '',
                fillRect() {},
                drawImage() {},
                createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) } },
                putImageData() {},
              }
            },
            toDataURL() { return 'data:image/jpeg;base64,' + 'A'.repeat(40) },
          }
        }
        return {
          width: 0,
          height: 0,
          getContext() { return null },
          toDataURL() { return 'data:image/jpeg;base64,xx' },
        }
      }
      throw new Error(`unexpected element: ${tagName}`)
    },
    body,
  })
  const windowApi = attachListenerApi({
    localStorage,
    __ModuleLoader__: {
      load(definition) {
        plugin = definition.factory(mod => mod === 'react' ? requireReact : undefined)
      },
    },
  })
  // Host settings document mock: GET serves the current document (a bare {}
  // until the host has been written), PUT adopts and stores the body.
  const fetchLog = []
  let hostSettingsDoc = options.hostSettings ?? null
  const fetchImpl = (url, init = {}) => {
    fetchLog.push({ url, method: init.method || 'GET', body: init.body })
    if ((init.method || 'GET') === 'GET') {
      const doc = hostSettingsDoc ?? {}
      return Promise.resolve({ ok: true, json: () => Promise.resolve(doc) })
    }
    hostSettingsDoc = JSON.parse(init.body)
    return Promise.resolve({ ok: true })
  }
  const context = {
    Set,
    Map,
    WeakMap,
    AbortController,
    Uint8ClampedArray,
    document,
    navigator: { language: 'zh-CN' },
    getComputedStyle() { return { getPropertyValue() { return '' }, borderTopLeftRadius: '' } },
    ResizeObserver: options.ResizeObserver,
    setTimeout: timers ? timers.setTimeout : setTimeout,
    clearTimeout: timers ? timers.clearTimeout : clearTimeout,
    fetch: fetchImpl,
    requestIdleCallback: options.requestIdleCallback,
    cancelIdleCallback: options.cancelIdleCallback,
    Image: options.Image,
    URL: options.URL || { createObjectURL() { return 'blob:test' }, revokeObjectURL() {} },
    FileReader: options.FileReader,
    window: windowApi,
  }
  if (timers) {
    context.requestAnimationFrame = timers.requestAnimationFrame
    context.cancelAnimationFrame = timers.cancelAnimationFrame
    windowApi.requestAnimationFrame = timers.requestAnimationFrame
    windowApi.cancelAnimationFrame = timers.cancelAnimationFrame
  }
  vm.runInNewContext(clientSource, context, { filename: 'client.js' })
  return { context, plugin, nodes, stats, timers, fetchLog }
}

export function mockTheme(initial = {}) {
  let preference = initial.preference ?? 'system'
  let colorScheme = initial.colorScheme ?? 'light'
  const overrides = []
  const themeSets = []
  return {
    overrides,
    themeSets,
    get preference() { return preference },
    set preference(value) { preference = value },
    set colorScheme(value) { colorScheme = value },
    setTheme(id) {
      themeSets.push(id)
      preference = id
      if (id === 'light' || id === 'dark') colorScheme = id
    },
    getTheme() {
      return { preference, active: { id: preference, colorScheme, tokens: {} }, themes: [], revision: 1 }
    },
    overrideTokens(source, tokens) {
      overrides.push({ source, tokens })
      return () => {
        const index = overrides.findIndex(item => item.source === source)
        if (index >= 0) overrides.splice(index, 1)
      }
    },
  }
}

export function makeReact() {
  const states = []
  let index = 0
  return {
    reset() { index = 0 },
    createElement(type, props, ...children) { return { type, props, children } },
    useState(initial) {
      const current = index
      index += 1
      if (!(current in states)) states[current] = typeof initial === 'function' ? initial() : initial
      return [states[current], (value) => {
        states[current] = typeof value === 'function' ? value(states[current]) : value
      }]
    },
    useEffect() { return undefined },
  }
}

export function createLiveReact() {
  const states = []
  const effectFns = []
  const disposers = []
  let cursor = 0
  let component = null
  let tree = null
  let mounted = false

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    useState(initial) {
      const current = cursor
      cursor += 1
      if (!(current in states)) states[current] = typeof initial === 'function' ? initial() : initial
      return [states[current], (value) => {
        states[current] = typeof value === 'function' ? value(states[current]) : value
      }]
    },
    useEffect(fn) {
      effectFns.push(fn)
    },
  }

  function render(comp = component) {
    component = comp
    cursor = 0
    effectFns.length = 0
    const raw = typeof component === 'function' ? component() : component
    tree = raw
    return tree
  }

  function mount(comp) {
    render(comp)
    if (!mounted) {
      mounted = true
      for (const fn of effectFns) disposers.push(fn())
    }
    return tree
  }

  function rerender() {
    return render(component)
  }

  function dispose() {
    for (const fn of disposers.splice(0).reverse()) {
      if (typeof fn === 'function') fn()
    }
    mounted = false
  }

  return {
    React,
    mount,
    rerender,
    dispose,
    get tree() { return tree },
    states,
    disposers,
  }
}

export function findBy(node, predicate) {
  if (node && typeof node === 'object' && predicate(node)) return node
  const children = node?.children
  if (!Array.isArray(children)) return null
  for (const child of children.flat()) {
    const hit = findBy(child, predicate)
    if (hit) return hit
  }
  return null
}

export function applyPlugin(plugin, theme, extras = {}) {
  const entries = []
  const effects = []
  plugin.apply({
    get(name) {
      if (name === 'theme') return theme
      if (name === 'slots') {
        return {
          inject(slot, callback) {
            const entry = callback()
            entries.push({ slot, entry })
            return () => {
              const index = entries.indexOf(entries.find(item => item.entry === entry))
              if (index >= 0) entries.splice(index, 1)
            }
          },
          register(options, component) { return { options, component } },
        }
      }
      return extras.get?.(name)
    },
    effect(callback) { effects.push(callback()) },
    on: extras.on || (() => () => {}),
  })
  return { entries, effects }
}

export function mockResizeObserver() {
  function ResizeObserver(callback) {
    this.callback = callback
    this.targets = []
    this.disconnects = 0
    ResizeObserver.instances.push(this)
  }
  ResizeObserver.instances = []
  ResizeObserver.prototype.observe = function (node) {
    if (!this.targets.includes(node)) this.targets.push(node)
  }
  ResizeObserver.prototype.unobserve = function (node) {
    this.targets = this.targets.filter(item => item !== node)
  }
  ResizeObserver.prototype.disconnect = function () {
    this.disconnected = true
    this.disconnects += 1
    this.targets = []
  }
  return ResizeObserver
}
