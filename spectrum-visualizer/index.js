const STORAGE_KEY = "settings";
const CHANNEL_NAME = "echo-plugin:spectrum-visualizer:settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  showPlayerBar: false,
  showMiniPlayer: false,
  showLyricControls: true,
  showBackdrop: false,
  fps: 15,
  binCount: 64,
  fftSize: 1024,
  smoothing: 72,
  scale: "log",
  mode: "bars",
  palette: "aurora",
  fill: 84,
  opacity: 56,
  lyricHeight: 82,
};

const PALETTES = {
  aurora: ["#42f5b3", "#35b7ff", "#a86dff"],
  ember: ["#ffe08a", "#ff8f4a", "#ff4d7d"],
  ice: ["#e9fbff", "#8ee7ff", "#6d8dff"],
  mono: ["#f7fbff", "#b8c4d6", "#6b7280"],
};

let state = null;
let settingsDispose = null;
let channel = null;
let applyingRemoteSettings = false;
let unsubscribeSpectrum = null;
let animationFrame = 0;
let latestFrame = null;
let lastDrawAt = 0;
let runtimeCtx = null;
let spectrumOptionsKey = "";
let spectrumStatusTimer = 0;
let lastStatusWarningKey = "";

const mountedLayers = new Set();

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const fps = Math.round(Number(source.fps ?? DEFAULT_SETTINGS.fps));
  const binCount = Math.round(
    Number(source.binCount ?? DEFAULT_SETTINGS.binCount),
  );
  const fftSize = Math.round(
    Number(source.fftSize ?? DEFAULT_SETTINGS.fftSize),
  );
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    showPlayerBar: source.showPlayerBar ?? DEFAULT_SETTINGS.showPlayerBar,
    showMiniPlayer: source.showMiniPlayer ?? DEFAULT_SETTINGS.showMiniPlayer,
    showLyricControls:
      source.showLyricControls ?? DEFAULT_SETTINGS.showLyricControls,
    showBackdrop: source.showBackdrop ?? DEFAULT_SETTINGS.showBackdrop,
    fps: [15, 24, 30].includes(fps) ? fps : DEFAULT_SETTINGS.fps,
    binCount: [32, 64, 96, 128].includes(binCount)
      ? binCount
      : DEFAULT_SETTINGS.binCount,
    fftSize: [1024, 2048, 4096, 8192].includes(fftSize)
      ? fftSize
      : DEFAULT_SETTINGS.fftSize,
    smoothing: clamp(source.smoothing ?? DEFAULT_SETTINGS.smoothing, 0, 95),
    scale: ["log", "mel", "linear"].includes(source.scale)
      ? source.scale
      : DEFAULT_SETTINGS.scale,
    mode: ["bars", "wave", "hybrid"].includes(source.mode)
      ? source.mode
      : DEFAULT_SETTINGS.mode,
    palette: ["aurora", "ember", "ice", "mono"].includes(source.palette)
      ? source.palette
      : DEFAULT_SETTINGS.palette,
    fill: clamp(source.fill ?? DEFAULT_SETTINGS.fill, 35, 100),
    opacity: clamp(source.opacity ?? DEFAULT_SETTINGS.opacity, 18, 92),
    lyricHeight: clamp(
      source.lyricHeight ?? DEFAULT_SETTINGS.lyricHeight,
      48,
      150,
    ),
  };
};

const hasVisibleTarget = (settings) =>
  Boolean(
    settings.enabled &&
    document.visibilityState !== "hidden" &&
    (settings.showPlayerBar ||
      settings.showMiniPlayer ||
      settings.showLyricControls),
  );

const toSubscriptionOptions = (settings) => ({
  fps: settings.fps,
  binCount: settings.binCount,
  fftSize: settings.fftSize,
  smoothing: settings.smoothing / 100,
  minFrequency: 20,
  maxFrequency: 20000,
  scale: settings.scale,
  includeWaveform: settings.mode !== "bars",
});

const getStatusLabel = (status) => {
  if (!status) return "未订阅";
  if (status.running) return "捕获中";
  if (status.available) return "待机";
  return "不可用";
};

