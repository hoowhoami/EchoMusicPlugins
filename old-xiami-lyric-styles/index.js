const STORAGE_KEY = "old-xiami-lyric-styles-settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  currentScale: 1.15,
  currentGlow: 38,
  idleOpacity: 0.45,
  scrollDuration: 420,
  lineHeight: 2.1,
  showMarker: true,
  markerStyle: "dot",
  textAlign: "center",
  lyricPadding: 72,
};

let state = null;
let effectDispose = null;
let settingsDispose = null;
let settingsStyleDispose = null;

const mountedHosts = new Set();

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

// ── Spring-based scroll physics (Apple Music style) ──

const derivative = (fn) => {
  const h = 0.001;
  return (x) => (fn(x + h) - fn(x - h)) / (2 * h);
};

const solveSpring = (from, velocity, to, params) => {
  const soft = params?.soft ?? false;
  const stiffness = params?.stiffness ?? 100;
  const damping = params?.damping ?? 10;
  const mass = params?.mass ?? 1;
  const delta = to - from;

  if (soft || 1 <= damping / (2 * Math.sqrt(stiffness * mass))) {
    const angularFrequency = -Math.sqrt(stiffness / mass);
    const leftover = -angularFrequency * delta - velocity;
    return (time) =>
      to - (delta + time * leftover) * Math.E ** (time * angularFrequency);
  }

  const dampingFrequency = Math.sqrt(4 * mass * stiffness - damping ** 2);
  const leftover = (damping * delta - 2 * mass * velocity) / dampingFrequency;
  const dfm = 0.5 * dampingFrequency / mass;
  const dm = (-0.5 * damping) / mass;
  return (time) =>
    to -
    (Math.cos(time * dfm) * delta + Math.sin(time * dfm) * leftover) *
      Math.E ** (time * dm);
};

class SpringValue {
  constructor(value = 0) {
    this.value = value;
    this.target = value;
    this.time = 0;
    this.params = {};
    this.solver = () => this.target;
    this.getVelocity = () => 0;
    this.getAcceleration = () => 0;
  }

  setParams(params) {
    const nextParams = {
      ...this.params,
      ...params,
      mass: Math.max(0.1, Number(params.mass ?? this.params.mass ?? 1) || 1),
      stiffness: Math.max(1, Number(params.stiffness ?? this.params.stiffness ?? 100) || 100),
      damping: Math.max(0, Number(params.damping ?? this.params.damping ?? 10) || 0),
    };
    const unchanged =
      this.params.mass === nextParams.mass &&
      this.params.stiffness === nextParams.stiffness &&
      this.params.damping === nextParams.damping &&
      this.params.soft === nextParams.soft;
    this.params = nextParams;
    if (!unchanged) this.resetSolver();
  }

  resetSolver() {
    const velocity = this.getVelocity(this.time);
    this.time = 0;
    this.solver = solveSpring(this.value, velocity, this.target, this.params);
    this.getVelocity = derivative(this.solver);
    this.getAcceleration = derivative(this.getVelocity);
  }

  setValue(value) {
    this.value = Number(value) || 0;
    this.target = this.value;
    this.time = 0;
    this.solver = () => this.target;
    this.getVelocity = () => 0;
    this.getAcceleration = () => 0;
  }

  setTarget(value) {
    const nextTarget = Number(value) || 0;
    if (Math.abs(nextTarget - this.target) < 0.0001) return;
    this.target = nextTarget;
    this.resetSolver();
  }

  update(deltaSeconds) {
    this.time += deltaSeconds;
    this.value = this.solver(this.time);
    if (this.settled()) this.setValue(this.target);
  }

