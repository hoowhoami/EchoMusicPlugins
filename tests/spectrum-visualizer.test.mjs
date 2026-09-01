import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../spectrum-visualizer/index.js", import.meta.url),
  "utf8",
);
const plugin = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("normalizes fog settings while preserving legacy defaults", () => {
  assert.equal(plugin.normalizeSettings({ mode: "mist" }).mode, "mist");
  assert.equal(plugin.normalizeSettings({ mode: "centered" }).mode, "centered");
  assert.equal(plugin.normalizeSettings({}).palette, "theme");
  assert.equal(plugin.normalizeSettings({}).mistIntensity, 78);
  assert.equal(plugin.normalizeSettings({}).mistSoftness, 72);
  assert.equal(plugin.normalizeSettings({}).mistMotion, 42);
  assert.equal(plugin.normalizeSettings({}).centeredBarWidth, 2);
  assert.equal(
    plugin.normalizeSettings({ mistSoftness: 160 }).mistSoftness,
    100,
  );
  assert.equal(plugin.normalizeSettings({ mistMotion: -20 }).mistMotion, 0);
  assert.equal(
    plugin.normalizeSettings({ mistIntensity: 120 }).mistIntensity,
    100,
  );
  assert.equal(
    plugin.normalizeSettings({ mistIntensity: 0 }).mistIntensity,
    35,
  );
  assert.equal(plugin.normalizeSettings({ mode: "unknown" }).mode, "bars");
  assert.equal(
    plugin.normalizeSettings({ centeredBarWidth: 0 }).centeredBarWidth,
    1,
  );
  assert.equal(
    plugin.normalizeSettings({ centeredBarWidth: 20 }).centeredBarWidth,
    8,
  );
});

test("provides a fresh complete settings snapshot for reset", () => {
  const first = plugin.getDefaultSettings();
  const second = plugin.getDefaultSettings();

  assert.deepEqual(first, plugin.DEFAULT_SETTINGS);
  assert.notEqual(first, second);
  first.mode = "mist";
  assert.equal(second.mode, "bars");
});

test("uses a stable theme palette fallback outside the renderer", () => {
  assert.deepEqual(plugin.resolvePaletteColors("theme"), [
    "#0071e3",
    "#5ac8fa",
    "#7c6cff",
  ]);
  assert.deepEqual(plugin.resolvePaletteColors("ember"), [
    "#ffe08a",
    "#ff8f4a",
    "#ff4d7d",
  ]);
});

