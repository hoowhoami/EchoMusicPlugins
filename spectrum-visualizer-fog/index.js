const STORAGE_KEY = "echo-plugin:fog-visualizer:settings";
const CHANNEL_NAME = "echo-plugin:fog-visualizer:channel";

const DEFAULT_SETTINGS = {
  enabled: true,
  showPlayerBar: false,
  showLyricControls: true,
  showMiniPlayer: true, 
  height: 120,
  opacity: 85,
  palette: "sky",
  binCount: 40
};

const PALETTES = {
  sky: "135, 206, 235",
  aurora: "53, 183, 255",
  ember: "255, 143, 74",
  ice: "142, 231, 255",
  mono: "184, 196, 214",
};

let state = null;
let unsubscribeSpectrum = null;
let animationFrame = 0;
let latestFrame = null;
let runtimeCtx = null;
let channel = null;
let applyingRemoteSettings = false;

const mountedLayers = new Set();

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    enabled: source.enabled ?? DEFAULT_SETTINGS.enabled,
    showPlayerBar: source.showPlayerBar ?? DEFAULT_SETTINGS.showPlayerBar,
    showLyricControls: source.showLyricControls ?? DEFAULT_SETTINGS.showLyricControls,
    showMiniPlayer: source.showMiniPlayer ?? DEFAULT_SETTINGS.showMiniPlayer,
    height: clamp(source.height ?? DEFAULT_SETTINGS.height, 30, 400),
    opacity: clamp(source.opacity ?? DEFAULT_SETTINGS.opacity, 10, 100),
    palette: PALETTES[source.palette] ? source.palette : DEFAULT_SETTINGS.palette,
  };
};

const getLayerAllowed = (kind, settings) => {
  if (!settings.enabled) return false;
  if (kind === "playerbar") return settings.showPlayerBar;
  if (kind === "lyric") return settings.showLyricControls;
  if (kind === "mini") return settings.showMiniPlayer;
  return false;
};

const updateLayerStyles = () => {
  if (!state) return;
  const settings = state.settings;
  const rgb = PALETTES[settings.palette] || PALETTES.sky;
  
  for (const entry of Array.from(mountedLayers)) {
    if (!entry.container.isConnected) continue;
    
    entry.container.style.display = getLayerAllowed(entry.kind, settings) ? 'flex' : 'none';
    entry.container.style.setProperty('--fog-rgb', rgb);
    entry.container.style.height = `${settings.height}px`;
  }
};

const mountLayer = (host, kind) => {
  if (!host || host.dataset.echoFogMounted === kind) return null;

  const container = document.createElement("div");
  container.className = `echo-fog-container echo-fog-${kind}`;

  const bars = [];
  const binCount = state?.settings?.binCount || 40;
  for (let i = 0; i < binCount; i++) {
    const bar = document.createElement("div");
    bar.className = "echo-fog-bar";
    bar.dataset.delay = String(Math.random() * -8);
    bars.push(bar);
    container.appendChild(bar);
  }

  host.dataset.echoFogMounted = kind;
  host.insertBefore(container, host.firstChild);
  host.classList.add("echo-fog-host");

  const entry = { kind, host, container, bars };
  mountedLayers.add(entry);
  updateLayerStyles();
  return entry;
};

const removeLayer = (entry) => {
  entry.container.remove();
  if (entry.host.dataset.echoFogMounted === entry.kind) {
    delete entry.host.dataset.echoFogMounted;
  }
  entry.host.classList.remove("echo-fog-host");
  mountedLayers.delete(entry);
};

const draw = (time) => {
  animationFrame = window.requestAnimationFrame(draw);
  if (!state || !state.settings.enabled) return;

  const settings = state.settings;
  const frame = latestFrame;
  const isIdle = !frame || frame.state === "idle" || (frame.rms || 0) < 0.001;
  const bins = frame?.bins || [];

  for (const entry of Array.from(mountedLayers)) {
    if (!entry.container.isConnected || !entry.host.isConnected) {
      removeLayer(entry);
      continue;
    }
    
    if (entry.container.style.display === 'none') continue;

    if (isIdle) {
      entry.container.style.opacity = '0';
      continue;
    } else {
      entry.container.style.opacity = String(settings.opacity / 100);
    }

    const barCount = entry.bars.length;
    for (let i = 0; i < barCount; i++) {
      const bar = entry.bars[i];
      const delay = parseFloat(bar.dataset.delay);

      let audioValue = 0;
      if (bins.length > 0) {
        const binIndex = Math.floor((i / barCount) * bins.length);
        audioValue = Math.pow((bins[binIndex] || 0) / 255, 1.35);
      }

      const wave = (Math.sin(time / 1000 + delay) * 0.5 + 0.5) * 0.15;
      const finalScale = clamp(0.1 + audioValue * 0.85 + wave, 0.05, 1.0);
      
      bar.style.transform = `scaleY(${finalScale})`;
    }
  }
};

function updateSpectrumSubscription() {
  if (!state || !runtimeCtx || !state.settings.enabled) {
    unsubscribeSpectrum?.();
    unsubscribeSpectrum = null;
    latestFrame = null;
    return;
  }
  if (unsubscribeSpectrum) return;

  unsubscribeSpectrum = runtimeCtx.audio.spectrum.subscribe(
    {
      fps: 30,
      binCount: state.settings.binCount,
      fftSize: 2048,
      smoothing: 0.75,
      minFrequency: 20,
      maxFrequency: 20000,
      scale: "log",
      includeWaveform: false,
    },
    (frame) => { latestFrame = frame; }
  );
}

