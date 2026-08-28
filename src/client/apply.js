    // Layer: register styles, atmosphere, settings, overlays; all reversible.
    function apply(ctx) {
      var theme = ctx.get('theme')
      if (theme === undefined) return
      var controller = createController()
      var dispose = runWithRollback([
        function () { return controller.installStyles() },
        function () {
          // First frame waits for the host settings document; before it
          // lands, reads fall back to defaults, so applying early would flash
          // the default wallpaper and get replaced one round-trip later.
          var live = true
          var started = hydrateSettings().then(function () {
            if (!live) return
            controller.applyAtmosphere(theme)
            controller.notifySettings()
          })
          started.catch(function () {})
          return function () {
            live = false
            controller.teardownAtmosphere()
          }
        },
        function () {
          if (typeof ctx.on !== 'function') return undefined
          return ctx.on('theme/change', function () {
            applyBoundWallpaper(theme)
            controller.applyAtmosphere(theme)
            controller.notifySettings()
          })
        },
        function () {
          var slots = ctx.get('slots')
          if (slots === undefined || React === undefined) return undefined
          return slots.inject('settings.general.item', function () {
            return slots.register(
              { name: 'settings.general.item', id: 'liquid-glass-' + controller.id, order: 15 },
              function LiquidGlassSettings() {
                return React.createElement(SettingsRow, { theme: theme, controller: controller })
              },
            )
          })
        },
        function () {
          var slots = ctx.get('slots')
          if (slots === undefined || React === undefined) return undefined
          return slots.inject('shell.overlay', function () {
            return slots.register(
              { name: 'shell.overlay', id: 'liquid-glass-metrics-' + controller.id, order: 0 },
              MetricsBridge,
            )
          })
        },
        function () {
          var slots = ctx.get('slots')
          if (slots === undefined || React === undefined) return undefined
          return slots.inject('shell.overlay', function () {
            return slots.register(
              { name: 'shell.overlay', id: 'liquid-glass-metal-' + controller.id, order: 1 },
              ComposerMetal,
            )
          })
        },
      ])
      ctx.effect(function () { return dispose })
    }
