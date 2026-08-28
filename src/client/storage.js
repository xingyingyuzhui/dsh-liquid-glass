    // Layer: host-persisted settings (memory cache + write-through) and apply rollback.
    // localStorage is per-origin and DSH listens on a fresh port every launch,
    // so the source of truth is the host document at SETTINGS_ENDPOINT; the
    // in-memory map is the working copy, reads stay synchronous for callers,
    // and every mutation schedules one debounced full-document PUT. Until the
    // first hydrate finishes, reads fall back to defaults (same as an empty
    // store) and writes are queued into the same copy. localStorage is read
    // exactly once, as a migration source, when the host has never been written.
    var SETTING_KEYS = [
      EFFECT_STORAGE,
      LEGACY_SKIN_STORAGE,
      BACKGROUND_STORAGE,
      CUSTOM_BACKGROUND_STORAGE,
      CUSTOM_LIBRARY_STORAGE,
      BACKGROUND_OPACITY_STORAGE,
      GLASS_BLUR_STORAGE,
    ]
    var memorySettings = null
    var persistChain = Promise.resolve()
    var persistTimer = null
    var persistFailed = false

    function settingsDocument(map) {
      var doc = {}
      for (var key in map) doc[key] = map[key]
      doc[SETTINGS_DOC_KEY] = SETTINGS_DOC_VERSION
      return doc
    }

    function sanitizeHostSettings(data) {
      var out = {}
      if (data === null || typeof data !== 'object') return out
      for (var i = 0; i < SETTING_KEYS.length; i++) {
        var key = SETTING_KEYS[i]
        if (typeof data[key] === 'string') out[key] = data[key]
      }
      return out
    }

    function fetchSettings(options) {
      if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'))
      return fetch(SETTINGS_ENDPOINT, options)
    }

    function putSettingsDocument() {
      var body = JSON.stringify(settingsDocument(memorySettings || {}))
      persistChain = persistChain.then(function () {
        return fetchSettings({
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: body,
        }).then(function (response) {
          persistFailed = !response.ok
        })
      }).catch(function () {
        persistFailed = true
      })
      return persistChain
    }

    function schedulePersist() {
      if (persistTimer !== null) return
      persistTimer = setTimeout(function () {
        persistTimer = null
        putSettingsDocument()
      }, SETTINGS_PERSIST_DEBOUNCE_MS)
    }

    function readLegacyLocalStorage() {
      var found = {}
      try {
        for (var i = 0; i < SETTING_KEYS.length; i++) {
          var value = window.localStorage.getItem(SETTING_KEYS[i])
          if (value !== null) found[SETTING_KEYS[i]] = value
        }
      } catch (_error) {}
      return found
    }

    function hydrateSettings() {
      return fetchSettings({})
        .then(function (response) {
          if (!response.ok) return {}
          return response.json()
        })
        .then(function (data) {
          var versioned = data !== null && typeof data === 'object' && data[SETTINGS_DOC_KEY] === SETTINGS_DOC_VERSION
          var incoming = versioned ? sanitizeHostSettings(data) : readLegacyLocalStorage()
          if (memorySettings === null) {
            memorySettings = incoming
          } else {
            // A write raced the hydrate: the in-flight mutation is the newer
            // user intent, so it wins over both the host copy and the legacy
            // migration source; only unset keys adopt the incoming values.
            for (var key in incoming) {
              if (!Object.prototype.hasOwnProperty.call(memorySettings, key)) memorySettings[key] = incoming[key]
            }
          }
          // Host has never been written: upload the adopted legacy values
          // (plus anything that raced in) so later launches hydrate fast.
          if (!versioned) putSettingsDocument()
        })
        .catch(function () {
          if (memorySettings === null) memorySettings = {}
        })
    }

    function storageGet(key) {
      if (memorySettings !== null && Object.prototype.hasOwnProperty.call(memorySettings, key)) {
        return memorySettings[key]
      }
      return null
    }

    function storageSet(key, value) {
      if (memorySettings === null) memorySettings = {}
      if (value === null) delete memorySettings[key]
      else memorySettings[key] = String(value)
      schedulePersist()
      return true
    }

    function storagePersistFailed() {
      return persistFailed
    }

    function clamp(value, min, max, fallback) {
      return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
    }

    function readNumber(key, min, max, fallback) {
      var raw = storageGet(key)
      if (raw === null) return fallback
      return clamp(Number(raw), min, max, fallback)
    }

    function runWithRollback(steps) {
      var disposers = []
      try {
        for (var i = 0; i < steps.length; i += 1) {
          var dispose = steps[i]()
          if (typeof dispose === 'function') disposers.push(dispose)
        }
        return function () {
          for (var j = disposers.length - 1; j >= 0; j -= 1) {
            try { disposers[j]() } catch (_error) {}
          }
        }
      } catch (error) {
        for (var k = disposers.length - 1; k >= 0; k -= 1) {
          try { disposers[k]() } catch (_error) {}
        }
        throw error
      }
    }
