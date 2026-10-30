    // Layer: Sidebar glass ::before only.
    var cssSidebarIsland = String.raw`
/* AppFrame sidebarCol paints an official 1px right divider. Hide it so the
   glass island edge is the only vertical boundary. */
body[data-dsh-liquid-glass] *:has(> [data-slot='sidebar']) {
  border-right: none;
  background: transparent;
  position: relative;
  z-index: 3;
}

/* L1 — SidebarRoot geometry stays official. Glass is a ::before only.
   z-index 2 sits above the conversation isolate (auto) so official
   position:fixed tooltips, which live next to their anchor, are not
   painted under the conversation island. */
body[data-dsh-liquid-glass] [data-slot='sidebar'] > :first-child {
  position: relative;
  isolation: isolate;
  z-index: 2;
  background: transparent;
}

body[data-dsh-liquid-glass] [data-slot='sidebar'] > :first-child::before {
  content: '';
  position: absolute;
  top: var(--lg-title-top);
  right: var(--lg-island-split);
  bottom: var(--lg-pane-gutter);
  left: var(--lg-pane-gutter);
  z-index: -1;
  pointer-events: none;
  background: var(--lg-shell-bg);
  background-clip: padding-box;
  overflow: hidden;
  -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  -webkit-backdrop-filter: url(#lg-island-lens-sidebar) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  backdrop-filter: url(#lg-island-lens-sidebar) blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  border-radius: var(--lg-radius-shell);
  box-shadow: inset 0 1px 0 var(--lg-highlight), inset 0 0 0 1px var(--lg-border);
}

body[data-dsh-liquid-glass] [data-sidebar-collapsed] [data-slot='sidebar'] > :first-child::before {
  top: var(--lg-title-top);
  right: 3px;
  bottom: 4px;
  left: 3px;
  border-radius: var(--lg-radius-shell);
}

/* Settings overlay stays inside SidebarRoot. Do not drop isolate or raise
   the ::before — that paints the shell over New Session / workspace chrome.
   Sidebar z-index: 2 already keeps the fixed dialog above the conversation. */

/* 移动端 GPU 降级(20261024)：侧栏玻璃岛
 * 只保留原生 blur()，去掉 SVG 引用滤镜 url(#lg-...)。
 * 原因：SVG reference filter 在移动 GPU 上需逐帧重算滤镜图；
 * 该层覆盖整个对话区，滚动时每帧重绘 => 滑动"不跟手"。
 * 属合成层开销，非布局开销（CDP 实测 LayoutCount≈0 佐证）。
 * 仅 max-width: 800px 生效，桌面端不受影响。 */
@media (max-width: 800px) {
  body[data-dsh-liquid-glass] [data-slot='sidebar'] > :first-child::before {
    -webkit-backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
    backdrop-filter: blur(var(--lg-blur-shell)) saturate(var(--lg-lens-saturate));
  }
}
`
