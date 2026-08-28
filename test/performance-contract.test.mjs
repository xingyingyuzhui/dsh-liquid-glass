import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPlugin,
  clientSource,
  createFakeTimers,
  createLiveReact,
  createRectNode,
  loadClient,
  mockResizeObserver,
  mockTheme,
  flushMicrotasks,
} from './helpers/client-runtime.mjs'

function sessionNodes(stats, overrides = {}) {
  const conversation = {
    getAttribute(name) { return name === 'data-phase' ? 'active' : null },
    offsetHeight: 800,
    style: {
      props: new Map(),
      getPropertyValue(name) { return this.props.get(name) || '' },
      setProperty(name, value) {
        if (stats) stats.cssWrites += 1
        this.props.set(name, String(value))
      },
      removeProperty(name) { this.props.delete(name) },
    },
    listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn) },
    removeEventListener(name, fn) {
      if (fn === undefined || this.listeners.get(name) === fn) this.listeners.delete(name)
    },
  }
  const header = { offsetHeight: 84, style: {}, clientWidth: 732, clientHeight: 66, getAttribute() { return null } }
  const scroll = createRectNode({ top: 0, bottom: 600, height: 600, width: 720 }, stats)
  const seat = createRectNode({ top: 500, bottom: 600, height: 100, width: 720 }, stats)
  const column = createRectNode({ top: -100, bottom: 900, height: 1000, width: 720 }, stats)
  const sidebar = {
    clientWidth: 256,
    clientHeight: 654,
    getAttribute() { return null },
  }
  const pane = {
    clientWidth: 732,
    clientHeight: 655,
    getAttribute(name) { return name === 'data-phase' ? 'active' : null },
  }
  return Object.assign({
    "[data-slot='conversation'] > [data-phase]": conversation,
    "[data-slot='conversation.session.header'] > header": header,
    '[data-conversation-scroll]': scroll,
    '[data-composer-seat]': seat,
    '[data-chat-flow]': column,
    "[data-slot='sidebar'] > :first-child": sidebar,
    "[data-slot='conversation'] > [data-phase='active']": pane,
    conversation,
    header,
    scroll,
    seat,
    column,
    sidebar,
    pane,
  }, overrides)
}

function mountMetrics(options = {}) {
  const timers = options.timers || createFakeTimers()
  const ResizeObserver = options.ResizeObserver || mockResizeObserver()
  const stats = timers.stats
  const nodes = options.nodes || sessionNodes(stats)
  const live = createLiveReact()
  const storage = new Map(options.storage || [['dsh-liquid-glass:effect', 'on']])
  const { context, plugin } = loadClient(live.React, storage, { timers, ResizeObserver, nodes })
  const { entries, effects } = applyPlugin(plugin, mockTheme())
  const metrics = entries.find(item => item.entry.options.id.includes('metrics'))
  live.mount(metrics.entry.component)
  return { context, nodes, timers, stats, live, effects, ResizeObserver, entries }
}

function button(kind, rect, stats) {
  return {
    querySelector(sel) {
      if (sel !== 'svg') return null
      return {
        querySelector(inner) {
          if (kind === 'stop' && inner === 'rect') return {}
          if (kind === 'send' && inner === 'path') return {}
          return null
        },
      }
    },
    getBoundingClientRect() {
      if (stats) stats.layoutReads += 1
      return rect
    },
  }
}

function composerCard(stats, opts = {}) {
  const textarea = { value: opts.value ?? 'hello draft' }
  const plus = button('plus', { left: 20, top: 40, width: 32, height: 32 }, stats)
  const send = button('send', { left: 200, top: 40, width: 32, height: 32 }, stats)
  const stop = opts.stop === false ? null : button('stop', { left: 160, top: 40, width: 32, height: 32 }, stats)
  const buttons = [plus, send, stop].filter(Boolean)
  const card = {
    querySelector(sel) {
      if (sel === 'textarea') return textarea
      if (sel === 'button[aria-haspopup="listbox"]') return plus
      return null
    },
    getElementsByTagName(tag) {
      return tag === 'button' ? buttons : []
    },
    getBoundingClientRect() {
      if (stats) stats.layoutReads += 1
      return { left: 10, top: 10, width: 400, height: 80 }
    },
  }
  return { card, textarea, plus, send, stop, buttons }
}

