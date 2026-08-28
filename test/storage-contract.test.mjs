import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const constants = await readFile(new URL('../src/client/constants.js', import.meta.url), 'utf8')
const storage = await readFile(new URL('../src/client/storage.js', import.meta.url), 'utf8')
const wallpaper = await readFile(new URL('../src/client/wallpaper-state.js', import.meta.url), 'utf8')

/**
 * Loads the storage + wallpaper layers against a fake host document. `host`
 * is the document a GET serves (null = the host has never been written);
 * `legacy` prefills localStorage; `puts`/`gets` collect the traffic.
 */
function loadStorage({ host = null, legacy = new Map(), failFetch = false } = {}) {
  const puts = []
  const gets = []
  const timers = []
  const sandbox = {
    Set,
    Map,
    window: { localStorage: memoryStorage(legacy) },
    Math,
    setTimeout(fn) { timers.push(fn); return timers.length },
    fetch(url, init = {}) {
      if (failFetch) return Promise.reject(new Error('offline'))
      if ((init.method || 'GET') === 'GET') {
        gets.push(1)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(host ?? {}) })
      }
      puts.push(init.body)
      return Promise.resolve({ ok: true })
    },
  }
  vm.runInNewContext(
    `${constants}\n${storage}\n${wallpaper}\nthis.api = {
  saveBackgroundState: saveBackgroundState,
  readBackgroundState: readBackgroundState,
  readGlassEnabled: readGlassEnabled,
  readCustomLibrary: readCustomLibrary,
  canPersistLibrary: canPersistLibrary,
  hydrate: hydrateSettings,
  storageGet: storageGet,
  storageSet: storageSet,
}`,
    sandbox,
  )
  return {
    api: sandbox.api,
    legacy: sandbox.window.localStorage,
    puts,
    gets,
    /** Runs pending debounce timers and lets the PUT queue settle. */
    async flush() {
      while (timers.length > 0) timers.shift()()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    },
  }
}

function memoryStorage(initial = new Map()) {
  const values = new Map(initial instanceof Map ? initial : Object.entries(initial))
  return {
    values,
    getItem(name) { return values.has(name) ? values.get(name) : null },
    setItem(name, value) { values.set(name, String(value)) },
    removeItem(name) { values.delete(name) },
  }
}

function settle(rounds = 8) {
  let chain = Promise.resolve()
  for (let i = 0; i < rounds; i++) chain = chain.then(() => {})
  return chain
}

test('six small custom images still persist', () => {
  const run = loadStorage()
  const library = Array.from({ length: 6 }, (_, i) => ({
    id: `custom-${i}`,
    data: `data:image/jpeg;base64,${'A'.repeat(20 + i)}`,
  }))
  assert.equal(run.api.saveBackgroundState(library[5].id, library[5].data, 0.88, library), true)
  assert.equal(run.api.readCustomLibrary().length, 6)
})

test('over-budget library is rejected before any write', async () => {
  const run = loadStorage({ host: {
    __v: '1',
    'dsh-liquid-glass.background': 'ice',
    'dsh-liquid-glass.background.opacity': '0.88',
  } })
  await run.api.hydrate()
  await settle()
  const huge = `data:image/jpeg;base64,${'B'.repeat(3 * 1024 * 1024)}`
  const library = [
    { id: 'custom-a', data: `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}` },
    { id: 'custom-b', data: huge },
  ]
  assert.equal(run.api.canPersistLibrary(library.slice(0, 1), huge), false)
  assert.equal(run.api.saveBackgroundState('custom-b', huge, 0.88, library), false)
  assert.equal(run.api.storageGet('dsh-liquid-glass.background'), 'ice')
  assert.equal(run.api.storageGet('dsh-liquid-glass.background.customs'), null)
})

test('legacy custom key is still readable after migration', async () => {
  const run = loadStorage({ legacy: new Map([
    ['dsh-liquid-glass.background', 'custom'],
    ['dsh-liquid-glass.background.custom', 'data:image/jpeg;base64,legacy'],
  ]) })
  await run.api.hydrate()
  await settle()
  const state = run.api.readBackgroundState({ getTheme() { return { active: { colorScheme: 'light' } } } })
  assert.equal(state.id, 'custom')
  assert.equal(state.custom, 'data:image/jpeg;base64,legacy')
  assert.equal(state.customs[0].id, 'custom')
})

