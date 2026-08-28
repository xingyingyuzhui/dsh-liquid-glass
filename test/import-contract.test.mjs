import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { applyPlugin, createFakeTimers, createLiveReact, findBy, flushMicrotasks, loadClient, mockTheme } from './helpers/client-runtime.mjs'

const constants = await readFile(new URL('../src/client/constants.js', import.meta.url), 'utf8')
const i18n = await readFile(new URL('../src/client/i18n.js', import.meta.url), 'utf8')
const importer = await readFile(new URL('../src/client/settings-import.js', import.meta.url), 'utf8')

function loadEncode(options = {}) {
  const revoked = []
  const listeners = new Map()
  const url = {
    createObjectURL() { return 'blob:test' },
    revokeObjectURL(value) { revoked.push(value) },
  }
  function Image() {
    this.onload = null
    this.onerror = null
    this.naturalWidth = 10
    this.naturalHeight = 10
    Object.defineProperty(this, 'src', {
      set: () => { options.onSrc?.(this) },
    })
  }
  const document = {
    visibilityState: 'visible',
    documentElement: { lang: 'zh-CN' },
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name) { listeners.delete(name) },
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: '',
            fillRect() {},
            drawImage() {},
          }
        },
        toDataURL() { return 'data:image/jpeg;base64,' + 'A'.repeat(32) },
      }
    },
  }
  const sandbox = {
    Set,
    Map,
    Math,
    URL: url,
    Image,
    document,
    navigator: { language: 'zh-CN' },
    requestIdleCallback: options.requestIdleCallback,
    cancelIdleCallback: options.cancelIdleCallback,
  }
  vm.runInNewContext(`${constants}\n${i18n}\n${importer}\nthis.encodeImageFile = encodeImageFile`, sandbox)
  return {
    encodeImageFile: sandbox.encodeImageFile,
    revoked,
    listeners,
    document,
    url,
  }
}

test('hidden page before load rejects and revokes the object URL once', async () => {
  const run = loadEncode({
    onSrc(image) {
      run.document.visibilityState = 'hidden'
      run.listeners.get('visibilitychange')()
      if (image.onload) image.onload()
    },
  })
  await assert.rejects(() => run.encodeImageFile({ type: 'image/jpeg', name: 'a.jpg', size: 12 }))
  assert.deepEqual(run.revoked, ['blob:test'])
  assert.equal(run.listeners.has('visibilitychange'), false)
})

test('hidden page after load and before idle rejects the pending encode', async () => {
  let idle
  const run = loadEncode({
    requestIdleCallback(fn) { idle = fn; return 7 },
    cancelIdleCallback() { idle = null },
    onSrc(image) { image.onload() },
  })
  const pending = run.encodeImageFile({ type: 'image/jpeg', name: 'a.jpg', size: 12 })
  run.document.visibilityState = 'hidden'
  run.listeners.get('visibilitychange')()
  await assert.rejects(() => pending)
  assert.equal(idle, null)
  assert.deepEqual(run.revoked, ['blob:test'])
})

function mountSettingsRow(options = {}) {
  const revoked = []
  const idles = []
  const images = []
  const live = createLiveReact()
  function Image() {
    this.onload = null
    this.onerror = null
    this.naturalWidth = 20
    this.naturalHeight = 20
    images.push(this)
    Object.defineProperty(this, 'src', { set() {} })
  }
  const timers = options.timers || createFakeTimers()
  const { plugin, context, fetchLog } = loadClient(live.React, options.storage || new Map(), {
    Image,
    timers,
    URL: {
      createObjectURL() { return 'blob:settings' },
      revokeObjectURL(value) { revoked.push(value) },
    },
    requestIdleCallback(fn) {
      const id = idles.length + 1
      idles.push({ id, fn })
      return id
    },
    cancelIdleCallback(id) {
      const index = idles.findIndex(item => item.id === id)
      if (index >= 0) idles.splice(index, 1)
    },
  })
  const { entries } = applyPlugin(plugin, mockTheme())
  const settings = entries.find(item => item.entry.options.name === 'settings.general.item')
  live.mount(() => {
    const wrapped = settings.entry.component({})
    return wrapped.type(wrapped.props)
  })
  return {
    live,
    context,
    plugin,
    revoked,
    images,
    get idle() { return idles[idles.length - 1]?.fn || null },
    runIdle(order = 'shift') {
      const item = order === 'pop' ? idles.pop() : idles.shift()
      if (item) item.fn()
    },
    render() {
      return live.rerender()
    },
    bag() { return live.states[1] },
    input() { return findBy(live.tree, node => node?.props?.type === 'file') },
    storage: context.window.localStorage.values,
    timers,
    fetchLog,
    /** The settings document of the most recent debounced host PUT. */
    async hostDoc() {
      timers.runAllTimeouts()
      await flushMicrotasks()
      const puts = fetchLog.filter(entry => entry.method === 'PUT')
      return puts.length === 0 ? {} : JSON.parse(puts.at(-1).body)
    },
  }
}