test('stable draft does not keep requesting animation frames', async () => {
  const timers = createFakeTimers()
  const { card } = composerCard(timers.stats, { stop: false })
  const live = createLiveReact()
  const { plugin, context } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes: { '[data-composer-card]': card },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  await flushMicrotasks()
  const metal = entries.find(item => item.entry.options.id.includes('metal'))
  live.mount(metal.entry.component)
  timers.flushRaf()
  const afterPaint = timers.stats.rafRequested
  const queries = timers.stats.queries
  timers.advance(2000)
  assert.equal(timers.pendingFrames(), 0)
  assert.equal(timers.stats.rafRequested, afterPaint)
  assert.equal(timers.stats.queries, queries)
  context.document.dispatch('input')
  assert.equal(timers.pendingFrames(), 1)
  timers.flushRaf()
  assert.equal(timers.pendingFrames(), 0)
})

test('100 scroll events in one turn schedule a single crop frame', () => {
  const { nodes, timers, stats } = mountMetrics()
  timers.flushRaf()
  const readsBefore = stats.layoutReads
  const writesBefore = stats.cssWrites
  const framesBefore = timers.stats.rafRequested
  for (let i = 0; i < 100; i++) nodes.scroll.dispatch('scroll')
  assert.equal(timers.pendingFrames(), 1)
  assert.equal(timers.stats.rafRequested, framesBefore + 1)
  assert.equal(stats.layoutReads, readsBefore)
  timers.flushRaf()
  assert.equal(stats.layoutReads - readsBefore, 3)
  assert.equal(stats.cssWrites, writesBefore)
})

test('MetricsBridge binds when session nodes appear later', () => {
  const timers = createFakeTimers()
  const stats = timers.stats
  const nodes = {}
  const { context } = mountMetrics({ timers, nodes })
  assert.equal(nodes["[data-slot='conversation'] > [data-phase]"], undefined)
  timers.advance(5000)
  Object.assign(nodes, sessionNodes(stats))
  timers.advance(2000)
  timers.flushRaf()
  timers.flushRaf()
  assert.equal(nodes.conversation.style.getPropertyValue('--lg-header-height'), '84px')
  assert.equal(nodes.column.style.getPropertyValue('--lg-chat-clip-top'), '100px')
  assert.equal(typeof nodes.scroll.listeners.get('scroll'), 'function')
  assert.equal(typeof context.document.listeners.get('click'), 'function')
})

test('one click creates a single replaceable retry batch', () => {
  const { context, timers } = mountMetrics()
  timers.flushRaf()
  const created = timers.stats.timeoutsCreated
  context.document.dispatch('click')
  assert.ok(timers.pendingTimeouts() <= 4)
  assert.ok(timers.stats.timeoutsCreated - created <= 4)
  context.document.dispatch('click')
  assert.ok(timers.pendingTimeouts() <= 4)
})

test('timer set stays bounded after 100 clicks', () => {
  const { context, timers } = mountMetrics()
  timers.flushRaf()
  for (let i = 0; i < 100; i++) context.document.dispatch('click')
  assert.ok(timers.pendingTimeouts() <= 4)
  timers.advance(400)
  timers.flushRaf()
  assert.ok(timers.pendingTimeouts() <= 1)
})

