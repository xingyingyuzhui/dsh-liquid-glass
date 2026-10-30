    // Layer: measure header / scrollport / composer; write clip CSS vars.
    var metricsVarOwners = typeof WeakMap === 'function' ? new WeakMap() : null

    function claimStyleOwner(node, prop, owner) {
      if (node === null || metricsVarOwners === null) return
      var byProp = metricsVarOwners.get(node)
      if (!byProp) {
        byProp = {}
        metricsVarOwners.set(node, byProp)
      }
      var owners = byProp[prop]
      if (!owners) {
        owners = new Set()
        byProp[prop] = owners
      }
      owners.add(owner)
    }

    function releaseStyleOwner(node, prop, owner) {
      if (node === null) return
      if (metricsVarOwners !== null) {
        var byProp = metricsVarOwners.get(node)
        if (byProp && byProp[prop]) {
          byProp[prop].delete(owner)
          if (byProp[prop].size > 0) return
        }
      }
      if (node.style && typeof node.style.removeProperty === 'function') node.style.removeProperty(prop)
    }

    function MetricsBridge() {
      React.useEffect(function () {
        var snap = { root: null, header: null, scroll: null, seat: null, column: null }
        var observer = null
        var observedTargets = []
        var reconnectSlow = null
        var lastClipTop = null
        var lastClipBottom = null
        var lastHeaderHeight = null
        var needsLayout = false
        var needsCrop = false
        var live = true
        var owner = {}

        function phaseOf(root) {
          return root && typeof root.getAttribute === 'function' ? root.getAttribute('data-phase') : null
        }

        function isReady(next) {
          if (next.root === null) return false
          if (phaseOf(next.root) === 'hero') return true
          return next.header !== null && next.scroll !== null && next.seat !== null && next.column !== null
        }

        function needsShell(next) {
          if (next.root === null) return true
          if (phaseOf(next.root) === 'hero') return false
          return next.header === null || next.scroll === null || next.seat === null || next.column === null
        }

        function sameTargets(a, b) {
          if (a.length !== b.length) return false
          for (var i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false
          }
          return true
        }

        function syncObserver(targets) {
          if (observer === null) return
          var next = []
          for (var i = 0; i < targets.length; i++) {
            if (targets[i] !== null) next.push(targets[i])
          }
          if (sameTargets(observedTargets, next)) return
          if (typeof observer.unobserve === 'function') {
            for (var u = 0; u < observedTargets.length; u++) {
              if (next.indexOf(observedTargets[u]) === -1) observer.unobserve(observedTargets[u])
            }
            for (var o = 0; o < next.length; o++) {
              if (observedTargets.indexOf(next[o]) === -1) observer.observe(next[o])
            }
          } else {
            observer.disconnect()
            for (var b = 0; b < next.length; b++) observer.observe(next[b])
          }
          observedTargets = next
        }

        function resolveNodes() {
          var next = {
            root: document.querySelector("[data-slot='conversation'] > [data-phase]"),
            header: document.querySelector("[data-slot='conversation.session.header'] > header"),
            scroll: document.querySelector('[data-conversation-scroll]'),
            seat: document.querySelector('[data-composer-seat]'),
            column: document.querySelector('[data-chat-flow]'),
          }
          var changed = {
            rootChanged: next.root !== snap.root,
            headerChanged: next.header !== snap.header,
            scrollChanged: next.scroll !== snap.scroll,
            seatChanged: next.seat !== snap.seat,
            columnChanged: next.column !== snap.column,
          }
          changed.changed = changed.rootChanged || changed.headerChanged || changed.scrollChanged || changed.seatChanged || changed.columnChanged
          changed.ready = isReady(next)
          if (changed.scrollChanged) {
            /* 20261022: 对应取消监听（旧实现遗留） */
            /* 20261022: 不再监听 scroll —— 裁剪逻辑已移除，无需逐帧重算。 */
          }
          if (changed.rootChanged) {
            releaseStyleOwner(snap.root, '--lg-header-height', owner)
            lastHeaderHeight = null
          }
          if (changed.columnChanged) {
            releaseStyleOwner(snap.column, '--lg-chat-clip-top', owner)
            releaseStyleOwner(snap.column, '--lg-chat-clip-bottom', owner)
            lastClipTop = null
            lastClipBottom = null
          }
          snap = next
          return changed
        }

        /* 裁剪诊断日志开关：localStorage 设置 'dsh-liquid-glass:debug-crop' = '1' 开启。
         * 开启后仅在裁剪值触发上限时打印一次结构化日志，便于定位基准计算偏差。 */
        var cropDebugLast = null
        function debugCrop() {
          try { return window.localStorage.getItem('dsh-liquid-glass:debug-crop') === '1' } catch (err) { return false }
        }

        /* 滚动节流(20261022)：clip-path 变化会触发整层重新栅格化，滚动过程中
         * 每帧改写会导致明显卡顿（移动端尤甚）。改为：
         *   - 滚动期间：立即用「同步 scrollTop」以 CSS 变量粗对齐（廉价），
         *     但不做完整重算；
         *   - 滚动停止 120ms 后：做一次精确重算。
         * 这样滚动时画面仍然连续对齐，又避免逐帧重算。 */
        var scrollIdleTimer = null
        var lastScrollTop = null

        function cropOnScroll() {
          if (snap.scroll === null || snap.column === null) return
          var st = snap.scroll.scrollTop || 0
          if (st !== lastScrollTop) {
            lastScrollTop = st
            snap.column.style.setProperty('--lg-chat-clip-top', Math.round(st) + 'px')
            claimStyleOwner(snap.column, '--lg-chat-clip-top', owner)
            lastClipTop = Math.round(st)
          }
          if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer)
          scrollIdleTimer = setTimeout(function () {
            scrollIdleTimer = null
            needsCrop = true
            frameGate.schedule()
          }, 120)
        }

        /* 20261022：内容列裁剪已移除（见 conversation-scroll.js 顶部说明）。
         * 保留本函数为空实现，维持 MetricsBridge 的调用链与生命周期不变，
         * 避免因删函数导致 observer/eff 结构变化。--lg-header-height 仍由
         * applyLayout 正常写入，玻璃岛的头部尺寸测量不受影响。 */
        function cropTranscript() {
          /* no-op */
        }

        function applyLayout() {
          var info = resolveNodes()
          if (info.changed && observer !== null) {
            syncObserver([snap.header, snap.scroll, snap.seat, snap.column])
          }
          if (snap.root === null) return
          if (snap.header !== null && snap.header.offsetHeight > 0) {
            var nextHeight = snap.header.offsetHeight
            if (lastHeaderHeight !== nextHeight) {
              snap.root.style.setProperty('--lg-header-height', nextHeight + 'px')
              claimStyleOwner(snap.root, '--lg-header-height', owner)
              lastHeaderHeight = nextHeight
            }
          }
          if (glassOwners.size > 0) islandLensSyncs.forEach(function (fn) { fn() })
          cropTranscript()
        }

        var frameGate = createFrameGate(function () {
          if (needsLayout) {
            needsLayout = false
            needsCrop = false
            applyLayout()
            return
          }
          if (needsCrop) {
            needsCrop = false
            cropTranscript()
          }
        })

        function scheduleLayoutMeasure() {
          needsLayout = true
          frameGate.schedule()
        }

        function scheduleTranscriptCrop() {
          needsCrop = true
          frameGate.schedule()
        }

        function ensureObserver() {
          if (observer === null && typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(scheduleLayoutMeasure)
          }
          syncObserver([snap.header, snap.scroll, snap.seat, snap.column])
        }

        function stopReconnect() {
          recoverBatch.cancel()
          probeBatch.cancel()
          if (reconnectSlow !== null) {
            clearTimeout(reconnectSlow)
            reconnectSlow = null
          }
        }

        function armSlowReconnect() {
          if (!live || reconnectSlow !== null || !needsShell(snap)) return
          reconnectSlow = setTimeout(function () {
            reconnectSlow = null
            if (!live) return
            var info = resolveNodes()
            if (info.ready) {
              stopReconnect()
              ensureObserver()
              scheduleLayoutMeasure()
              return
            }
            if (needsShell(snap)) armSlowReconnect()
          }, 2000)
        }

        function onRecoverTick() {
          if (!live) return
          var info = resolveNodes()
          if (info.ready) {
            stopReconnect()
            ensureObserver()
            scheduleLayoutMeasure()
            return
          }
          if (recoverBatch.pending() === 0 && needsShell(snap)) armSlowReconnect()
        }

        var recoverBatch = createRetryBatch(onRecoverTick, 5)
        var probeBatch = createRetryBatch(function () { probeAfterClick() }, 2)

        function startRecover() {
          if (!live || isReady(snap)) return
          recoverBatch.start([150, 400, 1000])
        }

        function probeAfterClick() {
          if (!live) return
          var info = resolveNodes()
          if (info.changed || !info.ready) {
            if (info.ready) {
              stopReconnect()
              ensureObserver()
              scheduleLayoutMeasure()
            } else {
              startRecover()
            }
          }
        }

        function onImmediateCheck() {
          if (!live) return
          var info = resolveNodes()
          if (info.ready) {
            stopReconnect()
            ensureObserver()
            scheduleLayoutMeasure()
          } else if (needsShell(snap)) {
            startRecover()
          }
        }

        function afterInteraction() {
          probeAfterClick()
          probeBatch.start([0, 50])
        }

        function connect() {
          var info = resolveNodes()
          if (info.ready) {
            ensureObserver()
            scheduleLayoutMeasure()
          } else if (needsShell(snap)) {
            startRecover()
            recoverBatch.start([0, 50, 150, 400, 1000])
          }
        }

        if (typeof document.addEventListener === 'function') {
          document.addEventListener('click', afterInteraction, true)
          document.addEventListener('visibilitychange', onImmediateCheck)
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('resize', onImmediateCheck)
          window.addEventListener('focus', onImmediateCheck)
        }

        metricsOwners.add(owner)
        connect()
        return function () {
          live = false
          frameGate.dispose()
          recoverBatch.dispose()
          probeBatch.dispose()
          stopReconnect()
          if (observer !== null) observer.disconnect()
          if (snap.scroll !== null) snap.scroll.removeEventListener('scroll', scheduleTranscriptCrop)
          releaseStyleOwner(snap.root, '--lg-header-height', owner)
          releaseStyleOwner(snap.column, '--lg-chat-clip-top', owner)
          releaseStyleOwner(snap.column, '--lg-chat-clip-bottom', owner)
          if (typeof document.removeEventListener === 'function') {
            document.removeEventListener('click', afterInteraction, true)
            document.removeEventListener('visibilitychange', onImmediateCheck)
          }
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', onImmediateCheck)
            window.removeEventListener('focus', onImmediateCheck)
          }
          metricsOwners.delete(owner)
        }
      }, [])
      return null
    }