test("resolves the active host theme colors for canvas rendering", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    getComputedStyle: () => ({
      getPropertyValue: (name) =>
        ({
          "--color-primary": "rgb(12, 34, 56)",
          "--color-secondary": "rgb(78, 90, 123)",
          "--color-primary-hover": "rgb(23, 45, 67)",
        })[name] || "",
    }),
  };

  try {
    assert.deepEqual(plugin.resolvePaletteColors("theme", {}), [
      "rgb(12, 34, 56)",
      "rgb(78, 90, 123)",
      "rgb(23, 45, 67)",
    ]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("requests waveform data only for waveform-based modes", () => {
  const mist = plugin.normalizeSettings({ mode: "mist" });
  const bars = plugin.normalizeSettings({ mode: "bars" });
  const wave = plugin.normalizeSettings({ mode: "wave" });
  const hybrid = plugin.normalizeSettings({ mode: "hybrid" });
  const centered = plugin.normalizeSettings({ mode: "centered" });

  assert.equal(plugin.toSubscriptionOptions(mist).includeWaveform, false);
  assert.equal(plugin.toSubscriptionOptions(bars).includeWaveform, false);
  assert.equal(plugin.toSubscriptionOptions(wave).includeWaveform, true);
  assert.equal(plugin.toSubscriptionOptions(hybrid).includeWaveform, true);
  assert.equal(plugin.toSubscriptionOptions(centered).includeWaveform, false);
  assert.equal(plugin.toSubscriptionOptions(centered).binCount, 128);
});

test("builds a symmetric centered profile with responsive attack and soft decay", () => {
  const profile = plugin.buildCenteredProfile([1, 0.6, 0.2, 0], 9);

  assert.equal(profile.length, 9);
  assert.deepEqual(profile, [...profile].reverse());
  assert.equal(profile[4] > profile[0], true);

  const attacked = plugin.updateCenteredDisplay(Array(9).fill(0), profile);
  const decayed = plugin.updateCenteredDisplay(attacked, Array(9).fill(0));
  assert.equal(attacked[4], profile[4] * 0.4);
  assert.equal(decayed[4], attacked[4] * 0.88);

  const interpolated = plugin.buildCenteredProfile([1, 0], 17);
  assert.equal(new Set(interpolated).size > 2, true);
});

test("uses a denser default centered spectrum layout", () => {
  const dense = plugin.getCenteredBarLayout(700);
  const sparse = plugin.getCenteredBarLayout(700, 4);

  assert.equal(dense.barWidth, 2);
  assert.equal(dense.count, 140);
  assert.equal(sparse.count, 100);
  assert.equal(dense.count > sparse.count, true);
});

test("releases canvas backing storage and layer caches", () => {
  const entry = {
    canvas: { width: 1920, height: 180 },
    centeredDisplay: [0.2, 0.4],
    paletteCache: { colors: ["#fff"], at: 1 },
  };

  assert.equal(plugin.releaseLayerResources(entry), true);
  assert.equal(entry.canvas.width, 1);
  assert.equal(entry.canvas.height, 1);
  assert.equal(entry.centeredDisplay, null);
  assert.equal(entry.paletteCache, null);
  assert.equal(plugin.releaseLayerResources(entry), false);
});

test("builds a bounded and smoothed fog profile from spectrum bins", () => {
  const profile = plugin.buildMistProfile(
    new Float32Array([0, 0.1, 0.8, 1, 0.42, 0.08, 0]),
    24,
  );

  assert.equal(profile.length, 24);
  assert.equal(
    profile.every((value) => Number.isFinite(value)),
    true,
  );
  assert.equal(
    profile.every((value) => value >= 0 && value <= 1),
    true,
  );
  assert.equal(Math.max(...profile) > 0.5, true);
  assert.equal(
    profile
      .slice(1)
      .every((value, index) => Math.abs(value - profile[index]) < 0.5),
    true,
  );
  assert.deepEqual(plugin.buildMistProfile([], 12), Array(12).fill(0));
  assert.equal(plugin.buildMistProfile([], 2).length, 8);
  assert.equal(plugin.buildMistProfile([], 200).length, 64);
});

test("keeps the default fog layers visible without excessive blur", () => {
  const settings = plugin.normalizeSettings({ mode: "mist" });
  const layers = plugin.getMistRenderLayers(settings, 0.5);

  assert.equal(layers.length, 3);
  assert.equal(layers[0].alpha > 0.4, true);
  assert.equal(
    layers.every((layer) => layer.blur >= 4 && layer.blur <= 12),
    true,
  );
  assert.equal(layers[2].scale > layers[0].scale, true);
});

test("plugin package exposes the fog mode as a feature release", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../spectrum-visualizer/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const readme = await readFile(
    new URL("../spectrum-visualizer/README.md", import.meta.url),
    "utf8",
  );

  assert.equal(manifest.version, "1.1.0");
  assert.match(manifest.description, /雾状/);
  assert.match(readme, /雾化柔度/);
  assert.match(readme, /中心频谱/);
  assert.match(source, /中心频谱/);
  assert.match(source, /恢复默认/);
  assert.match(source, /当前播放音频的频谱数据/);
  assert.doesNotMatch(source, /系统音频/);
  assert.doesNotMatch(source, /echo-spectrum-mist-note/);
  assert.equal(typeof plugin.activate, "function");
  assert.equal(typeof plugin.deactivate, "function");
});
