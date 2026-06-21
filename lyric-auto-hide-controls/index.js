/**
 * Lyric Auto-Hide Controls
 * 歌词全屏界面底部播放控制栏在鼠标静止后自动淡出隐藏
 *
 * 原理：
 * - 监听 lyric-page-view 或整个 document 的 mousemove
 * - 鼠标静止 idleDelay 毫秒后，给 lyric-bar 添加 .auto-hide 类（opacity: 0, pointer-events: none）
 * - 鼠标移动时立即移除 .auto-hide 类，恢复显示
 * - 进度条 hover 时保持显示（隔离进度条区域的事件）
 * - 通过 CSS transition 实现平滑淡入淡出
 */

const STORAGE_KEY = "settings";

// ========== CSS 样式注入 ==========

function injectStyles() {
  const styleId = "lyric-auto-hide-controls-style";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    /* 控制栏容器 — 淡入淡出过渡 */
    .lyric-bar {
      transition: opacity 0.35s ease, visibility 0.35s ease !important;
    }

    /* 隐藏状态：完全消失 */
    .lyric-bar.lyric-bar-hidden {
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    /* 但进度条保留一小条热点区域（不可见但可接收鼠标事件） */
    .lyric-bar.lyric-bar-hidden .bar-progress-top {
      opacity: 0 !important;
      visibility: visible !important;
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);
}

// ========== 核心逻辑 ==========

/**
 * 查找当前歌词页面中的控制栏
 */
function findLyricBar() {
  // 优先在当前歌词视图容器中查找
  const lyricView = document.querySelector(
    '[class*="lyric-page"], [class*="LyricPage"], [class*="lyric-view"]'
  );
  if (lyricView) {
    const bar = lyricView.querySelector(".lyric-bar");
    if (bar) return bar;
  }
  // 回退：全局查找
  return document.querySelector(".lyric-bar");
}

/**
 * 判断是否处于歌词全屏/沉浸模式
 * 控制栏存在且可见即认为处于歌词界面
 */
function isInLyricMode() {
  const bar = findLyricBar();
  if (!bar) return false;
  // 检查控制栏是否可见（不在 display:none 的父容器中）
  return bar.offsetParent !== null || bar.getBoundingClientRect().height > 0;
}

/**
 * 创建自动隐藏控制器
 */
function createAutoHider(options = {}) {
  let idleDelay = options.idleDelay ?? 2000; // 鼠标静止多久后隐藏（毫秒）
  let enabled = options.enabled ?? true;

  let hideTimer = null; // 隐藏延迟定时器
  let isHidden = false; // 当前是否处于隐藏状态
  let isOverProgress = false; // 鼠标是否在进度条区域
  let barElement = null; // 当前的控制栏元素

  // 鼠标在进度条上方时不要隐藏
  const progressSelector = ".bar-progress-top, .bar-slider-top";

  /**
   * 重置隐藏定时器（鼠标动了）
   */
  function resetIdleTimer() {
    if (!enabled) return;
    if (!barElement) return;

    // 如果当前是隐藏状态，立即取消隐藏
    if (isHidden) {
      showBar();
      return;
    }

    // 重置定时器
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideBar();
    }, idleDelay);
  }

  /**
   * 隐藏控制栏
   */
  function hideBar() {
    if (!barElement || isHidden) return;
    // 如果鼠标在进度条上，不隐藏
    if (isOverProgress) {
      // 重新延迟
      hideTimer = setTimeout(() => hideBar(), idleDelay);
      return;
    }
    barElement.classList.add("lyric-bar-hidden");
    isHidden = true;
  }

  /**
   * 显示控制栏
   */
  function showBar() {
    if (!barElement || !isHidden) return;
    barElement.classList.remove("lyric-bar-hidden");
    isHidden = false;

    // 重新计时
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideBar(), idleDelay);
  }

  /**
   * 鼠标移动事件处理器
   */
  function onMouseMove(e) {
    // 检查鼠标是否在进度条区域
    const progressEl = barElement?.querySelector(progressSelector);
    if (progressEl) {
      const rect = progressEl.getBoundingClientRect();
      isOverProgress =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
    }

    resetIdleTimer();
  }

  /**
   * 鼠标离开歌词页面事件
   */
  function onMouseLeave(e) {
    // 只有当鼠标真正离开了整个窗口才隐藏
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || relatedTarget === document.documentElement) {
      // 短暂延迟后隐藏
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideBar();
      }, 300);
    }
  }

  /**
   * 进度条 hover 事件
   */
  function onProgressEnter() {
    isOverProgress = true;
    // 如果当前是隐藏状态，显示控制栏
    if (isHidden) {
      showBar();
    }
    // 取消隐藏定时器
    if (hideTimer) clearTimeout(hideTimer);
  }

  function onProgressLeave() {
    isOverProgress = false;
    // 重新启动隐藏定时器
    resetIdleTimer();
  }

  /**
   * 绑定事件到控制栏和目标元素
   */
  function attachEvents(bar) {
    if (!bar) return;
    barElement = bar;

    // 使用整个 document 监听鼠标移动（覆盖更广）
    document.addEventListener("mousemove", onMouseMove, { passive: true });

    // 鼠标离开窗口时隐藏
    document.addEventListener("mouseleave", onMouseLeave);

    // 进度条 hover 事件
    const progressEl = bar.querySelector(progressSelector);
    if (progressEl) {
      progressEl.addEventListener("mouseenter", onProgressEnter);
      progressEl.addEventListener("mouseleave", onProgressLeave);
    }

    // 点击进度条时不要隐藏
    bar.addEventListener("pointerdown", () => {
      if (hideTimer) clearTimeout(hideTimer);
    });
    bar.addEventListener("pointerup", () => {
      resetIdleTimer();
    });

    // 键盘事件 — ESC 键切换显示/隐藏
    document.addEventListener("keydown", onKeyDown);

    // 启动空闲计时器
    if (enabled) {
      resetIdleTimer();
    }
  }

  function onKeyDown(e) {
    // ESC 键切换隐藏/显示
    if (e.key === "Escape" && barElement) {
      if (isHidden) {
        showBar();
      } else {
        hideBar();
      }
    }
  }

  /**
   * 解绑所有事件
   */
  function detachEvents() {
    if (hideTimer) clearTimeout(hideTimer);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("keydown", onKeyDown);

    if (barElement) {
      const progressEl = barElement.querySelector(progressSelector);
      if (progressEl) {
        progressEl.removeEventListener("mouseenter", onProgressEnter);
        progressEl.removeEventListener("mouseleave", onProgressLeave);
      }
    }

    // 恢复显示
    if (barElement && isHidden) {
      barElement.classList.remove("lyric-bar-hidden");
    }
    barElement = null;
    isHidden = false;
    isOverProgress = false;
  }

  /**
   * 更新设置
   */
  function updateSettings(newOptions) {
    const wasEnabled = enabled;
    const wasDelay = idleDelay;

    // 应用新设置
    Object.assign(options, newOptions);

    // 同步内部变量
    enabled = options.enabled ?? enabled;
    idleDelay = options.idleDelay ?? idleDelay;

    if (enabled && !wasEnabled) {
      // 从禁用变为启用
      resetIdleTimer();
    } else if (!enabled && wasEnabled) {
      // 从启用变为禁用
      if (hideTimer) clearTimeout(hideTimer);
      if (isHidden) showBar();
    } else if (enabled && idleDelay !== wasDelay) {
      // 只是延迟变了，重新计时
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => hideBar(), idleDelay);
    }
  }

  return {
    attachEvents,
    detachEvents,
    updateSettings,
    get isHidden() {
      return isHidden;
    },
  };
}

