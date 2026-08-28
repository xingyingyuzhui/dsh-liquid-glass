    // Layer: plugin identity, storage keys, lens defaults, wallpaper roster.
    var name = 'dsh-liquid-glass'
    var inject = ['theme', 'slots']
    var GLASS_ATTRIBUTE = 'data-dsh-liquid-glass'
    var STYLE_ID = 'dsh-liquid-glass/liquid-glass.css'
    var WALLPAPER_ELEMENT_ATTRIBUTE = 'data-dsh-liquid-glass-wallpaper'
    var EFFECT_STORAGE = 'dsh-liquid-glass:effect'
    var LEGACY_SKIN_STORAGE = 'dsh-liquid-glass:skin'
    var BACKGROUND_STORAGE = 'dsh-liquid-glass.background'
    var CUSTOM_BACKGROUND_STORAGE = 'dsh-liquid-glass.background.custom'
    var CUSTOM_LIBRARY_STORAGE = 'dsh-liquid-glass.background.customs'
    var MAX_CUSTOM_BACKGROUNDS = 6
    var MAX_CUSTOM_LIBRARY_DATA_URL_LENGTH = 4 * 1024 * 1024
    var CUSTOM_LIBRARY_STORAGE_RESERVE = 64 * 1024
    var ICE_WALLPAPER_HASH = 'f25a2221e0e89107'
    var ICE_WALLPAPER_URL = '/dsh-liquid-glass/assets/liquid-glass-ice.' + ICE_WALLPAPER_HASH + '.jpg'
    var DEEPWATER_WALLPAPER_HASH = 'b209a409aea86fd6'
    var DEEPWATER_WALLPAPER_URL = '/dsh-liquid-glass/assets/liquid-glass-deepwater.' + DEEPWATER_WALLPAPER_HASH + '.jpg'
    var BACKGROUND_OPACITY_STORAGE = 'dsh-liquid-glass.background.opacity'
    var GLASS_BLUR_STORAGE = 'dsh-liquid-glass.glass.blur'
    // Settings live on the host (stable path, survives the per-launch port
    // change); localStorage is only consulted once as a migration source.
    var SETTINGS_ENDPOINT = '/dsh-liquid-glass/settings.json'
    var SETTINGS_DOC_KEY = '__v'
    var SETTINGS_DOC_VERSION = '1'
    var SETTINGS_PERSIST_DEBOUNCE_MS = 300
    var DEFAULT_WALLPAPER_OPACITY = 0.88
    var DEFAULT_GLASS_BLUR = 20
    // Sidebar / title A / conversation H share the samasante field.
    // Loupe defaults (depth 0.95 / curvature 0.5) fill a 300px circle; on a
    // large island that becomes a centre dome. These stay on the rim.
    var ISLAND_LENS = {
      mapSize: 768,
      mapPad: 0,
      cornerRadius: 28,
      strength: 0.14,
      depthPx: 16,
      curvature: 0.08,
      bend: 0.78,
      bendPx: 14,
      rimFadePx: 5,
      dispersion: 0.06,
      sheen: 0,
      sheenWidth: 3.5,
      sheenFalloff: 1.7,
      sheenAngle: 45,
      specular: 0,
      glow: 0,
      glowSpread: 1,
      glowFalloff: 0.6,
      fallbackDisplacement: 28,
      filterMargin: 18,
    }
    var DISPERSION_SPREAD = 0.22
    var MAX_IMAGE_DATA_URL_LENGTH = 2 * 1024 * 1024
    var FALLBACK_BASE = { light: 'rgb(255, 255, 255)', dark: 'rgb(21, 21, 23)' }
    var nextControllerId = 0
    var glassOwners = new Set()
    var metricsOwners = new Set()
    var islandLensSyncs = new Set()

    // Stable selectors (DSH 47f943859b). Slot wrappers are display:contents.
    // [data-slot="sidebar"] > :first-child                         SidebarRoot
    // [data-slot="conversation"] > [data-phase]                    ConversationRoot
    // [data-slot="conversation.session.header"] > header           ConversationSession header
    // [data-slot="conversation.session.header.utilities"] > *      Session log cluster
    // [data-slot="conversation.session"] > :first-child            viewArea
    // [data-composer-seat] / [data-composer-card]                  seat + InputBar card
    // [data-slot="conversation.composer.dock"] > :first-child      StatsLine
    // [data-time-hover-root] > :last-child:has(button)             shared action row

    var BACKGROUNDS = [
      { id: 'none', css: 'none', tone: 'theme' },
      { id: 'ice', css: 'url("' + ICE_WALLPAPER_URL + '")', tone: 'light' },
      { id: 'deepwater', css: 'url("' + DEEPWATER_WALLPAPER_URL + '")', tone: 'dark' },
    ]
