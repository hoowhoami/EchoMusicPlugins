const STORAGE_KEY = "water-lyrics-settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  intensity: 62,
  stagger: 44,
  glow: 42,
  italic: true,
  typography: true,
  connectors: true,
};

let state = null;
let effectDispose = null;
let settingsDispose = null;
let settingsStyleDispose = null;
let saveTimer = 0;

const mountedHosts = new Set();

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    intensity: clamp(source.intensity ?? DEFAULT_SETTINGS.intensity, 0, 100),
    stagger: clamp(source.stagger ?? DEFAULT_SETTINGS.stagger, 0, 80),
    glow: clamp(source.glow ?? DEFAULT_SETTINGS.glow, 0, 100),
    italic: source.italic ?? DEFAULT_SETTINGS.italic,
    typography: source.typography ?? DEFAULT_SETTINGS.typography,
    connectors: source.connectors ?? DEFAULT_SETTINGS.connectors,
  };
};

const scheduleSave = (ctx) => {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    if (!state) return;
    void ctx.storage.set(STORAGE_KEY, normalizeSettings(state.settings));
  }, 240);
};

const updateSettings = (ctx, patch) => {
  if (!state) return;
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  for (const entry of mountedHosts) {
    applyHostSettings(entry);
    if (entry.snapshot) syncHostLayout(entry, entry.snapshot);
  }
  scheduleSave(ctx);
};

const getReducedMotionFactor = (snapshot) =>
  snapshot?.reducedMotion ? 0.22 : 1;

const applyHostSettings = (entry) => {
  if (!state) return;
  const settings = state.settings;
  const host = entry.host;
  const intensity = settings.intensity / 100;
  const glow = settings.glow / 100;
  host.root.dataset.waterLyricEnabled = settings.enabled ? "true" : "false";
  host.root.dataset.waterLyricItalic = settings.italic ? "true" : "false";
  host.root.dataset.waterLyricTypography = settings.typography
    ? "true"
    : "false";
  host.root.dataset.waterLyricConnectors = settings.connectors
    ? "true"
    : "false";
  host.root.style.setProperty("--echo-water-intensity", String(intensity));
  host.root.style.setProperty(
    "--echo-water-text-skew",
    settings.italic ? "-7deg" : "0deg",
  );
  host.root.style.setProperty(
    "--echo-water-glow-size",
    `${(22 * glow).toFixed(1)}px`,
  );
  host.root.style.setProperty(
    "--echo-water-connector-height",
    `${(32 + intensity * 30).toFixed(1)}px`,
  );
  host.root.style.setProperty(
    "--echo-water-connector-width",
    `${(0.72 + intensity * 0.42).toFixed(2)}px`,
  );
  host.root.style.setProperty(
    "--echo-water-drop-size",
    `${(3.4 + intensity * 2.4).toFixed(1)}px`,
  );
  host.root.style.setProperty(
    "--echo-water-caustic-opacity",
    (0.06 + intensity * 0.11).toFixed(3),
  );
  host.root.style.setProperty("--echo-water-stagger", String(settings.stagger));
};

