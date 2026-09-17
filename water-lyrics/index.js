const DEFAULT_SETTINGS = {
  particleCount: 60,
  particleSpeed: 40,
  glowIntensity: 70,
  lineSpacing: 72,
  connectorOpacity: 50,
  fontSize: 30,
};

/** 生成水波歌词皮肤的 SVG 预览图（16:9），体现水底光斑 + 竖排歌词 + 斜线分隔。 */
const createWaterPreviewSvg = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1f2e"/>
      <stop offset="1" stop-color="#06121a"/>
    </linearGradient>
    <radialGradient id="glow1" cx="30%" cy="35%" r="40%">
      <stop offset="0" stop-color="#3dd6c8" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#3dd6c8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="72%" cy="60%" r="35%">
      <stop offset="0" stop-color="#4ea8de" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#4ea8de" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="320" height="180" fill="url(#bg)"/>
  <rect width="320" height="180" fill="url(#glow1)"/>
  <rect width="320" height="180" fill="url(#glow2)"/>
  <g fill="#7fe9dd" opacity="0.8">
    <circle cx="60" cy="40" r="2"/>
    <circle cx="120" cy="70" r="1.5"/>
    <circle cx="200" cy="35" r="2.5"/>
    <circle cx="260" cy="90" r="1.8"/>
    <circle cx="90" cy="120" r="1.5"/>
    <circle cx="170" cy="140" r="2"/>
    <circle cx="240" cy="150" r="1.5"/>
  </g>
  <g stroke="#5ac8fa" stroke-width="1" opacity="0.25">
    <line x1="140" y1="40" x2="180" y2="40" transform="rotate(14 160 40)"/>
    <line x1="140" y1="75" x2="180" y2="75" transform="rotate(14 160 75)"/>
    <line x1="140" y1="110" x2="180" y2="110" transform="rotate(14 160 110)"/>
    <line x1="140" y1="145" x2="180" y2="145" transform="rotate(14 160 145)"/>
  </g>
  <g font-family="system-ui,sans-serif" text-anchor="middle" fill="#e6fffb">
    <text x="160" y="44" font-size="13" font-weight="700" opacity="0.95">灯初上</text>
    <text x="160" y="79" font-size="11" opacity="0.55">夜未央</text>
    <text x="160" y="114" font-size="11" opacity="0.4">心事逐浪</text>
    <text x="160" y="149" font-size="11" opacity="0.3">向远方</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    particleCount: clamp(
      source.particleCount ?? DEFAULT_SETTINGS.particleCount,
      0,
      200,
    ),
    particleSpeed: clamp(
      source.particleSpeed ?? DEFAULT_SETTINGS.particleSpeed,
      0,
      200,
    ),
    glowIntensity: clamp(
      source.glowIntensity ?? DEFAULT_SETTINGS.glowIntensity,
      0,
      100,
    ),
    lineSpacing: clamp(
      source.lineSpacing ?? DEFAULT_SETTINGS.lineSpacing,
      40,
      140,
    ),
    connectorOpacity: clamp(
      source.connectorOpacity ?? DEFAULT_SETTINGS.connectorOpacity,
      0,
      100,
    ),
    fontSize: clamp(source.fontSize ?? DEFAULT_SETTINGS.fontSize, 16, 56),
  };
};

/**
 * 创建水面光斑粒子背景 canvas。
 * 粒子缓慢上浮并左右漂移，带有柔和辉光，模拟水下阳光折射的光斑效果。
 */
