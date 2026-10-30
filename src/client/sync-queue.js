    // Layer: 服务端写入队列 + revision 轮询。
    //
    // 拆出来的原因：这两块都涉及异步时序与定时器，混在 storage.js 里
    // 容易与「本地读写」的同步语义纠缠，且轮询缺 stop() 会泄漏。

    /* ===== 写入队列 =====
     * serverConfig 尚未加载完成时，写入先入队，加载后补发。
     * ⚠️ 早期实现直接 return 丢弃 —— 页面加载后到 loadServerConfig() 返回前
     *    （慢网络可能数秒）的所有改动全部丢失。
     * 用对象而非数组：同字段多次改动只保留最后一次。 */
    var pendingPatch = {}
    var pendingReady = false

    function flushPendingPatch() {
      if (!pendingReady) return
      var patch = pendingPatch
      pendingPatch = {}
      if (Object.keys(patch).length === 0) return
      try {
        fetch(CONFIG_ENDPOINT, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch(function () {})
      } catch (_e) {}
    }

    /* ===== revision 轮询 =====
     * 每 POLL_INTERVAL_MS 探一次版本号，变了才拉全量配置。
     * 用轮询而非 SSE：移动端切后台/切网络会断长连接，轮询更稳。
     * 页面隐藏时暂停（省电），回到前台立即探一次。 */
    var lastRevision = null
    var pollTimer = null

    function pullConfig() {
      return fetch(CONFIG_ENDPOINT, { headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (cfg) {
          if (cfg === null || typeof cfg !== 'object') return
          var rev = cfg.__revision
          delete cfg.__revision
          if (rev !== undefined) lastRevision = rev
          serverConfig = cfg
          // P1 修复：把服务端值同步写入 localStorage。
          // 否则 readCustomLibrary() 等直接读 localStorage 的地方拿到旧值。
          persistServerConfigToLocal(cfg)
          emitRemoteChange(cfg)
        })
        .catch(function () {})
    }

    function pollOnce() {
      if (typeof document !== 'undefined' && document.hidden) return Promise.resolve()
      return fetch(REVISION_ENDPOINT, { headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (data) {
          if (data === null || typeof data.revision !== 'number') return
          if (lastRevision === null) { lastRevision = data.revision; return }
          if (data.revision === lastRevision) return
          return pullConfig()
        })
        .catch(function () {})
    }

    function startRevisionPolling() {
      if (pollTimer !== null) return null
      pollTimer = setInterval(function () { pollOnce() }, POLL_INTERVAL_MS)
      var onVisible = null
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        onVisible = function () { if (!document.hidden) pollOnce() }
        document.addEventListener('visibilitychange', onVisible)
      }
      // 返回清理函数：插件卸载/热重载时必须调用，否则定时器泄漏
      return function stopRevisionPolling() {
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
        if (onVisible !== null && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisible)
          onVisible = null
        }
      }
    }
