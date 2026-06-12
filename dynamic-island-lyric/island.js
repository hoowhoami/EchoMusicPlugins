const STORAGE_KEY = "settings";
const CHANNEL_NAME = "echo-plugin:dynamic-island-lyric:settings";
const LYRIC_LOOKAHEAD_MS = 90;

const DEFAULT_SETTINGS = {
  enabled: true,
  autoOpen: true,
  alwaysOnTop: true,
  density: "standard",
  theme: "auto",
  width: 260,
  opacity: 88,
  blur: 24,
  showCover: true,
  showControls: true,
  showSecondary: true,
  showProgress: true,
  hideWhenIdle: false,
  clickThrough: false,
};

const DENSITY_HEIGHT = {
  standard: 48,
  expanded: 172,
};

const getWidthLimits = (density) => {
  if (density === "expanded") return [360, 460];
  return [220, 280];
};

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const density = ["standard", "expanded"].includes(
    String(source.density),
  )
    ? String(source.density)
    : DEFAULT_SETTINGS.density;
  const theme = ["auto", "dark", "light"].includes(String(source.theme))
    ? String(source.theme)
    : DEFAULT_SETTINGS.theme;

  const [minWidth, maxWidth] = getWidthLimits(density);

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    autoOpen: source.autoOpen ?? DEFAULT_SETTINGS.autoOpen,
    alwaysOnTop: source.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop,
    density,
    theme,
    width: clamp(source.width ?? DEFAULT_SETTINGS.width, minWidth, maxWidth),
    opacity: clamp(source.opacity ?? DEFAULT_SETTINGS.opacity, 45, 100),
    blur: clamp(source.blur ?? DEFAULT_SETTINGS.blur, 0, 38),
    showCover: source.showCover ?? DEFAULT_SETTINGS.showCover,
    showControls: source.showControls ?? DEFAULT_SETTINGS.showControls,
    showSecondary: source.showSecondary ?? DEFAULT_SETTINGS.showSecondary,
    showProgress: source.showProgress ?? DEFAULT_SETTINGS.showProgress,
    hideWhenIdle: source.hideWhenIdle ?? DEFAULT_SETTINGS.hideWhenIdle,
    clickThrough: source.clickThrough ?? DEFAULT_SETTINGS.clickThrough,
  };
};

const settingsKey = (settings) => JSON.stringify(normalizeSettings(settings));

const getWindowSize = (settings) => ({
  width: Math.round(clamp(settings.width, ...getWidthLimits(settings.density))),
  height: DENSITY_HEIGHT[settings.density] ?? DENSITY_HEIGHT.standard,
});

const isSameWindowSize = (left, right) =>
  left.width === right.width && left.height === right.height;

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

const getEstimatedPlaybackMs = (playback) => {
  if (!playback) return 0;
  const baseMs = Math.max(0, Number(playback.currentTime || 0) * 1000);
  if (!playback.isPlaying) return baseMs;

  const updatedAt = Number(playback.updatedAt || Date.now());
  const playbackRate = Math.max(0.1, Number(playback.playbackRate || 1));
  const elapsedMs = Math.max(0, Date.now() - updatedAt) * playbackRate;
  const durationMs = Math.max(0, Number(playback.duration || 0) * 1000);
  const seekMs = baseMs + elapsedMs;
  return durationMs > 0 ? Math.min(seekMs, durationMs) : seekMs;
};