const setSpectrumStatus = (status) => {
  if (!state) return;
  state.spectrumStatus = status || null;

  const reason = status?.reason || "";
  const warningKey =
    status && !status.running && (!status.available || reason)
      ? `${status.provider}:${reason}`
      : "";
  if (warningKey && warningKey !== lastStatusWarningKey) {
    lastStatusWarningKey = warningKey;
    console.warn("[spectrum-visualizer] 频谱捕获未运行", status);
  } else if (!warningKey) {
    lastStatusWarningKey = "";
  }
};

const refreshSpectrumStatus = async () => {
  if (!state || !runtimeCtx?.audio?.spectrum?.getStatus) return;
  try {
    setSpectrumStatus(await runtimeCtx.audio.spectrum.getStatus());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error || "频谱状态读取失败");
    setSpectrumStatus({
      available: false,
      running: false,
      provider: "unavailable",
      reason: message,
    });
  }
};

const scheduleSpectrumStatusRefresh = (delay = 250) => {
  if (spectrumStatusTimer) window.clearTimeout(spectrumStatusTimer);
  spectrumStatusTimer = window.setTimeout(() => {
    spectrumStatusTimer = 0;
    void refreshSpectrumStatus();
  }, delay);
};

const clearSpectrumStatusRefresh = () => {
  if (spectrumStatusTimer) window.clearTimeout(spectrumStatusTimer);
  spectrumStatusTimer = 0;
};

const getLayerAllowed = (kind, settings) => {
  if (!settings.enabled) return false;
  if (kind === "playerbar") return settings.showPlayerBar;
  if (kind === "mini") return settings.showMiniPlayer;
  if (kind === "lyric") return settings.showLyricControls;
  return false;
};

const hasActiveLayer = (settings) =>
  Array.from(mountedLayers).some(
    (entry) =>
      entry.layer.isConnected &&
      entry.host.isConnected &&
      getLayerAllowed(entry.kind, settings),
  );

const createLayerElement = (kind) => {
  const layer = document.createElement("div");
  layer.className = `echo-spectrum-layer echo-spectrum-${kind}`;
  layer.dataset.kind = kind;
  const canvas = document.createElement("canvas");
  canvas.className = "echo-spectrum-canvas";
  layer.appendChild(canvas);
  return { layer, canvas };
};

const setLayerVariables = (entry) => {
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const opacity = settings.opacity / 100;
  const showBackdrop = Boolean(
    settings.showBackdrop && getLayerAllowed(entry.kind, settings),
  );
  entry.layer.style.setProperty("--echo-spectrum-opacity", String(opacity));
  entry.layer.style.setProperty("--echo-spectrum-fill", `${settings.fill}%`);
  entry.layer.style.setProperty(
    "--echo-spectrum-lyric-height",
    `${settings.lyricHeight}px`,
  );
  entry.layer.dataset.backdrop = showBackdrop ? "true" : "false";
  if (entry.kind !== "lyric") {
    entry.host.classList.toggle("echo-spectrum-backdrop-host", showBackdrop);
  }
};

const removeLayer = (entry) => {
  entry.layer.remove();
  if (entry.host.dataset.echoSpectrumMounted === entry.kind) {
    delete entry.host.dataset.echoSpectrumMounted;
  }
  if (entry.kind !== "lyric") {
    entry.host.classList.remove(`echo-spectrum-${entry.kind}-host`);
    entry.host.classList.remove("echo-spectrum-backdrop-host");
    if (!entry.host.querySelector(".echo-spectrum-layer")) {
      entry.host.classList.remove("echo-spectrum-host");
    }
  }
  mountedLayers.delete(entry);
};

const updateMountedLayers = () => {
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  for (const entry of Array.from(mountedLayers)) {
    if (!entry.layer.isConnected || !entry.host.isConnected) {
      removeLayer(entry);
      continue;
    }
    setLayerVariables(entry);
    entry.layer.hidden = !getLayerAllowed(entry.kind, settings);
  }
  updateRuntimeActivity();
};

