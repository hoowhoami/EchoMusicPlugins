/* OpenRGB SDK client for EchoMusic. Single-file ESM: the host loads plugins from blob URLs. */
const MAX_PACKET = 1024 * 1024;
const MAX_LEDS = 4096;
const PROTOCOL = 3;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
const errorText = (e) => (e instanceof Error ? e.message : String(e));
const aborted = () => new DOMException("连接已取消", "AbortError");

export const DEFAULT_SETTINGS = {
  enabled: false,
  host: "127.0.0.1",
  port: 6742,
  selected: [],
  effect: "spectrum",
  palette: "aurora",
  brightness: 50,
  gain: 2,
  smoothing: 65,
  fps: 20,
  pause: "black",
};
export function normalizeSettings(value = {}) {
  const s = value && typeof value === "object" ? value : {};
  return {
    enabled: s.enabled === true,
    host:
      typeof s.host === "string"
        ? s.host.trim().slice(0, 253)
        : DEFAULT_SETTINGS.host,
    port: Math.round(clamp(s.port ?? 6742, 1, 65535)),
    selected: [
      ...new Set(
        Array.isArray(s.selected)
          ? s.selected.filter((v) => typeof v === "string" && v.length <= 4096)
          : [],
      ),
    ].slice(0, 128),
    effect: ["spectrum", "pulse", "bass"].includes(s.effect)
      ? s.effect
      : "spectrum",
    palette: ["aurora", "ember", "ice"].includes(s.palette)
      ? s.palette
      : "aurora",
    brightness: clamp(s.brightness ?? 50, 0, 100),
    gain: clamp(s.gain ?? 2, 0.5, 5),
    smoothing: clamp(s.smoothing ?? 65, 0, 95),
    fps: Math.round(clamp(s.fps ?? 20, 5, 30)),
    pause: s.pause === "hold" ? "hold" : "black",
  };
}
export function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
export function packet(command, device = 0, payload = new Uint8Array()) {
  if (payload.length > MAX_PACKET) throw new Error("OpenRGB 数据包过大");
  const bytes = new Uint8Array(16 + payload.length);
  bytes.set([79, 82, 71, 66]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, device, true);
  view.setUint32(8, command, true);
  view.setUint32(12, payload.length, true);
  bytes.set(payload, 16);
  return bytes;
}