const getActiveLineIndex = (snapshot) => {
  const lyric = snapshot?.lyric;
  const playback = snapshot?.playback;
  const lines = lyric?.lines ?? [];
  if (!lyric || lines.length === 0) return -1;

  const canEstimate =
    playback?.trackId &&
    (!lyric.trackId || lyric.trackId === playback.trackId);
  if (canEstimate) {
    const seekMs =
      getEstimatedPlaybackMs(playback) +
      Number(lyric.timeOffset || 0) +
      LYRIC_LOOKAHEAD_MS;
    const index = calculateLineIndex(lines, seekMs);
    if (index >= 0) return index;
  }

  const fallbackIndex = Number(lyric.currentIndex);
  return Number.isFinite(fallbackIndex) ? fallbackIndex : -1;
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

const svgIcon = (h, name) => {
  const common = {
    class: "di-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  };
  const path = (d, extra = {}) => h("path", { d, ...extra });
  const polygon = (points) => h("polygon", { points, fill: "currentColor" });

  if (name === "previous") {
    return h("svg", common, [
      path("M19 20 9 12l10-8v16Z", { fill: "currentColor" }),
      path("M5 19V5"),
    ]);
  }
  if (name === "next") {
    return h("svg", common, [
      path("M5 4l10 8-10 8V4Z", { fill: "currentColor" }),
      path("M19 5v14"),
    ]);
  }
  if (name === "pause") {
    return h("svg", common, [path("M8 5v14"), path("M16 5v14")]);
  }
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
  return h("svg", common, [polygon("8 5 19 12 8 19 8 5")]);
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
    name: "DynamicIslandLyricWindow",
    setup() {
      const snapshot = ref(null);
      const clock = ref(Date.now());
      const isLayoutSyncing = ref(false);
      const settings = reactive(normalizeSettings(DEFAULT_SETTINGS));
      const lastSettingsKey = ref(settingsKey(settings));
      let disposeSnapshot = null;
      let clockTimer = 0;
      let settingsTimer = 0;
      let marqueeFrame = 0;
      let layoutSyncFrame = 0;
      let layoutSyncToken = 0;
      let channel = null;

      const finishLayoutSync = (token, frames = 2) => {
        if (layoutSyncFrame) window.cancelAnimationFrame(layoutSyncFrame);
        const step = (remaining) => {
          layoutSyncFrame = window.requestAnimationFrame(() => {
            if (token !== layoutSyncToken) return;
            if (remaining > 1) {
              step(remaining - 1);
              return;
            }
            layoutSyncFrame = 0;
            isLayoutSyncing.value = false;
            scheduleMarqueeMeasure();
          });
        };
        step(frames);
      };

      const syncWindowLayoutBeforeRender = async (next) => {
        const currentSize = getWindowSize(settings);
        const nextSize = getWindowSize(next);
        if (isSameWindowSize(currentSize, nextSize)) return 0;

        const token = ++layoutSyncToken;
        isLayoutSyncing.value = true;
        if (layoutSyncFrame) {
          window.cancelAnimationFrame(layoutSyncFrame);
          layoutSyncFrame = 0;
        }
        await ctx.window.move(nextSize).catch((error) => {
          console.warn("[dynamic-island-lyric] 同步浮窗尺寸失败", error);
        });
        return token;
      };

      const applySettings = async (value) => {
        const next = normalizeSettings(value);
        const nextKey = settingsKey(next);
        if (nextKey === lastSettingsKey.value) return;
        const layoutToken = await syncWindowLayoutBeforeRender(next);
        Object.assign(settings, next);
        lastSettingsKey.value = nextKey;
        if (layoutToken) finishLayoutSync(layoutToken);
      };

      const broadcastSettings = () => {
        if (!channel) return;
        try {
          channel.postMessage({
            type: "settings",
            settings: normalizeSettings({ ...settings }),
          });
        } catch (error) {
          console.warn("[dynamic-island-lyric] 同步设置失败", error);
        }
      };

      const saveSettings = async (value) => {
        const next = normalizeSettings(value);
        const layoutToken = await syncWindowLayoutBeforeRender(next);
        Object.assign(settings, next);
        lastSettingsKey.value = settingsKey(next);
        if (layoutToken) finishLayoutSync(layoutToken);
        await ctx.storage.set(STORAGE_KEY, next);
        broadcastSettings();
        return next;
      };

      const refreshSettings = async () => {
        try {
          await applySettings(await ctx.storage.get(STORAGE_KEY));
        } catch (error) {
          console.warn("[dynamic-island-lyric] 读取设置失败", error);
        }
      };

      const activeIndex = computed(() => {
        void clock.value;
        return getActiveLineIndex(snapshot.value);
      });
      const lyric = computed(() => snapshot.value?.lyric ?? null);
      const playback = computed(() => snapshot.value?.playback ?? null);
      const activeLine = computed(() => {
        const lines = lyric.value?.lines ?? [];
        const index = activeIndex.value;
        return index >= 0 ? (lines[index] ?? null) : null;
      });
      const nextLine = computed(() => {
        const lines = lyric.value?.lines ?? [];
        const index = activeIndex.value + 1;
        return index > 0 ? (lines[index] ?? null) : null;
      });
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
      const isExpanded = computed(() => settings.density === "expanded");
      const trackTitle = computed(() => {
        const title = String(playback.value?.title || "").trim();
        const artist = String(playback.value?.artist || "").trim();
        const displayTitle = title || "EchoMusic";
        if (!artist || artist === displayTitle) return displayTitle;
        return `${displayTitle} - ${artist}`;
      });
      const primaryText = computed(() => {
        if (lyric.value?.isLoading) return lyric.value.tips || "歌词加载中...";
        const lineText = String(activeLine.value?.text || "").trim();
        if (lineText) return lineText;
        return playback.value?.title || "EchoMusic";
      });
      const secondaryText = computed(() => {
        if (!isExpanded.value || !settings.showSecondary) return "";
        const secondary = getPreferredSecondary(lyric.value, activeLine.value);
        if (secondary) return secondary;
        return "";
      });
      const nextText = computed(() => {
        if (!isExpanded.value || !settings.showSecondary) return "";
        const next = String(nextLine.value?.text || "").trim();
        if (!next || next === primaryText.value || next === secondaryText.value) {
          return "";
        }
        return next;
      });
      const isVisible = computed(() => {
        if (!settings.enabled) return false;
        if (!settings.hideWhenIdle) return true;
        return Boolean(playback.value?.isPlaying || lyric.value?.isLoading);
      });
      const progress = computed(() => {
        void clock.value;
        const playbackValue = playback.value;
        if (!playbackValue?.duration) return 0;
        const currentMs = getEstimatedPlaybackMs(playbackValue);
        return clamp((currentMs / (playbackValue.duration * 1000)) * 100, 0, 100);
      });
      const syncWindowSize = () => {
        void ctx.window.move(getWindowSize(settings)).catch(() => undefined);
      };

      const syncMousePolicy = () => {
        void ctx.window
          .setIgnoreMouseEvents(Boolean(settings.clickThrough || !isVisible.value))
          .catch(() => undefined);
      };

      const measureMarqueeLines = () => {
        const lines = ctx.container.querySelectorAll(".di-line");
        lines.forEach((line) => {
          line.classList.remove("is-marquee");
          line.style.removeProperty("--di-scroll-distance");
          line.style.removeProperty("--di-scroll-duration");

          const text = line.querySelector(".di-text");
          if (!text) return;

          const overflow = Math.ceil(
            text.getBoundingClientRect().width - line.clientWidth,
          );
          if (overflow <= 4) return;

          const distance = overflow + 24;
          line.style.setProperty("--di-scroll-distance", `${distance}px`);
          line.style.setProperty(
            "--di-scroll-duration",
            `${Math.max(7, Math.min(18, distance / 18))}s`,
          );
          line.classList.add("is-marquee");
        });
      };

      const scheduleMarqueeMeasure = () => {
        if (marqueeFrame) window.cancelAnimationFrame(marqueeFrame);
        marqueeFrame = window.requestAnimationFrame(() => {
          marqueeFrame = 0;
          measureMarqueeLines();
        });
      };

      onMounted(async () => {
        await refreshSettings();
        syncWindowSize();
        syncMousePolicy();
        scheduleMarqueeMeasure();

        try {
          snapshot.value = await ctx.nowPlaying.getSnapshot();
          scheduleMarqueeMeasure();
        } catch (error) {
          console.warn("[dynamic-island-lyric] 读取播放快照失败", error);
        }

        disposeSnapshot = ctx.nowPlaying.onSnapshot((next) => {
          snapshot.value = next;
          scheduleMarqueeMeasure();
        });

        clockTimer = window.setInterval(() => {
          clock.value = Date.now();
        }, 120);

        settingsTimer = window.setInterval(refreshSettings, 900);

        if (typeof BroadcastChannel === "function") {
          channel = new BroadcastChannel(CHANNEL_NAME);
          channel.onmessage = (event) => {
            const payload = event.data;
            if (payload?.type === "settings") void applySettings(payload.settings);
          };
        }

        window.addEventListener("resize", scheduleMarqueeMeasure);
      });

      onBeforeUnmount(() => {
        disposeSnapshot?.();
        if (clockTimer) window.clearInterval(clockTimer);
        if (settingsTimer) window.clearInterval(settingsTimer);
        if (marqueeFrame) window.cancelAnimationFrame(marqueeFrame);
        if (layoutSyncFrame) window.cancelAnimationFrame(layoutSyncFrame);
        window.removeEventListener("resize", scheduleMarqueeMeasure);
        channel?.close();
      });

      watch(
        () => [settings.width, settings.density],
        syncWindowSize,
      );
      watch(
        () => [settings.clickThrough, isVisible.value],
        syncMousePolicy,
        { immediate: true },
      );
      watch(
        () => [
          settings.density,
          settings.width,
          primaryText.value,
          secondaryText.value,
          nextText.value,
        ],
        scheduleMarqueeMeasure,
        { flush: "post" },
      );

      const iconButton = (title, icon, onClick, options = {}) =>
        h(
          "button",
          {
            class: [
              "di-control",
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

      const commandButton = (command, title, icon) =>
        iconButton(title, icon, () => ctx.nowPlaying.command(command));

      const lyricLine = (className, text) =>
        h("div", { class: ["di-line", className], title: text }, [
          h("span", { class: "di-text" }, text),
        ]);

      const toggleAlwaysOnTop = async () => {
        const nextAlwaysOnTop = !settings.alwaysOnTop;
        await saveSettings({ ...settings, alwaysOnTop: nextAlwaysOnTop });
        await ctx.window.setAlwaysOnTop(nextAlwaysOnTop);
      };

      const cover = () => {
        if (!settings.showCover) return null;
        const coverUrl = playback.value?.coverUrl;
        return h("div", { class: "di-cover", "aria-hidden": "true" }, [
          coverUrl
            ? h("img", {
                src: coverUrl,
                alt: "",
                onError: (event) => {
                  event.currentTarget.hidden = true;
                },
              })
            : h("span", { class: "di-cover-fallback" }),
        ]);
      };

      const spectrum = () =>
        h("div", { class: "di-spectrum", "aria-hidden": "true" }, [
          h("span"),
          h("span"),
          h("span"),
          h("span"),
        ]);

      const controls = () => {
        if (!isExpanded.value || !settings.showControls) return null;
        const playing = Boolean(playback.value?.isPlaying);
        return h("div", { class: "di-controls" }, [
          commandButton("previousTrack", "上一首", "previous"),
          commandButton(
            "togglePlayback",
            playing ? "暂停" : "播放",
            playing ? "pause" : "play",
          ),
          commandButton("nextTrack", "下一首", "next"),
        ]);
      };

      const progressBar = () => {
        if (!isExpanded.value || !settings.showProgress) return null;
        return h("div", { class: "di-progress", "aria-hidden": "true" }, [
          h("span"),
        ]);
      };

      const playbackPanel = () => {
        if (!isExpanded.value) return null;
        return h("div", { class: "di-playback" }, [
          h("div", { class: "di-title", title: trackTitle.value }, trackTitle.value),
          controls(),
          progressBar(),
        ]);
      };

      const pinButton = () => {
        if (!isExpanded.value) return null;
        return iconButton(
          settings.alwaysOnTop ? "取消置顶" : "窗口置顶",
          settings.alwaysOnTop ? "pin" : "pin-off",
          () => {
            void toggleAlwaysOnTop().catch((error) => {
              console.warn("[dynamic-island-lyric] 切换置顶失败", error);
            });
          },
          { active: settings.alwaysOnTop, className: "di-pin" },
        );
      };

      return () => {
        void clock.value;
        const playing = Boolean(playback.value?.isPlaying);
        const expanded = isExpanded.value;
        const accent = appearance.value.accentColor || "#31cfa1";
        const style = {
          "--di-accent": accent,
          "--di-opacity": String(settings.opacity / 100),
          "--di-blur": `${settings.blur}px`,
          "--di-progress": `${progress.value}%`,
          fontFamily: appearance.value.fontFamily || undefined,
        };

        return h(
          "div",
          {
            class: [
              "dynamic-island",
              `density-${settings.density}`,
              settings.showCover ? "has-cover" : "no-cover",
              expanded && settings.showControls ? "has-controls" : "no-controls",
              expanded && settings.showProgress ? "has-progress" : "no-progress",
              playing ? "is-playing" : "is-paused",
              isVisible.value ? "is-visible" : "is-hidden",
              isLayoutSyncing.value ? "is-layout-syncing" : "",
            ],
            "data-theme": theme.value,
            style,
          },
          [
            h("div", { class: "di-sheen" }),
            pinButton(),
            cover(),
            playbackPanel(),
            h(
              "div",
              {
                class: "di-copy",
                key: `${playback.value?.trackId || "empty"}-${activeIndex.value}-${primaryText.value}-${secondaryText.value}-${nextText.value}`,
              },
              [
                lyricLine("di-primary", primaryText.value),
                secondaryText.value
                  ? lyricLine("di-secondary", secondaryText.value)
                  : null,
                nextText.value
                  ? lyricLine("di-next", nextText.value)
                  : null,
              ],
            ),
            spectrum(),
          ],
        );
      };
    },
  };

  const app = createApp(App);
  app.mount(ctx.container);
  ctx.dispose(() => app.unmount());
}