test('replaced scroll node drops the old listener', () => {
  const { nodes, context, timers } = mountMetrics()
  timers.flushRaf()
  const oldScroll = nodes.scroll
  const nextScroll = createRectNode({ top: 0, bottom: 600, height: 600, width: 720 }, timers.stats)
  nodes['[data-conversation-scroll]'] = nextScroll
  context.document.dispatch('click')
  timers.advance(0)
  timers.flushRaf()
  assert.equal(oldScroll.listeners.has('scroll'), false)
  assert.equal(typeof nextScroll.listeners.get('scroll'), 'function')
})

test('identical island sizes do not rebuild maps', () => {
  const { stats, timers, ResizeObserver, context } = mountMetrics()
  timers.flushRaf()
  const created = stats.canvasCreates
  const started = context.window.__lgIslandLensRuntime.jobsStarted
  for (let i = 0; i < 100; i++) {
    ResizeObserver.instances[0].callback()
    timers.flushRaf()
  }
  assert.equal(stats.canvasCreates, created)
  assert.equal(context.window.__lgIslandLensRuntime.jobsStarted, started)
})

test('sidebar-only resize rebuilds only the sidebar map', async () => {
  const { nodes, stats, timers, ResizeObserver, context } = mountMetrics()
  await flushMicrotasks()
  timers.flushRaf()
  const started = context.window.__lgIslandLensRuntime.jobsStarted
  nodes.sidebar.clientWidth = 200
  ResizeObserver.instances[0].callback()
  timers.flushRaf()
  let guard = 0
  while (timers.pendingTimeouts() && guard < 2000) {
    timers.advance(0)
    guard += 1
  }
  assert.equal(context.window.__lgIslandLensRuntime.jobsStarted, started + 1)
  assert.ok(stats.canvasCreates >= 1)
})

test('metal ring ids, count and geometry match the accepted overlay', async () => {
  const timers = createFakeTimers()
  const { card, send } = composerCard(timers.stats, { stop: false })
  const live = createLiveReact()
  const { plugin } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes: { '[data-composer-card]': card },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  await flushMicrotasks()
  const metal = entries.find(item => item.entry.options.id.includes('metal'))
  live.mount(metal.entry.component)
  timers.flushRaf()
  const tree = live.rerender()
  const rings = Array.isArray(tree) ? tree : [tree]
  assert.equal(rings.length, 1)
  assert.equal(rings[0].props['data-lg-metal-ring'], 'send')
  assert.equal(rings[0].type, 'div')
  const style = rings[0].props.style
  const rect = send.getBoundingClientRect()
  assert.equal(style.position, 'fixed')
  assert.equal(style.left, rect.left - 2)
  assert.equal(style.top, rect.top - 2)
  assert.equal(style.width, rect.width + 4)
  assert.equal(style.height, rect.height + 4)
  assert.equal(style.zIndex, 20)
})

test('streaming safety checks stay at or under 10Hz and stop with the button', () => {
  const timers = createFakeTimers()
  const pack = composerCard(timers.stats, { stop: true })
  const live = createLiveReact()
  const { plugin } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes: { '[data-composer-card]': pack.card },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  live.mount(entries.find(item => item.entry.options.id.includes('metal')).entry.component)
  timers.flushRaf()
  const start = timers.stats.rafRequested
  timers.advance(1000)
  while (timers.pendingFrames()) timers.flushRaf()
  assert.ok(timers.stats.rafRequested - start <= 10)
  pack.buttons.splice(0, pack.buttons.length, pack.plus, pack.send)
  pack.stop = null
  timers.advance(100)
  timers.flushRaf()
  const afterStop = timers.stats.timeoutsCreated
  timers.advance(500)
  assert.equal(timers.stats.timeoutsCreated, afterStop)
})

test('install and glass-off skip dynamic lens jobs', () => {
  const timers = createFakeTimers()
  const off = loadClient(undefined, new Map([['dsh-liquid-glass:effect', 'off']]), { timers })
  applyPlugin(off.plugin, mockTheme())
  assert.equal(off.context.window.__lgIslandLensRuntime.syncPixelBuilds, 0)
  assert.equal(off.context.window.__lgIslandLensRuntime.jobsStarted, 0)

  const on = loadClient(undefined, new Map([['dsh-liquid-glass:effect', 'on']]), { timers: createFakeTimers() })
  applyPlugin(on.plugin, mockTheme())
  assert.equal(on.context.window.__lgIslandLensRuntime.syncPixelBuilds, 0)
})

