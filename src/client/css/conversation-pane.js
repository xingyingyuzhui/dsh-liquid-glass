    // Layer: Conversation / hero island plates and rims.
    var cssConversationPane = String.raw`
/* ConversationRoot — official ui-conversation/ConversationRoot.tsx.
   Transparent host. The fixed transcript material spans the official
   scroll viewport: from just below the tab rail to the bottom of ConversationRoot.
   This keeps every scrolling pixel inside one stable island without clipping
   descendants or painting an opaque patch behind the sticky composer. */
body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase] {
  position: relative;
  isolation: isolate;
  background: transparent;
}

body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='active']::before,
body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='settling']::before {
  content: '';
  position: absolute;
  left: var(--lg-island-split);
  right: var(--lg-pane-gutter);
  top: calc(var(--lg-header-height, 84px) + var(--lg-island-gap));
  bottom: 8px;
  z-index: -1;
  pointer-events: none;
  background: var(--lg-pane-bg);
  background-clip: padding-box;
  overflow: hidden;
  clip-path: inset(0 round var(--lg-radius-shell));
  -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  -webkit-backdrop-filter: url(#lg-island-lens-pane) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  backdrop-filter: url(#lg-island-lens-pane) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  border-radius: var(--lg-radius-shell);
}

/* Blank New Session hides the header, so the pane island starts where the
   title island would — one full column of glass behind the hero stack. */
body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='hero']::before {
  content: '';
  position: absolute;
  left: var(--lg-island-split);
  right: var(--lg-pane-gutter);
  top: var(--lg-title-top);
  bottom: 8px;
  z-index: -1;
  pointer-events: none;
  background: var(--lg-pane-bg);
  background-clip: padding-box;
  overflow: hidden;
  clip-path: inset(0 round var(--lg-radius-shell));
  -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  -webkit-backdrop-filter: url(#lg-island-lens-pane) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  backdrop-filter: url(#lg-island-lens-pane) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  border-radius: var(--lg-radius-shell);
}

/* Fixed pane rim. Header/composer retain official z 6 / 7;
   data-conversation-scroll remains the sole scroll owner. */
body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='active']::after,
body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='settling']::after {
  content: '';
  position: absolute;
  left: var(--lg-island-split);
  right: var(--lg-pane-gutter);
  top: calc(var(--lg-header-height, 84px) + var(--lg-island-gap));
  bottom: 8px;
  z-index: 5;
  pointer-events: none;
  overflow: hidden;
  background: transparent;
  border-radius: var(--lg-radius-shell);
  box-shadow: inset 0 0 0 1px var(--lg-border);
}

body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='hero']::after {
  content: '';
  position: absolute;
  left: var(--lg-island-split);
  right: var(--lg-pane-gutter);
  top: var(--lg-title-top);
  bottom: 8px;
  z-index: 5;
  pointer-events: none;
  overflow: hidden;
  background: transparent;
  border-radius: var(--lg-radius-shell);
  box-shadow: inset 0 0 0 1px var(--lg-border);
}

/* 移动端 GPU 降级(20261024)：正文玻璃岛
 * 只保留原生 blur()，去掉 SVG 引用滤镜 url(#lg-...)。
 * 原因：SVG reference filter 在移动 GPU 上需逐帧重算滤镜图；
 * 该层覆盖整个对话区，滚动时每帧重绘 => 滑动"不跟手"。
 * 属合成层开销，非布局开销（CDP 实测 LayoutCount≈0 佐证）。
 * 仅 max-width: 800px 生效，桌面端不受影响。 */
@media (max-width: 800px) {
  body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='active']::before,
  body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='settling']::before {
    -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
    backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  }
}
`