  settled() {
    return (
      Math.abs(this.value - this.target) < 0.01 &&
      Math.abs(this.getVelocity(this.time)) < 0.01 &&
      Math.abs(this.getAcceleration(this.time)) < 0.01
    );
  }
}

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    currentScale: clamp(source.currentScale ?? DEFAULT_SETTINGS.currentScale, 1.0, 1.5),
    currentGlow: clamp(source.currentGlow ?? DEFAULT_SETTINGS.currentGlow, 0, 80),
    idleOpacity: clamp(source.idleOpacity ?? DEFAULT_SETTINGS.idleOpacity, 0.2, 0.8),
    scrollDuration: clamp(source.scrollDuration ?? DEFAULT_SETTINGS.scrollDuration, 100, 1200),
    lineHeight: clamp(source.lineHeight ?? DEFAULT_SETTINGS.lineHeight, 1.5, 3.5),
    showMarker: source.showMarker ?? DEFAULT_SETTINGS.showMarker,
    markerStyle: ["dot", "bar", "none"].includes(source.markerStyle) ? source.markerStyle : DEFAULT_SETTINGS.markerStyle,
    textAlign: ["left", "center"].includes(source.textAlign) ? source.textAlign : DEFAULT_SETTINGS.textAlign,
    lyricPadding: clamp(source.lyricPadding ?? DEFAULT_SETTINGS.lyricPadding, 0, 288),
  };
};

const updateSettings = (ctx, patch) => {
  if (!state) return;
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  for (const entry of mountedHosts) {
    applyHostSettings(entry);
    if (entry.snapshot) syncHostLayout(entry, entry.snapshot);
  }
};

const applyHostSettings = (entry) => {
  if (!state) return;
  const s = state.settings;
  const r = entry.host.root;
  r.dataset.classicLyricEnabled = s.enabled ? "true" : "false";
  r.dataset.classicLyricMarker = s.showMarker ? s.markerStyle : "none";
  r.dataset.classicGlowActive = s.currentGlow > 0 ? "true" : "false";
  r.style.setProperty("--echo-classic-current-scale", String(s.currentScale));
  r.style.setProperty("--echo-classic-glow-size", `${(s.currentGlow * 0.24).toFixed(1)}px`);
  r.style.setProperty("--echo-classic-idle-opacity", String(s.idleOpacity));
  r.style.setProperty("--echo-classic-scroll-duration", `${s.scrollDuration}ms`);
  r.style.setProperty("--echo-classic-line-height", s.lineHeight.toFixed(2));
  r.style.setProperty("--echo-classic-text-align", s.textAlign);
  r.style.setProperty("--echo-classic-transform-origin", s.textAlign === "left" ? "left center" : "center center");
  r.style.setProperty("--echo-classic-scroller-padding-x", s.textAlign === "left" ? `${s.lyricPadding}px` : "0px");
};

const syncHostLayout = (entry, snapshot) => {
  if (!state) return;
  entry.snapshot = snapshot;
  const s = state.settings;
  const idx = Number(snapshot.currentIndex);
  const hasCurrent = Number.isFinite(idx) && idx >= 0;
  const rows = entry.host.scroller.querySelectorAll("[data-echo-lyric-row]");

  // When the current index changes, skip applying the visual effect for one
  // frame so the scroll animation starts first.  Without this the highlight
  // briefly appears on the wrong line while the viewport is still mid-scroll.
  const prevIdx = entry._prevEffectIdx;
  if (hasCurrent && prevIdx !== undefined && prevIdx !== idx && !entry._skipEffectFrame) {
    entry._skipEffectFrame = true;
    entry._prevEffectIdx = idx;
    return;
  }
  entry._skipEffectFrame = false;
  if (hasCurrent) entry._prevEffectIdx = idx;

  rows.forEach((row) => {
    const ri = Number(row.getAttribute("data-echo-lyric-index") || -1);
    const distance = hasCurrent ? ri - idx : 0;
    const abs = Math.abs(distance);
    const isCurrent = ri === idx;

    const scale = isCurrent ? s.currentScale : Math.max(0.88, 1 - abs * 0.04);
    const opacity = isCurrent ? 1 : Math.max(s.idleOpacity, 1 - abs * 0.22);
    const blur = isCurrent ? 0 : Math.min(abs * 0.6, 2.4);

    row.style.setProperty("--echo-classic-row-scale", scale.toFixed(3));
    row.style.setProperty("--echo-classic-row-opacity", opacity.toFixed(3));
    row.style.setProperty("--echo-classic-row-blur", `${blur.toFixed(1)}px`);
    row.style.setProperty("--echo-classic-row-x", "0px");
    row.style.setProperty("--echo-classic-row-distance", String(distance));
    row.style.setProperty("--echo-classic-row-is-current", isCurrent ? "1" : "0");
  });
};

