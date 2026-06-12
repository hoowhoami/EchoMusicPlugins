const STORAGE_KEY = "page-motion-settings";
const CUSTOM_CSS_PRESET = "customCss";
const CUSTOM_TRANSITION_NAME = "page-motion-custom";
const DEFAULT_CUSTOM_CSS = `.page-motion-custom-enter-active,
.page-motion-custom-leave-active,
.page-motion-custom-appear-active {
  transition:
    opacity var(--page-transition-duration) ease-out,
    transform var(--page-transition-duration) ease-out;
}

.page-motion-custom-enter-from,
.page-motion-custom-appear-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-motion-custom-leave-to {
  opacity: 0;
}

.page-motion-custom-enter-to,
.page-motion-custom-leave-from,
.page-motion-custom-appear-to {
  opacity: 1;
  transform: translateY(0);
}

.page-motion-custom-route-enter-active {
  animation: page-motion-custom-route-enter var(--page-transition-duration) ease-out both;
}

@keyframes page-motion-custom-route-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}`;

const TRANSITION_PRESETS = {
  slideFade: {
    label: "上滑淡入",
    description: "沿用主页面原本的上滑淡入手感。",
    durationMs: 450,
    easing: "ease-out",
    enterTranslateX: 0,
    enterTranslateY: 6,
    leaveTranslateX: 0,
    leaveTranslateY: 0,
    enterScale: 1,
    leaveScale: 1,
    enterFilter: "none",
    leaveFilter: "none",
  },
  calm: {
    label: "柔和浮入",
    description: "轻微上浮，适合日常使用。",
    durationMs: 300,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    enterTranslateX: 0,
    enterTranslateY: 10,
    leaveTranslateX: 0,
    leaveTranslateY: -6,
    enterScale: 0.99,
    leaveScale: 0.995,
    enterFilter: "none",
    leaveFilter: "none",
  },
  crisp: {
    label: "轻快侧滑",
    description: "横向切换更明显，速度更快。",
    durationMs: 220,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    enterTranslateX: 12,
    enterTranslateY: 0,
    leaveTranslateX: -8,
    leaveTranslateY: 0,
    enterScale: 1,
    leaveScale: 1,
    enterFilter: "none",
    leaveFilter: "none",
  },
  depth: {
    label: "景深淡入",
    description: "加入轻微缩放和模糊，层次感更强。",
    durationMs: 360,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    enterTranslateX: 0,
    enterTranslateY: 14,
    leaveTranslateX: 0,
    leaveTranslateY: -8,
    enterScale: 0.975,
    leaveScale: 1.01,
    enterFilter: "blur(2px)",
    leaveFilter: "blur(1px)",
  },
  [CUSTOM_CSS_PRESET]: {
    label: "自定义 CSS",
    description: "使用 CSS transition 或 animation 自定义页面动效。",
    durationMs: 450,
    custom: true,
  },
};

const DEFAULT_SETTINGS = {
  enabled: true,
  preset: "slideFade",
  durationMs: TRANSITION_PRESETS.slideFade.durationMs,
  appear: true,
  customCss: DEFAULT_CUSTOM_CSS,
};

const LEGACY_PRESET_KEYS = {
  fade: "slideFade",
};

let runtimeCtx = null;
let state = null;
let transitionDispose = null;
let settingsDispose = null;
let settingsStyleDispose = null;

