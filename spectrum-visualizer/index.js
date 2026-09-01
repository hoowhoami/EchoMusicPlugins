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
  palette: "theme",
  fill: 84,
  opacity: 56,
  lyricHeight: 82,
  mistIntensity: 78,
  mistSoftness: 72,
  mistMotion: 42,
  centeredBarWidth: 2,
};

const PALETTES = {
  theme: ["#0071e3", "#5ac8fa", "#7c6cff"],
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
    mode: ["bars", "wave", "hybrid", "mist", "centered"].includes(source.mode)
      ? source.mode
      : DEFAULT_SETTINGS.mode,
    palette: ["theme", "aurora", "ember", "ice", "mono"].includes(
      source.palette,
    )
      ? source.palette
      : DEFAULT_SETTINGS.palette,
    fill: clamp(source.fill ?? DEFAULT_SETTINGS.fill, 35, 100),
    opacity: clamp(source.opacity ?? DEFAULT_SETTINGS.opacity, 18, 92),
    lyricHeight: clamp(
      source.lyricHeight ?? DEFAULT_SETTINGS.lyricHeight,
      48,
      150,
    ),
    mistIntensity: clamp(
      source.mistIntensity ?? DEFAULT_SETTINGS.mistIntensity,
      35,
      100,
    ),
    mistSoftness: clamp(
      source.mistSoftness ?? DEFAULT_SETTINGS.mistSoftness,
      20,
      100,
    ),
    mistMotion: clamp(source.mistMotion ?? DEFAULT_SETTINGS.mistMotion, 0, 100),
    centeredBarWidth: clamp(
      source.centeredBarWidth ?? DEFAULT_SETTINGS.centeredBarWidth,
      1,
      8,
    ),
  };
};

const getDefaultSettings = () => normalizeSettings({ ...DEFAULT_SETTINGS });

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
  binCount:
    settings.mode === "centered"
      ? Math.max(128, settings.binCount)
      : settings.binCount,
  fftSize: settings.fftSize,
  smoothing: settings.smoothing / 100,
  minFrequency: 20,
  maxFrequency: 20000,
  scale: settings.scale,
  includeWaveform: ["wave", "hybrid"].includes(settings.mode),
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
  entry.layer.dataset.mode = settings.mode;
  entry.layer.dataset.backdrop = showBackdrop ? "true" : "false";
  if (entry.kind !== "lyric") {
    entry.host.classList.toggle("echo-spectrum-backdrop-host", showBackdrop);
  }
};

const releaseLayerResources = (entry) => {
  if (!entry || entry.resourcesReleased) return false;
  entry.resourcesReleased = true;
  entry.centeredDisplay = null;
  entry.paletteCache = null;
  if (entry.canvas) {
    entry.canvas.width = 1;
    entry.canvas.height = 1;
  }
  return true;
};

const removeLayer = (entry) => {
  if (!entry || entry.removed) return;
  entry.removed = true;
  releaseLayerResources(entry);
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
  const colors = Array.isArray(palette)
    ? palette
    : PALETTES[palette] || PALETTES.theme;
  const gradient = context.createLinearGradient(0, height, width, 0);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.52, colors[1]);
  gradient.addColorStop(1, colors[2]);
  return gradient;
};

const resolvePaletteColors = (palette, element) => {
  const fallback = PALETTES[palette] || PALETTES.theme;
  if (
    palette !== "theme" ||
    !element ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return fallback;
  }

  const computed = window.getComputedStyle(element);
  const readColor = (...names) => {
    for (const name of names) {
      const value = computed.getPropertyValue(name).trim();
      if (value && !value.includes("var(")) return value;
    }
    return "";
  };
  const primary =
    readColor("--color-primary", "--color-primary-root") || fallback[0];
  const secondary =
    readColor("--color-secondary", "--color-primary-hover") || fallback[1];
  const tertiary =
    readColor("--color-primary-hover", "--color-primary-dark") || fallback[2];
  return [primary, secondary, tertiary];
};