test('stable clicks do not disconnect the resize observer', () => {
  const { context, timers, ResizeObserver } = mountMetrics()
  timers.flushRaf()
  const disconnects = ResizeObserver.instances[0].disconnects
  const reads = timers.stats.layoutReads
  for (let i = 0; i < 100; i++) context.document.dispatch('click')
  timers.advance(50)
  timers.flushRaf()
  assert.equal(ResizeObserver.instances[0].disconnects, disconnects)
  assert.ok(timers.stats.layoutReads - reads < 20)
})

test('hero phase does not poll missing chat nodes', () => {
  const timers = createFakeTimers()
  const root = {
    getAttribute(name) { return name === 'data-phase' ? 'hero' : null },
    style: { props: new Map(), getPropertyValue() { return '' }, setProperty() {}, removeProperty() {} },
    listeners: new Map(),
    addEventListener() {},
    removeEventListener() {},
  }
  mountMetrics({
    timers,
    nodes: { "[data-slot='conversation'] > [data-phase]": root },
  })
  const pending = timers.pendingTimeouts()
  timers.advance(6000)
  assert.ok(timers.pendingTimeouts() <= pending)
})

test('same-frame resize and scroll crop once', () => {
  const { nodes, timers, stats, ResizeObserver } = mountMetrics()
  timers.flushRaf()
  const reads = stats.layoutReads
  ResizeObserver.instances[0].callback()
  nodes.scroll.dispatch('scroll')
  assert.equal(timers.pendingFrames(), 1)
  timers.flushRaf()
  assert.equal(stats.layoutReads - reads, 3)
})

test('outside composer clicks do not measure button geometry', () => {
  const timers = createFakeTimers()
  const pack = composerCard(timers.stats, { stop: false })
  pack.card.contains = () => false
  const live = createLiveReact()
  const { plugin, context } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes: { '[data-composer-card]': pack.card },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  live.mount(entries.find(item => item.entry.options.id.includes('metal')).entry.component)
  timers.flushRaf()
  const reads = timers.stats.layoutReads
  for (let i = 0; i < 100; i++) context.document.dispatch('click', { target: {} })
  timers.advance(1000)
  timers.flushRaf()
  assert.ok(timers.stats.layoutReads - reads < 20)
})

test('outside clicks only keep two route probes and recover after async card swap', async () => {
  const timers = createFakeTimers()
  const first = composerCard(timers.stats, { stop: false })
  first.card.contains = () => false
  const nodes = { '[data-composer-card]': first.card }
  const live = createLiveReact()
  const { plugin, context } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes,
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  await flushMicrotasks()
  live.mount(entries.find(item => item.entry.options.id.includes('metal')).entry.component)
  timers.flushRaf()
  const reads = timers.stats.layoutReads
  for (let i = 0; i < 100; i++) context.document.dispatch('click', { target: {} })
  assert.ok(timers.pendingTimeouts() <= 2)
  assert.equal(timers.stats.layoutReads, reads)
  timers.advance(50)
  const second = composerCard(timers.stats, { stop: false })
  second.send.getBoundingClientRect = () => {
    timers.stats.layoutReads += 1
    return { left: 300, top: 80, width: 32, height: 32 }
  }
  nodes['[data-composer-card]'] = second.card
  timers.advance(350)
  timers.flushRaf()
  live.rerender()
  const tree = live.tree
  const rings = Array.isArray(tree) ? tree : [tree]
  assert.equal(rings[0].props['data-lg-metal-ring'], 'send')
  assert.equal(rings[0].props.style.left, 298)
})