const startSyncLoop = (entry) => {
  const tick = () => {
    if (!state) return;
    const snap = entry.host.getSnapshot();
    entry.snapshot = snap;
    syncHostLayout(entry, snap);
    entry.frame = window.requestAnimationFrame(tick);
  };
  entry.frame = window.requestAnimationFrame(tick);
};

const getSpringParams = (scrollDuration) => {
  // Map scrollDuration (100-1200ms) to critically-damped spring params
  // No overshoot — smooth slide to target without bounce
  const t = clamp((scrollDuration - 100) / 1100, 0, 1);
  const mass = 0.8 + t * 0.4;
  const stiffness = 140 - t * 50;
  return {
    mass,
    stiffness,
    damping: 2 * Math.sqrt(stiffness * mass) + 0.5,
  };
};

let globalLastFrameTime = 0;
let globalFrameId = 0;

const animationTick = (time) => {
  if (!globalLastFrameTime) globalLastFrameTime = time;
  const deltaSeconds = Math.min(0.05, Math.max(0.001, (time - globalLastFrameTime) / 1000));
  globalLastFrameTime = time;

  let active = false;
  for (const entry of mountedHosts) {
    if (!entry.scrollActive) continue;
    entry.springScroll.update(deltaSeconds);
    if (Math.abs(entry.host.scroller.scrollTop - entry.springScroll.value) > 0.1) {
      entry.host.scroller.scrollTop = entry.springScroll.value;
    }
    if (entry.springScroll.settled()) {
      entry.host.scroller.scrollTop = entry.springScroll.target;
      entry.scrollActive = false;
    } else {
      active = true;
    }
  }

  if (active) {
    globalFrameId = window.requestAnimationFrame(animationTick);
  } else {
    globalFrameId = 0;
    globalLastFrameTime = 0;
  }
};

const startSpringLoop = () => {
  if (globalFrameId) return;
  globalLastFrameTime = 0;
  globalFrameId = window.requestAnimationFrame(animationTick);
};

const mountClassicEffect = (host) => {
  const entry = {
    host,
    frame: 0,
    snapshot: host.getSnapshot(),
    unsubscribe: null,
    scrollFrame: 0,
    originalScrollTo: null,
    springScroll: new SpringValue(host.scroller?.scrollTop ?? 0),
    scrollActive: false,
  };

  const scroller = host.scroller;

  const onWheel = () => {
    entry.scrollActive = false;
    entry.springScroll.setValue(scroller.scrollTop);
  };

  if (scroller) {
    entry.originalScrollTo = scroller.scrollTo.bind(scroller);

    scroller.scrollTo = (options) => {
      let target = scroller.scrollTop;
      let instant = false;

      if (typeof options === "object" && options !== null) {
        if (options.top !== undefined) target = options.top;
        instant = options.behavior === "auto";
      } else if (typeof options === "number") {
        target = options;
      }

      target = Math.max(
        0,
        Math.min(target, scroller.scrollHeight - scroller.clientHeight),
      );

      if (instant || Math.abs(target - scroller.scrollTop) < 1) {
        scroller.scrollTop = target;
        return;
      }

      if (entry.scrollFrame) {
        cancelAnimationFrame(entry.scrollFrame);
        entry.scrollFrame = 0;
      }

      const scrollDuration = state?.settings?.scrollDuration || 420;
      const springParams = getSpringParams(scrollDuration);

      entry.springScroll.setParams(springParams);
      entry.springScroll.setValue(scroller.scrollTop);
      entry.springScroll.setTarget(target);
      entry.scrollActive = true;
      startSpringLoop();
    };
  }

  if (scroller) {
    scroller.addEventListener("wheel", onWheel, { passive: true });
  }

  mountedHosts.add(entry);
  applyHostSettings(entry);
  syncHostLayout(entry, entry.snapshot);
  entry.unsubscribe = host.subscribe((snap) => {
    entry.snapshot = snap;
    syncHostLayout(entry, snap);
  });
  startSyncLoop(entry);

  return () => {
    mountedHosts.delete(entry);
    entry.unsubscribe?.();
    if (entry.frame) window.cancelAnimationFrame(entry.frame);
    if (entry.scrollFrame) window.cancelAnimationFrame(entry.scrollFrame);
    if (scroller) {
      if (entry.originalScrollTo) scroller.scrollTo = entry.originalScrollTo;
      scroller.removeEventListener("wheel", onWheel);
    }
    entry.host.root.removeAttribute("data-classic-lyric-enabled");
    entry.host.root.removeAttribute("data-classic-lyric-marker");
  };
};