/** Incremental framing: one bounded allocation per packet, no growing concatenation buffer. */
export class PacketReader {
  header = new Uint8Array(16);
  used = 0;
  body = null;
  offset = 0;
  push(input, receive) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let pos = 0;
    while (pos < bytes.length) {
      if (!this.body) {
        const n = Math.min(16 - this.used, bytes.length - pos);
        this.header.set(bytes.subarray(pos, pos + n), this.used);
        this.used += n;
        pos += n;
        if (this.used !== 16) continue;
        if (
          this.header[0] !== 79 ||
          this.header[1] !== 82 ||
          this.header[2] !== 71 ||
          this.header[3] !== 66
        )
          throw new Error("OpenRGB 数据包标识无效");
        const view = new DataView(this.header.buffer);
        const size = view.getUint32(12, true);
        if (size > MAX_PACKET) throw new Error("OpenRGB 数据包超过 1 MiB");
        this.command = view.getUint32(8, true);
        this.device = view.getUint32(4, true);
        this.body = new Uint8Array(size);
        this.offset = 0;
      }
      const n = Math.min(this.body.length - this.offset, bytes.length - pos);
      this.body.set(bytes.subarray(pos, pos + n), this.offset);
      this.offset += n;
      pos += n;
      if (this.offset === this.body.length) {
        const message = {
          command: this.command,
          device: this.device,
          body: this.body,
        };
        this.body = null;
        this.used = 0;
        receive(message);
      }
    }
  }
}
class Cursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  take(n) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.bytes.length)
      throw new Error("OpenRGB 设备描述被截断");
    const start = this.pos;
    this.pos += n;
    return this.bytes.subarray(start, this.pos);
  }
  u16() {
    this.take(2);
    return this.view.getUint16(this.pos - 2, true);
  }
  u32() {
    this.take(4);
    return this.view.getUint32(this.pos - 4, true);
  }
  string() {
    const b = this.take(this.u16());
    if (!b.length || b[b.length - 1] !== 0)
      throw new Error("OpenRGB 字符串缺少结束符");
    return decoder.decode(b.subarray(0, -1));
  }
}
export function parseController(bytes, protocol, index) {
  if (protocol < 1 || protocol > PROTOCOL)
    throw new Error("不支持的 OpenRGB 协议版本");
  const c = new Cursor(bytes);
  if (c.u32() !== bytes.length) throw new Error("OpenRGB 设备描述长度不匹配");
  const type = c.u32(),
    name = c.string(),
    vendor = c.string();
  const description = c.string(),
    version = c.string(),
    serial = c.string(),
    location = c.string();
  const modeCount = c.u16(),
    activeMode = c.u32(),
    modes = [];
  if (modeCount > 256) throw new Error("OpenRGB 模式数量过多");
  for (let i = 0; i < modeCount; i++) {
    const start = c.pos;
    const name = c.string(),
      value = c.u32(),
      flags = c.u32();
    c.take(8); // speed min/max
    if (protocol >= 3) c.take(8); // brightness min/max
    c.take(12); // colors min/max and speed
    if (protocol >= 3) c.take(4); // brightness
    c.take(4); // direction
    const colorModeOffset = c.pos - start;
    const colorMode = c.u32(),
      colorCount = c.u16();
    c.take(colorCount * 4);
    modes.push({
      name,
      value,
      flags,
      colorMode,
      colorModeOffset,
      raw: bytes.slice(start, c.pos),
      index: i,
    });
  }
  const zoneCount = c.u16(),
    zones = [];
  if (zoneCount > 1024) throw new Error("OpenRGB 分区数量过多");
  for (let i = 0; i < zoneCount; i++) {
    const name = c.string(),
      type = c.u32();
    c.take(8);
    const count = c.u32(),
      matrixLength = c.u16();
    c.take(matrixLength);
    zones.push({ name, type, count });
  }
  const ledCount = c.u16();
  if (ledCount > MAX_LEDS)
    throw new Error(`设备 ${name} 超过 ${MAX_LEDS} 个 LED，暂不支持`);
  for (let i = 0; i < ledCount; i++) {
    c.string();
    c.take(4);
  }
  const colorCount = c.u16();
  c.take(colorCount * 4);
  if (c.pos !== bytes.length || colorCount !== ledCount)
    throw new Error("OpenRGB LED 描述长度不匹配");
  // Only explicit Direct + per-LED modes. Avoid Static/Custom fallbacks that may save to hardware.
  const direct = modes.find(
    (m) =>
      m.name.trim().toLowerCase() === "direct" &&
      m.flags & 32 &&
      !(m.flags & 512),
  );
  return {
    index,
    type,
    name,
    vendor,
    description,
    version,
    serial,
    location,
    activeMode,
    zones,
    ledCount,
    direct,
    supported: Boolean(direct && ledCount),
    reason: ledCount
      ? direct
        ? ""
        : "没有可用的 Direct 逐灯模式"
      : "设备没有 LED",
  };
}
export function deviceKey(device, settings) {
  return JSON.stringify([
    settings.host.toLowerCase(),
    settings.port,
    device.type,
    device.vendor,
    device.name,
    device.serial,
    device.location,
  ]);
}
export function modePayload(mode) {
  const bytes = new Uint8Array(8 + mode.raw.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, true);
  view.setUint32(4, mode.index, true);
  bytes.set(mode.raw, 8);
  view.setUint32(8 + mode.colorModeOffset, 1, true); // MODE_COLORS_PER_LED
  return bytes;
}
export function colorsPayload(rgb) {
  if (rgb.length % 3 || rgb.length / 3 > MAX_LEDS)
    throw new Error("OpenRGB 颜色长度无效");
  const count = rgb.length / 3,
    out = new Uint8Array(6 + 4 * count),
    v = new DataView(out.buffer);
  v.setUint32(0, out.length, true);
  v.setUint16(4, count, true);
  for (let i = 0; i < count; i++)
    out.set(rgb.subarray(i * 3, i * 3 + 3), 6 + i * 4);
  return out;
}