const mountLayer = (host, kind, options = {}) => {
  if (!host || host.dataset.echoSpectrumMounted === kind) return null;
  if (
    kind === "lyric" &&
    host.previousElementSibling?.classList?.contains("echo-spectrum-lyric")
  ) {
    return null;
  }
  if (kind !== "lyric" && host.querySelector(":scope > .echo-spectrum-layer")) {
    return null;
  }
  if (options.beforeHost && !host.parentElement) return null;

  const { layer, canvas } = createLayerElement(kind);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return null;

  host.dataset.echoSpectrumMounted = kind;
  if (kind !== "lyric") {
    host.classList.add("echo-spectrum-host", `echo-spectrum-${kind}-host`);
  }

  if (options.beforeHost) {
    host.parentElement?.insertBefore(layer, host);
  } else {
    host.insertBefore(layer, host.firstChild);
  }

  const entry = { kind, host, layer, canvas, context };
  mountedLayers.add(entry);
  setLayerVariables(entry);
  updateMountedLayers();
  return entry;
};

const resizeCanvas = (canvas, context) => {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === width && canvas.height === height) return rect;
  canvas.width = width;
  canvas.height = height;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
};

const makeGradient = (context, width, height, palette) => {
  const colors = PALETTES[palette] || PALETTES.aurora;
  const gradient = context.createLinearGradient(0, height, width, 0);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.52, colors[1]);
  gradient.addColorStop(1, colors[2]);
  return gradient;
};

const appendRoundRect = (context, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
};

const drawBackdrop = (context, width, height, settings, energy, kind) => {
  const colors = PALETTES[settings.palette] || PALETTES.aurora;
  context.save();
  context.globalAlpha = (kind === "lyric" ? 0.18 : 0.24) + energy * 0.14;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.5, "rgba(10, 15, 28, 0.12)");
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
};

const drawBars = (context, width, height, frame, settings, kind) => {
  const bins = frame?.bins || [];
  const count = Math.max(1, bins.length);
  const fillHeight = height * (settings.fill / 100);
  const bottom = kind === "lyric" ? height - 4 : height - 8;
  const top = Math.max(kind === "lyric" ? 8 : 10, bottom - fillHeight);
  const slot = width / count;
  const gap = Math.max(1.1, Math.min(4, slot * 0.22));
  const radius = Math.min(5, Math.max(2, slot * 0.24));
  const gradient = makeGradient(context, width, height, settings.palette);

  context.save();
  context.shadowColor = "rgba(80, 220, 255, 0.14)";
  context.shadowBlur = count > 128 ? 0 : kind === "mini" ? 6 : 8;
  context.fillStyle = gradient;
  context.beginPath();

  for (let index = 0; index < count; index += 1) {
    const value = Math.pow((bins[index] || 0) / 255, 1.35);
    const barHeight = Math.max(2, value * (bottom - top));
    const x = index * slot + gap * 0.5;
    const y = bottom - barHeight;
    const barWidth = Math.max(2, slot - gap);
    appendRoundRect(context, x, y, barWidth, barHeight, radius);
  }
  context.fill();

  context.restore();
};