const EFFECT_CSS = `
.echo-classic-lyrics {
  --echo-classic-current-scale: 1.15;
  --echo-classic-glow-size: 9px;
  --echo-classic-idle-opacity: 0.45;
  --echo-classic-scroll-duration: 420ms;
  --echo-classic-line-height: 2.1;
  --echo-classic-text-align: center;
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] .lyric-scroller {
  overflow: hidden;
  padding-left: var(--echo-classic-scroller-padding-x, 0px);
  padding-right: var(--echo-classic-scroller-padding-x, 0px);
  mask-image: linear-gradient(180deg, transparent 0%, black 8%, black 92%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, black 8%, black 92%, transparent 100%);
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-row] {
  padding-top: 6px !important;
  padding-bottom: 6px !important;
  opacity: var(--echo-classic-row-opacity, 1);
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-line] {
  position: relative;
  flex: 1;
  white-space: nowrap;
  text-align: var(--echo-classic-text-align, center) !important;
  transform-origin: var(--echo-classic-transform-origin, center center);
  transition:
    opacity var(--echo-classic-scroll-duration) cubic-bezier(0.4, 0, 0.2, 1),
    transform var(--echo-classic-scroll-duration) cubic-bezier(0.4, 0, 0.2, 1),
    filter var(--echo-classic-scroll-duration) ease;
  transform:
    translate3d(var(--echo-classic-row-x, 0px), 0, 0)
    scale(var(--echo-classic-row-scale, 1));
  filter: blur(var(--echo-classic-row-blur, 0px));
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-line][data-echo-lyric-current="true"] {
  filter: blur(0px);
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-primary] {
  text-align: var(--echo-classic-text-align, center) !important;
  transition:
    color var(--echo-classic-scroll-duration) ease,
    text-shadow var(--echo-classic-scroll-duration) ease;
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-line][data-echo-lyric-current="true"] [data-echo-lyric-primary] {
  text-shadow:
    0 0 var(--echo-classic-glow-size) var(--color-primary, #31cfa1),
    0 0 calc(var(--echo-classic-glow-size) * 2) var(--color-primary, #31cfa1) !important;
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-secondary] {
  transition:
    opacity var(--echo-classic-scroll-duration) ease;
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-line][data-echo-lyric-current="true"] [data-echo-lyric-secondary] {
  opacity: 0.85 !important;
}

/* Current line marker */
.echo-classic-lyrics[data-classic-lyric-enabled="true"][data-classic-lyric-marker="dot"] [data-echo-lyric-line][data-echo-lyric-current="true"]::before {
  content: "";
  position: absolute;
  left: -16px;
  top: 50%;
  transform: translateY(-50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow:
    0 0 6px currentColor,
    0 0 14px currentColor;
  animation: echo-classic-marker-pulse 1.8s ease-in-out infinite;
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"][data-classic-lyric-marker="bar"] [data-echo-lyric-line][data-echo-lyric-current="true"]::before {
  content: "";
  position: absolute;
  left: -16px;
  top: 15%;
  bottom: 15%;
  width: 3px;
  border-radius: 2px;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
  animation: echo-classic-marker-bar 2.4s ease-in-out infinite;
}

@keyframes echo-classic-marker-pulse {
  0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
  50% { opacity: 0.6; transform: translateY(-50%) scale(1.3); }
}

@keyframes echo-classic-marker-bar {
  0%, 100% { opacity: 1; transform: scaleY(1); }
  50% { opacity: 0.5; transform: scaleY(0.7); }
}

/* Idle lines fade */
.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-line].is-idle {
  transform:
    translate3d(var(--echo-classic-row-x, 0px), 0, 0)
    scale(var(--echo-classic-row-scale, 0.96));
}

.echo-classic-lyrics[data-classic-lyric-enabled="true"] [data-echo-lyric-line].is-current {
  transform:
    translate3d(var(--echo-classic-row-x, 0px), 0, 0)
    scale(var(--echo-classic-row-scale, 1.15));
}

/* Collapsed mode: keep it subtle */
.echo-classic-lyrics[data-classic-lyric-enabled="true"] .lyric-scroller.is-collapsed [data-echo-lyric-line] {
  transform: none;
  filter: none;
}

.echo-classic-lyrics[data-classic-lyric-enabled="false"] [data-echo-lyric-line] {
  transform: none;
  filter: none;
}
`;