const syncHostLayout = (entry, snapshot) => {
  if (!state) return;
  entry.snapshot = snapshot;
  const settings = state.settings;
  const motionFactor = getReducedMotionFactor(snapshot);
  const currentIndex = Number(snapshot.currentIndex);
  const hasCurrent = Number.isFinite(currentIndex) && currentIndex >= 0;
  const intensity = settings.intensity / 100;
  const connectorHeight = 32 + intensity * 30;
  const rows = entry.host.scroller.querySelectorAll("[data-echo-lyric-row]");
  rows.forEach((row) => {
    const index = Number(row.getAttribute("data-echo-lyric-index") || -1);
    const distance = hasCurrent ? index - currentIndex : 0;
    const absDistance = Math.abs(distance);
    const side = distance % 2 === 0 ? -1 : 1;
    const x = side * Math.min(absDistance, 4) * settings.stagger * 0.52;
    const y = Math.min(absDistance, 4) * settings.intensity * 0.035;
    const opacity = Math.max(0.18, 1 - absDistance * 0.16);
    const connectorVisible =
      settings.connectors && hasCurrent && distance >= -1 && distance <= 2;
    const connectorBias = distance === 0 ? 1 : distance > 0 ? 0.66 : 0.46;
    const connectorStrength = connectorVisible
      ? Math.max(0, 1 - absDistance * 0.34) * connectorBias
      : 0;
    const targetDistance = distance + 1;
    const connectorSide = targetDistance % 2 === 0 ? -1 : 1;
    const connectorAngle =
      connectorSide * (18 + Math.min(absDistance, 2) * 4.5);
    const connectorX = connectorSide * (5 + Math.min(absDistance, 2) * 3.5);
    const angleRadians = (Math.abs(connectorAngle) * Math.PI) / 180;
    const dropX =
      connectorX + Math.sin(angleRadians) * connectorHeight * connectorSide;
    row.style.setProperty("--echo-water-row-x", `${x.toFixed(2)}px`);
    row.style.setProperty(
      "--echo-water-row-y",
      `${(y * motionFactor).toFixed(2)}px`,
    );
    row.style.setProperty("--echo-water-row-opacity", opacity.toFixed(2));
    row.style.setProperty("--echo-water-row-distance", String(distance));
    row.style.setProperty(
      "--echo-water-connector-alpha",
      (connectorStrength * (0.18 + intensity * 0.26)).toFixed(3),
    );
    row.style.setProperty(
      "--echo-water-drop-alpha",
      (connectorStrength * (0.38 + intensity * 0.3)).toFixed(3),
    );
    row.style.setProperty(
      "--echo-water-connector-angle",
      `${connectorAngle.toFixed(1)}deg`,
    );
    row.style.setProperty(
      "--echo-water-connector-x",
      `${connectorX.toFixed(1)}px`,
    );
    row.style.setProperty("--echo-water-drop-x", `${dropX.toFixed(1)}px`);
    row.style.setProperty(
      "--echo-water-drop-scale",
      (0.72 + connectorStrength * 0.36).toFixed(3),
    );
  });
};

const createWaterOverlay = () => {
  const root = document.createElement("div");
  root.className = "echo-water-lyric-overlay";
  root.innerHTML = `
    <svg class="echo-water-lyric-filter-svg" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="echo-water-lyric-filter">
        <feTurbulence
          class="echo-water-lyric-turbulence"
          type="fractalNoise"
          baseFrequency="0.012 0.038"
          numOctaves="2"
          seed="7"
          result="noise"
        />
        <feDisplacementMap
          class="echo-water-lyric-displacement"
          in="SourceGraphic"
          in2="noise"
          scale="1.6"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
    <div class="echo-water-lyric-caustic echo-water-lyric-caustic-a"></div>
    <div class="echo-water-lyric-caustic echo-water-lyric-caustic-b"></div>
  `;
  return root;
};

const startWaterAnimation = (entry) => {
  const tick = (time) => {
    if (!state) return;
    const settings = state.settings;
    const snapshot = entry.snapshot;
    const reducedFactor = getReducedMotionFactor(snapshot);
    const active = settings.enabled && snapshot?.hasLyrics;
    const intensity = active ? (settings.intensity / 100) * reducedFactor : 0;
    const wave = 0.01 + intensity * 0.01 + Math.sin(time / 1900) * 0.002;
    const vertical = 0.032 + intensity * 0.016 + Math.cos(time / 2300) * 0.003;
    const scale = active ? 0.8 + intensity * 3.4 : 0;

    entry.turbulence?.setAttribute(
      "baseFrequency",
      `${wave.toFixed(4)} ${vertical.toFixed(4)}`,
    );
    entry.displacement?.setAttribute("scale", scale.toFixed(2));
    entry.frame = window.requestAnimationFrame(tick);
  };
  entry.frame = window.requestAnimationFrame(tick);
};