const drawWave = (context, width, height, frame, settings, alpha = 0.86) => {
  const waveform = frame?.waveform || [];
  if (!waveform.length) return;
  const colors = PALETTES[settings.palette] || PALETTES.aurora;
  const center = height * 0.5;
  const amplitude = height * 0.25 * (settings.fill / 100);

  context.save();
  context.globalAlpha = alpha;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = colors[1];
  context.shadowBlur = 16;
  context.strokeStyle = makeGradient(context, width, height, settings.palette);
  context.beginPath();
  waveform.forEach((sample, index) => {
    const x = (index / Math.max(1, waveform.length - 1)) * width;
    const y = center + clamp(sample, -1, 1) * amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
};

const drawIdle = (context, width, height, settings, time) => {
  const count = Math.min(settings.binCount, 48);
  const slot = width / count;
  const colors = PALETTES[settings.palette] || PALETTES.aurora;
  context.save();
  context.globalAlpha = 0.2;
  context.fillStyle = colors[1];
  context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const wave = 0.5 + 0.5 * Math.sin(time / 700 + index * 0.36);
    const barHeight = 2 + wave * 7;
    const x = index * slot + slot * 0.22;
    appendRoundRect(
      context,
      x,
      height - 12 - barHeight,
      slot * 0.56,
      barHeight,
      2,
    );
  }
  context.fill();
  context.restore();
};

const drawLayer = (entry, time) => {
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  if (!getLayerAllowed(entry.kind, settings) || entry.layer.hidden) return;

  const rect = resizeCanvas(entry.canvas, entry.context);
  const width = rect.width;
  const height = rect.height;
  if (width <= 1 || height <= 1) return;

  const frame = latestFrame;
  const energy = clamp(frame?.rms ?? 0, 0, 1);
  entry.context.clearRect(0, 0, width, height);
  if (settings.showBackdrop) {
    drawBackdrop(entry.context, width, height, settings, energy, entry.kind);
  }

  if (frame && frame.state !== "idle") {
    if (settings.mode === "wave") {
      drawWave(entry.context, width, height, frame, settings, 0.9);
    } else if (settings.mode === "hybrid") {
      drawWave(entry.context, width, height, frame, settings, 0.38);
      drawBars(entry.context, width, height, frame, settings, entry.kind);
    } else {
      drawBars(entry.context, width, height, frame, settings, entry.kind);
    }
  } else {
    drawIdle(entry.context, width, height, settings, time);
  }
};

const draw = (time) => {
  animationFrame = window.requestAnimationFrame(draw);
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const renderFps =
    settings.mode === "hybrid"
      ? Math.min(settings.fps || 15, 30)
      : settings.fps || 15;
  const minInterval = 1000 / Math.max(15, renderFps);
  if (time - lastDrawAt < minInterval) return;
  lastDrawAt = time;

  for (const entry of Array.from(mountedLayers)) {
    if (!entry.layer.isConnected || !entry.host.isConnected) {
      removeLayer(entry);
      continue;
    }
    drawLayer(entry, time);
  }

  if (!hasVisibleTarget(settings) || !hasActiveLayer(settings)) {
    updateRuntimeActivity();
  }
};

const ensureAnimation = () => {
  if (!animationFrame) animationFrame = window.requestAnimationFrame(draw);
};

const stopAnimation = () => {
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastDrawAt = 0;
};

function updateSpectrumSubscription() {
  if (!state || !runtimeCtx) return;
  const settings = state.settings;

  if (!hasVisibleTarget(settings) || !hasActiveLayer(settings)) {
    unsubscribeSpectrum?.();
    unsubscribeSpectrum = null;
    spectrumOptionsKey = "";
    latestFrame = null;
    clearSpectrumStatusRefresh();
    setSpectrumStatus(null);
    return;
  }

  const nextOptions = toSubscriptionOptions(settings);
  const nextOptionsKey = JSON.stringify(nextOptions);
  if (unsubscribeSpectrum && spectrumOptionsKey === nextOptionsKey) return;

  unsubscribeSpectrum?.();
  unsubscribeSpectrum = runtimeCtx.audio.spectrum.subscribe(
    nextOptions,
    (frame) => {
      latestFrame = frame;
      if (!state?.spectrumStatus?.running) {
        setSpectrumStatus({
          available: true,
          running: true,
          provider: "system-loopback",
        });
      }
    },
  );
  spectrumOptionsKey = nextOptionsKey;
  scheduleSpectrumStatusRefresh();
}

function updateRuntimeActivity() {
  if (!state) {
    stopAnimation();
    return;
  }

  updateSpectrumSubscription();

  const shouldRender =
    hasVisibleTarget(state.settings) && hasActiveLayer(state.settings);
  if (shouldRender) ensureAnimation();
  else stopAnimation();
}

const broadcastSettings = () => {
  if (!channel || applyingRemoteSettings || !state) return;
  try {
    channel.postMessage({
      type: "settings",
      settings: normalizeSettings({ ...state.settings }),
    });
  } catch (error) {
    console.warn("[spectrum-visualizer] 同步设置失败", error);
  }
};

const applySettings = async (values, options = {}) => {
  if (!state) return;
  state.settings = normalizeSettings(values);
  updateMountedLayers();
  if (options.broadcast !== false) broadcastSettings();
};

const setupSettingsChannel = () => {
  if (typeof BroadcastChannel !== "function") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const payload = event.data;
    if (!payload || payload.type !== "settings") return;
    applyingRemoteSettings = true;
    void applySettings(payload.settings, { broadcast: false }).finally(() => {
      applyingRemoteSettings = false;
    });
  };
};