const SETTINGS_CSS = `
.echo-classic-settings {
  display: grid;
  gap: 14px;
  color: var(--color-text-main);
}

.echo-classic-settings-row {
  display: grid;
  gap: 7px;
}

.echo-classic-settings-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.echo-classic-settings-title {
  font-size: 13px;
  font-weight: 760;
}

.echo-classic-settings-hint {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.echo-classic-settings-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
`;

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "OldXiamiLyricStylesSettings",
    setup() {
      const { defineAsyncComponent, h, ref, reactive, watch } = ctx.vue;
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const Select = defineAsyncComponent(ctx.ui.components.Select);

      const draft = reactive(normalizeSettings(state?.settings));
      const saving = ref(false);

      watch(
        () => state?.settings,
        (settings) => {
          if (settings && !saving.value) {
            Object.assign(draft, normalizeSettings(settings));
          }
        },
        { deep: true },
      );

      const setDraftValue = (key, value) => {
        draft[key] = value;
      };

      const saveDraft = async () => {
        if (saving.value) return;
        saving.value = true;
        try {
          const next = normalizeSettings({ ...draft });
          await ctx.storage.set(STORAGE_KEY, next);
          updateSettings(ctx, next);
          Object.assign(draft, next);
          ctx.toast.success("旧版虾米歌词风格设置已保存");
        } catch (error) {
          const text = error instanceof Error ? error.message : "设置保存失败";
          ctx.toast.warning(text);
        } finally {
          saving.value = false;
        }
      };

      const resetDraft = () => {
        Object.assign(draft, normalizeSettings(DEFAULT_SETTINGS));
      };

      const slider = (label, key, min, max, hint) =>
        h("div", { class: "echo-classic-settings-row" }, [
          h("div", { class: "echo-classic-settings-line" }, [
            h("span", { class: "echo-classic-settings-title" }, label),
            h(
              "span",
              { class: "echo-classic-settings-hint" },
              String(draft[key]),
            ),
          ]),
          h(Slider, {
            modelValue: draft[key],
            min,
            max,
            step: 1,
            "onUpdate:modelValue": (value) => setDraftValue(key, Number(value)),
          }),
          hint ? h("div", { class: "echo-classic-settings-hint" }, hint) : null,
        ]);

      const toggle = (label, key, hint) =>
        h("div", { class: "echo-classic-settings-row" }, [
          h("label", { class: "echo-classic-settings-line" }, [
            h("span", { class: "echo-classic-settings-title" }, label),
            h(Switch, {
              modelValue: Boolean(draft[key]),
              "onUpdate:modelValue": (value) => setDraftValue(key, Boolean(value)),
            }),
          ]),
          hint ? h("div", { class: "echo-classic-settings-hint" }, hint) : null,
        ]);

      const markerOptions = [
        { label: "圆点", value: "dot" },
        { label: "竖线", value: "bar" },
        { label: "无", value: "none" },
      ];

      const alignOptions = [
        { label: "左对齐", value: "left" },
        { label: "居中对齐", value: "center" },
      ];

      const renderButton = (label, props = {}) =>
        h(Button, props, { default: () => label });

      return () =>
        h("div", { class: "echo-classic-settings" }, [
          toggle(
            "启用动效",
            "enabled",
            "关闭后保留插件设置，但不修改页面歌词外观。",
          ),
          toggle(
            "当前行标记",
            "showMarker",
            "在当前歌词行左侧显示指示器。",
          ),
          draft.showMarker
            ? h("div", { class: "echo-classic-settings-row" }, [
                h("div", { class: "echo-classic-settings-line" }, [
                  h("span", { class: "echo-classic-settings-title" }, "标记样式"),
                ]),
                h(Select, {
                  modelValue: draft.markerStyle,
                  options: markerOptions,
                  "onUpdate:modelValue": (value) =>
                    setDraftValue("markerStyle", String(value)),
                }),
              ])
            : null,
          h("div", { class: "echo-classic-settings-row" }, [
            h("div", { class: "echo-classic-settings-line" }, [
              h("span", { class: "echo-classic-settings-title" }, "对齐方式"),
            ]),
            h(Select, {
              modelValue: draft.textAlign,
              options: alignOptions,
              "onUpdate:modelValue": (value) =>
                setDraftValue("textAlign", String(value)),
            }),
          ]),
          slider("当前行放大", "currentScale", 100, 150, "100 为原始大小，150 为放大 1.5 倍。"),
          slider("辉光强度", "currentGlow", 0, 80, "当前歌词行的文字发光。"),
          slider("其他行透明度", "idleOpacity", 20, 80, "非当前行的最低不透明度。"),
          slider("滚动过渡", "scrollDuration", 100, 1200, "歌词切换时的过渡动画时长。"),
          slider("行间距", "lineHeight", 15, 35, "歌词行之间的间距。"),
          draft.textAlign === "left"
            ? slider("歌词边距", "lyricPadding", 0, 288, "左对齐时歌词与左侧的间距。")
            : null,
          h("div", { class: "echo-classic-settings-actions" }, [
            renderButton("恢复默认", {
              variant: "outline",
              size: "xs",
              disabled: saving.value,
              onClick: resetDraft,
            }),
            renderButton(saving.value ? "保存中..." : "保存", {
              variant: "primary",
              size: "xs",
              loading: saving.value,
              disabled: saving.value,
              onClick: saveDraft,
            }),
          ]),
        ]);
    },
  });

export async function activate(ctx) {
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, {
    id: "old-xiami-lyric-styles-settings",
  });

  settingsDispose = ctx.ui.settings.define({
    title: "旧版虾米歌词风格",
    description: "将页面歌词替换为旧版虾米风格效果。",
    component: createSettingsComponent(ctx),
  });

  effectDispose = ctx.lyricEffects.register({
    id: "old-xiami-lyric-styles",
    title: "旧版虾米歌词风格",
    scope: "page",
    layer: "decorator",
    className: "echo-classic-lyrics",
    css: EFFECT_CSS,
    mount: mountClassicEffect,
  });
}

export function deactivate() {
  if (globalFrameId) window.cancelAnimationFrame(globalFrameId);
  globalFrameId = 0;
  globalLastFrameTime = 0;
  effectDispose?.();
  settingsDispose?.();
  settingsStyleDispose?.();
  effectDispose = null;
  settingsDispose = null;
  settingsStyleDispose = null;
  state = null;
  mountedHosts.clear();
}
