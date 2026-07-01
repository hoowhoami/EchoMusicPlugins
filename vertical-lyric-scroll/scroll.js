const STORAGE_KEY = "settings";
const CHANNEL_NAME = "echo-plugin:vertical-lyric-scroll:settings";

// 与主程序 DesktopLyricView.vue 对齐的阈值常量
const LYRIC_LOOKAHEAD = 150;
const SYNC_THRESHOLD = 300;
const PLAYBACK_STALE_THRESHOLD = 1800;

const DEFAULT_SETTINGS = {
  enabled: true,
  autoOpen: true,
  alwaysOnTop: true,
  theme: "auto",
  width: 200,
  height: 560,
  opacity: 88,
  blur: 24,
  fontSize: 30,
  showSecondary: true,
  showPrevNext: true,
  hideWhenIdle: false,
  clickThrough: false,
  locked: false,
};

const WIDTH_LIMITS = [180, 280];
const HEIGHT_LIMITS = [360, 760];

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const theme = ["auto", "dark", "light"].includes(String(source.theme))
    ? String(source.theme)
    : DEFAULT_SETTINGS.theme;

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    autoOpen: source.autoOpen ?? DEFAULT_SETTINGS.autoOpen,
    alwaysOnTop: source.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop,
    theme,
    width: clamp(source.width ?? DEFAULT_SETTINGS.width, ...WIDTH_LIMITS),
    height: clamp(source.height ?? DEFAULT_SETTINGS.height, ...HEIGHT_LIMITS),
    opacity: clamp(source.opacity ?? DEFAULT_SETTINGS.opacity, 50, 100),
    blur: clamp(source.blur ?? DEFAULT_SETTINGS.blur, 0, 38),
    fontSize: clamp(source.fontSize ?? DEFAULT_SETTINGS.fontSize, 20, 56),
    showSecondary: source.showSecondary ?? DEFAULT_SETTINGS.showSecondary,
    showPrevNext: source.showPrevNext ?? DEFAULT_SETTINGS.showPrevNext,
    hideWhenIdle: source.hideWhenIdle ?? DEFAULT_SETTINGS.hideWhenIdle,
    clickThrough: source.clickThrough ?? DEFAULT_SETTINGS.clickThrough,
    locked: source.locked ?? DEFAULT_SETTINGS.locked,
  };
};

const settingsKey = (settings) => JSON.stringify(normalizeSettings(settings));

const getWindowSize = (settings) => ({
  width: Math.round(clamp(settings.width, ...WIDTH_LIMITS)),
  height: Math.round(clamp(settings.height, ...HEIGHT_LIMITS)),
});

// ===== 歌词时间推算纯函数（对齐主程序）=====

const getLineStartMs = (line) => {
  const charStart = line?.characters?.[0]?.startTime;
  if (Number.isFinite(charStart)) return charStart;
  return Math.round((Number(line?.time) || 0) * 1000);
};

const calculateLineIndex = (lines, seekMs) => {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  let index = -1;
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (seekMs >= getLineStartMs(lines[mid])) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return index;
};

const getPreferredSecondary = (lyric, line) => {
  if (!lyric || !line) return "";
  const translated = String(line.translated || "").trim();
  const romanized = String(line.romanized || "").trim();
  const wantsTranslation = lyric.wantTranslation && lyric.hasTranslation;
  const wantsRomanization = lyric.wantRomanization && lyric.hasRomanization;
  if (wantsTranslation && wantsRomanization) {
    return [translated, romanized].filter(Boolean).join(" / ");
  }
  if (wantsRomanization) return romanized || translated;
  if (wantsTranslation) return translated || romanized;
  return translated || romanized;
};

const isYrcLine = (line) => (line?.characters?.length ?? 0) > 1;

// ===== SVG 图标 =====