const SETTINGS_CSS = `
.dialog-content.plugin-settings-dialog:has(.echo-page-motion-settings) {
  width: min(840px, 94vw);
}

.echo-page-motion-settings {
  display: grid;
  grid-template-columns: minmax(230px, 0.9fr) minmax(0, 1.1fr);
  gap: 14px;
  align-items: start;
  min-width: 0;
}

.echo-page-motion-controls {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.echo-page-motion-preview-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--control-muted-bg);
}

.echo-page-motion-preview-head,
.echo-page-motion-preview-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.echo-page-motion-preview-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.echo-page-motion-preview-title {
  color: var(--color-text-main);
  font-size: 13px;
  font-weight: 800;
}

.echo-page-motion-preview-subtitle {
  overflow: hidden;
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echo-page-motion-pill {
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--control-border);
  border-radius: 999px;
  color: color-mix(in srgb, var(--color-text-main) 58%, transparent);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.3;
}

.echo-page-motion-pill.is-active {
  border-color: color-mix(in srgb, var(--color-primary) 36%, transparent);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.echo-page-motion-preview-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  overflow: hidden;
  padding: 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-card)),
      var(--color-bg-card)
    );
}

.echo-page-motion-preview-card {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  width: min(100%, 270px);
  aspect-ratio: 1.42;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--color-bg-card);
  box-shadow: var(--shadow-control);
  transform: translate3d(0, 0, 0) scale(1);
  will-change: opacity, transform, filter;
}

.echo-page-motion-preview-card.is-disabled {
  opacity: 0.54;
}

.echo-page-motion-preview-card.is-previewing {
  animation: echo-page-motion-preview-enter
    var(--echo-page-motion-preview-duration)
    var(--echo-page-motion-preview-easing)
    both;
}

.echo-page-motion-preview-sidebar {
  display: grid;
  align-content: start;
  gap: 9px;
  padding: 12px 10px;
  border-right: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--color-primary) 7%, var(--control-muted-bg));
}

.echo-page-motion-preview-dot,
.echo-page-motion-preview-nav,
.echo-page-motion-preview-line,
.echo-page-motion-preview-chip {
  display: block;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-main) 18%, transparent);
}

.echo-page-motion-preview-dot {
  width: 24px;
  height: 24px;
  background: color-mix(in srgb, var(--color-primary) 62%, white);
}

.echo-page-motion-preview-nav {
  width: 100%;
  height: 6px;
}

.echo-page-motion-preview-nav:nth-child(3) {
  width: 74%;
}

.echo-page-motion-preview-nav:nth-child(4) {
  width: 58%;
}

.echo-page-motion-preview-main {
  display: grid;
  align-content: start;
  gap: 11px;
  min-width: 0;
  padding: 14px;
}

.echo-page-motion-preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.echo-page-motion-preview-line {
  width: 64%;
  height: 8px;
}

.echo-page-motion-preview-line.is-short {
  width: 42%;
}

.echo-page-motion-preview-chip {
  width: 34px;
  height: 14px;
  background: color-mix(in srgb, var(--color-primary) 42%, transparent);
}

.echo-page-motion-preview-list {
  display: grid;
  gap: 8px;
}

.echo-page-motion-preview-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.echo-page-motion-preview-thumb {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-primary) 24%, var(--control-muted-bg));
}

@keyframes echo-page-motion-preview-enter {
  from {
    opacity: var(--echo-page-motion-preview-enter-opacity);
    transform: translate3d(
        var(--echo-page-motion-preview-enter-x),
        var(--echo-page-motion-preview-enter-y),
        0
      )
      scale(var(--echo-page-motion-preview-enter-scale));
    filter: var(--echo-page-motion-preview-enter-filter);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
    filter: none;
  }
}

.echo-page-motion-section {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--control-muted-bg);
}

.echo-page-motion-title {
  color: var(--color-text-main);
  font-size: 13px;
  font-weight: 800;
}

.echo-page-motion-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 220px);
  align-items: center;
  gap: 14px;
}

.echo-page-motion-field.is-switch {
  grid-template-columns: minmax(0, 1fr) auto;
}

.echo-page-motion-field.is-wide {
  grid-template-columns: 1fr;
}

.echo-page-motion-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.echo-page-motion-label {
  color: var(--color-text-main);
  font-size: 12px;
  font-weight: 700;
}

.echo-page-motion-description {
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 11px;
  line-height: 1.5;
}

.echo-page-motion-host-select,
.echo-page-motion-host-slider {
  width: 100%;
  justify-self: end;
}

.echo-page-motion-css-editor {
  width: 100%;
  min-height: 220px;
  resize: vertical;
  padding: 12px 14px;
  border: 1px solid var(--control-border);
  border-radius: 12px;
  background: var(--control-muted-bg);
  color: var(--color-text-main);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.55;
  outline: none;
  white-space: pre;
  tab-size: 2;
}

.echo-page-motion-css-editor:focus {
  border-color: color-mix(in srgb, var(--color-primary) 35%, var(--control-border));
}

.echo-page-motion-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .dialog-content.plugin-settings-dialog:has(.echo-page-motion-settings) {
    width: min(640px, 92vw);
  }

  .echo-page-motion-settings {
    grid-template-columns: 1fr;
  }

  .echo-page-motion-field,
  .echo-page-motion-field.is-switch,
  .echo-page-motion-field.is-wide {
    grid-template-columns: 1fr;
  }

  .echo-page-motion-host-select,
  .echo-page-motion-host-slider {
    justify-self: stretch;
  }

  .echo-page-motion-actions {
    justify-content: flex-start;
  }
}
`;