const mountWaterEffect = (host) => {
  const overlay = createWaterOverlay();
  host.overlay.appendChild(overlay);

  const entry = {
    host,
    overlay,
    turbulence: overlay.querySelector(".echo-water-lyric-turbulence"),
    displacement: overlay.querySelector(".echo-water-lyric-displacement"),
    frame: 0,
    syncFrame: 0,
    snapshot: host.getSnapshot(),
    unsubscribe: null,
  };

  const scheduleLayoutSync = (snapshot) => {
    entry.snapshot = snapshot;
    if (entry.syncFrame) return;
    entry.syncFrame = window.requestAnimationFrame(() => {
      entry.syncFrame = 0;
      syncHostLayout(entry, entry.snapshot);
    });
  };

  mountedHosts.add(entry);
  applyHostSettings(entry);
  syncHostLayout(entry, entry.snapshot);
  entry.unsubscribe = host.subscribe(scheduleLayoutSync);
  startWaterAnimation(entry);

  return () => {
    mountedHosts.delete(entry);
    entry.unsubscribe?.();
    if (entry.frame) window.cancelAnimationFrame(entry.frame);
    if (entry.syncFrame) window.cancelAnimationFrame(entry.syncFrame);
    entry.host.root.removeAttribute("data-water-lyric-enabled");
    entry.host.root.removeAttribute("data-water-lyric-italic");
    entry.host.root.removeAttribute("data-water-lyric-typography");
    entry.host.root.removeAttribute("data-water-lyric-connectors");
    entry.overlay.remove();
  };
};