test('route probe restores a composer that appears after being removed', async () => {
  const timers = createFakeTimers()
  const first = composerCard(timers.stats, { stop: false })
  first.card.contains = () => false
  const nodes = { '[data-composer-card]': first.card }
  const live = createLiveReact()
  const { plugin, context } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes,
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  await flushMicrotasks()
  live.mount(entries.find(item => item.entry.options.id.includes('metal')).entry.component)
  timers.flushRaf()
  context.document.dispatch('click', { target: {} })
  nodes['[data-composer-card]'] = null
  timers.advance(50)
  const next = composerCard(timers.stats, { stop: false })
  nodes['[data-composer-card]'] = next.card
  timers.advance(350)
  timers.flushRaf()
  const tree = live.rerender()
  const rings = Array.isArray(tree) ? tree : [tree]
  assert.equal(rings[0].props['data-lg-metal-ring'], 'send')
})

test('metal dispose clears route probes', () => {
  const timers = createFakeTimers()
  const pack = composerCard(timers.stats, { stop: false })
  pack.card.contains = () => false
  const live = createLiveReact()
  const { plugin, context } = loadClient(live.React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes: { '[data-composer-card]': pack.card },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  live.mount(entries.find(item => item.entry.options.id.includes('metal')).entry.component)
  timers.flushRaf()
  context.document.dispatch('click', { target: {} })
  live.dispose()
  assert.equal(timers.pendingTimeouts(), 0)
  assert.equal(timers.pendingFrames(), 0)
})

test('glass off skips metal layout reads', () => {
  const timers = createFakeTimers()
  const pack = composerCard(timers.stats, { stop: false })
  const live = createLiveReact()
  const { plugin, context } = loadClient(live.React, new Map(), {
    timers,
    ResizeObserver: mockResizeObserver(),
    nodes: { '[data-composer-card]': pack.card },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  live.mount(entries.find(item => item.entry.options.id.includes('metal')).entry.component)
  timers.flushRaf()
  const reads = timers.stats.layoutReads
  const queries = timers.stats.queries
  context.document.dispatch('click', { target: pack.card })
  timers.advance(1000)
  timers.flushRaf()
  assert.equal(timers.stats.layoutReads, reads)
  assert.equal(timers.stats.queries, queries)
})

test('replacing root and column clears old CSS variables', () => {
  const { nodes, context, timers } = mountMetrics()
  timers.flushRaf()
  const oldRoot = nodes.conversation
  const oldColumn = nodes.column
  assert.equal(oldRoot.style.getPropertyValue('--lg-header-height'), '84px')
  assert.equal(oldColumn.style.getPropertyValue('--lg-chat-clip-top'), '100px')
  const nextRoot = {
    getAttribute(name) { return name === 'data-phase' ? 'active' : null },
    offsetHeight: 800,
    style: {
      props: new Map(),
      getPropertyValue(name) { return this.props.get(name) || '' },
      setProperty(name, value) { this.props.set(name, String(value)) },
      removeProperty(name) { this.props.delete(name) },
    },
    listeners: new Map(),
    addEventListener() {},
    removeEventListener() {},
  }
  const nextColumn = createRectNode({ top: -50, bottom: 850, height: 900, width: 720 }, timers.stats)
  nodes["[data-slot='conversation'] > [data-phase]"] = nextRoot
  nodes['[data-chat-flow]'] = nextColumn
  context.document.dispatch('click')
  timers.advance(50)
  timers.flushRaf()
  assert.equal(oldRoot.style.getPropertyValue('--lg-header-height'), '')
  assert.equal(oldColumn.style.getPropertyValue('--lg-chat-clip-top'), '')
  assert.equal(oldColumn.style.getPropertyValue('--lg-chat-clip-bottom'), '')
  assert.equal(nextRoot.style.getPropertyValue('--lg-header-height'), '84px')
  assert.equal(nextColumn.style.getPropertyValue('--lg-chat-clip-top'), '50px')
})

test('two MetricsBridge instances release CSS only after the last dispose', () => {
  const timers = createFakeTimers()
  const ResizeObserver = mockResizeObserver()
  const nodes = sessionNodes(timers.stats)
  const disposers = []
  const React = {
    createElement(type) { return typeof type === 'function' ? type() : { type } },
    useEffect(fn) { disposers.push(fn()) },
  }
  const { plugin } = loadClient(React, new Map([['dsh-liquid-glass:effect', 'on']]), {
    timers,
    ResizeObserver,
    nodes,
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  const metrics = entries.find(item => item.entry.options.id.includes('metrics'))
  metrics.entry.component()
  metrics.entry.component()
  timers.flushRaf()
  assert.equal(nodes.conversation.style.getPropertyValue('--lg-header-height'), '84px')
  disposers[0]()
  assert.equal(nodes.conversation.style.getPropertyValue('--lg-header-height'), '84px')
  disposers[1]()
  assert.equal(nodes.conversation.style.getPropertyValue('--lg-header-height'), '')
  assert.equal(nodes.column.style.getPropertyValue('--lg-chat-clip-top'), '')
})

test('hero to active starts recovery only after the phase change', () => {
  const timers = createFakeTimers()
  let phase = 'hero'
  const root = {
    getAttribute(name) { return name === 'data-phase' ? phase : null },
    style: { props: new Map(), getPropertyValue() { return '' }, setProperty() {}, removeProperty() {} },
    listeners: new Map(),
    addEventListener() {},
    removeEventListener() {},
  }
  const nodes = { "[data-slot='conversation'] > [data-phase]": root }
  const { context } = mountMetrics({ timers, nodes })
  const before = timers.pendingTimeouts()
  timers.advance(4000)
  assert.ok(timers.pendingTimeouts() <= before)
  phase = 'active'
  context.document.dispatch('click')
  assert.ok(timers.pendingTimeouts() > 0)
  Object.assign(nodes, sessionNodes(timers.stats))
  nodes["[data-slot='conversation'] > [data-phase]"] = root
  timers.advance(1000)
  timers.flushRaf()
  assert.equal(typeof nodes.scroll.listeners.get('scroll'), 'function')
})

test('metrics dispose clears frames, timers and observers', () => {
  const { live, timers, ResizeObserver, context, nodes } = mountMetrics()
  timers.flushRaf()
  context.document.dispatch('click')
  live.dispose()
  assert.equal(timers.pendingFrames(), 0)
  assert.equal(timers.pendingTimeouts(), 0)
  assert.ok(ResizeObserver.instances[0].disconnected)
  assert.equal(context.document.listeners.has('click'), false)
  assert.equal(nodes.scroll.listeners.has('scroll'), false)
})

test('fullscreen wallpaper has no perpetual rendering mechanism', () => {
  const plate = [...clientSource.matchAll(/\[data-dsh-liquid-glass-wallpaper\][^{]*\{([^}]+)\}/g)]
    .map(match => match[1])
    .join('\n')
  assert.doesNotMatch(plate, /animation\s*:/)
  assert.doesNotMatch(plate, /transition\s*:/)
  assert.doesNotMatch(plate, /infinite/)
  assert.doesNotMatch(clientSource, /requestAnimationFrame\([^\)]*wallpaper/i)
  assert.doesNotMatch(clientSource, /setInterval\([^\)]*wallpaper/i)
  assert.doesNotMatch(clientSource, /backgroundPosition\s*=/)
  assert.doesNotMatch(clientSource, /element\.style\.transform\s*=/)
  const applyCalls = [...clientSource.matchAll(/\.applyAtmosphere\(/g)].length
  assert.equal(applyCalls, 3)
  assert.match(clientSource, /ctx\.on\('theme\/change'/)
  assert.match(clientSource, /controller\.applyAtmosphere\(theme\)/)
})