export class OpenRgbClient {
  constructor(socket, onFailure = () => {}, requestTimeoutMs = 3000) {
    this.socket = socket;
    this.onFailure = onFailure;
    this.requestTimeoutMs = requestTimeoutMs;
    this.closed = false;
    this.pending = null;
    this.protocol = PROTOCOL;
  }
  async initialize() {
    this.readerTask = this.readLoop();
    const version = await this.request(40, 0, uint32(PROTOCOL));
    if (version.length !== 4) throw new Error("OpenRGB 协议版本响应无效");
    const reported = new DataView(
      version.buffer,
      version.byteOffset,
      4,
    ).getUint32(0, true);
    if (reported < 1) throw new Error("需要 OpenRGB 0.5 或更新版本");
    this.protocol = Math.min(reported, PROTOCOL);
    await this.send(50, 0, encoder.encode("EchoMusic OpenRGB\0"));
    const countData = await this.request(0);
    if (countData.length !== 4) throw new Error("OpenRGB 设备数量响应无效");
    const count = new DataView(
      countData.buffer,
      countData.byteOffset,
      4,
    ).getUint32(0, true);
    if (count > 128) throw new Error("OpenRGB 设备数量超过 128");
    const devices = [];
    let total = 0;
    for (let index = 0; index < count; index++) {
      const device = parseController(
        await this.request(1, index, uint32(this.protocol)),
        this.protocol,
        index,
      );
      total += device.ledCount;
      if (total > 32768) throw new Error("OpenRGB 总 LED 数量超过 32768");
      devices.push(device);
    }
    return devices;
  }
  async readLoop() {
    const reader = new PacketReader();
    try {
      while (!this.closed) {
        const chunk = await this.socket.read();
        if (this.closed) break;
        if (chunk === null) throw new Error("OpenRGB 服务已断开");
        reader.push(chunk, (message) => {
          if (message.command === 100)
            throw new Error("OpenRGB 设备列表已变化，正在重新发现");
          const p = this.pending;
          if (
            p &&
            p.command === message.command &&
            p.device === message.device
          ) {
            this.pending = null;
            clearTimeout(p.timer);
            p.resolve(message.body);
          }
        });
      }
    } catch (error) {
      this.fail(error);
    }
  }
  fail(error) {
    if (this.closed) return;
    this.close(error);
    this.onFailure(error);
  }
  close(error = aborted()) {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    void this.socket.close().catch(() => {});
  }
  async send(command, device = 0, payload = new Uint8Array()) {
    if (this.closed) throw new Error("OpenRGB 连接已关闭");
    await this.socket.write(packet(command, device, payload));
    if (this.closed) throw new Error("OpenRGB 连接已关闭");
  }
  async request(command, device = 0, payload = new Uint8Array()) {
    if (this.closed) throw new Error("OpenRGB 连接已关闭");
    if (this.pending) throw new Error("OpenRGB 请求不能并发");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            new Error("OpenRGB 请求超时，请检查 SDK Server 和协议版本"),
          ),
        this.requestTimeoutMs,
      );
      this.pending = { command, device, resolve, reject, timer };
      void this.send(command, device, payload).catch((error) =>
        this.fail(error),
      );
    });
  }
}