const normalizeSettings = (value = {}) => {
  const input = value && typeof value === "object" ? value : {};
  const rawPreset = String(input.preset || "");
  const presetKey = LEGACY_PRESET_KEYS[rawPreset] || rawPreset;
  const preset = TRANSITION_PRESETS[presetKey]
    ? presetKey
    : DEFAULT_SETTINGS.preset;
  const durationMs = Number(input.durationMs);
  const customCss =
    typeof input.customCss === "string" ? input.customCss : DEFAULT_SETTINGS.customCss;

  return {
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : DEFAULT_SETTINGS.enabled,
    preset,
    durationMs: Number.isFinite(durationMs)
      ? Math.max(80, Math.min(900, Math.round(durationMs)))
      : TRANSITION_PRESETS[preset].durationMs,
    appear:
      typeof input.appear === "boolean" ? input.appear : DEFAULT_SETTINGS.appear,
    customCss,
  };
};

const clearTransition = () => {
  transitionDispose?.();
  transitionDispose = null;
};

const applySettings = () => {
  if (!runtimeCtx || !state) return;

  clearTransition();

  if (!runtimeCtx.theme?.pageTransition?.set) {
    runtimeCtx.toast.warning("当前 EchoMusic 版本不支持页面动效插件能力");
    return;
  }

  if (!state.settings.enabled) {
    transitionDispose = runtimeCtx.theme.pageTransition.set({ enabled: false });
    return;
  }

  const preset = TRANSITION_PRESETS[state.settings.preset] || TRANSITION_PRESETS.slideFade;
  if (preset.custom) {
    transitionDispose = runtimeCtx.theme.pageTransition.set({
      enabled: true,
      name: CUSTOM_TRANSITION_NAME,
      mode: "out-in",
      appear: state.settings.appear,
      durationMs: state.settings.durationMs,
      easing: "ease-out",
      enterOpacity: 0,
      leaveOpacity: 0,
      enterTranslateY: 6,
      css: String(state.settings.customCss || "").trim() || DEFAULT_CUSTOM_CSS,
    });
    return;
  }

  transitionDispose = runtimeCtx.theme.pageTransition.set({
    enabled: true,
    mode: "out-in",
    appear: state.settings.appear,
    durationMs: state.settings.durationMs,
    easing: preset.easing,
    enterOpacity: 0,
    leaveOpacity: 0,
    enterTranslateX: preset.enterTranslateX,
    enterTranslateY: preset.enterTranslateY,
    leaveTranslateX: preset.leaveTranslateX,
    leaveTranslateY: preset.leaveTranslateY,
    enterScale: preset.enterScale,
    leaveScale: preset.leaveScale,
    enterFilter: preset.enterFilter,
    leaveFilter: preset.leaveFilter,
  });
};

