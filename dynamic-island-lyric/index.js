const WINDOW_ID = "island";
const STORAGE_KEY = "settings";
const CHANNEL_NAME = "echo-plugin:dynamic-island-lyric:settings";

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

let state = null;
let settingsDispose = null;
let settingsStyleDispose = null;
let channel = null;
let applyingRemoteSettings = false;

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

const getWindowSize = (settings) => ({
  width: Math.round(clamp(settings.width, ...getWidthLimits(settings.density))),
  height: DENSITY_HEIGHT[settings.density] ?? DENSITY_HEIGHT.standard,
});

const broadcastSettings = () => {
  if (!channel || applyingRemoteSettings || !state) return;
  try {
    channel.postMessage({
      type: "settings",
      settings: normalizeSettings({ ...state.settings }),
    });
  } catch (error) {
    console.warn("[dynamic-island-lyric] 设置同步失败", error);
  }
};

const showIsland = async (ctx, settings = state?.settings) => {
  const next = normalizeSettings(settings);
  if (!next.enabled) return;
  const size = getWindowSize(next);
  await ctx.windows.show(WINDOW_ID, {
    ...size,
    alwaysOnTop: next.alwaysOnTop,
  });
};

const syncWindowPresentation = async (ctx, settings = state?.settings) => {
  const next = normalizeSettings(settings);
  if (!next.enabled) {
    await ctx.windows.hide(WINDOW_ID).catch(() => undefined);
    return;
  }

  if (next.autoOpen) {
    await showIsland(ctx, next).catch((error) => {
      console.warn("[dynamic-island-lyric] 打开浮窗失败", error);
    });
    return;
  }

  const result = await ctx.windows.getBounds(WINDOW_ID).catch(() => null);
  if (result?.ok) {
    await ctx.windows
      .show(WINDOW_ID, {
        ...getWindowSize(next),
        alwaysOnTop: next.alwaysOnTop,
      })
      .catch(() => undefined);
  }
};

const saveSettings = async (ctx, values, options = {}) => {
  const next = normalizeSettings(values);
  if (!state) return next;
  state.settings = next;
  await ctx.storage.set(STORAGE_KEY, next);
  if (options.syncWindow !== false) await syncWindowPresentation(ctx, next);
  if (options.broadcast !== false) broadcastSettings();
  return next;
};

const setupSettingsChannel = (ctx) => {
  if (typeof BroadcastChannel !== "function") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const payload = event.data;
    if (!payload || payload.type !== "settings") return;
    applyingRemoteSettings = true;
    void saveSettings(ctx, payload.settings, {
      broadcast: false,
      syncWindow: true,
    }).finally(() => {
      applyingRemoteSettings = false;
    });
  };
};