// ========== 插件入口 ==========

export async function activate(ctx) {
  const saved = await ctx.storage.get(STORAGE_KEY);
  const settings = {
    enabled: true,
    idleDelay: 2000,
    fadeDuration: 400,
    ...(saved || {}),
  };

  // 注入 CSS
  injectStyles();

  // 创建控制器
  const hider = createAutoHider({
    idleDelay: settings.idleDelay,
    fadeDuration: settings.fadeDuration,
    enabled: settings.enabled,
  });

  /**
   * 尝试绑定控制栏
   */
  function tryAttach() {
    const bar = findLyricBar();
    if (!bar || bar === lastBar) return false;

    // 解绑旧的
    hider.detachEvents();

    hider.attachEvents(bar);
    lastBar = bar;
    return true;
  }

  // 立即尝试
  let lastBar = null;
  tryAttach();

  // MutationObserver 监听 DOM 变化，自动重新绑定
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      const currentBar = findLyricBar();
      if (currentBar !== lastBar) {
        // bar 变了（新建/重建/切换视图），重新绑定
        hider.detachEvents();
        if (currentBar) {
          hider.attachEvents(currentBar);
        }
        lastBar = currentBar;
      }
    }, 200);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
  });

  // 轮询重试（覆盖异步渲染，最长 15 秒）
  let retryCount = 0;
  const retryInterval = setInterval(() => {
    retryCount++;
    if (retryCount > 30) {
      clearInterval(retryInterval);
      return;
    }
    const bar = findLyricBar();
    if (!bar || bar === lastBar) return;
    tryAttach();
    lastBar = bar;
    clearInterval(retryInterval);
  }, 500);

  // 延迟重试（覆盖渲染延迟）
  for (const delay of [300, 800, 1500, 3000]) {
    setTimeout(() => {
      if (findLyricBar()) {
        tryAttach();
      }
    }, delay);
  }

  // ========== 注册设置面板 ==========

  ctx.ui.settings.define({
    id: "lyric-auto-hide-controls",
    title: "沉浸式歌词隐藏",
    description: "全屏歌词界面下，鼠标静止后自动隐藏底部控制栏",
    component: ctx.vue.defineComponent({
      setup() {
        const { ref, h } = ctx.vue;

        const enabled = ref(settings.enabled);
        const idleDelay = ref(settings.idleDelay);

        function saveSettings() {
          const newSettings = {
            enabled: enabled.value,
            idleDelay: idleDelay.value,
          };
          ctx.storage.set(STORAGE_KEY, newSettings);
          hider.updateSettings(newSettings);
        }

        return () => {
          const enabledStyle = enabled.value ? "" : " opacity: 0.4; pointer-events: none;";
          return h(
            "div",
            {
              style:
                "display: grid; gap: 14px; color: var(--color-text-main, #f8fafc); font-size: 13px;",
            },
            [
              // 启用开关（用原生 checkbox 模拟）
              h(
                "label",
                {
                  style:
                    "display: flex; justify-content: space-between; align-items: center; gap: 12px; cursor: pointer;",
                },
                [
                  h("span", "启用隐藏"),
                  h("input", {
                    type: "checkbox",
                    checked: enabled.value,
                    style:
                      "width: 18px; height: 18px; accent-color: var(--color-primary, #31cfa1); cursor: pointer;",
                    onChange: (e) => {
                      enabled.value = e.target.checked;
                      saveSettings();
                    },
                  }),
                ]
              ),
              // 隐藏延迟设置
              h(
                "div",
                { style: "display: grid; gap: 6px;" + enabledStyle },
                [
                  h(
                    "div",
                    {
                      style:
                        "display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-secondary, rgba(148,163,184,0.9));",
                    },
                    [
                      h("span", "隐藏延迟"),
                      h("span", idleDelay.value + "ms"),
                    ]
                  ),
                  h("input", {
                    type: "range",
                    min: 500,
                    max: 5000,
                    step: 100,
                    value: idleDelay.value,
                    style:
                      "width: 100%; accent-color: var(--color-primary, #31cfa1); cursor: pointer;",
                    onChange: (e) => {
                      idleDelay.value = parseInt(e.target.value);
                      saveSettings();
                    },
                    onInput: (e) => {
                      idleDelay.value = parseInt(e.target.value);
                    },
                  }),
                  h(
                    "div",
                    {
                      style:
                        "display: flex; justify-content: space-between; font-size: 10px; color: var(--color-text-tertiary, rgba(148,163,184,0.5));",
                    },
                    [h("span", "0.5s"), h("span", "5s")]
                  ),
                ]
              ),
              // 说明
              h(
                "p",
                {
                  style:
                    "color: var(--color-text-secondary, rgba(148,163,184,0.9)); font-size: 12px; line-height: 1.5; margin: 0;",
                },
                [
                  "鼠标静止后控制栏自动淡出。",
                  h("br"),
                  "鼠标移动或划过进度条恢复显示。",
                  h("br"),
                  "按 ESC 键手动切换。",
                ]
              ),
            ]
          );
        };
      },
    }),
  });

  ctx.dispose(() => {
    observer.disconnect();
    if (mutationTimer) clearTimeout(mutationTimer);
    hider.detachEvents();
  });
}

export async function deactivate(ctx) {
  // 清理注入的样式
  const style = document.getElementById("lyric-auto-hide-controls-style");
  if (style) style.remove();

  // 恢复控制栏显示
  document.querySelectorAll(".lyric-bar.lyric-bar-hidden").forEach((el) => {
    el.classList.remove("lyric-bar-hidden");
  });
}