const createParticleBackground = (ctx, settingsRef) => {
  const { onMounted, onUnmounted, ref, watch } = ctx.vue;
  const canvasRef = ref(null);
  let animationFrame = 0;
  let particles = [];
  let width = 0;
  let height = 0;

  const createParticle = () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: 1.5 + Math.random() * 4,
    speedY: 0.15 + Math.random() * 0.5,
    speedX: (Math.random() - 0.5) * 0.3,
    opacity: 0.15 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
  });

  const initParticles = () => {
    const count = settingsRef.value.particleCount;
    particles = Array.from({ length: count }, createParticle);
  };

  const resize = () => {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const gl = canvas.getContext("2d");
    gl.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  };

  const animate = () => {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const gl = canvas.getContext("2d");
    const s = settingsRef.value;
    const speed = s.particleSpeed / 100;
    const glow = s.glowIntensity / 100;

    gl.clearRect(0, 0, width, height);

    const bg = gl.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "rgba(8, 28, 26, 0.55)");
    bg.addColorStop(0.5, "rgba(6, 22, 20, 0.45)");
    bg.addColorStop(1, "rgba(4, 16, 14, 0.55)");
    gl.fillStyle = bg;
    gl.fillRect(0, 0, width, height);

    for (const p of particles) {
      p.phase += 0.01;
      p.y -= p.speedY * speed;
      p.x += p.speedX * speed + Math.sin(p.phase) * 0.2;

      if (p.y < -10) {
        p.y = height + 10;
        p.x = Math.random() * width;
      }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;

      const flicker = 0.7 + Math.sin(p.phase * 2) * 0.3;
      const alpha = p.opacity * glow * flicker;

      const gradient = gl.createRadialGradient(
        p.x,
        p.y,
        0,
        p.x,
        p.y,
        p.radius * 6,
      );
      gradient.addColorStop(0, `rgba(180, 255, 240, ${alpha})`);
      gradient.addColorStop(0.4, `rgba(120, 230, 210, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(80, 200, 180, 0)");
      gl.fillStyle = gradient;
      gl.beginPath();
      gl.arc(p.x, p.y, p.radius * 6, 0, Math.PI * 2);
      gl.fill();

      gl.fillStyle = `rgba(240, 255, 250, ${alpha * 1.4})`;
      gl.beginPath();
      gl.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
      gl.fill();
    }

    animationFrame = window.requestAnimationFrame(animate);
  };

  onMounted(() => {
    resize();
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(animate);
  });

  onUnmounted(() => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", resize);
  });

  watch(
    () => settingsRef.value.particleCount,
    () => initParticles(),
  );

  return canvasRef;
};

/**
 * 歌词页皮肤组件：竖排居中歌词，行间用斜线分隔。
 */
const createLyricSkinComponent = (ctx) => {
  const { defineComponent, h, computed } = ctx.vue;
  const LyricPlayerControls = ctx.vue.defineAsyncComponent(
    ctx.ui.components.LyricPlayerControls,
  );
  const BarrageControls = ctx.vue.defineAsyncComponent(
    ctx.ui.components.BarrageControls,
  );

  return defineComponent({
    name: "WaterLyricSkin",
    props: {
      page: { type: Object, required: true },
    },
    setup(props) {
      const skin = ctx.ui.lyricsPage.useSkin();
      const settings = computed(() => normalizeSettings(skin.settings.value));
      const canvasRef = createParticleBackground(ctx, settings);

      const VISIBLE_RANGE = 4;
      const visibleLines = computed(() => {
        const lyrics = props.page.state.value.lyrics;
        const lines = lyrics.lines || [];
        const current = lyrics.currentIndex;
        if (!lines.length) return [];
        const start = Math.max(0, current - VISIBLE_RANGE);
        const end = Math.min(lines.length, current + VISIBLE_RANGE + 1);
        return lines.slice(start, end).map((line, i) => ({
          text: line.text,
          distance: start + i - current,
        }));
      });

      const hasLyrics = computed(() => visibleLines.value.length > 0);

      const openQueue = () => props.page.panels.open("queue");
      const openComment = () => props.page.panels.open("comments");
      const openAddToPlaylist = () => props.page.panels.open("add-to-playlist");

      const barrageResource = computed(() => {
        const track = props.page.state.value.track;
        return {
          type: "song-barrage",
          hash: track?.hash || "",
          name: track?.name || "",
        };
      });
      const barrageEnabled = computed({
        get: () => props.page.barrage.enabled,
        set: (v) => {
          props.page.barrage.enabled = v;
        },
      });
      const handleBarrageSent = (content) => props.page.barrage.send(content);

      return () => {
        const s = settings.value;
        return h("div", { class: "water-lyric-skin" }, [
          h("canvas", { ref: canvasRef, class: "water-lyric-bg" }),
          h(
            "div",
            { class: "water-lyric-content" },
            hasLyrics.value
              ? visibleLines.value.map((line) =>
                  h("div", { class: "water-lyric-row" }, [
                    h(
                      "div",
                      {
                        class: "water-lyric-line",
                        "data-current": line.distance === 0 ? "true" : "false",
                        style: {
                          fontSize: `${s.fontSize}px`,
                          opacity:
                            line.distance === 0
                              ? 1
                              : Math.max(
                                  0.25,
                                  1 - Math.abs(line.distance) * 0.18,
                                ),
                          transform: `scale(${
                            line.distance === 0
                              ? 1.08
                              : Math.max(
                                  0.85,
                                  1 - Math.abs(line.distance) * 0.04,
                                )
                          })`,
                        },
                      },
                      line.text || " ",
                    ),
                    line.distance < VISIBLE_RANGE
                      ? h("div", {
                          class: "water-lyric-connector",
                          style: {
                            opacity: s.connectorOpacity / 100,
                            height: `${s.lineSpacing}px`,
                          },
                        })
                      : null,
                  ]),
                )
              : [h("div", { class: "water-lyric-empty" }, "暂无歌词")],
          ),
          h(
            LyricPlayerControls,
            {
              class: "water-lyric-controls",
              onOpenQueue: openQueue,
              onOpenComment: openComment,
              onOpenAddToPlaylist: openAddToPlaylist,
              onOpenSkins: () => ctx.ui.lyricsPage.openSkins(),
            },
            {
              "song-actions": () =>
                h(BarrageControls, {
                  modelValue: barrageEnabled.value,
                  "onUpdate:modelValue": (v) => (barrageEnabled.value = v),
                  resource: barrageResource.value,
                  variant: "lyric",
                  onSent: handleBarrageSent,
                }),
            },
          ),
        ]);
      };
    },
  });
};

const SKIN_CSS = `
.water-lyric-skin {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #061614;
  display: flex;
  flex-direction: column;
}

.water-lyric-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.water-lyric-content {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: max(46px, calc(35px / var(--window-zoom-factor, 1))) 8% 8%;
  overflow: hidden;
}

.water-lyric-controls {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
}

.water-lyric-row {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.water-lyric-line {
  color: #f0fffa;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-shadow: 0 0 18px rgba(120, 255, 220, 0.35), 0 2px 8px rgba(0, 0, 0, 0.5);
  transition: opacity 0.45s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, opacity;
  line-height: 1.4;
  text-align: center;
}

.water-lyric-line[data-current="true"] {
  color: #ffffff;
  font-weight: 700;
  text-shadow: 0 0 24px rgba(160, 255, 230, 0.6), 0 0 48px rgba(100, 220, 200, 0.3), 0 2px 10px rgba(0, 0, 0, 0.6);
}

.water-lyric-connector {
  width: 1.5px;
  margin: 6px 0;
  background: linear-gradient(180deg, rgba(180, 255, 240, 0), rgba(180, 255, 240, 0.55) 45%, rgba(120, 220, 200, 0.15) 100%);
  transform: rotate(14deg);
  border-radius: 999px;
  filter: blur(0.3px);
  pointer-events: none;
}

.water-lyric-empty {
  color: rgba(240, 255, 250, 0.4);
  font-size: 18px;
  letter-spacing: 0.1em;
}
`;

const SETTINGS_CSS = `
.water-lyric-settings {
  display: grid;
  gap: 16px;
  color: var(--color-text-main);
}

.water-lyric-settings-row {
  display: grid;
  gap: 8px;
}

.water-lyric-settings-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.water-lyric-settings-title {
  font-size: 13px;
  font-weight: 600;
}

.water-lyric-settings-value {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.water-lyric-settings-hint {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.water-lyric-settings-actions {
  display: flex;
  justify-content: flex-end;
}
`;

/**
 * 设置面板组件。在 setup 中调用 useSkin() 获取宿主管理的配置句柄，
 * patch 会经过 validate 校验后持久化到宿主设置。
 */
const createSettingsComponent = (ctx) => {
  const { defineComponent, h } = ctx.vue;
  const Button = ctx.vue.defineAsyncComponent(ctx.ui.components.Button);
  const Slider = ctx.vue.defineAsyncComponent(ctx.ui.components.Slider);

  return defineComponent({
    name: "WaterLyricSettings",
    setup() {
      const skin = ctx.ui.lyricsPage.useSkin();

      const slider = (label, key, min, max, hint) =>
        h("div", { class: "water-lyric-settings-row" }, [
          h("div", { class: "water-lyric-settings-line" }, [
            h("span", { class: "water-lyric-settings-title" }, label),
            h(
              "span",
              { class: "water-lyric-settings-value" },
              String(skin.settings.value[key]),
            ),
          ]),
          h(Slider, {
            modelValue: skin.settings.value[key],
            min,
            max,
            step: 1,
            "onUpdate:modelValue": (value) =>
              skin.patch({ [key]: Number(value) }),
          }),
          hint ? h("div", { class: "water-lyric-settings-hint" }, hint) : null,
        ]);

      return () =>
        h("div", { class: "water-lyric-settings" }, [
          slider(
            "光斑数量",
            "particleCount",
            0,
            200,
            "背景中浮动的水面光斑数量。",
          ),
          slider("漂浮速度", "particleSpeed", 0, 200, "光斑上浮和漂移的速度。"),
          slider(
            "辉光强度",
            "glowIntensity",
            0,
            100,
            "光斑和当前行文字的辉光强度。",
          ),
          slider("行间距", "lineSpacing", 40, 140, "歌词行之间的垂直间距。"),
          slider(
            "分隔线透明度",
            "connectorOpacity",
            0,
            100,
            "歌词行间斜线的可见程度。",
          ),
          slider("字号", "fontSize", 16, 56, "歌词文字大小。"),
          h("div", { class: "water-lyric-settings-actions" }, [
            h(
              Button,
              {
                variant: "outline",
                size: "xs",
                onClick: () => skin.patch(DEFAULT_SETTINGS),
              },
              { default: () => "恢复默认" },
            ),
          ]),
        ]);
    },
  });
};

const validateSettings = (values) => {
  const normalized = normalizeSettings(values);
  return JSON.stringify(normalized) === JSON.stringify(values)
    ? true
    : { errors: ["设置值超出范围"] };
};

export async function activate(ctx) {
  ctx.css.inject(SKIN_CSS, { id: "water-lyric-skin" });
  ctx.css.inject(SETTINGS_CSS, { id: "water-lyric-settings" });

  ctx.ui.lyricsPage.register({
    id: "water",
    title: "沉浸水波歌词",
    preview: createWaterPreviewSvg(),
    component: createLyricSkinComponent(ctx),
    titlebar: "host",
    settings: {
      defaults: DEFAULT_SETTINGS,
      validate: validateSettings,
      component: createSettingsComponent(ctx),
    },
  });
}

export function deactivate() {
  // 宿主会自动清理 lyricsPage 注册和注入的 CSS
}