const getLayerPalette = (entry, settings, time) => {
  if (settings.palette !== "theme") {
    return PALETTES[settings.palette] || PALETTES.theme;
  }
  const cached = entry.paletteCache;
  if (cached && time - cached.at < 500) return cached.colors;
  const colors = resolvePaletteColors(settings.palette, entry.host);
  entry.paletteCache = { at: time, colors };
  return colors;
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

const drawBackdrop = (
  context,
  width,
  height,
  settings,
  energy,
  kind,
  colors,
) => {
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

const drawBars = (context, width, height, frame, settings, kind, colors) => {
  const bins = frame?.bins || [];
  const count = Math.max(1, bins.length);
  const fillHeight = height * (settings.fill / 100);
  const bottom = kind === "lyric" ? height - 4 : height - 8;
  const top = Math.max(kind === "lyric" ? 8 : 10, bottom - fillHeight);
  const slot = width / count;
  const gap = Math.max(1.1, Math.min(4, slot * 0.22));
  const radius = Math.min(5, Math.max(2, slot * 0.24));
  const gradient = makeGradient(context, width, height, colors);

  context.save();
  context.shadowColor = "rgba(80, 220, 255, 0.14)";
  context.shadowBlur = count > 128 ? 0 : kind === "mini" ? 6 : 8;
  context.fillStyle = gradient;
  context.beginPath();

  for (let index = 0; index < count; index += 1) {
    const value = Math.pow(clamp(bins[index] || 0, 0, 1), 1.35);
    const barHeight = Math.max(2, value * (bottom - top));
    const x = index * slot + gap * 0.5;
    const y = bottom - barHeight;
    const barWidth = Math.max(2, slot - gap);
    appendRoundRect(context, x, y, barWidth, barHeight, radius);
  }
  context.fill();

  context.restore();
};

const buildCenteredProfile = (bins, barCount) => {
  const count = Math.round(clamp(barCount, 2, 512));
  const source = Array.from(bins || [], (value) => clamp(value, 0, 1));
  if (!source.length) return Array.from({ length: count }, () => 0);

  const sampleAt = (position) => {
    const bounded = clamp(position, 0, source.length - 1);
    const lower = Math.floor(bounded);
    const upper = Math.min(source.length - 1, lower + 1);
    const fraction = bounded - lower;
    return source[lower] + (source[upper] - source[lower]) * fraction;
  };

  return Array.from({ length: count }, (_, index) => {
    const progress = index / Math.max(1, count - 1);
    const frequencyPosition = Math.abs(progress * 2 - 1) * (source.length - 1);
    return clamp(
      (sampleAt(frequencyPosition - 0.65) +
        sampleAt(frequencyPosition) * 2 +
        sampleAt(frequencyPosition + 0.65)) /
        4,
      0,
      1,
    );
  });
};

const getCenteredBarLayout = (width, requestedBarWidth = 2, gap = 3) => {
  const barWidth = clamp(requestedBarWidth, 1, 8);
  const safeGap = clamp(gap, 1, 8);
  const count = Math.min(
    512,
    Math.max(2, Math.floor(Math.max(0, width) / (barWidth + safeGap))),
  );
  const slotWidth = Math.max(0, width) / count;
  return {
    count,
    slotWidth,
    barWidth: Math.min(barWidth, Math.max(1, slotWidth - 1)),
  };
};

const updateCenteredDisplay = (previous, target, attack = 0.4, decay = 0.88) =>
  target.map((value, index) => {
    const current = clamp(previous?.[index] ?? 0, 0, 1);
    return value > current
      ? current + (value - current) * attack
      : current * decay + value * (1 - decay);
  });

const drawCentered = (entry, width, height, frame, settings, colors) => {
  const { count, slotWidth, barWidth } = getCenteredBarLayout(
    width,
    settings.centeredBarWidth,
  );
  const target = buildCenteredProfile(frame?.bins, count);
  entry.centeredDisplay = updateCenteredDisplay(entry.centeredDisplay, target);

  const bottom = entry.kind === "lyric" ? height - 4 : height - 8;
  const fillHeight = height * (settings.fill / 100);

  entry.context.save();
  entry.context.globalAlpha = 0.65;
  entry.context.fillStyle = colors[0];
  entry.context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const barHeight = entry.centeredDisplay[index] * fillHeight;
    if (barHeight <= 0.5) continue;
    const x = index * slotWidth + (slotWidth - barWidth) * 0.5;
    appendRoundRect(
      entry.context,
      x,
      bottom - barHeight,
      barWidth,
      barHeight,
      2,
    );
  }
  entry.context.fill();
  entry.context.restore();
};

const drawWave = (
  context,
  width,
  height,
  frame,
  settings,
  alpha = 0.86,
  colors = PALETTES.theme,
) => {
  const waveform = frame?.waveform || [];
  if (!waveform.length) return;
  const center = height * 0.5;
  const amplitude = height * 0.25 * (settings.fill / 100);

  context.save();
  context.globalAlpha = alpha;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = colors[1];
  context.shadowBlur = 16;
  context.strokeStyle = makeGradient(context, width, height, colors);
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

const buildMistProfile = (bins, pointCount = 28) => {
  const count = Math.round(clamp(pointCount, 8, 64));
  const source = Array.from(bins || [], (value) => clamp(value, 0, 1));
  if (!source.length) return Array.from({ length: count }, () => 0);

  const profile = Array.from({ length: count }, (_, index) => {
    const center = (index / Math.max(1, count - 1)) * (source.length - 1);
    const radius = Math.max(1, (source.length / count) * 1.8);
    const from = Math.max(0, Math.floor(center - radius));
    const to = Math.min(source.length - 1, Math.ceil(center + radius));
    let weighted = 0;
    let weightTotal = 0;

    for (let sourceIndex = from; sourceIndex <= to; sourceIndex += 1) {
      const distance = Math.abs(sourceIndex - center) / radius;
      const weight = Math.max(0, 1 - distance * 0.72);
      weighted += source[sourceIndex] * weight;
      weightTotal += weight;
    }

    return Math.pow(weighted / Math.max(weightTotal, 1), 0.78);
  });

  return profile.map((value, index) => {
    const previous = profile[Math.max(0, index - 1)];
    const next = profile[Math.min(profile.length - 1, index + 1)];
    return clamp(previous * 0.2 + value * 0.6 + next * 0.2, 0, 1);
  });
};

const appendMistPath = (
  context,
  profile,
  width,
  baseline,
  fillHeight,
  layer,
  phase,
  motion,
  idle,
) => {
  const padding = Math.max(18, width * 0.035);
  const span = width + padding * 2;
  const points = profile.map((value, index) => {
    const progress = index / Math.max(1, profile.length - 1);
    const x = -padding + progress * span;
    const drift =
      Math.sin(
        progress * Math.PI * (2.4 + layer.index * 0.35) + phase + layer.phase,
      ) *
      (0.018 + motion * 0.035);
    const ambient = idle ? 0.075 : 0.025;
    const level = ambient + value * layer.scale + drift;
    return { x, y: baseline - fillHeight * clamp(level, 0.02, 1) };
  });

  context.beginPath();
  context.moveTo(-padding, baseline + padding);
  context.lineTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const midpointX = (previous.x + point.x) * 0.5;
    const midpointY = (previous.y + point.y) * 0.5;
    context.quadraticCurveTo(previous.x, previous.y, midpointX, midpointY);
  }
  const last = points[points.length - 1];
  context.quadraticCurveTo(last.x, last.y, width + padding, last.y);
  context.lineTo(width + padding, baseline + padding);
  context.closePath();
};

const getMistRenderLayers = (settings, energy = 0) => {
  const intensity = clamp(settings.mistIntensity, 35, 100) / 100;
  const softness = clamp(settings.mistSoftness, 20, 100) / 100;
  const signal = clamp(energy, 0, 1);
  return [
    { index: 0, scale: 0.58, alpha: 0.48, phase: 0.3, blur: 1.05 },
    { index: 1, scale: 0.78, alpha: 0.36, phase: 2.2, blur: 0.72 },
    { index: 2, scale: 0.98, alpha: 0.28, phase: 4.4, blur: 0.42 },
  ].map((layer) => ({
    ...layer,
    alpha: (layer.alpha + signal * 0.12) * intensity,
    blur: Math.round((3 + softness * 11) * layer.blur),
  }));
};

const drawMist = (
  context,
  width,
  height,
  frame,
  settings,
  kind,
  time,
  idle = false,
  colors = PALETTES.theme,
) => {
  const pointCount = Math.round(clamp(width / 18, 18, 44));
  const profile = buildMistProfile(idle ? [] : frame?.bins, pointCount);
  const energy = clamp(frame?.rms ?? 0, 0, 1);
  const fillHeight = height * (settings.fill / 100);
  const baseline = kind === "lyric" ? height + 4 : height + 8;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  )?.matches;
  const motion = reduceMotion ? 0 : settings.mistMotion / 100;
  const phase = (time / 1000) * motion * 0.9;
  const layers = getMistRenderLayers(settings, energy);

  context.save();
  context.globalCompositeOperation = "screen";
  for (const layer of layers) {
    const gradient = context.createLinearGradient(0, baseline, width, 0);
    gradient.addColorStop(0, colors[layer.index % colors.length]);
    gradient.addColorStop(0.5, colors[(layer.index + 1) % colors.length]);
    gradient.addColorStop(1, colors[(layer.index + 2) % colors.length]);
    context.save();
    context.globalAlpha = layer.alpha;
    context.filter = `blur(${layer.blur}px)`;
    context.fillStyle = gradient;
    appendMistPath(
      context,
      profile,
      width,
      baseline,
      fillHeight,
      layer,
      phase,
      motion,
      idle,
    );
    context.fill();
    context.restore();
  }
  context.restore();
};