const svgIcon = (h, name) => {
  const common = {
    class: "vls-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  };
  const path = (d, extra = {}) => h("path", { d, ...extra });

  if (name === "pin") {
    return h("svg", common, [
      path("M12 16v5"),
      path("M7 16h10"),
      path("M9 4h6l1 6 2 2v2H6v-2l2-2 1-6Z"),
    ]);
  }
  if (name === "pin-off") {
    return h("svg", common, [
      path("M12 16v5"),
      path("M7 16h7"),
      path("M9 4h6l1 6 2 2v2h-4"),
      path("M6 6l12 12"),
    ]);
  }
  if (name === "close") {
    return h("svg", common, [path("M18 6 6 18"), path("M6 6l12 12")]);
  }
  return h("svg", common, [path("M12 2v20")]);
};

export function activateWindow(ctx) {
  const {
    computed,
    createApp,
    h,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    watch,
  } = ctx.vue;

  const App = {
    name: "VerticalLyricScrollWindow",
    setup() {
      const snapshot = ref(null);
      const settings = reactive(normalizeSettings(DEFAULT_SETTINGS));
      const lastSettingsKey = ref(settingsKey(settings));

      // —— 锚点时间（毫秒）与锚点帧时间，用于插值推进（对齐主程序）——
      let baseMs = 0;
      let anchorTick = 0;
      let lastPlaybackUpdateTick = 0;
      // 实时播放进度（毫秒）- 非响应式以提升性能
      let playSeekMsRaw = 0;
      // 当前行索引 - 仅行号变化时才触发 Vue 重渲染
      const activeLineIndex = ref(-1);

      // —— DOM 引用缓存，避免每帧 querySelectorAll ——
      let cachedYrcElements = [];
      let cachedYrcLineKey = "";

      let disposeSnapshot = null;
      let settingsTimer = 0;
      let rafId = 0;
      let rafPaused = true;
      let channel = null;

      // ===== 设置同步 =====

      const applySettings = async (value) => {
        const next = normalizeSettings(value);
        const nextKey = settingsKey(next);
        if (nextKey === lastSettingsKey.value) return;
        Object.assign(settings, next);
        lastSettingsKey.value = nextKey;
      };

      const broadcastSettings = () => {
        if (!channel) return;
        try {
          channel.postMessage({
            type: "settings",
            settings: normalizeSettings({ ...settings }),
          });
        } catch (error) {
          console.warn("[vertical-lyric-scroll] 同步设置失败", error);
        }
      };

      const saveSettings = async (value) => {
        const next = normalizeSettings(value);
        Object.assign(settings, next);
        lastSettingsKey.value = settingsKey(next);
        await ctx.storage.set(STORAGE_KEY, next);
        broadcastSettings();
        return next;
      };

      const refreshSettings = async () => {
        try {
          await applySettings(await ctx.storage.get(STORAGE_KEY));
        } catch (error) {
          console.warn("[vertical-lyric-scroll] 读取设置失败", error);
        }
      };

      // ===== computed =====

      const lyric = computed(() => snapshot.value?.lyric ?? null);
      const playback = computed(() => snapshot.value?.playback ?? null);
      const appearance = computed(
        () =>
          snapshot.value?.appearance ?? {
            isDark: true,
            accentColor: "#31cfa1",
          },
      );
      const theme = computed(() => {
        if (settings.theme === "dark" || settings.theme === "light") {
          return settings.theme;
        }
        return appearance.value.isDark ? "dark" : "light";
      });
      const activeLine = computed(() => {
        const lines = lyric.value?.lines ?? [];
        const index = activeLineIndex.value;
        return index >= 0 ? (lines[index] ?? null) : null;
      });
      const prevLine = computed(() => {
        const lines = lyric.value?.lines ?? [];
        const index = activeLineIndex.value - 1;
        return index >= 0 ? (lines[index] ?? null) : null;
      });
      const nextLine = computed(() => {
        const lines = lyric.value?.lines ?? [];
        const index = activeLineIndex.value + 1;
        return index > 0 ? (lines[index] ?? null) : null;
      });
      const primaryText = computed(() => {
        if (lyric.value?.isLoading) return lyric.value.tips || "歌词加载中...";
        const lineText = String(activeLine.value?.text || "").trim();
        if (lineText) return lineText;
        return playback.value?.title || "EchoMusic";
      });
      const secondaryText = computed(() => {
        if (!settings.showSecondary) return "";
        return getPreferredSecondary(lyric.value, activeLine.value);
      });
      const prevText = computed(() => {
        if (!settings.showPrevNext) return "";
        return String(prevLine.value?.text || "").trim();
      });
      const nextText = computed(() => {
        if (!settings.showPrevNext) return "";
        return String(nextLine.value?.text || "").trim();
      });
      const isVisible = computed(() => {
        if (!settings.enabled) return false;
        if (!settings.hideWhenIdle) return true;
        return Boolean(playback.value?.isPlaying || lyric.value?.isLoading);
      });
      const playedColor = computed(
        () => appearance.value.accentColor || "#31cfa1",
      );
      const unplayedColor = computed(() =>
        theme.value === "light"
          ? "rgba(15, 23, 42, 0.32)"
          : "rgba(255, 255, 255, 0.32)",
      );

      // ===== 锚点同步（对齐主程序 syncAnchor）=====

      const syncAnchor = (force = false) => {
        const state = playback.value;
        if (!state) return;
        lastPlaybackUpdateTick = performance.now();
        const newBaseMs = Math.round((state.currentTime || 0) * 1000);
        const ipcDelay =
          performance.now() - (state.updatedAt || performance.now());
        const compensated =
          ipcDelay > 0 && ipcDelay < 1000 ? newBaseMs + ipcDelay : newBaseMs;
        if (force || Math.abs(compensated - playSeekMsRaw) > SYNC_THRESHOLD) {
          baseMs = compensated;
          anchorTick = performance.now();
          playSeekMsRaw = compensated;
        }
        if (!state.isPlaying) {
          baseMs = newBaseMs;
          anchorTick = performance.now();
        }
      };

      // ===== 逐字高亮 DOM 手动更新（对齐主程序 updateYrcDomManual）=====

      const updateYrcDomManual = () => {
        const idx = activeLineIndex.value;
        const line = activeLine.value;
        if (!line || !isYrcLine(line)) {
          cachedYrcElements = [];
          cachedYrcLineKey = "";
          return;
        }

        const key = `${idx}-${lyric.value?.trackId || ""}`;
        if (key !== cachedYrcLineKey) {
          const container = ctx.container.querySelector(".vls-primary");
          if (container) {
            cachedYrcElements = Array.from(
              container.querySelectorAll(".vls-word"),
            );
            cachedYrcLineKey = key;
          } else {
            cachedYrcElements = [];
            cachedYrcLineKey = "";
          }
        }

        if (cachedYrcElements.length === 0) return;

        const seekMs =
          playSeekMsRaw +
          Number(lyric.value?.timeOffset || 0) +
          LYRIC_LOOKAHEAD;
        const characters = line.characters;

        for (let i = 0; i < cachedYrcElements.length; i++) {
          const char = characters[i];
          const el = cachedYrcElements[i];
          if (!char || !el) continue;
          const duration = Math.max(
            (char.endTime || 0) - (char.startTime || 0),
            0.001,
          );
          const progress = Math.max(
            Math.min((seekMs - (char.startTime || 0)) / duration, 1),
            0,
          );
          el.style.backgroundPositionY = `${100 - progress * 100}%`;
        }
      };

      // ===== RAF 主循环（对齐主程序 useRafFn）=====

      const rafLoop = () => {
        if (rafPaused) return;
        const state = playback.value;
        const now = performance.now();
        const hasFresh =
          now - lastPlaybackUpdateTick <= PLAYBACK_STALE_THRESHOLD;
        if (state?.isPlaying && hasFresh) {
          playSeekMsRaw =
            baseMs + (now - anchorTick) * (state.playbackRate || 1);
        } else {
          playSeekMsRaw = baseMs;
        }

        const seekMs = playSeekMsRaw + Number(lyric.value?.timeOffset || 0);
        const next = calculateLineIndex(lyric.value?.lines ?? [], seekMs);
        if (next !== activeLineIndex.value && next >= 0) {
          activeLineIndex.value = next;
        }

        updateYrcDomManual();
        rafId = window.requestAnimationFrame(rafLoop);
      };

      const resumeRaf = () => {
        if (!rafPaused) return;
        rafPaused = false;
        rafId = window.requestAnimationFrame(rafLoop);
      };

      const pauseRaf = () => {
        rafPaused = true;
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
      };

      // ===== 窗口与鼠标策略 =====

      const syncWindowSize = () => {
        void ctx.window.move(getWindowSize(settings)).catch(() => undefined);
      };

      const syncMousePolicy = () => {
        void ctx.window
          .setIgnoreMouseEvents(
            Boolean(settings.clickThrough || !isVisible.value),
          )
          .catch(() => undefined);
      };

      // ===== JS 拖动（替代 -webkit-app-region: drag，规避透明窗口残影）=====

      let dragState = null;
      let dragRafId = 0;
      let dragPending = null;

      const flushDrag = () => {
        dragRafId = 0;
        if (!dragState || !dragPending) return;
        const { x, y, width, height } = dragPending;
        dragPending = null;
        void ctx.window.move({ x, y, width, height }).catch(() => undefined);
      };

      const onPointerMove = (event) => {
        if (!dragState) return;
        const deltaX = event.screenX - dragState.startX;
        const deltaY = event.screenY - dragState.startY;
        if (
          !dragState.hasMoved &&
          (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)
        ) {
          dragState.hasMoved = true;
        }
        if (dragState.hasMoved) {
          dragPending = {
            x: Math.round(dragState.startWinX + deltaX),
            y: Math.round(dragState.startWinY + deltaY),
            width: dragState.startWinWidth,
            height: dragState.startWinHeight,
          };
          if (!dragRafId) {
            dragRafId = window.requestAnimationFrame(flushDrag);
          }
        }
      };

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        if (dragRafId) {
          window.cancelAnimationFrame(dragRafId);
          dragRafId = 0;
          flushDrag();
        }
        dragState = null;
        dragPending = null;
      };

      const onBodyPointerDown = async (event) => {
        if (settings.locked || event.button !== 0) return;
        const bounds = await ctx.window.getBounds();
        if (!bounds) return;
        dragState = {
          startX: event.screenX,
          startY: event.screenY,
          startWinX: bounds.x,
          startWinY: bounds.y,
          startWinWidth: bounds.width,
          startWinHeight: bounds.height,
          hasMoved: false,
        };
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
        event.preventDefault();
      };

      // ===== 生命周期 =====

      onMounted(async () => {
        await refreshSettings();
        syncWindowSize();
        syncMousePolicy();

        try {
          snapshot.value = await ctx.nowPlaying.getSnapshot();
          syncAnchor(true);
          if (playback.value?.isPlaying) resumeRaf();
        } catch (error) {
          console.warn("[vertical-lyric-scroll] 读取播放快照失败", error);
        }

        disposeSnapshot = ctx.nowPlaying.onSnapshot((next) => {
          snapshot.value = next;
          syncAnchor();
          if (playback.value?.isPlaying) {
            resumeRaf();
          } else {
            baseMs = playSeekMsRaw;
            anchorTick = performance.now();
            pauseRaf();
          }
        });

        settingsTimer = window.setInterval(refreshSettings, 900);

        if (typeof BroadcastChannel === "function") {
          channel = new BroadcastChannel(CHANNEL_NAME);
          channel.onmessage = (event) => {
            const payload = event.data;
            if (payload?.type === "settings")
              void applySettings(payload.settings);
          };
        }
      });

      onBeforeUnmount(() => {
        disposeSnapshot?.();
        if (settingsTimer) window.clearInterval(settingsTimer);
        pauseRaf();
        channel?.close();
      });

      watch(() => [settings.width, settings.height], syncWindowSize);
      watch(
        () => [settings.clickThrough, isVisible.value],
        syncMousePolicy,
        { immediate: true },
      );
      // 行切换时清空 DOM 缓存，下一帧 RAF 会重新查询
      watch(activeLineIndex, () => {
        cachedYrcLineKey = "";
      });

      // ===== 渲染 =====

      const renderPrimary = () => {
        const line = activeLine.value;
        const characters = line?.characters;
        if (Array.isArray(characters) && characters.length > 0) {
          const played = playedColor.value;
          const unplayed = unplayedColor.value;
          return h(
            "div",
            { class: "vls-primary", key: primaryText.value },
            characters.map((char, index) =>
              h(
                "span",
                {
                  class: "vls-word",
                  key: `${index}-${char.text || ""}`,
                  style: {
                    backgroundImage: `linear-gradient(to bottom, ${played} 50%, ${unplayed} 50%)`,
                    backgroundSize: "100% 200%",
                    backgroundRepeat: "no-repeat",
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                    backgroundPositionY: "100%",
                  },
                },
                char.text || "",
              ),
            ),
          );
        }
        return h("div", { class: "vls-primary" }, primaryText.value);
      };

      const iconButton = (title, icon, onClick, options = {}) =>
        h(
          "button",
          {
            class: [
              "vls-control",
              options.className || "",
              options.active ? "is-active" : "",
            ],
            type: "button",
            title,
            onClick: (event) => {
              event.stopPropagation();
              onClick(event);
            },
          },
          [svgIcon(h, icon)],
        );

      const toggleLocked = async () => {
        const nextLocked = !settings.locked;
        await saveSettings({ ...settings, locked: nextLocked });
      };

      return () => {
        const playing = Boolean(playback.value?.isPlaying);
        const accent = appearance.value.accentColor || "#31cfa1";
        const style = {
          "--vls-accent": accent,
          "--vls-opacity": String(settings.opacity / 100),
          "--vls-blur": `${settings.blur}px`,
          "--vls-font-size": `${settings.fontSize}px`,
          fontFamily: appearance.value.fontFamily || undefined,
        };

        return h(
          "div",
          {
            class: [
              "vls-scroll",
              playing ? "is-playing" : "is-paused",
              isVisible.value ? "is-visible" : "is-hidden",
              settings.locked ? "is-locked" : "",
            ],
            "data-theme": theme.value,
            style,
          },
          [
            h("div", { class: "vls-body", onPointerdown: onBodyPointerDown }, [
              prevText.value
                ? h(
                    "div",
                    {
                      class: "vls-prev",
                      title: prevText.value,
                    },
                    prevText.value,
                  )
                : null,
              h("div", { class: "vls-current" }, [
                renderPrimary(),
                secondaryText.value
                  ? h(
                      "div",
                      {
                        class: "vls-secondary",
                        title: secondaryText.value,
                      },
                      secondaryText.value,
                    )
                  : null,
              ]),
              nextText.value
                ? h(
                    "div",
                    {
                      class: "vls-next",
                      title: nextText.value,
                    },
                    nextText.value,
                  )
                : null,
            ]),
            h("div", { class: "vls-controls" }, [
              iconButton(
                settings.locked ? "解锁拖动" : "固定位置",
                settings.locked ? "pin" : "pin-off",
                () => {
                  void toggleLocked().catch((error) => {
                    console.warn(
                      "[vertical-lyric-scroll] 切换固定失败",
                      error,
                    );
                  });
                },
                { active: settings.locked, className: "vls-pin" },
              ),
              iconButton("关闭", "close", () => ctx.window.close()),
            ]),
          ],
        );
      };
    },
  };

  const app = createApp(App);
  app.mount(ctx.container);
  ctx.dispose(() => app.unmount());
}