const saveSettings = async (ctx, settings) => {
  const normalized = normalizeSettings(settings);
  await ctx.storage.set(STORAGE_KEY, normalized);
  await applySettings(normalized);
  return normalized;
};

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "SpectrumVisualizerSettings",
    setup() {
      const { defineAsyncComponent, h, onUnmounted, ref, watch } = ctx.vue;
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const settings = ctx.vue.ref(normalizeSettings(state?.settings));
      const busy = ref(false);

      const syncFromState = () => {
        settings.value = normalizeSettings(state?.settings);
      };

      const stopWatch = watch(
        () => state?.settings,
        () => {
          if (!busy.value) syncFromState();
        },
        { deep: true },
      );
      if (typeof onUnmounted === "function") {
        onUnmounted(stopWatch);
      } else {
        ctx.dispose(stopWatch);
      }

      const patch = async (value) => {
        settings.value = normalizeSettings({ ...settings.value, ...value });
        busy.value = true;
        try {
          settings.value = await saveSettings(ctx, settings.value);
        } finally {
          busy.value = false;
        }
      };

      const setLocalValue = (key, value) => {
        settings.value = normalizeSettings({
          ...settings.value,
          [key]: value,
        });
      };

      const field = (label, control) =>
        h("div", { class: "echo-spectrum-field" }, [
          h("span", { class: "echo-spectrum-label" }, label),
          control,
        ]);

      const select = (key, options) =>
        h(Select, {
          modelValue: settings.value[key],
          options,
          class: "echo-spectrum-select",
          "onUpdate:modelValue": (value) => patch({ [key]: value }),
        });

      const range = (key, min, max, step = 1, suffix = "") =>
        h(
          "div",
          { class: "echo-spectrum-slider" },
          h(Slider, {
            modelValue: Number(settings.value[key]),
            min,
            max,
            step,
            showValue: true,
            valueSuffix: suffix,
            disabled: busy.value,
            "onUpdate:modelValue": (value) => setLocalValue(key, Number(value)),
            onValueCommit: (value) => patch({ [key]: Number(value) }),
          }),
        );

      const toggle = (key, label, hint = "") =>
        h("div", { class: "echo-spectrum-switch" }, [
          h("span", { class: "echo-spectrum-switch-copy" }, [
            h("strong", label),
            hint ? h("small", hint) : null,
          ]),
          h(Switch, {
            modelValue: Boolean(settings.value[key]),
            disabled: busy.value,
            "onUpdate:modelValue": (value) => patch({ [key]: Boolean(value) }),
          }),
        ]);

      const section = (title, children) =>
        h("section", { class: "echo-spectrum-panel" }, [
          h("h3", title),
          ...children,
        ]);

      return () =>
        h("div", { class: "echo-spectrum-settings" }, [
          section("捕获状态", [
            h(
              "div",
              {
                class: [
                  "echo-spectrum-status",
                  state?.spectrumStatus?.running
                    ? "is-running"
                    : state?.spectrumStatus?.available
                      ? "is-idle"
                      : "is-unavailable",
                ],
              },
              [
                h("strong", getStatusLabel(state?.spectrumStatus)),
                h(
                  "small",
                  state?.spectrumStatus?.reason ||
                    (state?.spectrumStatus?.running
                      ? "正在接收系统音频"
                      : "启用显示位置后自动订阅"),
                ),
              ],
            ),
          ]),
          section("显示位置", [
            h("div", { class: "echo-spectrum-switches" }, [
              toggle("enabled", "启用频谱"),
              toggle("showPlayerBar", "PlayerBar 背景"),
              toggle("showMiniPlayer", "mini 播放器背景"),
              toggle("showLyricControls", "歌词页控制栏上方"),
              toggle(
                "showBackdrop",
                "背景光晕",
                "开启后为频谱额外绘制渐变底色，默认关闭。",
              ),
            ]),
          ]),
          section("视觉参数", [
            h("div", { class: "echo-spectrum-grid" }, [
              field(
                "模式",
                select("mode", [
                  { label: "混合", value: "hybrid" },
                  { label: "柱状", value: "bars" },
                  { label: "波形", value: "wave" },
                ]),
              ),
              field(
                "配色",
                select("palette", [
                  { label: "极光", value: "aurora" },
                  { label: "余烬", value: "ember" },
                  { label: "冰蓝", value: "ice" },
                  { label: "单色", value: "mono" },
                ]),
              ),
              field("不透明度", range("opacity", 18, 92, 1, "%")),
              field("填充高度", range("fill", 35, 100, 1, "%")),
              field("歌词页高度", range("lyricHeight", 48, 150, 1, "px")),
              field(
                "分布",
                select("scale", [
                  { label: "对数", value: "log" },
                  { label: "Mel", value: "mel" },
                  { label: "线性", value: "linear" },
                ]),
              ),
            ]),
          ]),
          section("频谱采样", [
            h("div", { class: "echo-spectrum-grid" }, [
              field(
                "刷新率",
                select("fps", [
                  { label: "15 FPS", value: 15 },
                  { label: "24 FPS", value: 24 },
                  { label: "30 FPS", value: 30 },
                ]),
              ),
              field(
                "柱数",
                select("binCount", [
                  { label: "32", value: 32 },
                  { label: "64", value: 64 },
                  { label: "96", value: 96 },
                  { label: "128", value: 128 },
                ]),
              ),
              field(
                "FFT",
                select("fftSize", [
                  { label: "1024", value: 1024 },
                  { label: "2048", value: 2048 },
                  { label: "4096", value: 4096 },
                  { label: "8192", value: 8192 },
                ]),
              ),
              field("平滑", range("smoothing", 0, 95, 1, "%")),
            ]),
          ]),
        ]);
    },
  });

