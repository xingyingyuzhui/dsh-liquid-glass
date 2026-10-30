    // Layer: Wallpaper plate and L0 tokens.
    var cssTokens = String.raw`
[data-dsh-liquid-glass-wallpaper] {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

/* L0 tokens */
body[data-dsh-liquid-glass] {
  --lg-wallpaper-opacity: 0.88;
  --lg-glass-blur: 20px;
  --lg-shell-bg: rgba(255, 255, 255, 0.52);
  --lg-pane-bg: rgba(255, 255, 255, 0.52);
  --lg-card-bg: rgba(255, 255, 255, 0.46);
  --lg-overlay-bg: rgba(248, 251, 255, 0.92);
  --lg-control-bg: rgba(248, 251, 255, 0.80);
  --lg-selected-bg: rgba(176, 210, 255, 0.34);
  --lg-border: rgba(255, 255, 255, 0.46);
  --lg-border-strong: rgba(255, 255, 255, 0.62);
  --lg-highlight: rgba(255, 255, 255, 0.78);
  --lg-shadow-card: inset 0 1px 0 var(--lg-highlight), inset 0 -1px 0 rgba(40, 70, 110, 0.05);
  --lg-blur-shell: var(--lg-glass-blur);
  --lg-blur-card: max(0px, calc(var(--lg-glass-blur) - 6px));
  --lg-lens-saturate: 160%;
  --lg-shell-saturate: 145%;
  --lg-pane-saturate: 140%;
  --lg-radius-shell: 28px;
  --lg-radius-card: 22px;
  --lg-radius-control: 999px;
  --lg-pane-gutter: 8px;
  --lg-island-split: 4px;
  --lg-title-top: 6px;
  --lg-title-foot: 8px;
  --lg-island-gap: 3px;
  --lg-dock-gap: 6px;
  /* 修复(20261022)：文字色改为跟随宿主变量，不再硬编码。
   * 背景：插件用 theme.getTheme().active.colorScheme 判定明暗并写 data-dsh-liquid-glass='dark'，
   * 但该判定与宿主实际渲染的主题可能不一致。实测评测中插件标记为 'dark'（浅色字 #eef2f8），
   * 而宿主 --dsw-alias-label-primary 为 #2c3340（深色字），背景又是浅色壁纸，
   * 导致过程步骤/工具调用等使用 --lg-text-primary 的文字对比度仅 1.12（WCAG AA 需 >=4.5）。
   * 改为直接引用宿主变量后两边永远一致，对比度恢复到 12.69。
   * 保留原值作为 fallback，宿主变量缺失时行为不变。 */
  --lg-text-primary: var(--dsw-alias-label-primary, #2c3340);
  --lg-text-secondary: var(--dsw-alias-label-secondary, #5b6472);
  --lg-toggle-on-fill: #fff;
  --lg-toggle-on-ink: #2c3340;
  --lg-metal-ring: conic-gradient(#5a6068, #7eb6ff, #8a9096, #b8c0c6, #ffb3b3, #9a9090, #e6d56a, #8a8e86, #7eb6ff, #5a6068);
  --lg-edge-mask: rgba(229, 239, 250, 0.92);
  color: var(--lg-text-primary);
}

body[data-dsh-liquid-glass='dark'] {
  /* 20261027：wash 回退到 0.02 后，可读性由玻璃岛自身不透明度承担。
   * 侧栏与正文用同一色值，避免左右色差；正文略高以保证文字对比度。 */
  --lg-shell-bg: rgba(16, 22, 36, 0.42);
  --lg-pane-bg: rgba(16, 22, 36, 0.42);
  --lg-card-bg: rgba(24, 32, 50, 0.52);
  --lg-overlay-bg: rgba(22, 26, 36, 0.92);
  --lg-control-bg: rgba(24, 32, 50, 0.76);
  --lg-selected-bg: rgba(70, 120, 200, 0.28);
  --lg-border: rgba(255, 255, 255, 0.12);
  --lg-border-strong: rgba(255, 255, 255, 0.22);
  --lg-highlight: rgba(255, 255, 255, 0.18);
  --lg-shadow-card: inset 0 1px 0 var(--lg-highlight);
  --lg-text-primary: var(--dsw-alias-label-primary, #eef2f8);
  --lg-text-secondary: var(--dsw-alias-label-secondary, rgba(226, 234, 255, 0.70));
  --lg-toggle-on-fill: #2c3340;
  --lg-toggle-on-ink: #fff;
  --lg-metal-ring: conic-gradient(#151a22, #2a5560, #aae8ff, #5a6870, #3a3034, #f7888d, #6a5850, #4a4830, #fffdc3, #3a4a50, #aae8ff, #151a22);
  --lg-edge-mask: rgba(10, 17, 32, 0.90);
  color: var(--lg-text-primary);
}
`