test('a later commit that rereads the library keeps the earlier import', () => {
  const run = loadStorage()
  assert.equal(run.api.saveBackgroundState('custom-b', 'data:image/jpeg;base64,bbb', 0.88, [
    { id: 'custom-b', data: 'data:image/jpeg;base64,bbb' },
  ]), true)
  const latest = run.api.readCustomLibrary()
  latest.push({ id: 'custom-a', data: 'data:image/jpeg;base64,aaa' })
  assert.equal(run.api.saveBackgroundState('custom-a', 'data:image/jpeg;base64,aaa', 0.88, latest), true)
  assert.equal(JSON.stringify(run.api.readCustomLibrary().map(item => item.id).sort()), JSON.stringify(['custom-a', 'custom-b']))
})

test('hydrate adopts a versioned host document and never touches localStorage', async () => {
  const legacy = new Map([['dsh-liquid-glass:effect', 'off']])
  const run = loadStorage({ host: {
    __v: '1',
    'dsh-liquid-glass:effect': 'on',
    'dsh-liquid-glass.glass.blur': '30',
  }, legacy })
  await run.api.hydrate()
  await settle()
  assert.equal(run.api.readGlassEnabled(), true)
  assert.equal(run.api.storageGet('dsh-liquid-glass.glass.blur'), '30')
  // The host copy wins over legacy localStorage, and nothing is re-uploaded.
  assert.equal(run.puts.length, 0)
  assert.equal(run.legacy.getItem('dsh-liquid-glass:effect'), 'off')
})

test('an unwritten host adopts legacy localStorage once and uploads it', async () => {
  const run = loadStorage({ legacy: new Map([
    ['dsh-liquid-glass:effect', 'on'],
    ['dsh-liquid-glass.background', 'deepwater'],
    ['dsh-liquid-glass.background.opacity', '0.51'],
  ]) })
  await run.api.hydrate()
  await settle()
  assert.equal(run.api.readGlassEnabled(), true)
  assert.equal(run.api.storageGet('dsh-liquid-glass.background.opacity'), '0.51')
  assert.equal(run.puts.length, 1)
  const doc = JSON.parse(run.puts[0])
  assert.equal(doc.__v, '1')
  assert.equal(doc['dsh-liquid-glass.background'], 'deepwater')
})

test('a write that races the hydrate survives it', async () => {
  const run = loadStorage({ legacy: new Map([
    ['dsh-liquid-glass.background', 'ice'],
  ]) })
  // A mutation lands before the GET resolves (memory copy starts empty).
  run.api.storageSet('dsh-liquid-glass:effect', 'on')
  await run.api.hydrate()
  await settle()
  // The racing write wins; unset keys still adopt the migration source.
  assert.equal(run.api.readGlassEnabled(), true)
  assert.equal(run.api.storageGet('dsh-liquid-glass.background'), 'ice')
  const doc = JSON.parse(run.puts.at(-1))
  assert.equal(doc['dsh-liquid-glass:effect'], 'on')
  assert.equal(doc['dsh-liquid-glass.background'], 'ice')
})

test('mutations debounce into one versioned PUT', async () => {
  const run = loadStorage({ host: { __v: '1' } })
  await run.api.hydrate()
  await settle()
  run.api.storageSet('dsh-liquid-glass:effect', 'on')
  run.api.storageSet('dsh-liquid-glass.glass.blur', '12')
  run.api.storageSet('dsh-liquid-glass:effect', null)
  await run.flush()
  assert.equal(run.puts.length, 1)
  const doc = JSON.parse(run.puts[0])
  assert.equal(doc.__v, '1')
  assert.equal(doc['dsh-liquid-glass:effect'], undefined)
  assert.equal(doc['dsh-liquid-glass.glass.blur'], '12')
})

test('a failed hydrate keeps defaults and the plugin still works', async () => {
  const run = loadStorage({ failFetch: true })
  await run.api.hydrate()
  await settle()
  assert.equal(run.api.readGlassEnabled(), false)
  assert.equal(run.api.saveBackgroundState('ice', null, 0.6), true)
  assert.equal(run.api.storageGet('dsh-liquid-glass.background'), 'ice')
})