const registerSettings = (ctx) => {
  settingsDispose?.();
  settingsDispose = ctx.ui.settings.define({
    title: "频谱可视化",
    description: "把当前播放的音频频谱嵌入播放器界面背景。",
    component: createSettingsComponent(ctx),
  });
};

const setupMainRuntime = (ctx) => {
  const disposePlayerBar = ctx.dom.observe(".player-bar", (element) =>
    mountLayer(element, "playerbar"),
  );
  ctx.dispose(disposePlayerBar);

  const disposeLyricBar = ctx.dom.observe(".lyric-bar", (element) =>
    mountLayer(element, "lyric", { beforeHost: true }),
  );
  ctx.dispose(disposeLyricBar);
};

const setupMiniRuntime = (ctx) => {
  const disposeMini = ctx.dom.observe(".mini-card", (element) =>
    mountLayer(element, "mini"),
  );
  ctx.dispose(disposeMini);
};

export async function activate(ctx) {
  runtimeCtx = ctx;
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
    spectrumStatus: null,
  });

  setupSettingsChannel();
  registerSettings(ctx);

  ctx.css.inject(
    `
.echo-spectrum-settings {
  display: grid;
  gap: 16px;
  min-width: 0;
  color: var(--color-text-main, var(--text-main, #f8fafc));
}

.echo-spectrum-panel {
  display: grid;
  gap: 14px;
  border: 1px solid color-mix(in srgb, var(--color-text-main, #f8fafc) 12%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-card-base, #111827) 94%, transparent);
  padding: 14px;
}

.echo-spectrum-panel h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 760;
  line-height: 1.2;
}

.echo-spectrum-status {
  display: grid;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--color-text-main, #f8fafc) 10%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--control-muted-bg, rgba(148, 163, 184, 0.12)) 78%, transparent);
  padding: 10px 12px;
}

.echo-spectrum-status strong {
  color: var(--color-text-main, var(--text-main, #f8fafc));
  font-size: 13px;
  font-weight: 760;
  line-height: 1.35;
}

.echo-spectrum-status small {
  color: var(--color-text-secondary, var(--text-secondary, rgba(148, 163, 184, 0.9)));
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.echo-spectrum-status.is-running {
  border-color: color-mix(in srgb, #42f5b3 34%, transparent);
  background: color-mix(in srgb, #42f5b3 10%, transparent);
}

.echo-spectrum-status.is-unavailable {
  border-color: color-mix(in srgb, #ff4d7d 34%, transparent);
  background: color-mix(in srgb, #ff4d7d 10%, transparent);
}

.echo-spectrum-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.echo-spectrum-field {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.echo-spectrum-label,
.echo-spectrum-switch strong {
  color: var(--color-text-main, var(--text-main, #f8fafc));
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.echo-spectrum-switch small {
  color: var(--color-text-secondary, var(--text-secondary, rgba(148, 163, 184, 0.9)));
  font-size: 11px;
  line-height: 1.35;
}

.echo-spectrum-select {
  width: 100%;
  min-width: 0;
  justify-content: space-between;
}

.echo-spectrum-slider {
  min-width: 0;
  width: 100%;
}

.echo-spectrum-slider .slider-wrapper {
  width: 100%;
}

.echo-spectrum-switches {
  display: grid;
  gap: 8px;
}

.echo-spectrum-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 46px;
  border: 1px solid color-mix(in srgb, var(--color-text-main, #f8fafc) 10%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--control-muted-bg, rgba(148, 163, 184, 0.12)) 74%, transparent);
  padding: 10px 12px;
}

.echo-spectrum-switch-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.echo-spectrum-host {
  position: relative;
  overflow: hidden;
}

.echo-spectrum-layer {
  --echo-spectrum-opacity: 0.56;
  pointer-events: none;
  user-select: none;
  opacity: var(--echo-spectrum-opacity);
}

.echo-spectrum-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.echo-spectrum-playerbar,
.echo-spectrum-mini {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.echo-spectrum-playerbar[data-backdrop="true"] canvas,
.echo-spectrum-mini[data-backdrop="true"] canvas {
  background:
    linear-gradient(180deg, rgba(8, 12, 22, 0.18), rgba(8, 12, 22, 0.04)),
    transparent;
}

.echo-spectrum-playerbar-host > :not(.echo-spectrum-layer),
.echo-spectrum-mini-host > :not(.echo-spectrum-layer) {
  position: relative;
  z-index: 1;
}

.echo-spectrum-lyric {
  position: relative;
  z-index: 4;
  flex: 0 0 var(--echo-spectrum-lyric-height);
  width: 100%;
  height: var(--echo-spectrum-lyric-height);
  margin-top: -8px;
  overflow: hidden;
  background: transparent;
}

.echo-spectrum-lyric[data-backdrop="true"] {
  background:
    linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.1) 100%),
    transparent;
}

.echo-spectrum-lyric::before,
.echo-spectrum-lyric::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  z-index: 1;
  pointer-events: none;
}

.echo-spectrum-lyric::before {
  top: 0;
  height: 26px;
  background: transparent;
}

.echo-spectrum-lyric::after {
  bottom: 0;
  height: 22px;
  background: transparent;
}

.echo-spectrum-lyric[data-backdrop="true"]::after {
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.16));
}

.mini-card.echo-spectrum-mini-host.echo-spectrum-backdrop-host {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.88)),
    #f5f5f5;
}

.dark .mini-card.echo-spectrum-mini-host.echo-spectrum-backdrop-host {
  background:
    linear-gradient(180deg, rgba(24, 27, 34, 0.8), rgba(24, 27, 34, 0.9)),
    #181b22;
}

@media (max-width: 640px) {
  .echo-spectrum-grid {
    grid-template-columns: 1fr;
  }
}
`,
    { id: "runtime" },
  );

  setupMainRuntime(ctx);
  setupMiniRuntime(ctx);
  document.addEventListener("visibilitychange", updateRuntimeActivity);

  updateRuntimeActivity();

  ctx.dispose(() => {
    document.removeEventListener("visibilitychange", updateRuntimeActivity);
    unsubscribeSpectrum?.();
    unsubscribeSpectrum = null;
    spectrumOptionsKey = "";
    clearSpectrumStatusRefresh();
    stopAnimation();
    channel?.close();
    channel = null;
    for (const entry of Array.from(mountedLayers)) removeLayer(entry);
    settingsDispose?.();
    settingsDispose = null;
    state = null;
    runtimeCtx = null;
  });
}

export function deactivate() {
  document.removeEventListener("visibilitychange", updateRuntimeActivity);
  unsubscribeSpectrum?.();
  unsubscribeSpectrum = null;
  spectrumOptionsKey = "";
  clearSpectrumStatusRefresh();
  stopAnimation();
  channel?.close();
  channel = null;
  for (const entry of Array.from(mountedLayers)) removeLayer(entry);
  settingsDispose?.();
  settingsDispose = null;
  state = null;
  runtimeCtx = null;
}