const broadcastSettings = (settings) => {
  if (!channel || applyingRemoteSettings) return;
  try {
    channel.postMessage({ type: "settings", settings });
  } catch (error) {
    console.warn("[fog-visualizer] 跨窗口同步设置失败", error);
  }
};

const setupSettingsChannel = () => {
  if (typeof BroadcastChannel !== "function") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    const payload = event.data;
    if (!payload || payload.type !== "settings") return;
    
    applyingRemoteSettings = true;
    state.settings = normalizeSettings(payload.settings);
    updateLayerStyles();
    updateSpectrumSubscription();
    applyingRemoteSettings = false;
  };
};

const saveSettings = async (ctx, settings) => {
  const normalized = normalizeSettings(settings);
  await ctx.storage.set(STORAGE_KEY, normalized);
  state.settings = normalized;
  updateLayerStyles();
  updateSpectrumSubscription();
  broadcastSettings(normalized); // 【核心】：把最新的设置发给 Mini 窗口
  return normalized;
};

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "FogVisualizerSettings",
    setup() {
      const { defineAsyncComponent, h, onUnmounted, ref, watch } = ctx.vue;
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const settings = ref(normalizeSettings(state?.settings));

      const stopWatch = watch(() => state?.settings, () => {
        settings.value = normalizeSettings(state?.settings);
      }, { deep: true });
      ctx.dispose ? ctx.dispose(stopWatch) : onUnmounted(stopWatch);

      const patch = (value) => saveSettings(ctx, { ...settings.value, ...value });

      const field = (label, control) => h("div", { style: "display: grid; gap: 8px; margin-bottom: 12px;" }, [
        h("span", { style: "font-weight: bold; font-size: 13px;" }, label), control
      ]);
      const toggle = (key, label) => h("div", { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 10px; background: rgba(148, 163, 184, 0.05); border-radius: 8px;" }, [
        h("span", { style: "font-size: 13px;" }, label),
        h(Switch, {
          modelValue: Boolean(settings.value[key]),
          "onUpdate:modelValue": (v) => patch({ [key]: Boolean(v) }),
        }),
      ]);

      return () => h("div", { style: "color: var(--text-main, #f8fafc);" }, [
        toggle("enabled", "⚡ 开启全局迷雾频谱"),
        
        h("div", { style: "margin: 16px 0; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;" }, [
          h("strong", { style: "display: block; margin-bottom: 12px; color: #87CEEB;" }, "显示位置控制"),
          toggle("showLyricControls", "播放页"),
          toggle("showMiniPlayer", "mini模式 "),
          toggle("showPlayerBar", "主界面"),
        ]),

        field("主题配色", h(Select, {
          modelValue: settings.value.palette,
          options: [
            { label: "天蓝 ", value: "sky" },
            { label: "极光 ", value: "aurora" },
            { label: "余烬 ", value: "ember" },
            { label: "冰封 ", value: "ice" },
            { label: "单色 ", value: "mono" },
          ],
          "onUpdate:modelValue": (v) => patch({ palette: v }),
        })),
        field("迷雾最大高度", h(Slider, {
          modelValue: Number(settings.value.height), min: 30, max: 400, step: 5, showValue: true, valueSuffix: "px",
          "onUpdate:modelValue": (v) => patch({ height: Number(v) }), 
        })),
        field("不透明度", h(Slider, {
          modelValue: Number(settings.value.opacity), min: 10, max: 100, step: 1, showValue: true, valueSuffix: "%",
          "onUpdate:modelValue": (v) => patch({ opacity: Number(v) }), 
        })),
      ]);
    },
  });

// --- 生命周期与挂载 ---
const setupRuntimes = (ctx) => {
  const disposePlayerBar = ctx.dom.observe('.player-bar', (element) => mountLayer(element, 'playerbar'));
  ctx.dispose(disposePlayerBar);

  const disposeLyricBar = ctx.dom.observe('.lyric-bar', (element) => mountLayer(element, 'lyric'));
  ctx.dispose(disposeLyricBar);

  const disposeMini = ctx.dom.observe('.mini-card', (element) => mountLayer(element, 'mini'));
  ctx.dispose(disposeMini);
};

export async function activate(ctx) {
  runtimeCtx = ctx;
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  setupSettingsChannel(); // 启用跨窗口通讯

  ctx.css.inject(`
    .echo-fog-host {
      position: relative;
    }
    
    .echo-fog-container {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      display: flex;
      align-items: flex-end;
      pointer-events: none; /* 穿透鼠标 */
      z-index: 0; /* 沉入最底层 */
      transition: opacity 0.4s ease, height 0.1s ease;
    }

    .echo-fog-bar {
      flex: 1;
      height: 100%;
      margin: 0 -2px;
      background: linear-gradient(to top, rgba(var(--fog-rgb), 0.8), rgba(var(--fog-rgb), 0.05));
      border-radius: 50% 50% 0 0;
      filter: blur(10px);
      transform-origin: bottom;
      transform: scaleY(0.1);
      will-change: transform;
    }

    .echo-fog-host > :not(.echo-fog-container) {
      position: relative;
      z-index: 2;
    }
  `, { id: "fog-runtime" });

  ctx.ui.settings.define({
    title: "底部原生呼吸迷雾频谱",
    description: "完美还原天蓝色迷雾HTML特效。",
    component: createSettingsComponent(ctx),
  });

  setupRuntimes(ctx);
  updateSpectrumSubscription();
  animationFrame = window.requestAnimationFrame(draw);

  ctx.dispose(() => deactivate());
}

export function deactivate() {
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  unsubscribeSpectrum?.();
  unsubscribeSpectrum = null;
  channel?.close();
  channel = null;
  for (const entry of Array.from(mountedLayers)) removeLayer(entry);
  state = null;
  runtimeCtx = null;
}