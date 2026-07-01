const WINDOW_ID = "scroll";
const STORAGE_KEY = "settings";
const CHANNEL_NAME = "echo-plugin:vertical-lyric-scroll:settings";

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
};

const WIDTH_LIMITS = [180, 280];
const HEIGHT_LIMITS = [360, 760];

let state = null;
let settingsDispose = null;
let settingsStyleDispose = null;
let channel = null;
let applyingRemoteSettings = false;

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

const getWindowSize = (settings) => ({
  width: Math.round(clamp(settings.width, ...WIDTH_LIMITS)),
  height: Math.round(clamp(settings.height, ...HEIGHT_LIMITS)),
});

const broadcastSettings = () => {
  if (!channel || applyingRemoteSettings || !state) return;
  try {
    channel.postMessage({
      type: "settings",
      settings: normalizeSettings({ ...state.settings }),
    });
  } catch (error) {
    console.warn("[vertical-lyric-scroll] 设置同步失败", error);
  }
};

const showWindow = async (ctx, settings = state?.settings) => {
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

  const result = await ctx.windows.getBounds(WINDOW_ID).catch(() => null);
  if (!result?.ok) {
    // 窗口不存在：仅在 autoOpen 时创建（传完整尺寸）
    if (next.autoOpen) {
      await showWindow(ctx, next).catch((error) => {
        console.warn("[vertical-lyric-scroll] 打开浮窗失败", error);
      });
    }
    return;
  }

  // 窗口已存在：只同步置顶状态，不传 width/height，避免 setBounds 覆盖实时尺寸
  // 尺寸变化由浮窗通过 broadcast → watch → ctx.window.move（实时基准）处理
  await ctx.windows
    .show(WINDOW_ID, { alwaysOnTop: next.alwaysOnTop })
    .catch(() => undefined);
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
.vls-settings {
  display: grid;
  gap: 14px;
  color: var(--color-text-main, #f8fafc);
}

.vls-panel {
  display: grid;
  gap: 11px;
  border: 1px solid color-mix(in srgb, var(--color-text-main, #f8fafc) 12%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-elevated-base, #111827) 72%, transparent);
  padding: 14px;
}

.vls-panel h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 760;
}

.vls-row,
.vls-field {
  display: grid;
  gap: 8px;
}

.vls-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.vls-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.vls-copy span,
.vls-field > span {
  font-size: 13px;
  font-weight: 650;
}

.vls-copy small,
.vls-hint {
  color: var(--color-text-secondary, rgba(148, 163, 184, 0.9));
  font-size: 12px;
  line-height: 1.45;
}

.vls-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
`;

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "VerticalLyricScrollSettings",
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
            error instanceof Error ? error.message : "竖幅歌词设置保存失败";
          ctx.toast.warning(message);
        });
      };

      const row = (label, key, hint = "") =>
        h("div", { class: "vls-row" }, [
          h("span", { class: "vls-copy" }, [
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
        h("label", { class: "vls-field" }, [
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
        h("section", { class: "vls-panel" }, [
          h("h3", title),
          ...children,
        ]);

      return () =>
        h("div", { class: "vls-settings" }, [
          panel("启用", [
            row("启用竖幅歌词", "enabled"),
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
            row(
              "锁定位置",
              "locked",
              "固定后浮窗不可拖动，仅钉选按钮可解锁。",
            ),
          ]),
          panel("布局", [
            field(
              "主题",
              select("theme", [
                { label: "跟随系统", value: "auto" },
                { label: "深色卡片", value: "dark" },
                { label: "浅色玻璃", value: "light" },
              ]),
            ),
            field("窗口宽度", slider("width", ...WIDTH_LIMITS, "px")),
            field("窗口高度", slider("height", ...HEIGHT_LIMITS, "px")),
            field("不透明度", slider("opacity", 50, 100, "%")),
            field("背景模糊", slider("blur", 0, 38, "px")),
            field("字号", slider("fontSize", 20, 56, "px")),
          ]),
          panel("内容", [
            row("显示翻译/音译副列", "showSecondary"),
            row("显示上一句/下一句", "showPrevNext"),
          ]),
          h("div", { class: "vls-actions" }, [
            h(
              Button,
              {
                variant: "primary",
                size: "xs",
                onClick: () => showWindow(ctx, settings.value),
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
    title: "竖幅歌词",
    description: "调整桌面竖排歌词浮窗的显示、布局和交互。",
    component: createSettingsComponent(ctx),
  });
};

export async function activate(ctx) {
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  setupSettingsChannel(ctx);
  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, {
    id: "vertical-lyric-scroll-settings",
  });
  registerSettings(ctx);

  ctx.commands.register("show", () => showWindow(ctx), {
    title: "打开竖幅歌词",
  });
  ctx.commands.register("hide", () => ctx.windows.hide(WINDOW_ID), {
    title: "隐藏竖幅歌词",
  });

  if (state.settings.enabled && state.settings.autoOpen) {
    await showWindow(ctx, state.settings).catch((error) => {
      console.warn("[vertical-lyric-scroll] 自动打开浮窗失败", error);
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
