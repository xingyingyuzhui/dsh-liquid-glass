    // Layer: wallpaper DOM, style tag, SVG filters, theme token override.
    function createController() {
      var id = String(++nextControllerId)
      var wallpaperElement = null
      var wallpaperOverrideDispose = null
      var applyingAtmosphere = false
      var settingsListeners = new Set()
      var overrideSource = 'dsh-liquid-glass:wallpaper:' + id

      function notifySettings() {
        settingsListeners.forEach(function (fn) { fn() })
      }

      function subscribeSettings(fn) {
        settingsListeners.add(fn)
        return function () { settingsListeners.delete(fn) }
      }

      function ensureWallpaperElement() {
        if (wallpaperElement !== null && document.body.contains(wallpaperElement)) return wallpaperElement
        wallpaperElement = document.createElement('div')
        wallpaperElement.setAttribute(WALLPAPER_ELEMENT_ATTRIBUTE, '')
        wallpaperElement.setAttribute('data-lg-instance', id)
        document.body.prepend(wallpaperElement)
        return wallpaperElement
      }

      function removeWallpaperElement() {
        if (wallpaperElement !== null) wallpaperElement.remove()
        wallpaperElement = null
      }

      function shadeTokens(theme, glassOn, opacity, background) {
        if (wallpaperOverrideDispose !== null) {
          wallpaperOverrideDispose()
          wallpaperOverrideDispose = null
        }
        if (typeof theme.overrideTokens !== 'function') return
        var scheme = activeScheme(theme)
        var surface = glassOn ? surfaceScheme(theme, background) : scheme
        var fallback = FALLBACK_BASE[surface]
        var hasWallpaper = background.id !== 'none' || background.custom !== null
        /* 底色不透明度 wash（20261027 修订：回退为固定低值）
         *
         * ⚠️ 曾经试过让 wash 跟壁纸不透明度联动（1 - opacity*0.98），
         *    想解决「壁纸调低后文字糊在壁纸上」。但实测发现该方案引入更严重问题：
         *
         *   DSH 的正文区祖先链里有三层都用 --dsw-alias-bg-base：
         *     wSkVaW_root / pI_x6G_frame / BODY
         *   而侧栏只有 BODY 一层。
         *
         *   wash=0.02 时：正文合成 5.9%，侧栏 2.0% → 差 3.9pp，看不出来
         *   wash=0.44 时：正文合成 82.7%，侧栏 44.3% → 差 38.4pp，肉眼可见竖线分界
         *
         * 三层叠加会把 wash 的差异按指数放大，破坏左右一致性。
         *
         * ⇒ 回到固定 0.02：壁纸主导显示，左右自然统一。
         *   文字可读性改由玻璃岛自身不透明度保证（见 css/tokens.js 的 --lg-*-bg），
         *   那是插件自己的样式，不依赖 DSH 内部结构。
         */
        var wash = glassOn ? (hasWallpaper ? 0.02 : 1) : clamp(opacity, 0.35, 1, DEFAULT_WALLPAPER_OPACITY)

        var base = computedColor('--dsw-alias-bg-base', fallback)
        var sidebar = computedColor('--dsw-specific-sidebar-fill', fallback)
        var baseLight = glassOn ? fallback : (scheme === 'light' ? base : FALLBACK_BASE.light)
        var baseDark = glassOn ? fallback : (scheme === 'dark' ? base : FALLBACK_BASE.dark)
        var sidebarAlpha = Math.min(1, wash + 0.08)
        var tokens = {
          '--dsw-alias-bg-base': {
            light: toRgba(baseLight, wash),
            dark: toRgba(baseDark, wash),
          },
          '--dsw-specific-sidebar-fill': {
            light: glassOn ? toRgba(baseLight, wash) : toRgba(scheme === 'light' ? sidebar : FALLBACK_BASE.light, sidebarAlpha),
            dark: glassOn ? toRgba(baseDark, wash) : toRgba(scheme === 'dark' ? sidebar : FALLBACK_BASE.dark, sidebarAlpha),
          },
        }
        if (glassOn) {
          var primary = surface === 'dark' ? '#eef2f8' : '#2c3340'
          var secondary = surface === 'dark' ? 'rgba(226, 234, 255, 0.76)' : '#5b6472'
          var tertiary = surface === 'dark' ? 'rgba(226, 234, 255, 0.60)' : '#687282'
          var caption = surface === 'dark' ? 'rgba(226, 234, 255, 0.48)' : '#7b8492'
          var dimmed = surface === 'dark' ? 'rgba(226, 234, 255, 0.34)' : '#9aa2ae'
          tokens['--dsw-alias-label-primary'] = { light: primary, dark: primary }
          tokens['--dsw-alias-label-secondary'] = { light: secondary, dark: secondary }
          tokens['--dsw-alias-label-tertiary'] = { light: tertiary, dark: tertiary }
          tokens['--dsw-alias-label-caption'] = { light: caption, dark: caption }
          tokens['--dsw-alias-label-dimmed'] = { light: dimmed, dark: dimmed }
          var scrollbar = surface === 'dark' ? 'rgba(226, 234, 255, 0.20)' : 'rgba(50, 64, 82, 0.20)'
          var scrollbarHover = surface === 'dark' ? 'rgba(226, 234, 255, 0.34)' : 'rgba(50, 64, 82, 0.34)'
          tokens['--dsw-alias-scrollbar-bg-l1'] = { light: scrollbar, dark: scrollbar }
          tokens['--dsw-alias-scrollbar-bg-l2'] = { light: scrollbar, dark: scrollbar }
          tokens['--dsw-alias-scrollbar-hover-l1'] = { light: scrollbarHover, dark: scrollbarHover }
          tokens['--dsw-alias-scrollbar-hover-l2'] = { light: scrollbarHover, dark: scrollbarHover }
        }
        wallpaperOverrideDispose = theme.overrideTokens(overrideSource, tokens)
      }

      function applyAtmosphere(theme) {
        if (applyingAtmosphere) return
        applyingAtmosphere = true
        try {
          var background = readBackgroundState(theme)
          applyBoundAppearance(theme, background)
          var glassOn = readGlassEnabled()
          if (background.id === 'none' && background.custom === null) {
            removeWallpaperElement()
          } else {
            var element = ensureWallpaperElement()
            element.removeAttribute('data-ice')
            element.style.backgroundImage = backgroundCss(background.id, background.custom)
            element.style.filter = 'none'
            element.style.opacity = String(background.opacity)
          }
          document.body.style.setProperty('--lg-glass-blur', readGlassBlur() + 'px')
          if (glassOn) {
            glassOwners.add(id)
            document.body.setAttribute(GLASS_ATTRIBUTE, surfaceScheme(theme, background))
            islandLensSyncs.forEach(function (fn) { fn() })
          } else {
            glassOwners.delete(id)
            if (glassOwners.size === 0) document.body.removeAttribute(GLASS_ATTRIBUTE)
          }
          if (background.id === 'none' && !glassOn) {
            if (wallpaperOverrideDispose !== null) {
              wallpaperOverrideDispose()
              wallpaperOverrideDispose = null
            }
          } else {
            shadeTokens(theme, glassOn, background.id === 'none' ? 1 : background.opacity, background)
          }
        } finally {
          applyingAtmosphere = false
        }
      }

      function teardownAtmosphere() {
        glassOwners.delete(id)
        if (glassOwners.size === 0) {
          document.body.removeAttribute(GLASS_ATTRIBUTE)
          document.body.style.removeProperty('--lg-glass-blur')
        }
        removeWallpaperElement()
        if (wallpaperOverrideDispose !== null) {
          wallpaperOverrideDispose()
          wallpaperOverrideDispose = null
        }
      }

      function installStyles() {
        return installIslandStyles(id)
      }

      return {
        id: id,
        overrideSource: overrideSource,
        applyAtmosphere: applyAtmosphere,
        teardownAtmosphere: teardownAtmosphere,
        installStyles: installStyles,
        subscribeSettings: subscribeSettings,
        notifySettings: notifySettings,
      }
    }
