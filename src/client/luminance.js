    // Layer: 纯函数 —— 亮度测量与明暗推算。无副作用，便于验证。
    //
    // 为什么单独成文件：这是一段纯计算逻辑，与存储/网络无关。
    // 混在 storage.js 里既难读也难测。

    /* 测量图片亮度（0~1）。缩到 16x16 画到 canvas，按 Rec.709 权重加权求均值：
     *   L = 0.2126*R + 0.7152*G + 0.0722*B     （比简单平均更贴近人眼）
     * 只在导入时算一次，不在渲染路径上。
     * canvas 被跨域污染 / 解码失败时返回 null。 */
    function inferLuminanceFromDataUrl(dataUrl) {
      return new Promise(function (resolve) {
        try {
          var img = new Image()
          img.onload = function () {
            try {
              var size = 16
              var canvas = document.createElement('canvas')
              canvas.width = size
              canvas.height = size
              var ctx = canvas.getContext('2d')
              if (ctx === null) { resolve(null); return }
              ctx.drawImage(img, 0, 0, size, size)
              var px = ctx.getImageData(0, 0, size, size).data
              var sum = 0
              var weight = 0
              for (var k = 0; k < px.length; k += 4) {
                var a = px[k + 3] / 255
                if (a < 0.1) continue
                var lum = (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255
                sum += lum * a
                weight += a
              }
              if (weight === 0) { resolve(null); return }
              resolve(Math.round((sum / weight) * 1000) / 1000)
            } catch (_e) { resolve(null) }
          }
          img.onerror = function () { resolve(null) }
          img.src = dataUrl
        } catch (_e) { resolve(null) }
      })
    }

    /* 按「实际显示效果」判定明暗。
     *
     *   最终视觉 = 图片亮度 × opacity + 底层亮度 × (1 - opacity)
     *
     * 但底层色取决于 surface(light/dark)，与判定本身构成循环依赖。
     * 解法：两个假设各算一遍，一致才采用；不一致说明落在临界区，返回 null
     * （由调用方回退宿主主题，避免明暗来回跳）。
     *
     * 参数不合法时返回 null。 */
    function resolveTone(luminance, opacity) {
      if (typeof luminance !== 'number' || !isFinite(luminance)) return null
      var alpha = Number(opacity)
      if (!isFinite(alpha)) alpha = DEFAULT_WALLPAPER_OPACITY
      alpha = Math.min(1, Math.max(0, alpha))
      var LIGHT_BASE = 1.0    // rgb(255,255,255)
      var DARK_BASE = 0.08    // rgb(21,21,23)
      var onLight = luminance * alpha + LIGHT_BASE * (1 - alpha)
      var onDark = luminance * alpha + DARK_BASE * (1 - alpha)
      var verdictLight = onLight > 0.5 ? 'light' : 'dark'
      var verdictDark = onDark > 0.5 ? 'light' : 'dark'
      return verdictLight === verdictDark ? verdictLight : null
    }