const palettes = {
  aurora: [
    [38, 239, 177],
    [58, 151, 255],
    [191, 93, 255],
  ],
  ember: [
    [255, 53, 64],
    [255, 139, 39],
    [255, 225, 104],
  ],
  ice: [
    [35, 92, 255],
    [46, 220, 255],
    [218, 249, 255],
  ],
};
const sample = (bins, x) => {
  if (!bins?.length) return 0;
  const index = clamp(x, 0, 1) * (bins.length - 1),
    lo = Math.floor(index),
    f = index - lo;
  return clamp(
    (Number(bins[lo]) || 0) * (1 - f) +
      (Number(bins[Math.min(lo + 1, bins.length - 1)]) || 0) * f,
    0,
    1,
  );
};
export function renderColors(
  device,
  frame,
  settings,
  previous = [],
  dt = 50,
  stale = false,
) {
  const rgb = new Uint8Array(device.ledCount * 3),
    levels = new Float32Array(device.ledCount);
  const playing = !stale && frame?.state === "playing";
  if (!playing && settings.pause === "hold") return null;
  const min = Math.max(1, Number(frame?.minFrequency) || 20),
    max = Math.max(min + 1, Number(frame?.maxFrequency) || 20000);
  const position = (hz) =>
    Math.log(Math.max(min, Math.min(max, hz)) / min) / Math.log(max / min);
  let pulse = clamp(frame?.rms, 0, 1);
  if (settings.effect === "bass") {
    pulse = 0;
    for (let i = 0; i < 8; i++)
      pulse += sample(frame?.bins, position(30 * (250 / 30) ** (i / 7))) / 8;
  }
  for (let led = 0; led < device.ledCount; led++) {
    const x = device.ledCount <= 1 ? 0.5 : led / (device.ledCount - 1);
    const magnitude =
      settings.effect === "spectrum"
        ? sample(frame?.bins, position(20 * 1000 ** x))
        : pulse;
    const target = playing ? clamp(magnitude * settings.gain, 0, 1) : 0;
    const old = previous[led] || 0;
    const tau = target > old ? 25 : 30 + settings.smoothing * 5;
    levels[led] = playing
      ? old + (target - old) * (1 - Math.exp(-clamp(dt, 1, 500) / tau))
      : 0;
    const colors = palettes[settings.palette],
      p = x * 2,
      a = Math.min(1, Math.floor(p)),
      f = p - a;
    for (let channel = 0; channel < 3; channel++)
      rgb[led * 3 + channel] = Math.round(
        ((colors[a][channel] * (1 - f) + colors[a + 1][channel] * f) *
          levels[led] *
          settings.brightness) /
          100,
      );
  }
  return { rgb, levels };
}
const sameBytes = (a, b) =>
  a?.length === b.length && b.every((v, i) => v === a[i]);