const WATER_EFFECT_CSS = `
.echo-water-lyrics {
  --echo-water-intensity: 0.62;
  --echo-water-glow-size: 9.2px;
  --echo-water-text-skew: -7deg;
  --echo-water-stagger: 44;
  --echo-water-connector-height: 55px;
  --echo-water-connector-width: 0.98px;
  --echo-water-drop-size: 4.9px;
  --echo-water-caustic-opacity: 0.128;
}

.echo-water-lyrics[data-water-lyric-enabled="true"] .lyric-scroller {
  mask-image: linear-gradient(180deg, transparent 0%, black 13%, black 86%, transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, black 13%, black 86%, transparent 100%);
}

.echo-water-lyrics[data-water-lyric-enabled="true"] [data-echo-lyric-row] {
  opacity: var(--echo-water-row-opacity, 1);
}

.echo-water-lyrics[data-water-lyric-enabled="true"] [data-echo-lyric-line] {
  position: relative;
  will-change: transform, opacity, filter;
  transform:
    translate3d(var(--echo-water-row-x, 0px), var(--echo-water-row-y, 0px), 0)
    skewX(var(--echo-water-text-skew))
    scale(0.98);
  transition:
    opacity 420ms ease,
    filter 420ms ease,
    transform 560ms cubic-bezier(0.22, 1, 0.36, 1);
}

.echo-water-lyrics[data-water-lyric-enabled="true"][data-water-lyric-italic="true"] [data-echo-lyric-primary] {
  font-style: italic;
}

.echo-water-lyrics[data-water-lyric-enabled="true"][data-water-lyric-typography="true"] [data-echo-lyric-primary] {
  letter-spacing: 0.18em !important;
}

.echo-water-lyrics[data-water-lyric-enabled="true"][data-water-lyric-typography="true"] [data-echo-lyric-secondary] {
  letter-spacing: 0.08em;
}

.echo-water-lyrics[data-water-lyric-enabled="true"] [data-echo-lyric-line][data-echo-lyric-current="true"] {
  filter:
    url("#echo-water-lyric-filter")
    drop-shadow(0 0 var(--echo-water-glow-size) rgba(178, 255, 238, 0.66));
  transform:
    translate3d(var(--echo-water-row-x, 0px), var(--echo-water-row-y, 0px), 0)
    skewX(var(--echo-water-text-skew))
    scale(1.08);
}

.echo-water-lyrics[data-water-lyric-enabled="true"][data-water-lyric-connectors="true"] [data-echo-lyric-line]::after {
  content: "";
  position: absolute;
  left: 50%;
  top: calc(100% + 10px);
  width: var(--echo-water-connector-width);
  height: var(--echo-water-connector-height);
  border-radius: 999px;
  transform:
    translate3d(calc(-50% + var(--echo-water-connector-x, 0px)), 0, 0)
    rotate(var(--echo-water-connector-angle, 18deg));
  transform-origin: top center;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0),
      rgba(234, 255, 249, 0.76) 16%,
      rgba(133, 226, 255, 0.48) 58%,
      rgba(255, 255, 255, 0)
    );
  filter:
    drop-shadow(0 0 4px rgba(154, 236, 255, 0.42))
    drop-shadow(0 0 10px rgba(133, 255, 231, 0.18));
  opacity: var(--echo-water-connector-alpha, 0);
  pointer-events: none;
  transition:
    opacity 360ms ease,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}

.echo-water-lyrics[data-water-lyric-enabled="true"][data-water-lyric-connectors="true"] [data-echo-lyric-line]::before {
  content: "";
  position: absolute;
  left: 50%;
  top: calc(100% + 10px + var(--echo-water-connector-height) - 2px);
  width: var(--echo-water-drop-size);
  height: calc(var(--echo-water-drop-size) * 1.34);
  border-radius: 55% 55% 62% 62%;
  transform:
    translate3d(calc(-50% + var(--echo-water-drop-x, 0px)), 0, 0)
    rotate(var(--echo-water-connector-angle, 18deg))
    scale(var(--echo-water-drop-scale, 0.72));
  transform-origin: center top;
  background:
    radial-gradient(circle at 38% 24%, rgba(255, 255, 255, 0.92) 0 17%, transparent 22%),
    linear-gradient(180deg, rgba(229, 255, 251, 0.9), rgba(87, 207, 255, 0.42));
  box-shadow:
    0 0 7px rgba(143, 238, 255, 0.36),
    0 0 16px rgba(130, 255, 224, 0.18);
  opacity: var(--echo-water-drop-alpha, 0);
  pointer-events: none;
  transition:
    opacity 360ms ease,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}

.echo-water-lyric-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.echo-water-lyric-filter-svg {
  position: absolute;
  width: 0;
  height: 0;
}

.echo-water-lyric-caustic {
  position: absolute;
  left: 18%;
  right: 18%;
  height: 34%;
  border-radius: 999px;
  opacity: var(--echo-water-caustic-opacity);
  filter: blur(34px);
  transform: translate3d(0, 0, 0);
  background:
    radial-gradient(circle at 20% 50%, rgba(130, 255, 224, 0.36), transparent 36%),
    radial-gradient(circle at 70% 40%, rgba(89, 180, 255, 0.28), transparent 38%);
}

.echo-water-lyric-caustic-a {
  top: 18%;
  animation: echo-water-lyric-drift-a 12s ease-in-out infinite alternate;
}

.echo-water-lyric-caustic-b {
  bottom: 12%;
  animation: echo-water-lyric-drift-b 15s ease-in-out infinite alternate;
}

.echo-water-lyrics[data-water-lyric-enabled="false"] .echo-water-lyric-overlay,
.echo-water-lyrics[data-echo-lyric-reduced-motion="true"] .echo-water-lyric-caustic {
  display: none;
}

@keyframes echo-water-lyric-drift-a {
  from { transform: translate3d(-5%, -2%, 0) scale(0.96); }
  to { transform: translate3d(6%, 3%, 0) scale(1.08); }
}

@keyframes echo-water-lyric-drift-b {
  from { transform: translate3d(7%, 2%, 0) scale(1.04); }
  to { transform: translate3d(-6%, -3%, 0) scale(0.94); }
}
`;

