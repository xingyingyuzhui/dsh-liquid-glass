import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createFakeTimers, findBy, flushMicrotasks, loadClient, makeReact, mockTheme } from './helpers/client-runtime.mjs'
import { loadFixture, select } from './helpers/fixture-dom.mjs'

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function cssBlocks(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
  return [...clientSource.matchAll(new RegExp(escaped + '(?:\\s*,[^/{]*)?\\s*\\{([^}]+)\\}', 'g'))].map(match => match[1])
}

function cssBlock(selector) {
  return cssBlocks(selector)[0] || ''
}

const FIXED_CONTAINING_BLOCK = /backdrop-filter\s*:\s*(?!none\b)|(?<!-webkit-|backdrop-)filter\s*:|transform\s*:|perspective\s*:|contain\s*:\s*(?:paint|layout)|will-change\s*:\s*(?:transform|filter)|content-visibility\s*:/

test('source has no dangerous runtime mechanisms', () => {
  assert.doesNotMatch(clientSource, /unifyHeader/)
  assert.doesNotMatch(clientSource, /restoreMovedTabs/)
  assert.doesNotMatch(clientSource, /classifyGlass/)
  assert.doesNotMatch(clientSource, /stampGlass/)
  assert.doesNotMatch(clientSource, /stampChrome/)
  assert.doesNotMatch(clientSource, /startGlassStamper/)
  assert.doesNotMatch(clientSource, /new MutationObserver/)
  assert.doesNotMatch(clientSource, /data-dsh-glass/)
  assert.equal([...clientSource.matchAll(/getBoundingClientRect\(\)/g)].length, 4)
  assert.doesNotMatch(clientSource, /appendChild\(/)
  assert.doesNotMatch(clientSource, /url\(#dsh-liquid-glass-refract\)/)
  assert.doesNotMatch(clientSource, /querySelectorAll\(\s*['"]button/)
})

test('CSS uses official slot anchors and drops the broken surface selectors', () => {
  assert.match(clientSource, /\[data-slot='sidebar'\] > :first-child/)
  assert.match(clientSource, /\[data-slot='conversation'\] > \[data-phase='active'\]::before/)
  assert.match(clientSource, /\[data-slot='conversation'\] > \[data-phase='settling'\]::before/)
  assert.doesNotMatch(clientSource, /\[data-variant='think'\],/)
  assert.match(clientSource, /\[data-slot='conversation'\] > \[data-phase\]/)
  assert.match(clientSource, /\[data-slot='conversation\.session\.header'\] > header/)
  assert.match(clientSource, /\[data-slot='conversation\.session\.header\.utilities'\] > \*/)
  assert.match(clientSource, /\[data-slot='conversation\.session'\] > :first-child/)
  assert.match(clientSource, /\[data-conversation-scroll\] \[data-chat-flow\]/)
  assert.match(clientSource, /\[data-slot='conversation\.composer\.dock'\] > :first-child/)
  assert.doesNotMatch(clientSource, /\[data-time-hover-root\]\[data-turn-tail\] > :last-child:has\(button\) \{/)
  assert.doesNotMatch(clientSource, /\[data-time-hover-root\]:not\(\[data-turn-tail\]\) > :last-child:has\(button\) \{/)
  assert.match(clientSource, /\[data-slot='sidebar\.settings'\] > button\[aria-haspopup='dialog'\]/)
  assert.doesNotMatch(clientSource, /\[data-slot='sidebar\.settings'\] > \*/)
  assert.doesNotMatch(clientSource, /\[data-sidebar-collapsed\]\s*>\s*:first-child/)
  assert.doesNotMatch(clientSource, /\[data-phase\]\s*>\s*header/)
  assert.doesNotMatch(clientSource, /\[data-phase\]:has\(>\s*\[data-conversation-scroll\]\)/)
  assert.match(clientSource, /prefers-reduced-motion/)
  assert.match(clientSource, /forced-colors/)
})

test('CSS blacklist: scroll owner and composer seat keep official geometry', () => {
  assert.doesNotMatch(clientSource, /\[data-conversation-scroll\][^{]*\{[^}]*(overflow-y|overflow-x|scrollbar-gutter|flex-direction)/)
  const scroll = cssBlock('[data-conversation-scroll]')
  assert.match(scroll, /margin-inline:\s*var\(--lg-pane-gutter\)/)
  assert.match(scroll, /margin-bottom:\s*var\(--lg-pane-gutter\)/)
  assert.doesNotMatch(scroll, /border-bottom/)
  assert.doesNotMatch(clientSource, /--lg-scroll-foot/)
  const seat = cssBlock("[data-composer-seat]")
  assert.match(seat, /background/)
  assert.doesNotMatch(seat, /position/)
  assert.doesNotMatch(seat, /sticky/)
  assert.doesNotMatch(seat, /bottom/)
  assert.doesNotMatch(seat, /z-index/)
  const mask = cssBlock("[data-slot='conversation'] > [data-phase='active'] [data-composer-seat]::before")
  assert.equal(mask, '')
  assert.doesNotMatch(clientSource, /--lg-composer-mask/)
})

test('message action rows are not glass islands and do not clip tooltips', () => {
  assert.doesNotMatch(clientSource, /\[data-time-hover-root\] button\s*\{/)
  assert.equal(cssBlock("[data-time-hover-root][data-turn-tail] > :last-child:has(button)"), '')
  assert.equal(cssBlock("[data-time-hover-root]:not([data-turn-tail]) > :last-child:has(button)"), '')
  assert.doesNotMatch(clientSource, /\[data-time-hover-root\][^{]*overflow:\s*hidden/)
  const openFlow = cssBlock("[data-conversation-scroll] [data-chat-flow]:has([role='tooltip'])")
  assert.match(openFlow, /clip-path:\s*none/)
})

test('official 47f943859b Chat fixture matches the surface selectors', async () => {
  const root = await loadFixture('dsh-47f943859b.html')
  const expandedSidebar = select(root, '[data-slot="sidebar"] > :first-child')
  assert.ok(expandedSidebar.length >= 2, 'expanded and collapsed fixtures both expose SidebarRoot')
  const collapsed = select(root, '[data-sidebar-collapsed] [data-slot="sidebar"] > :first-child')
  assert.equal(collapsed.length, 1)
  const header = select(root, '[data-slot="conversation.session.header"] > header')
  assert.equal(header.length, 1)
  const phaseRoots = select(root, '[data-slot="conversation"] > [data-phase]')
  assert.equal(phaseRoots.length, 1)
  const textareas = select(root, 'textarea[data-phase]')
  assert.equal(textareas.length, 1)
  assert.notEqual(textareas[0], phaseRoots[0])
  assert.equal(select(root, '[data-slot="conversation.session"] > :first-child').length, 1)
  assert.equal(select(root, '[data-composer-card]').length, 1)
  assert.equal(select(root, '[data-composer-seat]').length, 1)
  assert.equal(select(root, '[data-slot="conversation.composer.dock"] > :first-child').length, 1)
  assert.equal(select(root, '[data-slot="conversation.session.header"] > header > :first-child').length, 1)
  assert.equal(select(root, '[data-slot="conversation.session.header.utilities"] > *').length, 1)
  assert.equal(select(root, '[data-time-hover-root][data-turn-tail] > :last-child:has(> button)').length, 1)
  assert.equal(select(root, '[data-time-hover-root]:not([data-turn-tail]) > :last-child:has(> button)').length, 1)
  assert.equal(select(root, '[data-conversation-scroll]').length, 1)
  assert.equal(select(root, '[data-conversation-scroll] [data-chat-flow]').length, 1)
  assert.equal(select(root, '[data-slot="sidebar.workspaces"] > :first-child > :first-child button').length, 6)
})

test('Trajectory fixture is a separate view frame, not Chat sizing', async () => {
  const root = await loadFixture('dsh-47f943859b-trajectory.html')
  const view = select(root, '[data-slot="conversation.session"] > :first-child')
  assert.equal(view.length, 1)
  assert.equal(select(view[0], '[data-conversation-composer-overlay]').length, 1)
  assert.match(clientSource, /:has\(\[data-conversation-composer-overlay\]\)/)
})

test('settings trigger selector hits one button and never the overlay', async () => {
  const root = await loadFixture('dsh-47f943859b-settings-open.html')
  assert.equal(select(root, '[data-slot="sidebar.settings"] > button[aria-haspopup="dialog"]').length, 1)
  const overlay = select(root, '[data-slot="sidebar.settings"] > [role="presentation"]')
  assert.equal(overlay.length, 1)
  assert.equal(select(root, '[role="dialog"]').length, 1)
  assert.equal(select(root, '[data-liquid-glass-settings]').length, 1)
  const triggerRule = cssBlock("[data-slot='sidebar.settings'] > button[aria-haspopup='dialog']")
  assert.match(triggerRule, /border-radius:\s*var\(--lg-radius-control\)/)
  assert.match(triggerRule, /width:\s*auto\s*!important/)
  assert.match(triggerRule, /height:\s*38px/)
  assert.match(triggerRule, /margin:\s*4px 2px 8px\s*!important/)
  assert.match(triggerRule, /background:\s*var\(--lg-control-bg\)/)
  const railTriggerRule = cssBlock("[data-sidebar-collapsed] [data-slot='sidebar.settings'] > button[aria-haspopup='dialog']")
  assert.match(railTriggerRule, /width:\s*36px\s*!important/)
  assert.match(railTriggerRule, /height:\s*36px/)
  assert.match(railTriggerRule, /margin:\s*8px auto 10px\s*!important/)
  assert.match(railTriggerRule, /border-radius:\s*50%/)
  const overlayRule = cssBlock("[data-slot='sidebar.settings'] > [role='presentation']")
  assert.match(overlayRule, /padding:\s*0/)
  assert.doesNotMatch(overlayRule, /999px/)
  assert.doesNotMatch(overlayRule, /padding:\s*6px/)
  assert.doesNotMatch(clientSource, /\[data-slot='sidebar\.settings'\] > \*/)
})

test('open settings does not rebuild the sidebar stacking context', () => {
  assert.doesNotMatch(
    clientSource,
    /:has\(\[data-slot='sidebar\.settings'\] > \[role='presentation'\]\) \[data-slot='sidebar'\] > :first-child \{/,
  )
  const root = cssBlock("[data-slot='sidebar'] > :first-child")
  assert.match(root, /isolation:\s*isolate/)
  assert.match(root, /z-index:\s*2/)
})

test('tooltips do not rebuild the sidebar stacking context', () => {
  assert.doesNotMatch(clientSource, /:has\(\[role='tooltip'\]\) \[data-slot='sidebar'\]/)
  const tip = cssBlock("[role='tooltip']")
  assert.match(tip, /var\(--lg-overlay-bg\)/)
  assert.match(tip, /var\(--lg-text-primary\)/)
  assert.match(tip, /backdrop-filter/)
  assert.doesNotMatch(tip, /position\s*:/)
  assert.doesNotMatch(tip, /z-index\s*:/)
})

test('session HoverCard portal uses glass material and theme text', () => {
  const card = cssBlock("body[data-dsh-liquid-glass] > [role='button'][aria-label]")
  assert.match(card, /var\(--lg-overlay-bg\)/)
  assert.match(card, /var\(--lg-text-primary\)/)
  assert.match(card, /backdrop-filter/)
  assert.doesNotMatch(card, /position\s*:/)
  assert.doesNotMatch(card, /z-index\s*:/)
  assert.doesNotMatch(card, /#2C2C2E|#FFFFFF|#CFD3D6|#ADB2B8/)
  const title = cssBlock("body[data-dsh-liquid-glass] > [role='button'][aria-label] > div > div:first-child")
  assert.match(title, /var\(--lg-text-primary\)/)
  const meta = cssBlock("body[data-dsh-liquid-glass] > [role='button'][aria-label] > div > div:not(:first-child)")
  assert.match(meta, /var\(--lg-text-secondary\)/)
})

test('structure ancestors that can host fixed overlays do not create containing blocks', () => {
  const ancestors = [
    "[data-slot='sidebar'] > :first-child",
    "[data-slot='conversation'] > [data-phase]",
    "[data-slot='conversation.session'] > :first-child:not(:has([data-conversation-composer-overlay]))",
    "[data-slot='conversation.session'] > :first-child:has([data-conversation-composer-overlay])",
    "[data-composer-seat]",
    "[data-slot='sidebar.settings'] > [role='presentation']",
  ]
  for (const selector of ancestors) {
    const blocks = cssBlocks(selector)
    assert.ok(blocks.length > 0, `missing rule for ${selector}`)
    for (const block of blocks) {
      assert.doesNotMatch(block, FIXED_CONTAINING_BLOCK, selector)
    }
  }
  const dialog = cssBlock("[role='dialog']")
  assert.doesNotMatch(dialog, FIXED_CONTAINING_BLOCK)
  assert.doesNotMatch(dialog, /position\s*:/)
  assert.doesNotMatch(dialog, /inset\s*:/)
  assert.doesNotMatch(dialog, /display\s*:/)
  assert.doesNotMatch(dialog, /flex-direction\s*:/)
  assert.doesNotMatch(dialog, /max-width\s*:/)
  assert.doesNotMatch(dialog, /overflow\s*:/)
  assert.doesNotMatch(dialog, /z-index\s*:/)
})

test('sidebar shell geometry stays official; only ::before inset changes when collapsed', () => {
  const root = cssBlock("[data-slot='sidebar'] > :first-child")
  assert.match(root, /isolation:\s*isolate/)
  assert.match(root, /z-index:\s*2/)
  assert.doesNotMatch(root, /margin/)
  assert.doesNotMatch(root, /max-width/)
  assert.doesNotMatch(root, /height:\s*calc/)
  assert.doesNotMatch(root, /width\s*:/)
  assert.doesNotMatch(root, /backdrop-filter/)
  const shell = cssBlock("[data-slot='sidebar'] > :first-child::before")
  assert.match(shell, /top:\s*var\(--lg-title-top\)/)
  assert.match(shell, /right:\s*var\(--lg-island-split\)/)
  assert.match(shell, /bottom:\s*var\(--lg-pane-gutter\)/)
  assert.match(shell, /left:\s*var\(--lg-pane-gutter\)/)
  assert.match(shell, /border-radius:\s*var\(--lg-radius-shell\)/)
  assert.match(shell, /backdrop-filter/)
  const collapsed = cssBlock("[data-sidebar-collapsed] [data-slot='sidebar'] > :first-child::before")
  assert.match(collapsed, /top:\s*var\(--lg-title-top\)/)
  assert.match(collapsed, /right:\s*3px/)
  assert.match(collapsed, /bottom:\s*4px/)
  assert.match(collapsed, /left:\s*3px/)
  assert.match(collapsed, /border-radius:\s*var\(--lg-radius-shell\)/)
  assert.doesNotMatch(clientSource, /\[data-sidebar-collapsed\] \[data-slot='sidebar'\] > :first-child \{/)
})

test('expanded sidebar capsule islands share the official new-session baseline', () => {
  const settings = cssBlock("[data-slot='sidebar.settings'] > button[aria-haspopup='dialog']")
  assert.match(settings, /width:\s*auto\s*!important/)
  assert.match(settings, /height:\s*38px/)
  assert.match(settings, /margin:\s*4px 2px 8px\s*!important/)
  assert.match(settings, /padding:\s*0 14px\s*!important/)
  assert.match(settings, /justify-content:\s*center/)
  assert.match(settings, /background:\s*var\(--lg-control-bg\)/)
  assert.match(clientSource, /\*:has\(> \[data-slot='sidebar'\]\) \{[\s\S]*border-right:\s*none/)
  const selected = cssBlock("[role='treeitem'][aria-selected='true']")
  assert.equal(selected, '')
  assert.doesNotMatch(clientSource, /\[data-slot='sidebar'\] \[role='treeitem'\] \{/)
  assert.match(cssBlock("[data-side='sidebar']"), /margin-left:\s*0/)
  assert.equal(cssBlock("[data-slot='sidebar.workspaces'] > :first-child > :first-child button"), '')
})

test('Ice wallpaper uses the same static image plate as deepwater', () => {
  assert.doesNotMatch(clientSource, /--lg-ice/)
  assert.doesNotMatch(clientSource, /setAttribute\('data-ice'/)
  assert.doesNotMatch(clientSource, /@keyframes\s+dsh-lg-ice/)
  assert.doesNotMatch(clientSource, /animation:\s*dsh-lg-ice/)
  assert.equal(cssBlock('[data-dsh-liquid-glass-wallpaper][data-ice]'), '')
  assert.match(clientSource, /ICE_WALLPAPER_URL = '\/dsh-liquid-glass\/assets\/liquid-glass-ice\.' \+ ICE_WALLPAPER_HASH \+ '\.jpg'/)
  assert.match(clientSource, /id: 'ice', css: 'url\("' \+ ICE_WALLPAPER_URL \+ '"\)'/)
  assert.match(clientSource, /id: 'deepwater', css: 'url\("' \+ DEEPWATER_WALLPAPER_URL \+ '"\)'/)
  const plate = cssBlock('[data-dsh-liquid-glass-wallpaper]')
  assert.match(plate, /background-size:\s*cover/)
  assert.doesNotMatch(plate, /animation\s*:/)
  assert.doesNotMatch(plate, /infinite/)
  assert.doesNotMatch(plate, /transform\s*:/)
})

test('wallpaper is never globally blurred; glass blur updates CSS variables only', async () => {
  const storage = new Map([
    ['dsh-liquid-glass:effect', 'on'],
    ['dsh-liquid-glass.glass.blur', '28'],
    ['dsh-liquid-glass.background.opacity', '0.7'],
    ['dsh-liquid-glass.background.blur', '60'],
  ])
  const { context, plugin } = loadClient(undefined, storage)
  plugin.apply({
    get() { return mockTheme() },
    effect(callback) { callback() },
    on() { return () => {} },
  })
  await flushMicrotasks()
  const wall = context.document.body.children[0]
  assert.equal(wall.style.filter, 'none')
  assert.equal(wall.style.opacity, '0.7')
  assert.equal(context.document.body.style.getPropertyValue('--lg-glass-blur'), '28px')
  assert.doesNotMatch(cssBlock('[data-dsh-liquid-glass-wallpaper]'), /filter\s*:/)
  assert.doesNotMatch(clientSource, /element\.style\.filter = background/)
})

test('structure hosts do not carry filter or backdrop-filter on the node itself', () => {
  const hosts = [
    "[data-dsh-liquid-glass-wallpaper]",
    "body[data-dsh-liquid-glass]",
    "[data-slot='sidebar'] > :first-child",
    "[data-slot='conversation'] > [data-phase]",
    "[data-conversation-scroll]",
    "[data-slot='conversation.session'] > :first-child:not(:has([data-conversation-composer-overlay]))",
    "[data-slot='conversation.session'] > :first-child:has([data-conversation-composer-overlay])",
    "[data-composer-seat]",
  ]
  for (const selector of hosts) {
    for (const block of cssBlocks(selector)) {
      assert.doesNotMatch(block, /backdrop-filter/)
      assert.doesNotMatch(block, /(?<!backdrop-)filter\s*:/)
    }
  }
  const scroller = cssBlock('[data-conversation-scroll]')
  assert.match(scroller, /margin-inline:\s*var\(--lg-pane-gutter\)/)
  assert.match(scroller, /clip-path:\s*inset\(var\(--lg-pane-gutter\) 0 0 0 round var\(--lg-radius-shell\)\)/)
  assert.doesNotMatch(scroller, /overflow/)
  assert.doesNotMatch(scroller, /scrollbar-gutter/)
  const heroScroll = cssBlock("[data-slot='conversation'] > [data-phase='hero'] [data-conversation-scroll]")
  assert.match(heroScroll, /clip-path:\s*inset\(0 round var\(--lg-radius-shell\)\)/)
  assert.match(cssBlock('[data-conversation-scroll]:has([role=\'tooltip\'])'), /clip-path:\s*none/)
})

test('each glass island owns a local ::before material', () => {
  const layers = [
    "[data-slot='sidebar'] > :first-child::before",
    "[data-slot='conversation.session.header'] > header::before",
    "[data-slot='conversation'] > [data-phase='active']::before",
    "[data-slot='conversation'] > [data-phase='hero']::before",
    "[data-composer-card]::before",
  ]
  for (const selector of layers) {
    assert.match(cssBlock(selector), /backdrop-filter/)
  }
  const pane = cssBlock("[data-slot='conversation'] > [data-phase='active']::before")
  assert.match(pane, /--lg-header-height/)
  assert.match(pane, /left:\s*var\(--lg-island-split\)/)
  assert.match(clientSource, /--lg-island-split:\s*4px/)
  assert.match(clientSource, /--lg-title-foot:\s*8px/)
  assert.match(clientSource, /--lg-island-gap:\s*3px/)
  assert.match(clientSource, /--lg-dock-gap:\s*6px/)
  assert.match(pane, /top:\s*calc\(var\(--lg-header-height, 84px\) \+ var\(--lg-island-gap\)\)/)
  const title = cssBlock("[data-slot='conversation.session.header'] > header::before")
  assert.match(title, /top:\s*var\(--lg-title-top\)/)
  assert.match(title, /left:\s*var\(--lg-island-split\)/)
  assert.match(title, /right:\s*var\(--lg-pane-gutter\)/)
  assert.match(title, /bottom:\s*var\(--lg-title-foot\)/)
  assert.match(title, /var\(--lg-pane-bg\)/)
  assert.match(title, /-webkit-backdrop-filter:\s*url\(#lg-island-lens-title\)/)
  assert.match(title, /url\(#lg-island-lens-title\)/)
  assert.match(title, /blur\(var\(--lg-blur-shell\)\) saturate\(var\(--lg-lens-saturate\)\)/)
  assert.match(clientSource, /filterUnits="objectBoundingBox"/)
  assert.match(clientSource, /primitiveUnits="objectBoundingBox"/)
  assert.doesNotMatch(clientSource, /--lg-lens-blur-base/)
  assert.doesNotMatch(clientSource, /--lg-lens-blur-mix/)
  assert.match(pane, /url\(#lg-island-lens-pane\)/)
  assert.match(cssBlock("[data-slot='sidebar'] > :first-child::before"), /url\(#lg-island-lens-sidebar\)/)
  assert.doesNotMatch(title, /(?<!backdrop-)filter:\s*url/)
  assert.doesNotMatch(pane, /(?<!backdrop-)filter:\s*url/)
  assert.match(clientSource, /buildIslandLensMap/)
  assert.match(clientSource, /measureIslandShapes/)
  assert.match(clientSource, /var ISLAND_LENS = \{/)
  assert.match(clientSource, /strength: 0\.14/)
  assert.match(clientSource, /depthPx: 16/)
  assert.match(clientSource, /bendPx: 14/)
  assert.match(clientSource, /rimFadePx: 5/)
  assert.match(clientSource, /sheen: 0/)
  assert.match(clientSource, /dispersion: 0\.06/)
  assert.match(clientSource, /mapSize: 768/)
  assert.match(clientSource, /islandMapSize/)
  assert.match(title, /border-radius:\s*var\(--lg-radius-shell\)/)
  assert.match(title, /clip-path:\s*inset\(0 round var\(--lg-radius-shell\)\)/)
  assert.match(pane, /clip-path:\s*inset\(0 round var\(--lg-radius-shell\)\)/)
  assert.match(cssBlock("[data-slot='sidebar'] > :first-child::before"), /overflow:\s*hidden/)
  assert.match(pane, /overflow:\s*hidden/)
  assert.match(title, /overflow:\s*hidden/)

  assert.match(clientSource, /DISPERSION_SPREAD/)
  assert.match(clientSource, /islandDisplacementScale/)
  assert.match(clientSource, /feColorMatrix/)
  assert.doesNotMatch(clientSource, /snellBevelShift/)
  assert.doesNotMatch(clientSource, /ior: 1\.52/)
  assert.doesNotMatch(clientSource, /lipInner:/)
  assert.match(clientSource, /--lg-lens-saturate:\s*160%/)
  assert.doesNotMatch(title, /--lg-blur-card/)
  assert.doesNotMatch(title, /clamp\(/)
  const sideCardToggles = cssBlock(
    "body[data-dsh-liquid-glass][data-dsh-sidebar-collapsed] [data-dsh-better-sidebar] > :first-child",
  )
  assert.match(sideCardToggles, /top:\s*14px/)
  assert.doesNotMatch(sideCardToggles, /position/)
  assert.doesNotMatch(sideCardToggles, /right/)
  assert.doesNotMatch(sideCardToggles, /z-index/)
  assert.doesNotMatch(clientSource, /W-zNGW_/)
  assert.match(pane, /bottom:\s*8px/)
  assert.doesNotMatch(pane, /--lg-composer-height/)
  assert.match(pane, /pointer-events:\s*none/)
  assert.match(pane, /border-radius/)
  assert.doesNotMatch(pane, /border:\s*1px/)
  const rim = cssBlock("[data-slot='conversation'] > [data-phase='active']::after")
  assert.match(rim, /--lg-header-height/)
  assert.match(rim, /top:\s*calc\(var\(--lg-header-height, 84px\) \+ var\(--lg-island-gap\)\)/)
  assert.match(rim, /bottom:\s*8px/)
  assert.doesNotMatch(rim, /--lg-composer-height/)
  assert.doesNotMatch(rim, /linear-gradient/)
  assert.match(rim, /background:\s*transparent/)
  assert.match(rim, /inset 0 0 0 1px var\(--lg-border\)/)
  assert.doesNotMatch(rim, /--lg-shadow-shell/)
  assert.doesNotMatch(clientSource, /--lg-shadow-shell/)
  assert.doesNotMatch(clientSource, /0 10px 36px|0 12px 36px|0 10px 28px|0 12px 28px|0 12px 32px/)
  assert.match(clientSource, /--lg-shadow-card:\s*inset/)
  assert.doesNotMatch(
    clientSource.replace(/--lg-shadow-card:[^;]+/g, ''),
    /0\s+\d+px\s+\d+px\s+(?:0\s+)?rgba/,
  )
  assert.match(rim, /pointer-events:\s*none/)
  const view = cssBlock("[data-slot='conversation.session'] > :first-child:not(:has([data-conversation-composer-overlay]))")
  assert.doesNotMatch(view, /border\s*:/)
  assert.doesNotMatch(view, /border-radius/)
  assert.doesNotMatch(view, /box-shadow/)
  assert.doesNotMatch(view, /backdrop-filter/)
  assert.doesNotMatch(view, /margin/)
  const flow = cssBlock("[data-conversation-scroll] [data-chat-flow]")
  assert.match(flow, /--lg-chat-clip-top/)
  assert.match(flow, /--lg-chat-clip-bottom/)
  assert.match(flow, /--lg-chat-clip-bottom, 0px\) \+ var\(--lg-pane-gutter\)/)
  assert.doesNotMatch(flow, /--lg-chat-clip-top, 0px\) \+ 20px/)
  assert.match(flow, /padding-bottom:\s*6px/)
  assert.doesNotMatch(flow, /background/)
  assert.doesNotMatch(flow, /backdrop-filter/)
  const stats = cssBlock("[data-slot='conversation.composer.dock'] > :first-child")
  assert.match(stats, /font-size:\s*12px/)
  assert.match(stats, /line-height:\s*20px/)
  assert.match(stats, /height:\s*auto/)
  assert.doesNotMatch(stats, /height:\s*36px/)
  assert.doesNotMatch(stats, /line-height:\s*36px/)
  assert.match(stats, /width:\s*fit-content/)
  assert.match(stats, /max-width:\s*100%/)
  assert.match(stats, /margin:\s*0 auto/)
  assert.doesNotMatch(stats, /--dsh-composer-card-max-width/)
  const bar = cssBlock("[data-composer-seat] :has(> [data-composer-card])")
  assert.match(bar, /gap:\s*var\(--lg-dock-gap\)/)
  assert.match(bar, /padding-bottom:\s*var\(--lg-dock-gap\)/)
  const card = cssBlock("[data-composer-card]")
  assert.match(card, /box-shadow:\s*none/)
  assert.doesNotMatch(clientSource, /\[data-composer-card\]:focus-within/)
  assert.match(cssBlock("[role='menu']"), /--lg-overlay-bg/)
  const composerHover = cssBlock("[data-composer-card] button:hover:not(:disabled)")
  assert.match(composerHover, /--lg-text-primary/)
  assert.doesNotMatch(composerHover, /rgba\(255, 255, 255, 0\.22\)/)
  const sendHover = cssBlock("[data-composer-card] button:has(> svg[width='16']):hover:not(:disabled)")
  assert.match(sendHover, /--dsw-alias-button-info-hover/)
  assert.match(sendHover, /color:\s*#fff/)
  assert.match(clientSource, /@keyframes dsh-lg-metal-spin/)
  assert.match(clientSource, /data-lg-metal-ring/)
  assert.match(clientSource, /collectMetalRings/)
  assert.match(cssBlock('[data-lg-metal-ring]'), /--lg-metal-ring/)
  assert.match(cssBlock('[data-liquid-glass-slider-row]'), /grid-template-columns:\s*6em minmax\(0, 1fr\) 3\.5em/)
  const seat = cssBlock("[data-composer-seat]")
  assert.match(seat, /background:\s*transparent/)
  assert.doesNotMatch(seat, /--lg-edge-mask/)
  const heroPane = cssBlock("[data-slot='conversation'] > [data-phase='hero']::before")
  assert.match(heroPane, /top:\s*var\(--lg-title-top\)/)
  assert.match(heroPane, /url\(#lg-island-lens-pane\)/)
  assert.doesNotMatch(heroPane, /--lg-header-height/)
  const heroRim = cssBlock("[data-slot='conversation'] > [data-phase='hero']::after")
  assert.match(heroRim, /top:\s*var\(--lg-title-top\)/)
  assert.match(heroRim, /background:\s*transparent/)
  const trajectoryFloor = cssBlock('[data-conversation-composer-overlay]')
  assert.match(trajectoryFloor, /--dsh-trajectory-bottom-clearance/)
  assert.match(trajectoryFloor, /clip-path:\s*inset\(0 0 var\(--dsh-composer-height/)
  assert.match(clientSource, /\[data-conversation-composer-overlay\]:has\(\[role='tooltip'\]\)/)
  assert.match(clientSource, /\[data-conversation-composer-overlay\] table/)
  assert.match(clientSource, /\[data-conversation-composer-overlay\] section > \*/)
  assert.doesNotMatch(clientSource, /\[data-tool\],/)
  assert.doesNotMatch(clientSource, /\[data-variant='others'\]/)
})

test('install keeps official appearance and only washes the canvas for wallpaper', async () => {
  const { context, plugin } = loadClient()
  const theme = mockTheme()
  const effects = []
  plugin.apply({
    get(name) { return name === 'theme' ? theme : undefined },
    effect(callback) { effects.push(callback()) },
    on() { return () => {} },
  })
  await flushMicrotasks()

  assert.equal(plugin.name, 'dsh-liquid-glass')
  assert.deepEqual(Array.from(plugin.inject), ['theme', 'slots'])
  assert.equal(theme.preference, 'system')
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), null)
  assert.equal(context.document.body.getAttribute('data-dsh-glass'), null)
  assert.equal(theme.overrides.length, 1)
  assert.equal(context.document.body.children[0].attributes.get('data-ice'), undefined)
  assert.match(context.document.body.children[0].style.backgroundImage, /liquid-glass-ice\.f25a2221e0e89107\.jpg/)
  assert.match(context.document.head.tags[0].textContent, /--lg-pane-bg/)
  assert.match(context.document.head.tags[0].textContent, /data-composer-card/)
  assert.doesNotMatch(cssBlock('[data-composer-seat]'), /flex-direction/)
  assert.doesNotMatch(cssBlock("[role='dialog']"), /flex-direction/)

  effects[0]()
  assert.equal(theme.overrides.length, 0)
  assert.equal(context.document.body.children.length, 0)
  assert.equal(context.document.head.tags.length, 0)
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), null)
})

test('enabling glass does not write data-dsh-glass or move DOM', async () => {
  const storage = new Map([['dsh-liquid-glass:effect', 'on']])
  const { context, plugin } = loadClient(undefined, storage)
  const theme = mockTheme()
  const originalChildren = context.document.body.children
  plugin.apply({
    get() { return theme },
    effect(callback) { callback() },
    on() { return () => {} },
  })
  await flushMicrotasks()
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), 'light')
  assert.equal(context.document.body.getAttribute('data-dsh-glass'), null)
  assert.equal(context.document.body.children, originalChildren)
})

test('interleaved apply A / apply B / dispose A keeps B alive', async () => {
  const { context, plugin } = loadClient(makeReact())
  const theme = mockTheme()
  const effects = []
  const entries = []
  const ctx = {
    get(name) {
      if (name === 'theme') return theme
      if (name === 'slots') {
        return {
          inject(_slot, callback) {
            const entry = callback()
            entries.push(entry)
            return () => {
              const index = entries.indexOf(entry)
              if (index >= 0) entries.splice(index, 1)
            }
          },
          register(options, component) { return { options, component } },
        }
      }
      return undefined
    },
    effect(callback) { effects.push(callback()) },
    on() { return () => {} },
  }
  plugin.apply(ctx)
  await flushMicrotasks()
  plugin.apply(ctx)
  await flushMicrotasks()
  assert.equal(context.document.head.tags.length, 2)
  assert.equal(context.document.body.children.length, 4)
  assert.equal(theme.overrides.length, 2)
  assert.equal(entries.length, 6)
  effects[0]()
  assert.equal(context.document.head.tags.length, 1)
  assert.equal(context.document.body.children.length, 2)
  assert.equal(theme.overrides.length, 1)
  assert.equal(entries.length, 3)
  effects[1]()
  assert.equal(context.document.head.tags.length, 0)
  assert.equal(context.document.body.children.length, 0)
  assert.equal(theme.overrides.length, 0)
  assert.equal(entries.length, 0)
})

test('slot inject throw rolls back style and wallpaper', () => {
  const { context, plugin } = loadClient(makeReact())
  const theme = mockTheme()
  assert.throws(() => {
    plugin.apply({
      get(name) {
        if (name === 'theme') return theme
        if (name === 'slots') {
          return {
            inject() { throw new Error('slot fail') },
            register() { return {} },
          }
        }
        return undefined
      },
      effect() {},
      on() { return () => {} },
    })
  }, /slot fail/)
  assert.equal(context.document.head.tags.length, 0)
  assert.equal(context.document.body.children.length, 0)
  assert.equal(theme.overrides.length, 0)
})

test('theme/change refreshes light, dark and system variables', async () => {
  const storage = new Map([['dsh-liquid-glass:effect', 'on']])
  const { context, plugin } = loadClient(undefined, storage)
  const theme = mockTheme({ colorScheme: 'light' })
  let listener
  plugin.apply({
    get() { return theme },
    effect(callback) { callback() },
    on(name, fn) {
      assert.equal(name, 'theme/change')
      listener = fn
      return () => { listener = undefined }
    },
  })
  await flushMicrotasks()
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), 'light')
  theme.preference = 'dark'
  theme.colorScheme = 'dark'
  listener({ preference: 'dark', active: { colorScheme: 'dark' } })
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), 'dark')
  theme.preference = 'system'
  theme.colorScheme = 'light'
  listener({ preference: 'system', active: { colorScheme: 'light' } })
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), 'light')
})

test('ice locks light appearance and deepwater locks dark appearance', async () => {
  const darkStorage = new Map([
    ['dsh-liquid-glass:effect', 'on'],
    ['dsh-liquid-glass.background', 'deepwater'],
  ])
  const darkRun = loadClient(undefined, darkStorage)
  const darkTheme = mockTheme({ preference: 'light', colorScheme: 'light' })
  darkRun.plugin.apply({
    get() { return darkTheme },
    effect(callback) { callback() },
    on() { return () => {} },
  })
  await flushMicrotasks()
  assert.deepEqual(darkTheme.themeSets, ['dark'])
  assert.equal(darkTheme.preference, 'dark')
  assert.equal(darkRun.context.document.body.getAttribute('data-dsh-liquid-glass'), 'dark')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-bg-base'].light, 'rgba(21, 21, 23, 0.02)')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-label-primary'].light, '#eef2f8')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-label-secondary'].dark, 'rgba(226, 234, 255, 0.76)')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-label-tertiary'].light, 'rgba(226, 234, 255, 0.60)')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-label-caption'].dark, 'rgba(226, 234, 255, 0.48)')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-scrollbar-bg-l1'].light, 'rgba(226, 234, 255, 0.20)')
  assert.equal(darkTheme.overrides[0].tokens['--dsw-alias-scrollbar-hover-l2'].dark, 'rgba(226, 234, 255, 0.34)')

  const lightStorage = new Map([
    ['dsh-liquid-glass:effect', 'on'],
    ['dsh-liquid-glass.background', 'ice'],
  ])
  const lightRun = loadClient(undefined, lightStorage)
  const lightTheme = mockTheme({ preference: 'dark', colorScheme: 'dark' })
  lightRun.plugin.apply({
    get() { return lightTheme },
    effect(callback) { callback() },
    on() { return () => {} },
  })
  await flushMicrotasks()
  assert.deepEqual(lightTheme.themeSets, ['light'])
  assert.equal(lightTheme.preference, 'light')
  assert.equal(lightRun.context.document.body.getAttribute('data-dsh-liquid-glass'), 'light')
  assert.equal(lightTheme.overrides[0].tokens['--dsw-alias-label-primary'].light, '#2c3340')
})

test('switching official appearance swaps ice and deepwater, but leaves none alone', async () => {
  const iceStorage = new Map([
    ['dsh-liquid-glass:effect', 'on'],
    ['dsh-liquid-glass.background', 'ice'],
  ])
  const iceTimers = createFakeTimers()
  const iceRun = loadClient(undefined, iceStorage, { timers: iceTimers })
  const iceTheme = mockTheme({ preference: 'light', colorScheme: 'light' })
  let iceListener
  iceRun.plugin.apply({
    get() { return iceTheme },
    effect(callback) { callback() },
    on(name, fn) {
      assert.equal(name, 'theme/change')
      iceListener = fn
      return () => {}
    },
  })
  await flushMicrotasks()
  iceTheme.preference = 'dark'
  iceTheme.colorScheme = 'dark'
  iceListener({ preference: 'dark', active: { colorScheme: 'dark' } })
  iceTimers.runAllTimeouts()
  await flushMicrotasks()
  const icePut = JSON.parse(iceRun.fetchLog.filter(entry => entry.method === 'PUT').at(-1).body)
  assert.equal(icePut['dsh-liquid-glass.background'], 'deepwater')
  assert.equal(iceRun.context.document.body.getAttribute('data-dsh-liquid-glass'), 'dark')

  const noneStorage = new Map([
    ['dsh-liquid-glass:effect', 'on'],
    ['dsh-liquid-glass.background', 'none'],
  ])
  const noneTimers = createFakeTimers()
  const noneRun = loadClient(undefined, noneStorage, { timers: noneTimers })
  const noneTheme = mockTheme({ preference: 'light', colorScheme: 'light' })
  let noneListener
  noneRun.plugin.apply({
    get() { return noneTheme },
    effect(callback) { callback() },
    on(name, fn) {
      noneListener = fn
      return () => {}
    },
  })
  await flushMicrotasks()
  noneTheme.preference = 'dark'
  noneTheme.colorScheme = 'dark'
  noneListener({ preference: 'dark', active: { colorScheme: 'dark' } })
  noneTimers.runAllTimeouts()
  await flushMicrotasks()
  const nonePut = JSON.parse(noneRun.fetchLog.filter(entry => entry.method === 'PUT').at(-1).body)
  assert.equal(nonePut['dsh-liquid-glass.background'], 'none')
  assert.deepEqual(noneTheme.themeSets, [])
})

test('collapsing sidebar keeps frozen official width; plugin only paints ::before', async () => {
  const root = await loadFixture('dsh-47f943859b-sidebar-collapsing.html')
  const freezing = select(root, '[data-case="freezing"] [data-slot="sidebar"] > :first-child')
  assert.equal(freezing.length, 1)
  assert.equal(freezing[0].attrs.style, 'width:260px')
  const shell = cssBlock("[data-slot='sidebar'] > :first-child")
  assert.doesNotMatch(shell, /max-width/)
  assert.doesNotMatch(shell, /width\s*:/)
})

test('MetricsBridge registers on shell.overlay, measures, and rolls back per instance', () => {
  const observed = []
  function ResizeObserver(callback) {
    this.callback = callback
    this.targets = []
    ResizeObserver.instances.push(this)
  }
  ResizeObserver.instances = []
  ResizeObserver.prototype.observe = function (node) { this.targets.push(node); observed.push(node) }
  ResizeObserver.prototype.disconnect = function () { this.disconnected = true }

  const props = new Map()
  function surface(rect) {
    const values = new Map()
    return {
      style: {
        getPropertyValue(name) { return values.get(name) || '' },
        setProperty(name, value) { values.set(name, String(value)) },
        removeProperty(name) { values.delete(name) },
      },
      getBoundingClientRect() { return rect },
      addEventListener(name, fn) { this.listeners ??= new Map(); this.listeners.set(name, fn) },
      removeEventListener(name) { this.listeners?.delete(name) },
    }
  }
  const conversation = {
    offsetHeight: 800,
    style: {
      getPropertyValue(name) { return props.get(name) || '' },
      setProperty(name, value) { props.set(name, String(value)) },
      removeProperty(name) { props.delete(name) },
    },
    listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn) },
    removeEventListener(name) { this.listeners.delete(name) },
  }
  const header = { offsetHeight: 84, style: {} }
  const scroll = surface({ top: 0, bottom: 600, height: 600 })
  const seat = surface({ top: 500, bottom: 600, height: 100 })
  const column = surface({ top: -100, bottom: 900, height: 1000 })
  const disposers = []
  const React = {
    createElement(type) { return type() },
    useEffect(fn) { disposers.push(fn()) },
  }
  const { context, plugin } = loadClient(React, new Map(), {
    ResizeObserver,
    nodes: {
      "[data-slot='conversation'] > [data-phase]": conversation,
      "[data-slot='conversation.session.header'] > header": header,
      '[data-conversation-scroll]': scroll,
      '[data-composer-seat]': seat,
      '[data-chat-flow]': column,
    },
  })
  const entries = []
  const effects = []
  plugin.apply({
    get(name) {
      if (name === 'theme') return mockTheme()
      if (name === 'slots') {
        return {
          inject(slot, callback) {
            const entry = callback()
            entries.push({ slot, entry })
            return () => {}
          },
          register(options, component) { return { options, component } },
        }
      }
      return undefined
    },
    effect(callback) { effects.push(callback()) },
    on() { return () => {} },
  })
  const overlay = entries.find(item => item.slot === 'shell.overlay')
  assert.ok(overlay)
  assert.equal(overlay.entry.options.name, 'shell.overlay')
  assert.equal(overlay.entry.component(), null)
  assert.equal(conversation.style.getPropertyValue('--lg-header-height'), '84px')
  assert.equal(conversation.style.getPropertyValue('--lg-composer-height'), '')
  assert.equal(column.style.getPropertyValue('--lg-chat-clip-top'), '100px')
  assert.equal(column.style.getPropertyValue('--lg-chat-clip-bottom'), '400px')
  assert.equal(observed.length, 4)
  assert.equal(ResizeObserver.instances[0].targets[0], header)
  assert.equal(ResizeObserver.instances[0].targets[1], scroll)
  assert.equal(ResizeObserver.instances[0].targets[2], seat)
  assert.equal(ResizeObserver.instances[0].targets[3], column)
  assert.equal(typeof scroll.listeners.get('scroll'), 'function')
  assert.equal(conversation.listeners.has('click'), false)
  assert.equal(typeof context.document.listeners.get('click'), 'function')

  overlay.entry.component()
  assert.equal(disposers.length, 2)
  disposers[0]()
  assert.equal(ResizeObserver.instances[0].disconnected, true)
  assert.equal(conversation.style.getPropertyValue('--lg-header-height'), '84px')
  disposers[1]()
  assert.equal(conversation.style.getPropertyValue('--lg-header-height'), '')
  assert.equal(column.style.getPropertyValue('--lg-chat-clip-top'), '')
  assert.equal(column.style.getPropertyValue('--lg-chat-clip-bottom'), '')
  assert.equal(scroll.listeners.has('scroll'), false)
  assert.equal(conversation.listeners.has('click'), false)
  assert.equal(context.document.listeners.has('click'), false)
})

test('plugin still applies when localStorage throws', () => {
  const { plugin } = loadClient(undefined, new Map(), { brokenStorage: true })
  assert.doesNotThrow(() => {
    plugin.apply({
      get() { return mockTheme() },
      effect(callback) { callback() },
      on() { return () => {} },
    })
  })
})

test('settings expose wallpaper and glass toggle, and custom image failures are explicit', async () => {
  const React = makeReact()
  const { context, plugin } = loadClient(React)
  const theme = mockTheme()
  const entries = []
  let disposeSettings
  plugin.apply({
    get(name) {
      if (name === 'theme') return theme
      if (name === 'slots') {
        return {
          inject(slot, callback) {
            assert.ok(slot === 'settings.general.item' || slot === 'shell.overlay')
            const entry = callback()
            entries.push(entry)
            return () => {
              const index = entries.indexOf(entry)
              if (index >= 0) entries.splice(index, 1)
            }
          },
          register(options, component) { return { options, component } },
        }
      }
      return undefined
    },
    effect(callback) { disposeSettings = callback() },
    on() { return () => {} },
  })

  const render = () => {
    React.reset()
    const settings = entries.find(entry => entry.options.id.startsWith('liquid-glass-') && entry.options.name === 'settings.general.item')
    const wrapped = settings.component({})
    return wrapped.type(wrapped.props)
  }

  const tree = render()
  const serialized = JSON.stringify(tree)
  assert.doesNotMatch(serialized, /背景图片/)
  assert.match(serialized, /液态玻璃/)
  assert.match(serialized, /data-liquid-glass-head/)
  assert.match(serialized, /data-liquid-glass-heading/)
  assert.doesNotMatch(serialized, /data-liquid-glass-section/)
  assert.doesNotMatch(serialized, /data-liquid-glass-copy/)
  assert.match(cssBlock('[data-liquid-glass-settings]'), /padding:\s*16px 0/)
  assert.match(cssBlock('[data-liquid-glass-settings]'), /border-bottom:\s*1px solid var\(--dsw-alias-border-l2\)/)
  assert.match(cssBlock('[data-liquid-glass-slider-row]'), /align-items:\s*center/)
  assert.equal(findBy(tree, node => node?.props?.role === 'status'), null)
  assert.equal(findBy(tree, node => node?.props?.['data-liquid-glass-background-choice'] === 'none'), null)
  const iceCard = findBy(tree, node => node?.props?.['data-liquid-glass-background-choice'] === 'ice')
  const waterCard = findBy(tree, node => node?.props?.['data-liquid-glass-background-choice'] === 'deepwater')
  assert.ok(iceCard)
  assert.ok(waterCard)
  assert.match(iceCard.props.style.backgroundImage, /liquid-glass-ice\.f25a2221e0e89107\.jpg/)
  assert.match(waterCard.props.style.backgroundImage, /liquid-glass-deepwater\.b209a409aea86fd6\.jpg/)
  assert.equal(iceCard.children.filter(Boolean).length, 0)
  assert.equal(waterCard.children.filter(Boolean).length, 0)
  const importRow = findBy(tree, node => node?.props && 'data-liquid-glass-import-row' in node.props)
  const importButton = findBy(tree, node => node?.props && 'data-liquid-glass-import' in node.props)
  assert.ok(importRow)
  assert.ok(importButton)
  assert.equal(importRow.children.flat().filter(Boolean)[0], importButton)
  assert.equal(findBy(tree, node => node?.props && 'data-liquid-glass-remove' in node.props), null)
  assert.match(cssBlock('[data-liquid-glass-import-row]'), /display:\s*flex/)
  assert.match(cssBlock("[data-liquid-glass-background-choice][aria-pressed='true']"), /0 0 0 2px #fff,\s*0 0 0 4px #111/)
  assert.doesNotMatch(clientSource, /border: '2px solid var\(--lg-text-primary\)'/)
  assert.doesNotMatch(clientSource, /border: '2px solid var\(--dsw-alias-brand-primary\)'/)
  assert.equal(iceCard.props['aria-pressed'], true)
  assert.match(iceCard.props.style.boxShadow, /0 0 0 2px #fff, 0 0 0 4px #111/)
  assert.equal(waterCard.props['aria-pressed'], false)
  assert.equal(waterCard.props.style.boxShadow, 'none')
  assert.match(clientSource, /body\[data-dsh-liquid-glass\] \{[\s\S]*?--lg-toggle-on-fill:\s*#fff/)
  assert.match(clientSource, /body\[data-dsh-liquid-glass\] \{[\s\S]*?--lg-toggle-on-ink:\s*#2c3340/)
  assert.match(clientSource, /body\[data-dsh-liquid-glass='dark'\] \{[\s\S]*?--lg-toggle-on-fill:\s*#2c3340/)
  assert.match(clientSource, /body\[data-dsh-liquid-glass='dark'\] \{[\s\S]*?--lg-toggle-on-ink:\s*#fff/)
  assert.match(clientSource, /background: state\.glass \? 'var\(--lg-toggle-on-fill\)'/)
  assert.match(clientSource, /color: state\.glass \? 'var\(--lg-toggle-on-ink\)'/)
  assert.doesNotMatch(clientSource, /color: state\.glass \? '#fff'/)
  assert.doesNotMatch(clientSource, /background: state\.glass \? 'var\(--dsw-alias-brand-primary\)'/)
  findBy(tree, node => node?.props?.['data-liquid-glass-toggle'] === '').props.onClick()
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), 'light')
  findBy(render(), node => node?.props?.['data-liquid-glass-toggle'] === '').props.onClick()
  assert.equal(context.document.body.getAttribute('data-dsh-liquid-glass'), null)

  const input = findBy(render(), node => node?.props?.type === 'file')
  await input.props.onChange({
    target: {
      files: [{ type: 'text/plain', name: 'note.txt', size: 12 }],
      value: 'note.txt',
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(JSON.stringify(render()), /请选择图片文件|Choose an image file/)

  disposeSettings()
  assert.equal(entries.length, 0)
  assert.equal(context.document.head.tags.length, 0)
  assert.equal(context.document.body.children.length, 0)
})

test('imported wallpapers stack in a library and remove sits beside import only while one is selected', async () => {
  const React = makeReact()
  const storage = new Map([
    ['dsh-liquid-glass.background', 'custom-a'],
    ['dsh-liquid-glass.background.custom', 'data:image/jpeg;base64,aaa'],
    ['dsh-liquid-glass.background.customs', JSON.stringify([
      { id: 'custom-a', data: 'data:image/jpeg;base64,aaa' },
      { id: 'custom-b', data: 'data:image/jpeg;base64,bbb' },
    ])],
  ])
  const timers = createFakeTimers()
  const { plugin, fetchLog } = loadClient(React, storage, { timers })
  const hostDoc = async () => {
    timers.runAllTimeouts()
    await flushMicrotasks()
    const puts = fetchLog.filter(entry => entry.method === 'PUT')
    return puts.length === 0 ? {} : JSON.parse(puts.at(-1).body)
  }
  const theme = mockTheme()
  const entries = []
  plugin.apply({
    get(name) {
      if (name === 'theme') return theme
      if (name === 'slots') {
        return {
          inject(slot, callback) {
            const entry = callback()
            entries.push(entry)
            return () => {}
          },
          register(options, component) { return { options, component } },
        }
      }
      return undefined
    },
    effect(callback) { callback() },
    on() { return () => {} },
  })
  await flushMicrotasks()

  const render = () => {
    React.reset()
    const settings = entries.find(entry => entry.options.id.startsWith('liquid-glass-') && entry.options.name === 'settings.general.item')
    const wrapped = settings.component({})
    return wrapped.type(wrapped.props)
  }

  const first = render()
  const customA = findBy(first, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-a')
  const customB = findBy(first, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-b')
  const iceCard = findBy(first, node => node?.props?.['data-liquid-glass-background-choice'] === 'ice')
  assert.ok(customA)
  assert.ok(customB)
  assert.equal(customA.children.filter(Boolean).length, 0)
  assert.equal(customB.children.filter(Boolean).length, 0)
  assert.doesNotMatch(JSON.stringify(customA.children), /我的图片|My image/)
  assert.equal(customA.props['aria-pressed'], true)
  assert.equal(customB.props['aria-pressed'], false)
  assert.equal(iceCard.props['aria-pressed'], false)
  assert.match(customA.props.style.boxShadow, /0 0 0 2px #fff, 0 0 0 4px #111/)
  assert.equal(iceCard.props.style.boxShadow, 'none')
  const importRow = findBy(first, node => node?.props && 'data-liquid-glass-import-row' in node.props)
  const rowKids = importRow.children.flat().filter(Boolean)
  assert.equal(rowKids[0].props['data-liquid-glass-import'], '')
  assert.equal(rowKids[1].props['data-liquid-glass-remove'], '')
  assert.match(JSON.stringify(rowKids[1]), /移除图片/)

  iceCard.props.onClick()
  const afterIce = render()
  assert.equal(findBy(afterIce, node => node?.props?.['data-liquid-glass-background-choice'] === 'ice').props['aria-pressed'], true)
  assert.equal(findBy(afterIce, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-a').props['aria-pressed'], false)
  assert.equal(findBy(afterIce, node => node?.props && 'data-liquid-glass-remove' in node.props), null)
  assert.equal((await hostDoc())['dsh-liquid-glass.background'], 'ice')
  assert.equal(JSON.parse((await hostDoc())['dsh-liquid-glass.background.customs']).length, 2)

  findBy(afterIce, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-b').props.onClick()
  const afterCustom = render()
  const remove = findBy(afterCustom, node => node?.props && 'data-liquid-glass-remove' in node.props)
  assert.ok(remove)
  assert.equal(findBy(afterCustom, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-b').props['aria-pressed'], true)
  assert.equal((await hostDoc())['dsh-liquid-glass.background'], 'custom-b')

  remove.props.onClick()
  const afterRemove = render()
  assert.equal(findBy(afterRemove, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-b'), null)
  assert.equal(findBy(afterRemove, node => node?.props?.['data-liquid-glass-background-choice'] === 'custom-a').props['aria-pressed'], true)
  assert.ok(findBy(afterRemove, node => node?.props && 'data-liquid-glass-remove' in node.props))
  const finalDoc = await hostDoc()
  assert.deepEqual(JSON.parse(finalDoc['dsh-liquid-glass.background.customs']).map(item => item.id), ['custom-a'])
  assert.equal(finalDoc['dsh-liquid-glass.background'], 'custom-a')

  assert.match(clientSource, /CUSTOM_LIBRARY_STORAGE/)
  assert.match(clientSource, /newCustomBackgroundId/)
  assert.match(clientSource, /library\.push\(item\)/)
  assert.match(clientSource, /MAX_CUSTOM_BACKGROUNDS = 6/)
})
