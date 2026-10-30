    // Layer: Title island, utilities, side-card offset.
    var cssConversationTitle = String.raw`
/* Header chrome stays transparent. Official header already position:relative. */
body[data-dsh-liquid-glass] [data-slot='conversation.session.header'] > header {
  isolation: isolate;
  z-index: 6;
  background: transparent;
  border-bottom-color: transparent;
  box-shadow: none;
}

body[data-dsh-liquid-glass] [data-slot='conversation.session.header'] > header::after {
  opacity: 0;
  background: transparent;
}

/* Title island shares the transcript island's left/right edges and frames
   Session log / header utilities. Stops above the official tab underline so
   that rail sits in the gap and bisects it. */
body[data-dsh-liquid-glass] [data-slot='conversation.session.header'] > header::before {
  content: '';
  position: absolute;
  left: var(--lg-island-split);
  right: var(--lg-pane-gutter);
  top: var(--lg-title-top);
  bottom: var(--lg-title-foot);
  pointer-events: none;
  z-index: -1;
  background: var(--lg-pane-bg);
  background-clip: padding-box;
  overflow: hidden;
  clip-path: inset(0 round var(--lg-radius-shell));
  -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  -webkit-backdrop-filter: url(#lg-island-lens-title) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  backdrop-filter: url(#lg-island-lens-title) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  border-radius: var(--lg-radius-shell);
  box-shadow: inset 0 1px 0 var(--lg-highlight), inset 0 0 0 1px var(--lg-border);
}

body[data-dsh-liquid-glass] [data-slot='conversation.session.header'] > header > * {
  position: relative;
  z-index: 1;
}

/* Utilities sit inside the title island — no second capsule. */
body[data-dsh-liquid-glass] [data-slot='conversation.session.header.utilities'] > * {
  background: transparent;
  box-shadow: none;
}

/* Side-card toggles (dsh-better-sidebar) are viewport-fixed at top: 3px.
   While the right drawer is closed they sit on the title island — drop
   them onto the official Session log midline (header pad 12 + 32/2 − 28/2).
   An open drawer keeps the plugin's own 3px tab-strip alignment. */
body[data-dsh-liquid-glass][data-dsh-sidebar-collapsed] [data-dsh-better-sidebar] > :first-child {
  top: 14px;
}

/* 移动端 GPU 降级(20261024)：标题栏玻璃岛
 * 只保留原生 blur()，去掉 SVG 引用滤镜 url(#lg-...)。
 * 原因：SVG reference filter 在移动 GPU 上需逐帧重算滤镜图；
 * 该层覆盖整个对话区，滚动时每帧重绘 => 滑动"不跟手"。
 * 属合成层开销，非布局开销（CDP 实测 LayoutCount≈0 佐证）。
 * 仅 max-width: 800px 生效，桌面端不受影响。 */
@media (max-width: 800px) {
  body[data-dsh-liquid-glass] [data-slot='conversation.session.header'] > header::before {
    -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
    backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  }
}
`