const SETTINGS_CSS = `
.echo-water-settings {
  display: grid;
  gap: 14px;
  color: var(--color-text-main);
}

.echo-water-settings-row {
  display: grid;
  gap: 7px;
}

.echo-water-settings-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.echo-water-settings-title {
  font-size: 13px;
  font-weight: 760;
}

.echo-water-settings-hint {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.echo-water-settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
`;

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "WaterLyricsSettings",
    setup() {
      const { defineAsyncComponent, h } = ctx.vue;
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);

      const slider = (label, key, min, max, hint) =>
        h("div", { class: "echo-water-settings-row" }, [
          h("div", { class: "echo-water-settings-line" }, [
            h("span", { class: "echo-water-settings-title" }, label),
            h(
              "span",
              { class: "echo-water-settings-hint" },
              String(state.settings[key]),
            ),
          ]),
          h(Slider, {
            modelValue: state.settings[key],
            min,
            max,
            step: 1,
            "onUpdate:modelValue": (value) =>
              updateSettings(ctx, { [key]: Number(value) }),
          }),
          hint ? h("div", { class: "echo-water-settings-hint" }, hint) : null,
        ]);

      const toggle = (label, key, hint) =>
        h("div", { class: "echo-water-settings-row" }, [
          h("label", { class: "echo-water-settings-line" }, [
            h("span", { class: "echo-water-settings-title" }, label),
            h(Switch, {
              modelValue: Boolean(state.settings[key]),
              "onUpdate:modelValue": (value) =>
                updateSettings(ctx, { [key]: Boolean(value) }),
            }),
          ]),
          hint ? h("div", { class: "echo-water-settings-hint" }, hint) : null,
        ]);

      return () =>
        h("div", { class: "echo-water-settings" }, [
          toggle(
            "启用动效",
            "enabled",
            "关闭后保留插件设置，但不修改页面歌词外观。",
          ),
          toggle(
            "歌词斜体",
            "italic",
            "默认开启；关闭后保留水波和错位，但主歌词不再倾斜。",
          ),
          toggle(
            "错位字距排版",
            "typography",
            "接近音乐视频字幕的拉开字距效果。",
          ),
          toggle("歌词连线", "connectors", "为上下行添加细线连接。"),
          slider("水波强度", "intensity", 0, 100, "影响文字扰动和背景水光。"),
          slider("行错位", "stagger", 0, 80, "控制上下歌词左右错开的距离。"),
          slider("辉光", "glow", 0, 100, "控制当前歌词行的柔光强度。"),
          h("div", { class: "echo-water-settings-actions" }, [
            h(
              Button,
              {
                variant: "outline",
                size: "xs",
                onClick: () => updateSettings(ctx, DEFAULT_SETTINGS),
              },
              { default: () => "恢复默认" },
            ),
          ]),
        ]);
    },
  });

export async function activate(ctx) {
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, {
    id: "water-lyrics-settings",
  });

  settingsDispose = ctx.ui.settings.define({
    title: "水波歌词动效",
    description: "调整页面歌词的水波、斜体、错位排版和辉光强度。",
    component: createSettingsComponent(ctx),
  });

  effectDispose = ctx.lyricEffects.register({
    id: "water",
    title: "水波歌词",
    scope: "page",
    layer: "decorator",
    className: "echo-water-lyrics",
    css: WATER_EFFECT_CSS,
    mount: mountWaterEffect,
  });
}

export function deactivate() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  effectDispose?.();
  settingsDispose?.();
  settingsStyleDispose?.();
  effectDispose = null;
  settingsDispose = null;
  settingsStyleDispose = null;
  state = null;
  mountedHosts.clear();
}