const persistSettings = async () => {
  if (!runtimeCtx || !state) return;
  await runtimeCtx.storage.set(STORAGE_KEY, { ...state.settings });
};

const updateSettings = (patch) => {
  if (!state) return;
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  applySettings();
  void persistSettings();
};

const createSettingsComponent = (ctx) => {
  const { defineComponent } = ctx.vue;

  return defineComponent({
    name: "PageMotionSettings",
    setup() {
      const { h, defineAsyncComponent } = ctx.vue;
      const { computed, onBeforeUnmount, onMounted, ref, watch } = ctx.vue;
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const Textarea = ctx.ui.components.Textarea
        ? defineAsyncComponent(ctx.ui.components.Textarea)
        : null;
      const presetOptions = Object.entries(TRANSITION_PRESETS).map(([value, preset]) => ({
        label: preset.label,
        value,
      }));
      const previewPhase = ref("idle");
      const previewNonce = ref(0);
      let previewFrame = 0;
      let previewNextFrame = 0;
      let previewTimer = 0;

      const selectedPreset = computed(
        () => TRANSITION_PRESETS[state.settings.preset] || TRANSITION_PRESETS.slideFade,
      );
      const isCustomPreset = computed(() => Boolean(selectedPreset.value.custom));
      const previewDuration = computed(() =>
        Math.max(80, Math.min(900, Number(state.settings.durationMs) || 450)),
      );
      const toCssLength = (value) => (Number.isFinite(Number(value)) ? `${Number(value)}px` : "0px");
      const previewStyle = computed(() => {
        const preset = isCustomPreset.value ? TRANSITION_PRESETS.slideFade : selectedPreset.value;
        const duration = `${previewDuration.value}ms`;
        const easing = preset.easing || "ease-out";

        return {
          "--echo-page-motion-preview-duration": duration,
          "--echo-page-motion-preview-easing": easing,
          "--echo-page-motion-preview-enter-opacity": "0",
          "--echo-page-motion-preview-enter-x": toCssLength(preset.enterTranslateX || 0),
          "--echo-page-motion-preview-enter-y": toCssLength(preset.enterTranslateY || 0),
          "--echo-page-motion-preview-enter-scale": String(preset.enterScale || 1),
          "--echo-page-motion-preview-enter-filter": preset.enterFilter || "none",
          "--page-transition-duration": duration,
          "--page-transition-easing": easing,
          "--page-transition-enter-opacity": "0",
          "--page-transition-leave-opacity": "0",
          "--page-transition-enter-x": toCssLength(preset.enterTranslateX || 0),
          "--page-transition-enter-y": toCssLength(preset.enterTranslateY || 0),
          "--page-transition-enter-scale": String(preset.enterScale || 1),
          "--page-transition-enter-filter": preset.enterFilter || "none",
        };
      });

      const cancelPreview = () => {
        if (previewFrame) cancelAnimationFrame(previewFrame);
        if (previewNextFrame) cancelAnimationFrame(previewNextFrame);
        if (previewTimer) clearTimeout(previewTimer);
        previewFrame = 0;
        previewNextFrame = 0;
        previewTimer = 0;
      };

      const replayPreview = () => {
        cancelPreview();
        previewPhase.value = "idle";
        previewNonce.value += 1;

        if (!state.settings.enabled) return;

        previewFrame = requestAnimationFrame(() => {
          previewPhase.value = "from";
          previewNonce.value += 1;
          previewNextFrame = requestAnimationFrame(() => {
            previewPhase.value = "to";
          });
        });
        previewTimer = setTimeout(() => {
          previewPhase.value = "done";
        }, previewDuration.value + 180);
      };

      const previewCardClasses = computed(() => {
        const classes = ["echo-page-motion-preview-card"];
        const isPlaying = previewPhase.value === "from" || previewPhase.value === "to";

        if (!state.settings.enabled) classes.push("is-disabled");

        if (state.settings.enabled && isPlaying && !isCustomPreset.value) {
          classes.push("is-previewing");
        }

        if (state.settings.enabled && isPlaying && isCustomPreset.value) {
          const name = CUSTOM_TRANSITION_NAME;
          classes.push(`${name}-route-enter-active`, `${name}-enter-active`, `${name}-appear-active`);
          if (previewPhase.value === "from") {
            classes.push(`${name}-enter-from`, `${name}-appear-from`);
          } else {
            classes.push(`${name}-enter-to`, `${name}-appear-to`);
          }
        }

        return classes;
      });

      watch(
        () => [
          state.settings.enabled,
          state.settings.preset,
          state.settings.durationMs,
          state.settings.customCss,
        ],
        replayPreview,
        { flush: "post" },
      );
      onMounted(replayPreview);
      onBeforeUnmount(cancelPreview);

      const switchControl = (key) =>
        h(Switch, {
          modelValue: Boolean(state.settings[key]),
          "onUpdate:modelValue": (value) => {
            updateSettings({ [key]: Boolean(value) });
          },
        });

      const presetSelect = () =>
        h(Select, {
          class: "echo-page-motion-host-select",
          modelValue: state.settings.preset,
          options: presetOptions,
          "onUpdate:modelValue": (value) => {
            const preset = String(value || DEFAULT_SETTINGS.preset);
            updateSettings({
              preset,
              durationMs: TRANSITION_PRESETS[preset]?.durationMs || state.settings.durationMs,
            });
          },
        });

      const durationSlider = () =>
        h(Slider, {
          class: "echo-page-motion-host-slider",
          modelValue: state.settings.durationMs,
          min: 80,
          max: 900,
          step: 10,
          showValue: true,
          valueSuffix: "ms",
          "onUpdate:modelValue": (value) => {
            updateSettings({ durationMs: Number(value) });
          },
        });

      const customCssEditor = () => {
        if (Textarea) {
          return h(Textarea, {
            class: "echo-page-motion-css-editor",
            modelValue: state.settings.customCss,
            rows: 12,
            spellcheck: false,
            "onUpdate:modelValue": (value) => {
              updateSettings({ customCss: String(value ?? "") });
            },
          });
        }

        return h("textarea", {
          class: "echo-page-motion-css-editor",
          spellcheck: "false",
          value: state.settings.customCss,
          onInput: (event) => {
            updateSettings({ customCss: String(event.target.value ?? "") });
          },
        });
      };

      const field = (label, description, control, options = {}) =>
        h(
          "div",
          {
            class: [
              "echo-page-motion-field",
              options.switch ? "is-switch" : "",
              options.wide ? "is-wide" : "",
            ],
          },
          [
            h("span", { class: "echo-page-motion-copy" }, [
              h("span", { class: "echo-page-motion-label" }, label),
              description
                ? h("span", { class: "echo-page-motion-description" }, description)
                : null,
            ]),
            control,
          ],
        );

      const reset = () => {
        updateSettings({ ...DEFAULT_SETTINGS });
      };

      const renderPreview = () =>
        h("aside", { class: "echo-page-motion-preview-panel" }, [
          h("div", { class: "echo-page-motion-preview-head" }, [
            h("div", { class: "echo-page-motion-preview-copy" }, [
              h("span", { class: "echo-page-motion-preview-title" }, "动画预览"),
              h(
                "span",
                { class: "echo-page-motion-preview-subtitle" },
                `${selectedPreset.value.label} · ${previewDuration.value}ms`,
              ),
            ]),
            h(
              "span",
              { class: ["echo-page-motion-pill", state.settings.enabled ? "is-active" : ""] },
              state.settings.enabled ? "已启用" : "已停用",
            ),
          ]),
          h("div", { class: "echo-page-motion-preview-stage" }, [
            h(
              "div",
              {
                key: `preview-${previewNonce.value}`,
                class: previewCardClasses.value,
                style: previewStyle.value,
              },
              [
                h("div", { class: "echo-page-motion-preview-sidebar" }, [
                  h("span", { class: "echo-page-motion-preview-dot" }),
                  h("span", { class: "echo-page-motion-preview-nav" }),
                  h("span", { class: "echo-page-motion-preview-nav" }),
                  h("span", { class: "echo-page-motion-preview-nav" }),
                ]),
                h("div", { class: "echo-page-motion-preview-main" }, [
                  h("div", { class: "echo-page-motion-preview-row" }, [
                    h("span", { class: "echo-page-motion-preview-line" }),
                    h("span", { class: "echo-page-motion-preview-chip" }),
                  ]),
                  h("span", { class: "echo-page-motion-preview-line is-short" }),
                  h("div", { class: "echo-page-motion-preview-list" }, [
                    h("div", { class: "echo-page-motion-preview-item" }, [
                      h("span", { class: "echo-page-motion-preview-thumb" }),
                      h("span", { class: "echo-page-motion-preview-line" }),
                    ]),
                    h("div", { class: "echo-page-motion-preview-item" }, [
                      h("span", { class: "echo-page-motion-preview-thumb" }),
                      h("span", { class: "echo-page-motion-preview-line is-short" }),
                    ]),
                  ]),
                ]),
              ],
            ),
          ]),
          h("div", { class: "echo-page-motion-preview-actions" }, [
            h("span", { class: "echo-page-motion-preview-subtitle" }, "设置变更后自动重播"),
            h(
              Button,
              {
                type: "button",
                variant: "outline",
                size: "xs",
                disabled: !state.settings.enabled,
                onClick: replayPreview,
              },
              { default: () => "重播预览" },
            ),
          ]),
        ]);

      return () => {
        const preset = selectedPreset.value;

        return h("div", { class: "echo-page-motion-settings" }, [
          renderPreview(),
          h("div", { class: "echo-page-motion-controls" }, [
            h("section", { class: "echo-page-motion-section" }, [
              h("div", { class: "echo-page-motion-title" }, "页面动效"),
              field(
                "启用页面切换",
                "关闭后页面切换不再播放入场动画",
                switchControl("enabled"),
                { switch: true },
              ),
              field(
                "首次进入也播放",
                "应用启动或进入主界面时同样播放动效",
                switchControl("appear"),
                { switch: true },
              ),
              field("动效预设", preset.description, presetSelect()),
              field("时长", "控制页面切换速度", durationSlider()),
              preset.custom
                ? field(
                    "自定义 CSS",
                    `固定使用 .${CUSTOM_TRANSITION_NAME}-enter-active 和 .${CUSTOM_TRANSITION_NAME}-route-enter-active 等类名`,
                    customCssEditor(),
                    { wide: true },
                  )
                : null,
            ]),
            h("div", { class: "echo-page-motion-actions" }, [
              h(
                Button,
                {
                  type: "button",
                  variant: "ghost",
                  size: "xs",
                  onClick: reset,
                },
                { default: () => "恢复默认" },
              ),
            ]),
          ]),
        ]);
      };
    },
  });
};

export async function activate(ctx) {
  runtimeCtx = ctx;
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, {
    id: "page-motion-settings",
  });
  settingsDispose = ctx.ui.settings.define({
    title: "页面动效",
    description: "控制 EchoMusic 页面切换的统一入场动画",
    component: createSettingsComponent(ctx),
  });

  applySettings();
}

export function deactivate() {
  clearTransition();
  settingsDispose?.();
  settingsStyleDispose?.();
  settingsDispose = null;
  settingsStyleDispose = null;
  runtimeCtx = null;
  state = null;
}