export class OpenRgbRuntime {
  constructor(
    ctx,
    state,
    clock = {
      now: () => performance.now(),
      setTimeout: (fn, delay) => setTimeout(fn, delay),
      clearTimeout: (id) => clearTimeout(id),
      random: Math.random,
    },
  ) {
    this.ctx = ctx;
    this.state = state;
    this.clock = clock;
    this.settings = normalizeSettings(state.settings);
    this.session = null;
    this.retry = null;
    this.attempt = 0;
    this.disposed = false;
  }
  apply(settings) {
    const previous = this.settings;
    this.settings = normalizeSettings(settings);
    this.state.settings = this.settings;
    for (const key of previous.selected)
      if (!this.settings.selected.includes(key)) {
        this.session?.claimed.delete(key);
        this.session?.sent.delete(key);
        this.session?.levels.delete(key);
      }
    if (!this.settings.enabled) {
      this.stop();
      return;
    }
    if (
      !previous.enabled ||
      previous.host !== this.settings.host ||
      previous.port !== this.settings.port
    )
      this.connect();
  }
  release() {
    if (this.retry !== null) this.clock.clearTimeout(this.retry);
    this.retry = null;
    const s = this.session;
    this.session = null;
    if (s) {
      this.clock.clearTimeout(s.timer);
      s.unsubscribe?.();
      s.abort.abort();
      s.client?.close();
    }
    this.state.connected = false;
  }
  stop() {
    this.release();
    this.state.status = "未连接";
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
  async connect() {
    if (this.disposed) return;
    this.release();
    this.state.error = "";
    this.state.status = "正在连接…";
    const s = {
      abort: new AbortController(),
      timer: null,
      unsubscribe: null,
      levels: new Map(),
      sent: new Map(),
      claimed: new Set(),
      frame: null,
      frameAt: 0,
      lastAt: this.clock.now(),
    };
    this.session = s;
    try {
      if (!this.settings.host || /[\s\0/\\]/.test(this.settings.host))
        throw new Error("请输入有效的主机名或 IP 地址");
      if (!this.ctx.net?.tcp?.connect)
        throw new Error("请更新 EchoMusic：当前宿主没有 TCP API");
      const socket = await this.ctx.net.tcp.connect({
        host: this.settings.host,
        port: this.settings.port,
        connectTimeoutMs: 4000,
        writeTimeoutMs: 2000,
        keepAlive: true,
        keepAliveInitialDelayMs: 15000,
        signal: s.abort.signal,
      });
      if (this.session !== s) {
        await socket.close();
        return;
      }
      if (typeof socket.end !== "function") {
        await socket.close();
        throw new Error("请更新 EchoMusic：需要支持取消和半关闭的新 TCP API");
      }
      s.client = new OpenRgbClient(socket, (error) => this.failed(s, error));
      s.devices = await s.client.initialize();
      if (this.session !== s) return;
      const counts = new Map();
      for (const device of s.devices) {
        device.key = deviceKey(device, this.settings);
        counts.set(device.key, (counts.get(device.key) || 0) + 1);
      }
      for (const device of s.devices)
        if (counts.get(device.key) > 1) {
          device.supported = false;
          device.reason = "设备身份重复，无法安全保存选择";
        }
      this.state.devices = s.devices.map((d) => ({
        key: d.key,
        index: d.index,
        name: d.name,
        vendor: d.vendor,
        location: d.location,
        ledCount: d.ledCount,
        zones: d.zones.map((z) => z.name),
        supported: d.supported,
        reason: d.reason,
      }));
      this.state.connected = true;
      this.state.protocol = s.client.protocol;
      this.state.status = s.devices.length
        ? "已连接，请选择需要控制的设备"
        : "已连接，OpenRGB 尚未发现设备";
      this.attempt = 0;
      void this.tick(s);
    } catch (error) {
      this.failed(s, error);
    }
  }
  failed(s, error) {
    if (this.session !== s) return;
    this.release();
    this.state.error = errorText(error);
    if (this.disposed || !this.settings.enabled) {
      this.state.status = "未连接";
      return;
    }
    const delay =
      Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)) +
      Math.floor(this.clock.random() * 250);
    this.state.status = `连接中断，${Math.ceil(delay / 1000)} 秒后重试`;
    this.retry = this.clock.setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, delay);
  }
  async tick(s) {
    if (this.session !== s) return;
    const start = this.clock.now();
    try {
      const settings = this.settings;
      const targets = s.devices.filter(
        (d) => d.supported && settings.selected.includes(d.key),
      );
      const optionsKey = targets.length ? String(settings.fps) : "";
      if (s.subscriptionKey !== optionsKey) {
        s.unsubscribe?.();
        s.unsubscribe = null;
        s.frame = null;
        s.subscriptionKey = optionsKey;
        if (targets.length)
          s.unsubscribe = this.ctx.audio.spectrum.subscribe(
            {
              fps: settings.fps,
              binCount: 64,
              minFrequency: 20,
              maxFrequency: 20000,
              smoothing: 0.65,
              includeWaveform: false,
            },
            (frame) => {
              if (this.session === s) {
                s.frame = frame;
                s.frameAt = this.clock.now();
              }
            },
          );
      }
      this.state.status = targets.length
        ? `正在控制 ${targets.length} 个设备`
        : "已连接，请选择需要控制的设备";
      for (const d of targets) {
        if (this.session !== s) return;
        if (!this.settings.selected.includes(d.key)) continue;
        if (!s.claimed.has(d.key)) {
          await s.client.send(1101, d.index, modePayload(d.direct));
          if (this.session !== s) return;
          if (!this.settings.selected.includes(d.key)) continue;
          s.claimed.add(d.key);
        }
        if (this.session !== s) return;
        if (!this.settings.selected.includes(d.key)) continue;
        const result = renderColors(
          d,
          s.frame,
          settings,
          s.levels.get(d.key),
          start - s.lastAt,
          !s.frame || start - s.frameAt > 750,
        );
        if (!result) continue;
        s.levels.set(d.key, result.levels);
        if (sameBytes(s.sent.get(d.key), result.rgb)) continue;
        await s.client.send(1050, d.index, colorsPayload(result.rgb));
        if (this.session === s && this.settings.selected.includes(d.key))
          s.sent.set(d.key, result.rgb);
      }
      s.lastAt = start;
      if (this.session === s)
        s.timer = this.clock.setTimeout(
          () => void this.tick(s),
          Math.max(1, 1000 / this.settings.fps - (this.clock.now() - start)),
        );
    } catch (error) {
      this.failed(s, error);
    }
  }
}