const drawIdle = (context, width, height, settings, time, colors) => {
  const count = Math.min(settings.binCount, 48);
  const slot = width / count;
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
  const colors = getLayerPalette(entry, settings, time);
  entry.context.clearRect(0, 0, width, height);
  if (settings.showBackdrop) {
    drawBackdrop(
      entry.context,
      width,
      height,
      settings,
      energy,
      entry.kind,
      colors,
    );
  }

  if (frame && frame.state !== "idle") {
    if (settings.mode === "mist") {
      drawMist(
        entry.context,
        width,
        height,
        frame,
        settings,
        entry.kind,
        time,
        false,
        colors,
      );
    } else if (settings.mode === "centered") {
      drawCentered(entry, width, height, frame, settings, colors);
    } else if (settings.mode === "wave") {
      drawWave(entry.context, width, height, frame, settings, 0.9, colors);
    } else if (settings.mode === "hybrid") {
      drawWave(entry.context, width, height, frame, settings, 0.38, colors);
      drawBars(
        entry.context,
        width,
        height,
        frame,
        settings,
        entry.kind,
        colors,
      );
    } else {
      drawBars(
        entry.context,
        width,
        height,
        frame,
        settings,
        entry.kind,
        colors,
      );
    }
  } else if (settings.mode === "mist") {
    drawMist(
      entry.context,
      width,
      height,
      frame,
      settings,
      entry.kind,
      time,
      true,
      colors,
    );
  } else if (settings.mode !== "centered") {
    drawIdle(entry.context, width, height, settings, time, colors);
  }
};

