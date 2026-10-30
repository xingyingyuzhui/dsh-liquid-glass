# dsh-liquid-glass · DSH 液态玻璃（维护版 fork）

DeepSeek Harness（DSH）Web 皮肤：在官方**浅色 / 深色 / 跟随系统**之上叠加壁纸，以及可选的液态玻璃岛。

对照官方基线：DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`。

> ## ⚠️ 这是 fork，不是原版
>
> 上游 [xingyingyuzhui/dsh-liquid-glass](https://github.com/xingyingyuzhui/dsh-liquid-glass)
> 自 2026-08-15（`573a81d`）后**已停更**。本仓库在其基础上修复缺陷并新增能力，
> **代码已大幅偏离**，不保证与上游行为一致。
>
> **安装请用本仓库，不要用上游。** 改动清单见下方「本 fork 的改动」。

## 预览

| 冰原 | 深水 |
| --- | --- |
| ![冰原壁纸下的新会话](docs/preview/ice-hero.jpg) | ![深水壁纸下的对话](docs/preview/deepwater-chat.jpg) |

| 设置 | 自定义壁纸 |
| --- | --- |
| ![设置里选择壁纸](docs/preview/settings.jpg) | ![导入的自定义壁纸](docs/preview/custom-wallpaper.jpg) |

## 功能

- **壁纸预设**：冰原（浅色）、深水（深色），也可导入自己的图
- **壁纸透明度**：只改壁纸本身，不糊整张图
- **玻璃模糊**：只糊每个玻璃岛背后那一层（侧栏、标题、正文、输入区）
- **液态玻璃开关**：关材质后官方表面回来，壁纸可以继续留着
- **不抢官方几何**：会话滚动仍由 `data-conversation-scroll` 管，输入区 sticky 不改

## 安装

前置：已安装 DSH（`dsh web` 可运行）。

```sh
dsh plugin --profile web add github:ptrel1/dsh-liquid-glass
```

装完**重启 DSH**（`dsh web`），然后打开 **设置 → 通用 → Liquid Glass**。

## 使用

| 控件 | 作用 |
| --- | --- |
| Wallpaper | 预设 / 导入。滑杆只改壁纸透明度。 |
| Glass blur | 每个玻璃岛背后的 backdrop blur。壁纸保持清晰。 |
| Liquid Glass | 开/关材质。关了恢复官方表面，壁纸可单独留着。 |

旧的「壁纸模糊」存储键不再读取，也不会自动换成新的玻璃模糊。

## 配置持久化与多设备同步

**配置存在服务端，不是浏览器本地。** 所有客户端共享同一份。

```
$DSH_HOME/liquid-glass/config.json
```

| 存储位置 | 内容 | 原因 |
| --- | --- | --- |
| **服务端**（上述文件） | 开关、皮肤、壁纸预设、玻璃模糊、壁纸透明度 | 统一风格，多端一致 |
| **浏览器本地** | 自定义壁纸图片 | 图片体积大，且只对当前设备有意义 |

对应接口：`GET/PUT /api/dsh-liquid-glass/config`

**升级注意**：从旧版本升级时会**自动迁移** —— 首次加载若服务端配置为空，
会把浏览器里已有的设置上报一次，无需重新配置。

### 自定义壁纸也跨设备同步

导入的图片会上传服务端，其他设备**自动下载一次**，之后走浏览器缓存。

```
$DSH_HOME/liquid-glass/wallpapers/
  ├── index.json           清单（{id: {hash, ext}}）
  └── <内容哈希>.jpg        原图
```

**不会重复下载**：图片按内容哈希命名，URL 带指纹，响应头设
`cache-control: public, max-age=31536000, immutable`。
内容变 ⇒ 哈希变 ⇒ URL 变 ⇒ 自动失效重取。

> 本地仍保留一份副本：服务端不可达时壁纸照常显示。


## 本 fork 的改动（相对上游 573a81d）

共 13 个提交。分三类：

### 一、修复上游缺陷

| 问题 | 根因 | 修法 |
|---|---|---|
| 过程步骤文字被「挖空」、滚动卡顿 | `clip-path: inset()` 用**视口坐标差值**当元素自身裁剪量，实测达 17820px | 移除内容列动态 clip-path（滚动容器已有 `overflow:auto`）|
| 过程步骤文字不可见 | `--lg-text-primary` 硬编码，与宿主实际主题不一致，对比度仅 1.12 | 改为 `var(--dsw-alias-label-primary, 原值)` |
| 移动端滑动「不跟手」 | 8 处 `backdrop-filter: url(#lg-...)` 是 SVG 引用滤镜，移动 GPU 逐帧重算 | `@media (max-width: 800px)` 降级为原生 `blur()` |
| 左右背景色调分界 | 正文区有**三层**元素共用 `--dsw-alias-bg-base`，侧栏只有一层，差异被 wash 指数放大 | wash 回退固定值，可读性改由玻璃岛自身不透明度承担 |

### 二、新增能力

| 能力 | 说明 |
|---|---|
| **配置服务端持久化** | 原配置只存 `localStorage`，每个客户端各配一遍。现存 `$DSH_HOME/liquid-glass/config.json`，多端共享 |
| **跨设备实时同步** | 每 2s 探一次 revision，变了才拉全量。设备 A 改设置，设备 B 自动跟随 |
| **自定义壁纸同步** | 图片存服务端，按内容 sha256 命名 + `immutable` 缓存，不重复下载 |
| **明暗按实际显示效果判断** | 自定义图原本没有 tone，永远回退宿主主题。现按「图亮度 × 不透明度 + 底层亮度 ×(1-不透明度)」实时推算 |

### 三、代码结构

`storage.js` 由 445 行拆为 3 个模块：

```
src/client/
  ├── luminance.js    纯函数：亮度测量 + tone 推算（无副作用）
  ├── storage.js      本地读写 + 服务端 config 同步
  └── sync-queue.js   写入队列 + revision 轮询（带 stop）
```

## 与上游的关系

- 已向上游提交 issue #6 与 PR #7（仅含第一个修复），**作者未处理**
- 上游自 2026-08-15 停更，后续修复不会回流
- 本 fork 完整包含上游全部提交（`git rev-list 573a81d --not HEAD` 为空）

## 工作原理

| 面 | 文件 | 说明 |
| --- | --- | --- |
| Host | `host.js` | 托管冰原 / 深水 JPEG。哈希 URL 一年 `immutable`，legacy URL `no-cache`。 |
| Client | `client.js` | `__ModuleLoader__` bundle：设置行 + 壁纸层 + 玻璃岛 CSS。源码在 `src/client/`，`client.js` 由 `npm run build` 生成。 |

CSS 只挂在 `body[data-dsh-liquid-glass]` 下。模糊只发生在各岛 `::before`，不糊壁纸、body 或官方滚动容器。

## 卸载

```sh
dsh plugin --profile web remove dsh-liquid-glass
```

然后重启 `dsh web`。

## 开发

```sh
# 改 src/client/ 后重新生成 client.js
npm run build
npm test          # 只读检查，生成物过期会失败

# 本地验证
dsh plugin --profile web add file:/absolute/path/to/dsh-liquid-glass
# 或
dsh plugin --profile web add link:/absolute/path/to/dsh-liquid-glass
```

不要手改 `client.js` 和 `src/client/generated-optics-fallbacks.js`。

## License

MIT