test('abort signal settles the promise without leaking listeners', async () => {
  const controller = new AbortController()
  const run = loadEncode({
    requestIdleCallback() { return 1 },
    cancelIdleCallback() {},
    onSrc(image) { image.onload() },
  })
  const pending = run.encodeImageFile({ type: 'image/jpeg', name: 'a.jpg', size: 12 }, controller.signal)
  controller.abort()
  await assert.rejects(pending, /AbortError/)
  assert.equal(run.listeners.has('visibilitychange'), false)
  assert.deepEqual(run.revoked, ['blob:test'])
})

test('unmounting SettingsRow aborts an in-flight encode', async () => {
  const row = mountSettingsRow()
  const file = { type: 'image/jpeg', name: 'same.jpg', size: 20, lastModified: 1 }
  row.input().props.onChange({ currentTarget: { files: [file], value: 'same.jpg' }, target: { files: [file], value: 'same.jpg' } })
  row.images[0].onload()
  assert.equal(typeof row.idle, 'function')
  const bag = row.bag()
  assert.equal(bag.controllers.length, 1)
  row.live.dispose()
  assert.equal(bag.live, false)
  assert.deepEqual(row.revoked, ['blob:settings'])
})

test('a failed encode clears lastStamp so the same file can retry', async () => {
  const row = mountSettingsRow()
  const file = { type: 'image/jpeg', name: 'same.jpg', size: 20, lastModified: 2 }
  const input = { files: [file], value: 'same.jpg' }
  row.input().props.onChange({ currentTarget: input, target: input })
  row.images[0].onerror()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(row.bag().lastStamp, '')
  assert.equal(input.value, '')
  row.input().props.onChange({ currentTarget: input, target: input })
  assert.equal(row.images.length, 2)
})

test('hidden page failure does not stay in processing and allows retry', async () => {
  const row = mountSettingsRow()
  const file = { type: 'image/jpeg', name: 'same.jpg', size: 20, lastModified: 3 }
  const input = { files: [file], value: 'same.jpg' }
  row.input().props.onChange({ currentTarget: input, target: input })
  row.context.document.visibilityState = 'hidden'
  row.context.document.dispatch('visibilitychange')
  await new Promise(resolve => setImmediate(resolve))
  const tree = row.render()
  assert.doesNotMatch(JSON.stringify(tree), /正在处理图片/)
  assert.equal(row.bag().lastStamp, '')
})

test('two imports finishing in reverse order both persist', async () => {
  const row = mountSettingsRow()
  const a = { type: 'image/jpeg', name: 'a.jpg', size: 20, lastModified: 4 }
  const b = { type: 'image/jpeg', name: 'b.jpg', size: 21, lastModified: 5 }
  row.input().props.onChange({ currentTarget: { files: [a], value: 'a.jpg' }, target: { files: [a], value: 'a.jpg' } })
  row.images[0].onload()
  row.input().props.onChange({ currentTarget: { files: [b], value: 'b.jpg' }, target: { files: [b], value: 'b.jpg' } })
  row.images[1].onload()
  row.runIdle('pop')
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve))
  row.runIdle('shift')
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve))
  const doc = await row.hostDoc()
  const library = JSON.parse(doc['dsh-liquid-glass.background.customs'] || '[]')
  assert.equal(library.length, 2)
})

test('unmounting after encode but before commit skips storage writes', async () => {
  const row = mountSettingsRow()
  const file = { type: 'image/jpeg', name: 'late.jpg', size: 20, lastModified: 6 }
  row.input().props.onChange({ currentTarget: { files: [file], value: 'late.jpg' }, target: { files: [file], value: 'late.jpg' } })
  row.images[0].onload()
  row.runIdle()
  row.live.dispose()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(row.storage.get('dsh-liquid-glass.background.customs'), undefined)
})