const draw = (time) => {
  animationFrame = window.requestAnimationFrame(draw);
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const renderFps =
    settings.mode === "mist"
      ? Math.min(settings.fps || 15, 24)
      : settings.mode === "hybrid"
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
          provider: "player",
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
      const Button = defineAsyncComponent(ctx.ui.components.Button);
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

      const reset = async () => {
        busy.value = true;
        try {
          settings.value = await saveSettings(ctx, getDefaultSettings());
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

      const copy = (label, hint = "") =>
        h("span", { class: "echo-spectrum-field-copy" }, [
          h("strong", label),
          hint ? h("small", hint) : null,
        ]);

      const field = (label, control, hint = "") =>
        h("div", { class: "echo-spectrum-field" }, [
          copy(label, hint),
          control,
        ]);

      const select = (key, options) =>
        h(Select, {
          modelValue: settings.value[key],
          options,
          class: "echo-spectrum-select",
          disabled: busy.value,
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
          copy(label, hint),
          h(Switch, {
            modelValue: Boolean(settings.value[key]),
            disabled: busy.value,
            "onUpdate:modelValue": (value) => patch({ [key]: Boolean(value) }),
          }),
        ]);

      const section = (title, description, children) =>
        h("section", { class: "echo-spectrum-panel" }, [
          h("header", { class: "echo-spectrum-section-heading" }, [
            h("h3", title),
            h("p", description),
          ]),
          h("div", { class: "echo-spectrum-section-body" }, children),
        ]);

      return () => {
        const status = state?.spectrumStatus;
        const statusClass = status?.running
          ? "is-running"
          : !status || status?.available
            ? "is-idle"
            : "is-unavailable";
        const visualFields = [
          field(
            "频谱样式",
            select("mode", [
              { label: "雾状", value: "mist" },
              { label: "中心频谱", value: "centered" },
              { label: "混合", value: "hybrid" },
              { label: "柱状", value: "bars" },
              { label: "波形", value: "wave" },
            ]),
            "切换频谱的绘制语言",
          ),
          field(
            "色彩主题",
            select("palette", [
              { label: "跟随主程序", value: "theme" },
              { label: "极光", value: "aurora" },
              { label: "余烬", value: "ember" },
              { label: "冰蓝", value: "ice" },
              { label: "单色", value: "mono" },
            ]),
            "应用到频谱与背景光晕",
          ),
          field("不透明度", range("opacity", 18, 92, 1, "%"), "控制整体存在感"),
          field(
            "填充高度",
            range("fill", 35, 100, 1, "%"),
            "频谱可使用的垂直空间",
          ),
          field(
            "歌词页高度",
            range("lyricHeight", 48, 150, 1, "px"),
            "歌词控制栏上方的频谱区域",
          ),
        ];

        if (settings.value.mode === "mist") {
          visualFields.splice(
            1,
            0,
            field(
              "雾气浓度",
              range("mistIntensity", 35, 100, 1, "%"),
              "控制雾带的可见程度",
            ),
            field(
              "雾化柔度",
              range("mistSoftness", 20, 100, 1, "%"),
              "数值越高，雾带边缘越柔和",
            ),
            field(
              "流动速度",
              range("mistMotion", 0, 100, 1, "%"),
              "只影响漂移速度，不影响音频响应",
            ),
          );
        }

        if (settings.value.mode === "centered") {
          visualFields.splice(
            1,
            0,
            field(
              "频谱条宽度",
              range("centeredBarWidth", 1, 8, 1, "px"),
              "数值越小，柱条越细密",
            ),
          );
        }

        return h("div", { class: "echo-spectrum-settings" }, [
          h("section", { class: "echo-spectrum-overview" }, [
            h("div", { class: "echo-spectrum-mark", "aria-hidden": "true" }, [
              h("i"),
              h("i"),
              h("i"),
              h("i"),
              h("i"),
            ]),
            h("div", { class: "echo-spectrum-overview-copy" }, [
              h("h3", "让频谱融入播放器"),
              h(
                "p",
                status?.reason ||
                  (status?.running
                    ? "正在根据当前播放音频的频谱数据实时绘制"
                    : "开启任一显示位置后，将按需订阅当前播放音频的频谱数据"),
              ),
            ]),
            h("span", { class: ["echo-spectrum-status", statusClass] }, [
              h("i"),
              getStatusLabel(status),
            ]),
          ]),
          section("显示位置", "选择频谱参与界面的范围", [
            toggle("enabled", "启用频谱", "关闭后停止订阅与绘制"),
            toggle("showPlayerBar", "播放栏背景"),
            toggle("showMiniPlayer", "Mini 播放器背景"),
            toggle("showLyricControls", "歌词页控制栏上方"),
            toggle("showBackdrop", "背景光晕", "增加一层低对比度渐变底色"),
          ]),
          section("视觉表现", "调整样式、色彩与空间占比", visualFields),
          section("频谱采样", "较高参数会增加多区域同时绘制时的负担", [
            field(
              "刷新率",
              select("fps", [
                { label: "15 FPS · 节能", value: 15 },
                { label: "24 FPS · 平衡", value: 24 },
                { label: "30 FPS · 流畅", value: 30 },
              ]),
              "雾状模式最高按 24 FPS 绘制",
            ),
            field(
              "频段数量",
              select("binCount", [
                { label: "32", value: 32 },
                { label: "64", value: 64 },
                { label: "96", value: 96 },
                { label: "128", value: 128 },
              ]),
              settings.value.mode === "centered"
                ? "中心频谱会使用至少 128 个频段以保留细节"
                : "控制频谱分析的频率分辨率",
            ),
            field(
              "FFT 精度",
              select("fftSize", [
                { label: "1024", value: 1024 },
                { label: "2048", value: 2048 },
                { label: "4096", value: 4096 },
                { label: "8192", value: 8192 },
              ]),
            ),
            field("平滑度", range("smoothing", 0, 95, 1, "%")),
            field(
              "频率分布",
              select("scale", [
                { label: "对数", value: "log" },
                { label: "Mel", value: "mel" },
                { label: "线性", value: "linear" },
              ]),
            ),
          ]),
          h("div", { class: "echo-spectrum-actions" }, [
            h("p", "恢复样式、显示位置和采样参数的初始设置。"),
            h(
              Button,
              {
                variant: "outline",
                size: "xs",
                disabled: busy.value,
                onClick: reset,
              },
              { default: () => (busy.value ? "正在保存" : "恢复默认") },
            ),
          ]),
        ]);
      };
    },
  });

