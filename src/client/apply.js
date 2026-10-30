    // Layer: register styles, atmosphere, settings, overlays; all reversible.
    function apply(ctx) {
      var theme = ctx.get('theme')
      if (theme === undefined) return
      // 20261027：先拉服务端配置再建控制器 —— 保证首帧就用对的值，
      // 避免"先用本地值渲染、再被服务端值纠正"造成闪烁。
      // 服务端不可用时 loadServerConfig 内部静默回退到 localStorage。
      var pending = (typeof loadServerConfig === 'function') ? loadServerConfig() : null
      // 图库同步与配置拉取并行；不阻塞首帧（图片到位后由 controller 自行刷新）。
      if (typeof syncGallery === 'function') syncGallery()
      if (pending !== null && typeof pending.then === 'function') {
        pending.then(function () { boot(ctx, theme) }, function () { boot(ctx, theme) })
        return
      }
      boot(ctx, theme)
    }

    function boot(ctx, theme) {
      var controller = createController()
      var dispose = runWithRollback([
        function () { return controller.installStyles() },
        function () {
          controller.applyAtmosphere(theme)
          return function () { controller.teardownAtmosphere() }
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
        function () {
          // 20261027：跨设备变更探测。每 2s 探一次 revision，变了才拉全量配置。
          // 收到变更后就地重放氛围与设置面板，无需刷新页面。
          if (typeof onRemoteConfigChange !== 'function' || typeof startRevisionPolling !== 'function') return undefined
          // 远端变更处理：先重新同步图库（新图要下载），再重放氛围与设置面板。
          // ⚠️ 早期只重放氛围，但图库条目在 localStorage 里，新图要等 syncGallery() 才到位，
          //    所以另一台设备新增的图这边认不到。
          onRemoteConfigChange(function () {
            try {
              if (typeof syncGallery === 'function') {
                syncGallery().then(function () {
                  applyBoundWallpaper(theme)
                  controller.applyAtmosphere(theme)
                  controller.notifySettings()
                }, function () {})
                return
              }
              applyBoundWallpaper(theme)
              controller.applyAtmosphere(theme)
              controller.notifySettings()
            } catch (_error) {}
          })
          // P2 修复：轮询必须可停，否则插件卸载/热重载时定时器泄漏。
          var stopPolling = startRevisionPolling()
          return function () {
            if (typeof stopPolling === 'function') stopPolling()
          }
        },
      ])
      ctx.effect(function () { return dispose })
    }
