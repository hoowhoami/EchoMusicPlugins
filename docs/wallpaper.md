# 壁纸 API（桌面歌词壁纸）

动态歌词壁纸是宿主的一块全屏子窗口，挂在桌面层（Windows 上是 `WorkerW`），内容就是宿主自己的壁纸页 `#/wallpaper`。插件接入壁纸有两条路：

- **歌词页插件**：宿主把自己的壁纸页当歌词页渲染，插件通过 `page` 上下文拿状态；
- **皮肤插件（自带前端页面）**：插件自己决定画什么，用 `window.electron.wallpaper` 读宿主设定，并按本文的契约排帧、应答歌词接管。

壁纸窗口是**只读镜像**：歌词、进度、外观全部来自主窗口快照，它不会写回持久化状态。

## 1. 宿主设定：`window.electron.wallpaper`

```ts
interface WallpaperState {
  enabled: boolean;
  supported: boolean;
  attached: boolean;
  activeDisplayIds: string[];
  coverage: number;            // 被其它窗口遮挡的比例 0–1
  frameRate: number;           // 当前实际帧率预算，0 表示停帧
  activeFrameRates: Record<string, number>;
  activeReasons: Record<string, string>;
  reason: 'disabled' | 'detached' | 'covered' | 'paused' | 'playing';
  displays: Array<{ id: string; label: string; width: number; height: number; scale: number; primary: boolean }>;
  settings: {
    contentMode: 'lyric' | 'follow';   // 仅歌词 / 跟随播放页
    pauseBehavior: 'freeze' | 'clear'; // 暂停时留在桌面 / 清空
    frameRate: number;
    frameRates: Record<string, number>;
    palette: string;
    texture: Record<string, unknown>;
  };
}
```

| 方法 | 说明 |
|---|---|
| `getState()` | 读一次完整状态 |
| `onStateChange(cb)` | 订阅状态变化，返回取消订阅函数 |
| `setEnabled(enabled)` | 仅主窗口可调；壁纸窗口调用会被忽略 |
| `setSettings(patch)` | 仅主窗口可调 |
| `setLyricRect(rect)` | 上报歌词区域，用于遮挡判定；`{ left, top, width, height, dpr }`，宽或高为 0 表示「没有歌词区」 |
| `reportPluginFrameSupport(supported)` | 声明插件是否遵守第 2 节的帧率契约；声明 `false` 时宿主在遮挡场景会直接把窗口藏起来而不是降帧 |

插件要按能力探测再使用：旧版宿主没有 `window.electron.wallpaper`，拿不到就当「不是壁纸窗口」，退回普通歌词页行为。

## 2. 帧率契约

壁纸的帧率不是固定值：每块屏一档（30–240，上限由屏幕刷新率压住），桌面被挡住时按设定的 20% 省电跑，整页看不见时完全冻结。宿主只约束自己的绘制循环，插件自绘的画面必须自己遵守。

```ts
interface WallpaperFrameMode {
  fps: number;    // 上限；0 表示不限
  frozen: boolean; // true 表示现在看不见，应当彻底停帧
}
```

- `fps: 0` 是「不限」，不是暂停；暂停只看 `frozen`。
- 设定只在**真正变化**时通知，首帧之前按 `{ fps: 0, frozen: false }` 处理。
- 冻结期间宿主会给 `html` 加上 `data-wallpaper-frozen`（CSS 动画会停），但 Canvas / WebGL / Web Animations 不会自己停。
- 「暂停时把画面留在桌面上」这种冻结会按退避补几次短暂唤醒（`frozen: false`，各约 1 秒、累计约 11 秒）再冻住：插件冷启动时引擎和素材还没就绪，第一次放开画出来的常常是空场景，最后一次冻住的才是带内容的那一帧。插件照常按事件排帧即可。

### 歌词页插件：`page` 上下文

```ts
const fps = computed(() => props.page.state.value.view.frame.fps);
const frozen = computed(() => props.page.state.value.view.frame.frozen);
const isWallpaper = computed(() => props.page.state.value.view.wallpaper);
const clearBackground = computed(() => props.page.state.value.view.clearBackground);
```