const registerSettings = (ctx) => {
  settingsDispose?.();
  settingsDispose = ctx.ui.settings.define({
    title: "频谱可视化",
    description: "用柱状、波形和雾状效果，让当前播放的音频融入播放器界面。",
    component: createSettingsComponent(ctx),
  });
};

const setupMainRuntime = (ctx) => {
  const disposePlayerBar = ctx.dom.observe(".player-bar", (element) => {
    const entry = mountLayer(element, "playerbar");
    if (!entry) return undefined;
    return () => {
      removeLayer(entry);
      updateRuntimeActivity();
    };
  });
  ctx.dispose(disposePlayerBar);

  const disposeLyricBar = ctx.dom.observe(".lyric-bar", (element) => {
    const entry = mountLayer(element, "lyric", { beforeHost: true });
    if (!entry) return undefined;
    return () => {
      removeLayer(entry);
      updateRuntimeActivity();
    };
  });
  ctx.dispose(disposeLyricBar);
};

const setupMiniRuntime = (ctx) => {
  const disposeMini = ctx.dom.observe(".mini-card", (element) => {
    const entry = mountLayer(element, "mini");
    if (!entry) return undefined;
    return () => {
      removeLayer(entry);
      updateRuntimeActivity();
    };
  });
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
  gap: 14px;
  min-width: 0;
  color: var(--color-text-main, var(--text-main, #1d1d1f));
}

.echo-spectrum-overview {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;
  border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.16));
  border-radius: 16px;
  background: var(--color-bg-elevated, var(--surface-card-base, #fff));
  padding: 14px;
  box-shadow: 0 2px 12px color-mix(in srgb, var(--color-text-main, #1d1d1f) 3%, transparent);
}

.echo-spectrum-mark {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  overflow: hidden;
  background:
    radial-gradient(circle at 28% 18%, rgba(255, 255, 255, 0.55), transparent 38%),
    linear-gradient(145deg, #42f5b3, #35b7ff 54%, #a86dff);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--color-primary, #35b7ff) 22%, transparent);
}

.echo-spectrum-mark i {
  width: 3px;
  margin-bottom: 13px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 7px rgba(255, 255, 255, 0.42);
}

.echo-spectrum-mark i:nth-child(1),
.echo-spectrum-mark i:nth-child(5) { height: 10px; }
.echo-spectrum-mark i:nth-child(2),
.echo-spectrum-mark i:nth-child(4) { height: 19px; }
.echo-spectrum-mark i:nth-child(3) { height: 27px; }

.echo-spectrum-overview-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.echo-spectrum-overview-copy h3,
.echo-spectrum-section-heading h3 {
  margin: 0;
  color: var(--color-text-main, var(--text-main, #1d1d1f));
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.echo-spectrum-overview-copy p,
.echo-spectrum-section-heading p {
  margin: 0;
  color: var(--color-text-secondary, var(--text-secondary, #6b7280));
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.echo-spectrum-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  border: 1px solid var(--control-border, rgba(127, 127, 127, 0.18));
  border-radius: 999px;
  background: var(--control-muted-bg, rgba(127, 127, 127, 0.08));
  padding: 4px 9px;
  color: var(--color-text-secondary, var(--text-secondary, #6b7280));
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.echo-spectrum-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.echo-spectrum-status.is-running {
  border-color: color-mix(in srgb, #10b981 30%, transparent);
  background: color-mix(in srgb, #10b981 10%, transparent);
  color: #059669;
}

.echo-spectrum-status.is-unavailable {
  border-color: color-mix(in srgb, #ef4444 30%, transparent);
  background: color-mix(in srgb, #ef4444 10%, transparent);
  color: #ef4444;
}

.echo-spectrum-panel {
  display: grid;
  border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.16));
  border-radius: 16px;
  overflow: hidden;
  background: var(--color-bg-elevated, var(--surface-card-base, #fff));
  box-shadow: 0 2px 12px color-mix(in srgb, var(--color-text-main, #1d1d1f) 3%, transparent);
}

.echo-spectrum-section-heading {
  display: grid;
  gap: 3px;
  padding: 15px 18px 12px;
}

.echo-spectrum-section-body {
  display: grid;
  min-width: 0;
}

.echo-spectrum-section-body > * + * {
  border-top: 1px solid color-mix(in srgb, var(--color-text-main, #1d1d1f) 12%, transparent);
}

.echo-spectrum-field,
.echo-spectrum-switch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(200px, 250px);
  align-items: center;
  gap: 24px;
  min-width: 0;
  min-height: 58px;
  padding: 10px 18px;
}

.echo-spectrum-field-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.echo-spectrum-field-copy strong {
  color: var(--color-text-main, var(--text-main, #1d1d1f));
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
}

.echo-spectrum-field-copy small {
  color: var(--color-text-secondary, var(--text-secondary, #6b7280));
  font-size: 12px;
  line-height: 1.4;
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

.echo-spectrum-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 2px;
}

.echo-spectrum-actions p {
  margin: 0;
  color: var(--color-text-secondary, var(--text-secondary, #6b7280));
  font-size: 12px;
  line-height: 1.45;
}

.echo-spectrum-switch {
  grid-template-columns: minmax(0, 1fr) auto;
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

.echo-spectrum-layer[data-mode="centered"] .echo-spectrum-canvas {
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent 0,
    rgba(0, 0, 0, 0.6) 5%,
    #000 12%,
    #000 88%,
    rgba(0, 0, 0, 0.6) 95%,
    transparent 100%
  );
  mask-image: linear-gradient(
    90deg,
    transparent 0,
    rgba(0, 0, 0, 0.6) 5%,
    #000 12%,
    #000 88%,
    rgba(0, 0, 0, 0.6) 95%,
    transparent 100%
  );
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
  .echo-spectrum-overview {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .echo-spectrum-mark {
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }

  .echo-spectrum-status {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .echo-spectrum-field {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .echo-spectrum-field,
  .echo-spectrum-switch {
    padding-inline: 14px;
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

export {
  DEFAULT_SETTINGS,
  buildMistProfile,
  buildCenteredProfile,
  getCenteredBarLayout,
  getDefaultSettings,
  getMistRenderLayers,
  normalizeSettings,
  releaseLayerResources,
  resolvePaletteColors,
  toSubscriptionOptions,
  updateCenteredDisplay,
};