const SETTINGS_CSS = `
.echo-dynamic-island-settings {
  display: grid;
  gap: 14px;
  color: var(--color-text-main, #f8fafc);
}

.echo-dynamic-island-preview,
.echo-dynamic-island-panel {
  display: grid;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--color-text-main, #f8fafc) 12%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-elevated-base, #111827) 72%, transparent);
  padding: 14px;
}

.echo-dynamic-island-preview-capsule {
  --preview-opacity: 0.88;
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.16), transparent 42%),
    rgba(10, 12, 16, var(--preview-opacity));
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.18);
  padding: 10px 14px;
}

.echo-dynamic-island-preview-capsule.is-expanded {
  grid-template-columns: 34px minmax(0, 1fr) auto;
  grid-template-rows: 48px auto;
  align-items: center;
  min-height: 126px;
  border-radius: 26px;
  row-gap: 10px;
  padding: 14px;
}

.echo-dynamic-island-preview-cover {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background:
    radial-gradient(circle at 35% 30%, #ffffff 0 9%, transparent 11%),
    linear-gradient(135deg, #31cfa1, #4f7cff);
}

.echo-dynamic-island-preview-copy {
  min-width: 0;
}

.echo-dynamic-island-preview-capsule.is-expanded .echo-dynamic-island-preview-copy {
  grid-column: 1 / 4;
  grid-row: 2;
}

.echo-dynamic-island-preview-copy strong,
.echo-dynamic-island-preview-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
}

.echo-dynamic-island-preview-copy strong {
  color: rgba(255, 255, 255, 0.96);
  font-size: 13px;
  font-weight: 760;
}

.echo-dynamic-island-preview-copy small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
}

.echo-dynamic-island-preview-capsule.is-expanded .echo-dynamic-island-preview-copy strong,
.echo-dynamic-island-preview-capsule.is-expanded .echo-dynamic-island-preview-copy small {
  white-space: normal;
}

.echo-dynamic-island-preview-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.echo-dynamic-island-preview-capsule.is-expanded .echo-dynamic-island-preview-controls {
  justify-content: center;
}

.echo-dynamic-island-preview-playback {
  display: grid;
  grid-column: 2;
  grid-row: 1;
  justify-items: center;
  align-content: center;
  gap: 4px;
  min-width: 0;
}

.echo-dynamic-island-preview-title {
  width: 100%;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.72);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.15;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echo-dynamic-island-preview-progress {
  width: min(132px, 72%);
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.echo-dynamic-island-preview-progress span {
  display: block;
  width: 48%;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in srgb, var(--color-primary, #31cfa1) 68%, #ffffff);
}

.echo-dynamic-island-preview-spectrum {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 17px;
  height: 22px;
}

.echo-dynamic-island-preview-spectrum span {
  width: 2px;
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #31cfa1) 78%, rgba(255, 255, 255, 0.82));
}

.echo-dynamic-island-preview-spectrum span:nth-child(2) {
  height: 13px;
}

.echo-dynamic-island-preview-spectrum span:nth-child(3) {
  height: 10px;
}

.echo-dynamic-island-preview-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
}

.echo-dynamic-island-panel {
  gap: 11px;
}

.echo-dynamic-island-panel h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 760;
}

.echo-dynamic-island-row,
.echo-dynamic-island-field {
  display: grid;
  gap: 8px;
}

.echo-dynamic-island-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.echo-dynamic-island-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.echo-dynamic-island-copy span,
.echo-dynamic-island-field > span {
  font-size: 13px;
  font-weight: 650;
}

.echo-dynamic-island-copy small,
.echo-dynamic-island-hint {
  color: var(--color-text-secondary, rgba(148, 163, 184, 0.9));
  font-size: 12px;
  line-height: 1.45;
}

.echo-dynamic-island-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.echo-dynamic-island-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 640px) {
  .echo-dynamic-island-grid {
    grid-template-columns: 1fr;
  }

  .echo-dynamic-island-row {
    align-items: flex-start;
  }
}
`;

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "DynamicIslandLyricSettings",
    setup() {
      const { computed, defineAsyncComponent, h } = ctx.vue;
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);

      const settings = computed(() => normalizeSettings(state?.settings));

      const patch = (value) => {
        void saveSettings(ctx, { ...settings.value, ...value }).catch((error) => {
          const message =
            error instanceof Error ? error.message : "灵动岛歌词设置保存失败";
          ctx.toast.warning(message);
        });
      };

      const row = (label, key, hint = "") =>
        h("div", { class: "echo-dynamic-island-row" }, [
          h("span", { class: "echo-dynamic-island-copy" }, [
            h("span", label),
            hint ? h("small", hint) : null,
          ]),
          h(Switch, {
            modelValue: Boolean(settings.value[key]),
            "onUpdate:modelValue": (value) =>
              patch({ [key]: Boolean(value) }),
          }),
        ]);

      const field = (label, control) =>
        h("label", { class: "echo-dynamic-island-field" }, [
          h("span", label),
          control,
        ]);

      const select = (key, options) =>
        h(Select, {
          modelValue: settings.value[key],
          options,
          "onUpdate:modelValue": (value) => patch({ [key]: value }),
        });

      const slider = (key, min, max, suffix = "") =>
        h(Slider, {
          modelValue: Number(settings.value[key]),
          min,
          max,
          step: 1,
          showValue: true,
          valueSuffix: suffix,
          "onUpdate:modelValue": (value) =>
            patch({ [key]: Number(value) }),
        });

      const panel = (title, children) =>
        h("section", { class: "echo-dynamic-island-panel" }, [
          h("h3", title),
          ...children,
        ]);

      return () =>
        h("div", { class: "echo-dynamic-island-settings" }, [
          h("section", { class: "echo-dynamic-island-preview" }, [
            h(
              "div",
              {
                class: [
                  "echo-dynamic-island-preview-capsule",
                  settings.value.density === "expanded" ? "is-expanded" : "",
                ],
                style: {
                  "--preview-opacity": String(settings.value.opacity / 100),
                },
              },
              [
                h("div", { class: "echo-dynamic-island-preview-cover" }),
                h("div", { class: "echo-dynamic-island-preview-copy" }, [
                  h("strong", "正在播放的歌词会显示在这里"),
                  settings.value.density === "expanded"
                    ? h("small", "翻译 / 歌手 / 下一句")
                    : null,
                ]),
                settings.value.density === "expanded"
                  ? h("div", { class: "echo-dynamic-island-preview-playback" }, [
                      h("div", { class: "echo-dynamic-island-preview-title" }, "歌曲标题 - 歌手"),
                      h("div", { class: "echo-dynamic-island-preview-controls" }, [
                        h("span", { class: "echo-dynamic-island-preview-dot" }),
                        h("span", { class: "echo-dynamic-island-preview-dot" }),
                        h("span", { class: "echo-dynamic-island-preview-dot" }),
                      ]),
                      h("div", { class: "echo-dynamic-island-preview-progress" }, [
                        h("span"),
                      ]),
                    ])
                  : h("div", { class: "echo-dynamic-island-preview-spectrum" }, [
                      h("span"),
                      h("span"),
                      h("span"),
                      h("span"),
                    ]),
              ],
            ),
          ]),
          panel("启用", [
            row("启用灵动岛歌词", "enabled"),
            row("插件启用时自动打开", "autoOpen"),
            row(
              "窗口置顶",
              "alwaysOnTop",
              "macOS 上切换时宿主会重建浮窗以匹配系统窗口类型。",
            ),
            row(
              "空闲时淡出",
              "hideWhenIdle",
              "暂停、无歌曲或没有可展示内容时让窗口透明并穿透鼠标。",
            ),
            row(
              "鼠标穿透",
              "clickThrough",
              "开启后浮窗不接收鼠标，适合只作为桌面提示使用。",
            ),
          ]),
          panel("布局", [
            h("div", { class: "echo-dynamic-island-grid" }, [
              field(
                "密度",
                select("density", [
                  { label: "标准", value: "standard" },
                  { label: "展开", value: "expanded" },
                ]),
              ),
              field(
                "主题",
                select("theme", [
                  { label: "跟随系统", value: "auto" },
                  { label: "深色胶囊", value: "dark" },
                  { label: "浅色玻璃", value: "light" },
                ]),
              ),
              field("窗口宽度", slider("width", ...getWidthLimits(settings.value.density), "px")),
              field("不透明度", slider("opacity", 45, 100, "%")),
              field("背景模糊", slider("blur", 0, 38, "px")),
            ]),
          ]),
          panel("内容", [
            row("显示封面", "showCover"),
            row("显示播放控制", "showControls", "仅展开密度下显示。"),
            row("显示副歌词", "showSecondary", "仅展开密度下显示。"),
            row("显示播放进度", "showProgress", "仅展开密度下显示。"),
          ]),
          h("div", { class: "echo-dynamic-island-actions" }, [
            h(
              Button,
              {
                variant: "primary",
                size: "xs",
                onClick: () => showIsland(ctx, settings.value),
              },
              { default: () => "打开浮窗" },
            ),
            h(
              Button,
              {
                variant: "outline",
                size: "xs",
                onClick: () => ctx.windows.hide(WINDOW_ID),
              },
              { default: () => "隐藏浮窗" },
            ),
            h(
              Button,
              {
                variant: "ghost",
                size: "xs",
                onClick: () => patch(DEFAULT_SETTINGS),
              },
              { default: () => "恢复默认" },
            ),
          ]),
        ]);
    },
  });

const registerSettings = (ctx) => {
  settingsDispose?.();
  settingsDispose = ctx.ui.settings.define({
    title: "灵动岛歌词",
    description: "调整桌面顶部悬浮歌词胶囊的显示、布局和交互。",
    component: createSettingsComponent(ctx),
  });
};

export async function activate(ctx) {
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  setupSettingsChannel(ctx);
  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, {
    id: "dynamic-island-lyric-settings",
  });
  registerSettings(ctx);

  ctx.commands.register("show", () => showIsland(ctx), {
    title: "打开灵动岛歌词",
  });
  ctx.commands.register("hide", () => ctx.windows.hide(WINDOW_ID), {
    title: "隐藏灵动岛歌词",
  });

  if (state.settings.enabled && state.settings.autoOpen) {
    await showIsland(ctx, state.settings).catch((error) => {
      console.warn("[dynamic-island-lyric] 自动打开浮窗失败", error);
    });
  }
}

export async function deactivate(ctx) {
  settingsDispose?.();
  settingsDispose = null;
  settingsStyleDispose?.();
  settingsStyleDispose = null;
  channel?.close();
  channel = null;
  await ctx?.windows?.close?.(WINDOW_ID).catch(() => undefined);
  state = null;
}
