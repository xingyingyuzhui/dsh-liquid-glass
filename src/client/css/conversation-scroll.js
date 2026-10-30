    // Layer: Scroller clip, viewArea, chat-flow, seat, trajectory floor.
    var cssConversationScroll = String.raw`
/* Inset the official scroller so its stable gutter/scrollbar sit inside the
   transcript island. Do not touch overflow or scrollbar-gutter. clip-path
   (not overflow) keeps fast-scroll pixels inside the island; the 3px top
   inset is the title/pane gap so text cannot paint into G. */
body[data-dsh-liquid-glass] [data-conversation-scroll] {
  margin-inline: var(--lg-pane-gutter);
  margin-bottom: var(--lg-pane-gutter);
  border-radius: 0 0 var(--lg-radius-shell) var(--lg-radius-shell);
  clip-path: inset(var(--lg-pane-gutter) 0 0 0 round var(--lg-radius-shell));
}

body[data-dsh-liquid-glass] [data-slot='conversation'] > [data-phase='hero'] [data-conversation-scroll] {
  clip-path: inset(0 round var(--lg-radius-shell));
}

body[data-dsh-liquid-glass] [data-conversation-scroll]:has([role='tooltip']) {
  clip-path: none;
}

/* viewArea — content inset only. Shell lives on ConversationRoot::before. */
body[data-dsh-liquid-glass] [data-slot='conversation.session'] > :first-child:not(:has([data-conversation-composer-overlay])) {
  padding: 20px 16px 8px;
}

/* ChatView exposes one stable flow node. MetricsBridge updates these two
   insets against the actual scrollport and sticky composer rectangles, so
   transcript pixels are genuinely clipped at both viewport edges instead of
   being covered by an opaque colour slab. Trajectory does not have this node. */
/* 修复(20261022)：删除 [data-chat-flow] 上的动态 clip-path。
 *
 * 原实现给内容列加 clip-path: inset(--lg-chat-clip-top ...)，变量由 JS 按
 * 「scrollRect.top - columnRect.top」逐帧写入。实测该差值滚动后可达 1.7 万 px
 * （17820），而 inset() 是相对元素自身盒子裁剪，导致：
 *   ① 内容被从顶部整片切掉 → 过程步骤/工具调用文字被挖空，完全不可见；
 *   ② 每帧改写超大 clip-path → 整层重新栅格化，滚动明显卡顿（移动端尤甚）。
 *
 * 根本原因：这段裁剪是多余的。滚动容器 [data-conversation-scroll] 本身
 * 就是 overflow:auto 的滚动所有者，滚出视口的内容浏览器天然不绘制；
 * 容器自身的静态 clip-path(见上方规则) 已保证内容在玻璃岛圆角内被裁齐。
 * 再对内容列叠一层动态裁剪，既是二次裁剪，坐标系也不对。
 *
 * 保留 padding-bottom 作为底部呼吸位。 */
body[data-dsh-liquid-glass] [data-conversation-scroll] [data-chat-flow] {
  box-sizing: border-box;
  padding-bottom: 6px;
}

/* 20261022：内容列已不再应用 clip-path，此处原本用于在 tooltip 打开时
   释放裁剪的规则已无必要，保留说明以免后人误加回来。 */

body[data-dsh-liquid-glass] [data-slot='conversation.session'] > :first-child:has([data-conversation-composer-overlay]) {
  padding: 12px 24px;
}

@media (max-width: 800px) {
  body[data-dsh-liquid-glass] [data-slot='conversation.session'] > :first-child:not(:has([data-conversation-composer-overlay])),
  body[data-dsh-liquid-glass] [data-slot='conversation.session'] > :first-child:has([data-conversation-composer-overlay]) {
    padding-inline: 16px;
  }
}

/* Composer seat: do not write position / bottom / z-index / sticky.
   Official fade and our old edge-mask painted a full-width slab behind
   the input card and stats dock. Transcript clip already stops at the
   seat; the conversation island is the floor. */
body[data-dsh-liquid-glass] [data-composer-seat] {
  background: transparent;
}

/* Same inner gap as Chat: last ledger pixels stop pane-gutter above the
   input island. Official --dsh-composer-height is published on the scroller. */
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] {
  --dsh-trajectory-bottom-clearance: var(--dsh-composer-height, 152px);
  clip-path: inset(0 0 var(--dsh-composer-height, 152px) 0);
}

body[data-dsh-liquid-glass] [data-conversation-composer-overlay]:has([role='tooltip']) {
  clip-path: none;
}

/* Official trajectory paints --dsw-alias-bg-layer-1 on the host, toolbar,
   split, and the table itself. Clear those floors; row hover/chips stay. */
body[data-dsh-liquid-glass] [data-conversation-composer-overlay],
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] > *,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] > :last-child,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] > :last-child > *,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] section,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] section > *,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] table,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] thead,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] tbody,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] tr,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] th,
body[data-dsh-liquid-glass] [data-conversation-composer-overlay] td {
  background-color: transparent;
}
`