### 自绘循环：window 事件

```ts
const MODE_EVENT = 'echomusic:wallpaper-frame';
let mode = { fps: 0, frozen: false };

window.addEventListener(MODE_EVENT, (event) => {
  mode = (event as CustomEvent<typeof mode>).detail;
  schedule(); // 解除冻结后要自己续上循环
});

function tick(now: number) {
  if (mode.frozen) return;
  draw(now);
  const wait = mode.fps > 0 ? Math.max(0, 1000 / mode.fps - (performance.now() - now)) : 0;
  wait > 0 ? setTimeout(() => requestAnimationFrame(tick), wait) : requestAnimationFrame(tick);
}
```

### 用 `ctx.graphics` 的插件

`ctx.graphics.createCanvas()` + `start(draw)` 拿到的是宿主托管循环：冻结时停住、解除后自动续上、`fps > 0` 时按目标帧率排队，插件不需要做任何事。

### 画面在 iframe 里

跨窗口事件不会自动送达：父窗口收到 `echomusic:wallpaper-frame` 后要自己 `postMessage` 转进去，iframe 里按同样的语义排帧，并回一个回执让宿主知道契约被接住了。仓库里的 `player-frontend`（3D 歌词）就是这么做的：`player-frontend/js/wallpaper-frame-gate.js` 在 iframe 里接管 `requestAnimationFrame`，`frozen` 时停画，并通过 `echomusic:wallpaper-frame-ack` 回执。

## 3. 歌词接管契约

壁纸里能画歌词的有两方：宿主自己的歌词页，和皮肤插件。宿主默认**不隐藏**自己的歌词页，插件必须明确声明「这一屏我能画」才让位，避免出现「插件没画、宿主也藏了」的空白桌面。

```ts
// 1. 宿主问：什么时候切模式、当前是什么模式
window.addEventListener('echomusic:wallpaper-mode', (event) => {
  const { mode } = (event as CustomEvent<{ mode: 'follow' | 'lyric' }>).detail;
  // 'follow'：内容跟随主界面歌词页；'lyric'：只把歌词铺在桌面上
});

// 2. 插件答：这一屏我能自己画歌词
window.dispatchEvent(
  new CustomEvent('echomusic:wallpaper-lyrics', { detail: { available: true } }),
);
```

- 宿主在壁纸页挂载后、内容模式切换后、插件运行时被重建或停用后各问一次。
- 只有 `available === true` 才接管；`false`、缺字段、不回话都按「插件不画」处理，宿主等 3 秒后回退到自己的歌词页。
- 接管期间 `body` 会带 `wallpaper-plugin-lyrics` 类，插件可以用它调整样式；这个类名只表示「歌词归插件画」。
- 宿主只隐藏内置版式（工具栏与歌词主体），不隐藏整个歌词页——插件页就挂在歌词页内部。

## 4. 只读镜像的限制

壁纸窗口里的 `playback`、`storage` 等写操作会被宿主拒绝：

- 播放控制（`playback.toggle` / `next` / `seek` / `setVolume` 等）一律抛「壁纸窗口是只读镜像，不能控制播放」；
- `storage.setKv` / `deleteKv` / `resetAll` 返回 `{ ok: false }`，宿主的设置持久化在壁纸窗口里也不订阅写入。

插件在壁纸窗口里不要依赖「写设置立即生效」这类副作用，那类写入会被丢掉。

## 5. 验证边界

- 壁纸窗口的尺寸等于主屏逻辑分辨率，`devicePixelRatio` 与主窗口一致；多屏时只挂主屏。
- 遮挡比例由宿主的原生采样线程计算（`wallpaper.rs` 的采样间隔有下限），插件不要自己根据鼠标位置猜「现在是不是被挡住」。
- 冻结与解冻次数不受限制，插件要保证反复冻结/解冻不会泄漏画布或计时器。
- 壁纸窗口随时可能被销毁重建（改分辨率、切换显示器、插件重载），所有订阅都要在卸载时释放。