let runtime;
export async function activate(ctx) {
  const state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get("settings")),
    connected: false,
    status: "未连接",
    error: "",
    devices: [],
    protocol: null,
  });
  runtime = new OpenRgbRuntime(ctx, state);
  const current = runtime;
  const save = async (settings) => {
    const next = normalizeSettings(settings);
    await ctx.storage.set("settings", next);
    if (!current.disposed) current.apply(next);
  };
  const Page = ctx.vue.defineComponent({
    name: "OpenRgbSettings",
    setup() {
      const { h, ref, defineAsyncComponent } = ctx.vue;
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Checkbox = defineAsyncComponent(ctx.ui.components.Checkbox);
      const draft = ref({});
      const host = ref(state.settings.host),
        port = ref(state.settings.port),
        busy = ref(false),
        formError = ref("");
      const perform = async (task) => {
        if (busy.value) return;
        busy.value = true;
        formError.value = "";
        try {
          await task();
        } catch (e) {
          formError.value = errorText(e);
        } finally {
          busy.value = false;
        }
      };
      const patch = (value) =>
        perform(() => save({ ...state.settings, ...value }));
      const button = (text, action, disabled = false, primary = false) =>
        h(
          "button",
          {
            class: ["orgb-button", primary && "orgb-primary"],
            disabled: busy.value || disabled,
            onClick: action,
          },
          text,
        );
      const select = (label, key, values) =>
        h("div", { class: "orgb-field" }, [
          h("div", { class: "orgb-label" }, label),
          h(Select, {
            class: "orgb-select",
            ariaLabel: label,
            modelValue: state.settings[key],
            options: values.map(([value, label]) => ({ value, label })),
            disabled: busy.value,
            "onUpdate:modelValue": (value) => patch({ [key]: value }),
          }),
        ]);
      const slider = (label, key, min, max, step, suffix = "") =>
        h("div", { class: "orgb-field" }, [
          h("div", { class: "orgb-label" }, [
            label,
            h(
              "output",
              { class: "orgb-value" },
              `${draft.value[key] ?? state.settings[key]}${suffix}`,
            ),
          ]),
          h(Slider, {
            modelValue: Number(draft.value[key] ?? state.settings[key]),
            min,
            max,
            step,
            ariaLabel: label,
            trackClass: "orgb-slider-track",
            rangeClass: "orgb-slider-range",
            thumbClass: "orgb-slider-thumb",
            disabled: busy.value,
            "onUpdate:modelValue": (value) => {
              draft.value[key] = Number(value);
            },
            onValueCommit: (value) =>
              perform(() =>
                save({ ...state.settings, [key]: Number(value) }),
              ).finally(() => {
                delete draft.value[key];
              }),
          }),
        ]);
      return () =>
        h("div", { class: "orgb-settings" }, [
          h("header", { class: "orgb-hero" }, [
            h("div", { class: "orgb-orbit", "aria-hidden": "true" }, "◌"),
            h("div", [
              h("h2", "让音乐点亮桌面"),
              h("p", "独立的音乐灯效 · 与屏幕频谱可同时使用"),
            ]),
            h(
              "span",
              { class: ["orgb-badge", state.connected && "orgb-online"] },
              state.connected ? "已连接" : "未连接",
            ),
          ]),
          h("section", { class: "orgb-panel" }, [
            h("h3", "OpenRGB 连接"),
            h("p", "先在 OpenRGB 中开启 SDK Server，再填写服务地址。"),
            h("div", { class: "orgb-address" }, [
              h("label", [
                "主机地址",
                h("input", {
                  value: host.value,
                  placeholder: "127.0.0.1",
                  disabled: busy.value,
                  onInput: (e) => (host.value = e.target.value),
                }),
              ]),
              h("label", [
                "端口",
                h("input", {
                  type: "number",
                  min: 1,
                  max: 65535,
                  value: port.value,
                  disabled: busy.value,
                  onInput: (e) => (port.value = Number(e.target.value)),
                }),
              ]),
            ]),
            h("div", { class: "orgb-actions" }, [
              button(
                "保存并连接",
                () =>
                  perform(async () => {
                    if (
                      !host.value.trim() ||
                      /[\s\0/\\]/.test(host.value) ||
                      !Number.isInteger(Number(port.value)) ||
                      port.value < 1 ||
                      port.value > 65535
                    )
                      throw new Error("请输入有效地址和 1–65535 的整数端口");
                    const changed =
                      host.value.trim().toLowerCase() !==
                        state.settings.host.toLowerCase() ||
                      Number(port.value) !== state.settings.port;
                    await save({
                      ...state.settings,
                      host: host.value,
                      port: port.value,
                      enabled: true,
                      selected: changed ? [] : state.settings.selected,
                    });
                    if (
                      !changed &&
                      current.session === null &&
                      current.retry === null
                    )
                      void current.connect();
                  }),
                false,
                true,
              ),
              button(
                "重新发现设备",
                () => void current.connect(),
                !state.settings.enabled,
              ),
              button(
                "断开连接",
                () => patch({ enabled: false }),
                !state.settings.enabled,
              ),
            ]),
            h("label", { class: "orgb-check" }, [
              h(Checkbox, {
                ariaLabel: "启用后自动连接，断线时自动重试",
                modelValue: state.settings.enabled,
                disabled: busy.value,
                "onUpdate:modelValue": (checked) =>
                  patch({ enabled: checked === true }),
              }),
              "启用后自动连接，断线时自动重试",
            ]),
            h("p", { role: "status", "aria-live": "polite" }, state.status),
            (state.error || formError.value) &&
              h(
                "p",
                { class: "orgb-error", role: "alert" },
                formError.value || state.error,
              ),
          ]),
          h("section", { class: "orgb-panel" }, [
            h("h3", "选择灯光设备"),
            h(
              "p",
              "只控制勾选的设备。按 OpenRGB 的 LED 顺序排列频谱，左端低频、右端高频。",
            ),
            !state.devices.length &&
              h(
                "div",
                { class: "orgb-empty" },
                "连接后，这里会显示 OpenRGB 发现的设备。",
              ),
            ...state.devices.map((d) =>
              h(
                "label",
                {
                  class: ["orgb-device", !d.supported && "orgb-unavailable"],
                  key: d.key + ":" + d.index,
                },
                [
                  h(Checkbox, {
                    ariaLabel: `选择设备 ${d.name}`,
                    modelValue: state.settings.selected.includes(d.key),
                    disabled: !state.connected || !d.supported || busy.value,
                    "onUpdate:modelValue": (checked) =>
                      patch({
                        selected:
                          checked === true
                            ? [...state.settings.selected, d.key]
                            : state.settings.selected.filter(
                                (key) => key !== d.key,
                              ),
                      }),
                  }),
                  h("span", [
                    h("strong", d.name),
                    h(
                      "small",
                      `${d.vendor || "OpenRGB"} · ${d.ledCount} LED${d.zones.length ? " · " + d.zones.join(" / ") : ""}`,
                    ),
                    !d.supported && h("small", d.reason),
                  ]),
                ],
              ),
            ),
          ]),
          h("section", { class: "orgb-panel" }, [
            h("h3", "音乐灯效"),
            h("div", { class: "orgb-controls" }, [
              select("律动方式", "effect", [
                ["spectrum", "频谱铺展"],
                ["pulse", "整体音量律动"],
                ["bass", "低频节拍"],
              ]),
              select("配色", "palette", [
                ["aurora", "极光"],
                ["ember", "余烬"],
                ["ice", "冰蓝"],
              ]),
              slider("亮度", "brightness", 0, 100, 1, "%"),
              slider("灵敏度", "gain", 0.5, 5, 0.1, "×"),
              slider("衰减平滑", "smoothing", 0, 95, 1, "%"),
              slider("刷新率", "fps", 5, 30, 1, " FPS"),
              select("暂停或音频数据中断", "pause", [
                ["black", "熄灭灯光"],
                ["hold", "保留最后颜色"],
              ]),
            ]),
            h(
              "p",
              { class: "orgb-note" },
              "断开、停用或退出会停止发送，设备保留最后颜色和模式；可回到 OpenRGB 切换灯效。请避免其他灯效软件同时控制相同设备。",
            ),
          ]),
        ]);
    },
  });
  ctx.css.inject(STYLE, { id: "openrgb-settings" });
  ctx.dispose(
    ctx.ui.settings.define({
      title: "OpenRGB 音乐灯效",
      description: "将播放中的音乐频谱同步到 OpenRGB 灯光设备。",
      component: Page,
    }),
  );
  ctx.dispose(() => current.dispose());
  if (state.settings.enabled) void current.connect();
}
export function deactivate() {
  runtime?.dispose();
  runtime = null;
}
const STYLE = `
.orgb-settings { --orgb-control-border: color-mix(in srgb, var(--color-text-main, #1d1d1f) 38%, var(--surface-card-base, #fff)); display: grid; gap: 18px; color: var(--color-text-main, #1d1d1f); min-width: 0; }
.orgb-settings * { box-sizing: border-box; }
.orgb-hero { display: flex; align-items: center; gap: 16px; padding: 20px; border-radius: 16px; background: linear-gradient(115deg, color-mix(in srgb, #23dca2 10%, transparent), color-mix(in srgb, #568bff 10%, transparent), color-mix(in srgb, #bc71ff 10%, transparent)); border: 1px solid var(--border-strong); }
.orgb-orbit { font-size: 46px; line-height: 1; color: var(--color-primary-text, var(--color-primary)); }
.orgb-settings h2 { margin: 0 0 6px; font-size: 20px; font-weight: 700; } .orgb-settings h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
.orgb-settings p { color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; margin: 8px 0; }
.orgb-badge { margin-left: auto; padding: 5px 10px; border: 1px solid var(--orgb-control-border); border-radius: 99px; font-size: 12px; white-space: nowrap; }
.orgb-online { background: var(--control-active-bg); color: var(--color-primary-text, var(--color-primary)); }
.orgb-panel { padding: 20px; border: 1px solid var(--border-strong); border-radius: 16px; background: var(--control-muted-bg); }
.orgb-address { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 12px; margin: 16px 0; }
.orgb-address label, .orgb-field { display: grid; gap: 10px; font-size: 13px; min-width: 0; }
.orgb-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 500; }
.orgb-value { padding: 2px 8px; border-radius: 6px; background: var(--control-bg); color: var(--color-text-main); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.orgb-address input { width: 100%; min-width: 0; padding: 9px 11px; min-height: 40px; border-radius: 9px; background: var(--control-bg); color: inherit; border: 1px solid var(--orgb-control-border); font: inherit; }
.orgb-settings .orgb-select { width: 100%; min-height: 40px; background: var(--control-bg); border-color: var(--orgb-control-border); font-weight: 500; }
.orgb-settings .orgb-field .slider-root-horizontal .orgb-slider-track { height: 6px; background: color-mix(in srgb, var(--color-text-main) 50%, var(--surface-card-base)); }
.orgb-settings .orgb-slider-range { background: var(--color-primary-text, var(--color-primary)); }
.orgb-settings .orgb-slider-thumb { width: 16px; height: 16px; background: var(--control-thumb-bg); border: 2px solid var(--color-primary-text, var(--color-primary)); }
.orgb-settings :is(input, button, [role=combobox], [role=slider]):focus-visible { outline: 2px solid var(--color-primary-text, var(--color-primary)) !important; outline-offset: 3px; }
.orgb-settings :disabled { opacity: .55; cursor: not-allowed; }
.orgb-actions { display: flex; flex-wrap: wrap; gap: 9px; margin: 10px 0 16px; }
.orgb-button { padding: 9px 14px; min-height: 40px; border-radius: 9px; border: 1px solid var(--orgb-control-border); background: var(--control-bg); color: inherit; cursor: pointer; font: inherit; font-size: 13px; }
.orgb-button:hover:not(:disabled) { background: var(--control-hover-bg); border-color: var(--color-primary-text, var(--color-primary)); }
.orgb-primary { background: var(--color-primary); color: var(--color-on-primary); border-color: transparent; }
.orgb-primary:hover:not(:disabled) { background: var(--color-primary-hover, var(--color-primary)); color: var(--color-on-primary-hover, var(--color-on-primary)); }
.orgb-check, .orgb-device { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.orgb-device { padding: 14px 0; border-bottom: 1px solid var(--border-strong); } .orgb-device:last-child { border-bottom: none; }
.orgb-device > span { display: grid; gap: 5px; min-width: 0; } .orgb-device small { color: var(--color-text-secondary); overflow-wrap: anywhere; }
.orgb-unavailable { opacity: .7; } .orgb-empty { padding: 24px 0; text-align: center; color: var(--color-text-secondary); font-size: 13px; }
.orgb-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; }
.orgb-settings .orgb-error { color: var(--state-danger, #e96a6a); overflow-wrap: anywhere; } .orgb-settings .orgb-note { margin-top: 20px; }
@media (max-width: 560px) { .orgb-controls { grid-template-columns: 1fr; } .orgb-hero { flex-wrap: wrap; } .orgb-panel, .orgb-hero { padding: 16px; } }
`;
