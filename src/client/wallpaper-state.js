    // Layer: wallpaper library, glass switch, appearance wash.
    function cssUrl(value) {
      return 'url("' + String(value).replace(/(["\\])/g, '\\$1') + '")'
    }

    function isCustomBackgroundId(id) {
      return id === 'custom' || (typeof id === 'string' && id.indexOf('custom-') === 0)
    }

    function newCustomBackgroundId() {
      return 'custom-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36)
    }

    function readCustomLibrary() {
      var raw = storageGet(CUSTOM_LIBRARY_STORAGE)
      if (raw) {
        try {
          var parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            return parsed.filter(function (item) {
              return item
                && typeof item.id === 'string'
                && typeof item.data === 'string'
                && item.data.indexOf('data:image/') === 0
            })
          }
        } catch (_error) {}
      }
      var legacy = storageGet(CUSTOM_BACKGROUND_STORAGE)
      if (legacy) return [{ id: 'custom', data: legacy }]
      return []
    }

    function customFromLibrary(library, id) {
      for (var i = 0; i < library.length; i++) {
        if (library[i].id === id) return library[i]
      }
      return null
    }

    function backgroundCss(id, custom) {
      if (isCustomBackgroundId(id) && custom !== null) return cssUrl(custom)
      var preset = BACKGROUNDS.find(function (item) { return item.id === id })
      return (preset || BACKGROUNDS[1]).css
    }

    function toRgba(color, alpha) {
      var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim())
      if (hex !== null) {
        var digits = hex[1]
        if (digits.length === 3) digits = digits.split('').map(function (ch) { return ch + ch }).join('')
        var n = parseInt(digits, 16)
        return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alpha + ')'
      }
      var rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(color).trim())
      if (rgb !== null) return 'rgba(' + rgb[1] + ', ' + rgb[2] + ', ' + rgb[3] + ', ' + alpha + ')'
      return String(color).trim()
    }

    function computedColor(name, fallback) {
      if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback
      var value = getComputedStyle(document.body).getPropertyValue(name).trim()
      return value || fallback
    }

    function activeScheme(theme) {
      var snapshot = theme && theme.getTheme && theme.getTheme()
      if (snapshot && snapshot.active && snapshot.active.colorScheme === 'light') return 'light'
      return 'dark'
    }

    function backgroundTone(id) {
      var preset = BACKGROUNDS.find(function (item) { return item.id === id })
      return preset === undefined ? 'theme' : preset.tone
    }

    /* 决定整体明暗。优先级：
     *   ① 预设壁纸自带 tone（ice=light / deepwater=dark）—— 固定satisfying，不做亮度换算
     *   ② 自定义壁纸按「实际显示效果」实时推算（方案 B，20261027）
     *   ③ 都没有 → 跟随宿主主题
     *
     * ⭐ 为什么自定义图要实时算而不能预设：
     *   最终视觉 = 图片亮度 × opacity + 底层亮度 × (1 - opacity)
     *   opacity 是用户随时可调的滑块，所以同一个 tone 值在不同透明度下会错。
     *   只存图片自身亮度（luminance，唯一稳定属性），每次渲染按当时 opacity 换算。
     */
    function surfaceScheme(theme, background) {
      var preset = BACKGROUNDS.find(function (item) { return item.id === background.id })
      if (preset !== undefined && (preset.tone === 'dark' || preset.tone === 'light')) return preset.tone

      // 自定义壁纸：用亮度 + 当前不透明度实时判定
      if (typeof resolveTone === 'function') {
        var lum = null
        var hit = customFromLibrary(background.customs || [], background.id)
        if (hit !== null && typeof hit.luminance === 'number') lum = hit.luminance
        else if (typeof background.luminance === 'number') lum = background.luminance
        if (lum !== null) {
          var tone = resolveTone(lum, background.opacity)
          if (tone !== null) return tone
          // 落在临界区（两种底层假设结论不一致）→ 交给宿主主题，避免闪烁
        }
      }
      return activeScheme(theme)
    }

    function defaultBackgroundId(theme) {
      return theme && activeScheme(theme) === 'dark' ? 'deepwater' : 'ice'
    }

    function boundAppearance(id) {
      var tone = backgroundTone(id)
      return tone === 'light' || tone === 'dark' ? tone : null
    }

    function isBoundWallpaper(id) {
      return id === 'ice' || id === 'deepwater'
    }

    function readGlassEnabled() {
      var effect = storageGet(EFFECT_STORAGE)
      if (effect === 'on') return true
      if (effect === 'off') return false
      var legacy = storageGet(LEGACY_SKIN_STORAGE)
      return legacy === 'liquid-glass' || legacy === 'liquid-glass-light'
    }

    function writeGlassEnabled(on) {
      return storageSet(EFFECT_STORAGE, on ? 'on' : 'off')
    }

    function readBackgroundState(theme) {
      var library = readCustomLibrary()
      var selected = storageGet(BACKGROUND_STORAGE)
      var fallback = defaultBackgroundId(theme)
      var knownPreset = BACKGROUNDS.some(function (item) { return item.id === selected })
      var knownCustom = customFromLibrary(library, selected) !== null
      if (selected === 'custom' && !knownCustom && library.length > 0) {
        selected = library[0].id
        knownCustom = true
      }
      if (!knownPreset && !knownCustom) selected = fallback
      var current = customFromLibrary(library, selected)
      return {
        id: selected,
        custom: current !== null ? current.data : null,
        customs: library,
        opacity: readNumber(BACKGROUND_OPACITY_STORAGE, 0.35, 1, DEFAULT_WALLPAPER_OPACITY),
        // 自定义图的亮度，供 surfaceScheme 按当前不透明度实时推明暗
        luminance: (current !== null && typeof current.luminance === 'number') ? current.luminance : null,
      }
    }

    function libraryPersistSize(library, custom) {
      var encoded = JSON.stringify(library || [])
      var customLen = custom ? String(custom).length : 0
      return encoded.length + customLen + CUSTOM_LIBRARY_STORAGE_RESERVE
    }

    function canPersistLibrary(library, incomingData) {
      var next = (library || []).slice()
      if (incomingData) next.push({ id: 'probe', data: incomingData })
      try {
        if (JSON.stringify(next).length > MAX_CUSTOM_LIBRARY_DATA_URL_LENGTH) return false
      } catch (_error) {
        return false
      }
      return libraryPersistSize(next, incomingData || null) <= MAX_CUSTOM_LIBRARY_DATA_URL_LENGTH + CUSTOM_LIBRARY_STORAGE_RESERVE
    }

    function restoreStorageSnapshot(snapshot) {
      var keys = [
        BACKGROUND_STORAGE,
        CUSTOM_LIBRARY_STORAGE,
        CUSTOM_BACKGROUND_STORAGE,
        BACKGROUND_OPACITY_STORAGE,
      ]
      for (var i = 0; i < keys.length; i++) {
        try {
          var prev = snapshot[keys[i]]
          if (prev === null || prev === undefined) window.localStorage.removeItem(keys[i])
          else window.localStorage.setItem(keys[i], prev)
        } catch (_error) {}
      }
    }

    function saveBackgroundState(id, custom, opacity, library) {
      var snapshot = {}
      var keys = [
        BACKGROUND_STORAGE,
        CUSTOM_LIBRARY_STORAGE,
        CUSTOM_BACKGROUND_STORAGE,
        BACKGROUND_OPACITY_STORAGE,
      ]
      try {
        for (var i = 0; i < keys.length; i++) snapshot[keys[i]] = window.localStorage.getItem(keys[i])
      } catch (_error) {
        snapshot = {
          [BACKGROUND_STORAGE]: storageGet(BACKGROUND_STORAGE),
          [CUSTOM_LIBRARY_STORAGE]: storageGet(CUSTOM_LIBRARY_STORAGE),
          [CUSTOM_BACKGROUND_STORAGE]: storageGet(CUSTOM_BACKGROUND_STORAGE),
          [BACKGROUND_OPACITY_STORAGE]: storageGet(BACKGROUND_OPACITY_STORAGE),
        }
      }

      var nextLibrary = undefined
      if (library !== undefined) {
        try {
          nextLibrary = JSON.stringify(library)
        } catch (_error) {
          return false
        }
        if (nextLibrary.length > MAX_CUSTOM_LIBRARY_DATA_URL_LENGTH) return false
        if (!canPersistLibrary(library, null)) return false
      }

      /* 20261027：改用 storageSet —— 它会「写本地 + 上报服务端」。
       * 原来直接调 window.localStorage.setItem，绕过了服务端上报，
       * 导致壁纸透明度只改本地，而 storageGet 优先读服务端旧值 ⇒ 滑杆动了没反应。 */
      function write(key, value) {
        storageSet(key, value)
      }

      try {
        if (library !== undefined) write(CUSTOM_LIBRARY_STORAGE, nextLibrary)
        write(BACKGROUND_STORAGE, id)
        if (custom !== undefined) write(CUSTOM_BACKGROUND_STORAGE, custom)
        write(BACKGROUND_OPACITY_STORAGE, String(opacity))
        return true
      } catch (_error) {
        restoreStorageSnapshot(snapshot)
        return false
      }
    }

    function applyBoundAppearance(theme, background) {
      var stored = storageGet(BACKGROUND_STORAGE)
      if (!isBoundWallpaper(stored)) return
      var appearance = boundAppearance(background.id)
      if (appearance === null || typeof theme.setTheme !== 'function') return
      if (theme.preference === appearance) return
      theme.setTheme(appearance)
    }

    function applyBoundWallpaper(theme) {
      var stored = storageGet(BACKGROUND_STORAGE)
      if (!isBoundWallpaper(stored)) return
      var want = activeScheme(theme) === 'dark' ? 'deepwater' : 'ice'
      if (stored === want) return
      var background = readBackgroundState(theme)
      saveBackgroundState(want, background.custom, background.opacity)
    }

    function readGlassBlur() {
      return readNumber(GLASS_BLUR_STORAGE, 0, 40, DEFAULT_GLASS_BLUR)
    }

    function writeGlassBlur(value) {
      return storageSet(GLASS_BLUR_STORAGE, String(value))
    }
