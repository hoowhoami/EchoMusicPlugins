# 插件独立浮窗与 Now Playing

EchoMusic 插件可以声明独立的受控浮窗，用于桌面悬浮歌词、轻量工具条等场景。浮窗由主进程创建，插件只提供窗口入口脚本和样式，不直接接触 `BrowserWindow`。

## Manifest

```json
{
  "id": "dynamic-island-lyric",
  "name": "灵动岛歌词",
  "version": "1.0.2",
  "icon": "icon.svg",
  "main": "index.js",
  "requires": {
    "echoMusicVersion": ">=2.2.6-beta.20"
  },
  "contributes": {
    "windows": [
      {
        "id": "island",
        "type": "floating",
        "title": "灵动岛歌词",
        "main": "island.js",
        "style": "island.css",
        "defaultWidth": 420,
        "defaultHeight": 72,
        "minWidth": 260,
        "minHeight": 56,
        "maxWidth": 720,
        "maxHeight": 180,
        "position": "top-center",
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "movable": true,
        "allowOutsideWorkArea": true,
        "acceptFirstMouse": true,
        "rememberBounds": true
      }
    ]
  }
}
```

窗口入口只允许插件目录内的 `.js` / `.mjs` 文件，样式只允许 `.css` 文件。

常用窗口字段：

| 字段 | 说明 |
| --- | --- |
| `transparent` | 是否创建透明背景窗口，默认 `true` |
| `alwaysOnTop` | 是否默认置顶，默认 `true` |
| `skipTaskbar` | 是否隐藏任务栏/Dock 窗口入口，默认 `true` |
| `resizable` / `movable` | 是否允许原生调整大小和移动 |
| `rememberBounds` | 是否记住窗口位置和大小，默认 `true` |
| `acceptFirstMouse` | macOS 下首次点击是否直接交给窗口内容 |
| `allowOutsideWorkArea` | 是否允许使用完整显示器范围，开启后可贴近或覆盖 Windows 任务栏区域 |

## 主插件入口

```js
export function activate(ctx) {
  ctx.windows.show("island", {
    width: 420,
    height: 72,
    alwaysOnTop: true,
  });
}

export function deactivate(ctx) {
  ctx.windows.close("island");
}
```

`ctx.windows` 会自动绑定当前插件 id，不能操作其他插件的窗口。`show(windowId, options?)` 支持临时覆盖 `width`、`height`、`x`、`y`、`alwaysOnTop` 和 `allowOutsideWorkArea`；不传时使用 manifest 中的默认尺寸、位置、置顶和边界设置。

`allowOutsideWorkArea: true` 会让宿主使用当前显示器完整 `bounds` 限制窗口，而不是排除任务栏/Dock/系统面板后的 `workArea`。这适合灵动岛歌词、桌面工具条等需要贴近或覆盖 Windows 任务栏区域的透明浮窗。默认值为 `false`，普通插件窗口仍会被限制在工作区内。

`alwaysOnTop` 可以在运行时切换。Windows/Linux 会直接更新置顶状态；macOS 如果需要在 `panel` 和普通浮窗类型之间切换，宿主会自动重建插件窗口并保留位置尺寸。

## 窗口入口

窗口脚本可以导出 `activateWindow(ctx)`、`activate(ctx)` 或默认函数。入口上下文独立于主插件上下文，只提供窗口渲染所需的 Vue、容器、私有存储、CSS 注入、Now Playing、字体、宿主图标、主题图标封面、音频频谱、受控文件、本地进程、原生网络、本地 Web 服务和当前窗口控制 API。

```js
export function activateWindow(ctx) {
  const { h, createApp, ref, onMounted, onBeforeUnmount } = ctx.vue;

  const App = {
    setup() {
      const snapshot = ref(null);
      let dispose = null;

      onMounted(async () => {
        snapshot.value = await ctx.nowPlaying.getSnapshot();
        dispose = ctx.nowPlaying.onSnapshot((next) => {
          snapshot.value = next;
        });
      });

      onBeforeUnmount(() => dispose?.());

      return () =>
        h(
          "div",
          { class: "island" },
          snapshot.value?.lyric?.lines[
            snapshot.value?.lyric?.currentIndex ?? -1
          ]?.text ||
            snapshot.value?.playback?.title ||
            "EchoMusic",
        );
    },
  };

  const app = createApp(App);
  app.mount(ctx.container);
  ctx.dispose(() => app.unmount());
}
```

浮窗上下文提供 `ctx.icons` 和 `ctx.cover.createThemedIconCoverUrl({ icon, color? })`。如果要生成和当前播放外观一致的图标封面，推荐显式使用 `ctx.nowPlaying` 快照里的主题色：

```js
const snapshot = await ctx.nowPlaying.getSnapshot();
const coverUrl = ctx.cover.createThemedIconCoverUrl({
  icon: ctx.icons.iconPulse,
  color: snapshot.appearance.accentColor,
});
```

## Now Playing

插件浮窗通过 `ctx.nowPlaying` 读取与订阅中性的当前播放快照：

- `getSnapshot()`：读取当前快照。
- `onSnapshot(handler)`：订阅播放、歌词、主题变化。
- `command(command)`：发送播放/歌词命令。

快照包含：

- `playback`：当前歌曲、封面、时长、进度、播放状态、我喜欢状态、私人 FM 状态（`isPersonalFM`，当前曲目是否来自私人 FM）、倍速和快照更新时间。
- `lyric`：歌词行、当前行索引、翻译/音译开关、歌词偏移、加载状态。
- `appearance`：深浅色、主题色、全局字体。

### 本地进度推算

`onSnapshot` 适合订阅状态变化，但它不是逐帧歌词时钟。`playback.currentTime` 和 `ctx.player.currentTime` 一样，表示播放引擎最近一次推送的离散进度（秒）；`playback.updatedAt` 是这次进度样本的时间戳。歌词滚动、桌面歌词这类对时序敏感的插件，应使用 `playback.currentTime`、`playback.updatedAt` 和 `playback.playbackRate` 在本地推算当前播放时间，再叠加 `lyric.timeOffset` 计算歌词行，避免显示慢半拍。

```js
function getEstimatedPlaybackMs(playback) {
  if (!playback) return 0;
  const baseMs = Math.max(0, Number(playback.currentTime || 0) * 1000);
  if (!playback.isPlaying) return baseMs;

  const updatedAt = Number(playback.updatedAt || Date.now());
  const playbackRate = Math.max(0.1, Number(playback.playbackRate || 1));
  const elapsedMs = Math.max(0, Date.now() - updatedAt) * playbackRate;
  const durationMs = Math.max(0, Number(playback.duration || 0) * 1000);
  const seekMs = baseMs + elapsedMs;

  return durationMs > 0 ? Math.min(seekMs, durationMs) : seekMs;
}

function getLyricSeekMs(snapshot) {
  return (
    getEstimatedPlaybackMs(snapshot.playback) +
    Number(snapshot.lyric?.timeOffset || 0)
  );
}
```

`lyric.currentIndex` 仍可作为降级显示依据；如果插件需要更顺滑的歌词体验，建议优先按推算后的时间在 `lyric.lines` 中查找当前行。

常用命令：

```js
ctx.nowPlaying.command("togglePlayback");
ctx.nowPlaying.command("previousTrack");
ctx.nowPlaying.command("nextTrack");
ctx.nowPlaying.command("toggleTranslation");
ctx.nowPlaying.command("toggleRomanization");
ctx.nowPlaying.command("lyricOffsetBackward");
ctx.nowPlaying.command("lyricOffsetForward");
ctx.nowPlaying.command("lyricOffsetReset");
```

字符串命令只能表达"开关"或"按固定步长前进/后退"这类无参语义（如 `seekForward` / `volumeUp` 在主窗口按设置项里的步长执行）。需要精确跳转或设置绝对音量时，使用对象命令：

```js
// 跳到指定秒数（会被 clamp 到 [0, duration]）
ctx.nowPlaying.command({ type: "seek", value: 42 });

// 设置绝对音量（0-100，会被 clamp 到 [0, 100]）
ctx.nowPlaying.command({ type: "setVolume", value: 35 });

// 相对调整音量（正值加、负值减，最终结果 clamp 到 [0, 100]）
ctx.nowPlaying.command({ type: "adjustVolume", value: -10 });
```

对象命令经过主进程转发到主窗口 `playerStore`，与字符串命令走同一通道，状态同步逻辑一致；可安全用于插件浮窗与桌面歌词等需要精确控制播放位置或音量的场景。


## 窗口控制

窗口入口中的 `ctx.window` 只控制当前插件窗口：

- `getBounds()`
- `move({ x, y, width, height })`
- `drag.bind(element)`：推荐的窗口拖动方式。宿主自动处理 pointer capture、取消、失焦、卸载、多屏 DPI 和 session 生命周期。
- `resize.bind(element, options)`：将元素绑定为当前浮窗的缩放手柄。
- `onCancelInteraction(handler)`：监听宿主取消当前拖动或缩放会话。
- `hide()`
- `close()`
- `setIgnoreMouseEvents(ignore)`
- `setAlwaysOnTop(alwaysOnTop)`
- `showOnTop(options?)`

`showOnTop()` 会把当前窗口抬到最前一次，但**不改变置顶状态**（不会变成 `alwaysOnTop`）：窗口隐藏时先显示，最小化时先还原，然后抬升层级。它适合“呼出/聚焦”这类一次性动作，而不是常驻置顶。

`options.focus` 默认 `true`：抢占焦点并激活窗口，能真正浮到其他应用窗口之上；设为 `false` 时退化为不抢焦点的轻抬（`showInactive` + 抬层），不打断当前输入，但在部分平台不保证压过其他应用的前台窗口。

```js
await ctx.window.showOnTop(); // 抢焦点，浮到最前
await ctx.window.showOnTop({ focus: false }); // 不打断输入，仅抬层
```

拖拽推荐使用 `ctx.window.drag.bind(element)`，不需要自行计算窗口坐标；锁定穿透仍由插件窗口 UI 自己决定。

### 拖动与缩放

窗口入口使用 `ctx.window.drag` / `ctx.window.resize` 控制当前浮窗；主插件入口使用 `ctx.windows.drag` / `ctx.windows.resize` 并显式传入已声明的 `windowId`。绑定方法返回清理函数，宿主也会在窗口销毁或插件停用时结束交互会话。

```js
const disposeDrag = ctx.window.drag.bind(titlebar);
const disposeResize = ctx.window.resize.bind(resizeHandle, {
  direction: "se",
  minWidth: 240,
  minHeight: 120,
});

ctx.dispose(disposeDrag);
ctx.dispose(disposeResize);
```

`direction` 支持 `n`、`ne`、`e`、`se`、`s`、`sw`、`w`、`nw`。最终边界会同时受到绑定参数、Manifest 窗口描述和显示器范围约束；Manifest 设置 `resizable: false` 时，宿主会拒绝缩放会话。

主入口控制其他已声明浮窗时传入窗口 id：

```js
const dispose = ctx.windows.resize.bind("panel", resizeHandle, {
  direction: "e",
});
ctx.dispose(dispose);
```

`startResize`、`resize`、`endResize` 和 `cancelResize` 等低层 API 继续保留给特殊集成；常规插件应优先使用 `bind()`，避免自行维护 pointer capture、失焦取消和多屏 DPI 状态。

`setAlwaysOnTop()` 适合在插件浮窗内部做“图钉”按钮。macOS 下宿主会在需要时重建窗口，以便在 `panel` 和普通浮窗类型之间切换；插件应先把置顶状态写入自己的设置，再调用该方法。

```js
async function togglePin(ctx, settings) {
  const nextAlwaysOnTop = !settings.alwaysOnTop;
  const nextSettings = { ...settings, alwaysOnTop: nextAlwaysOnTop };
  await ctx.storage.set("settings", nextSettings);
  await ctx.window.setAlwaysOnTop(nextAlwaysOnTop);
  return nextSettings;
}
```

主插件入口中的 `ctx.windows` 可以控制当前插件声明的任意窗口：

- `show(windowId, options?)`
- `hide(windowId)`
- `close(windowId)`
- `move(windowId, bounds)`
- `drag.bind(windowId, element)`：将 DOM 元素绑定为拖动区域。
- `resize.bind(windowId, element, options)`：将 DOM 元素绑定为缩放手柄。
- `getBounds(windowId)`
- `setIgnoreMouseEvents(windowId, ignore)`
- `showOnTop(windowId, options?)`
- `player`：浮窗播放控制入口，作用于全局主播放器。详见下文。

### `ctx.windows.player` 浮窗播放控制

`ctx.windows.player` 是面向"主插件入口管理多窗口时顺手控制播放"的轻量入口，**不带 windowId**（目标是全局唯一的主播放器），**不走 Pinia store**——所有方法直接转发到主进程 player IPC 或 `now-playing:command` 通道。与顶层 `ctx.player`（响应式 store 模式，含 `currentTime / volume / isPlaying` 等 computed 状态）互补：需要响应式状态订阅用 `ctx.player`，只需要一次性控制动作用 `ctx.windows.player`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `play()` | `player:play` IPC | 强制开始播放（不切换暂停状态） |
| `pause()` | `player:pause` IPC | 强制暂停 |
| `stop()` | `player:stop` IPC | 停止播放并释放当前源 |
| `seek(time)` | `player:seek` IPC | 跳到指定秒数（秒，非毫秒） |
| `setVolume(volume)` | `player:set-volume` IPC | 设置绝对音量，0-100 |
| `adjustVolume(delta)` | `getState → +delta → clamp[0,100] → setVolume` | 相对调整音量；先读当前 volume，再加 delta 并裁剪到 `[0, 100]` 写回 |
| `setSpeed(speed)` | `player:set-speed` IPC | 设置播放速率（如 1.0、1.5、0.75） |
| `toggleMute()` | `now-playing:command('toggleMute')` | 切换静音，复用主窗口 `lastNonZeroVolume` 恢复逻辑 |
| `togglePlayMode()` | `now-playing:command('togglePlayMode')` | 循环切换播放模式：顺序 → 列表 → 随机 → 单曲循环 → 顺序 |
| `getState()` | `player:get-state` IPC | 返回 `{ playing, paused, duration, timePos, volume, speed, idle, path, audioDevice } \| null` |

```js
// 跳到副歌段
await ctx.windows.player.seek(95);

// 音量下调 10
await ctx.windows.player.adjustVolume(-10);

// 一键静音 / 恢复
await ctx.windows.player.toggleMute();

// 读取当前播放状态（注意可能为 null，例如播放器尚未初始化）
const state = await ctx.windows.player.getState();
if (state) {
  console.log(state.timePos, '/', state.duration, 'volume:', state.volume);
}
```

`adjustVolume` 是组合操作：先 `getState()` 读 `volume`，加 `delta` 并 clamp 到 `[0, 100]` 再 `setVolume` 写回。这意味着频繁调用可能因竞态看到旧值；如需精确控制，应直接使用 `setVolume(absoluteValue)`。

`toggleMute` 与 `togglePlayMode` 走 `now-playing:command` 通道而非 player IPC：mute 的 `lastNonZeroVolume` 恢复逻辑、playMode 的循环切换逻辑都在主窗口 `playerStore` 内，复用它们能避免重复实现且保证 UI 状态一致。

窗口入口（`EchoPluginWindowContext`）**没有** `ctx.windows.player`——窗口入口里只能通过 `ctx.nowPlaying.command(...)` 控制播放（包括上面新增的对象命令）。

窗口入口中的 `ctx.webServer` 与主插件入口一致，可用 `listen(handler, options?)` 创建仅监听 `127.0.0.1` 的本地 HTTP 服务。需要声明 `capabilities.webServer: true`；服务会在插件窗口销毁、插件禁用/卸载或应用退出时自动关闭。

窗口入口中的 `ctx.sqlite` 与主插件入口一致，可用 `open(options?)` 打开当前插件的私有 SQLite 数据库，并使用 `db.exec/run/get/all/transaction/close` 操作数据。使用前仍需在 manifest 中声明 `capabilities.sqlite: true`；数据库按插件 id 隔离，窗口销毁、插件禁用/卸载或安全模式开启时会由宿主关闭连接。

`ctx.windows.showOnTop(windowId, options?)` 与窗口入口的 `ctx.window.showOnTop()` 行为一致，只是按 windowId 指定目标插件窗口；`options.focus` 默认 `true`。

主入口也可以通过 `ctx.windows.show(windowId, { alwaysOnTop })` 临时切换置顶状态；窗口入口内更推荐使用 `ctx.window.setAlwaysOnTop()`。

## 宿主窗口（主窗口 / mini 播放器）

主插件入口和窗口入口都提供 `ctx.host`，用于把**宿主窗口**抬到最前（同样不改变置顶状态）：

- `showOnTop(target?, options?)`，`target` 为 `'main' | 'mini-player'`，默认 `'main'`；`options.focus` 默认 `true`。

```js
await ctx.host.showOnTop(); // 等价于 'main'，呼出主窗口
await ctx.host.showOnTop('mini-player'); // 呼出 mini 播放器窗口
await ctx.host.showOnTop('main', { focus: false }); // 仅抬层，不抢焦点
```

`'mini-player'` 仅在 mini 播放器已开启时生效；未开启时返回 `{ ok: false, error: 'mini 播放器未开启' }`，不会自动切换到 mini 模式。桌面歌词有独立的置顶开关，不在 `ctx.host` 覆盖范围内。

窗口入口中的 `ctx.process` 与主插件入口一致，也只会绑定当前插件 id。使用前仍需在 manifest 中声明 `capabilities.process: true`，详见[插件开发指南的“本地辅助进程”章节](plugin-development.md#本地辅助进程)。

窗口入口中的 `ctx.net.fetch` / `ctx.net.request` 与主插件入口一致。需要绕过 Chromium 禁止请求头规则并精确设置 `User-Agent`、`Referer`、`Cookie` 等字段时，应声明 `capabilities.unrestrictedNetwork: true` 后使用 `ctx.net.request`；该接口由主进程 Axios Node adapter 执行，请求会在窗口销毁时自动取消，详细语义见[插件开发指南的“原生网络请求”章节](plugin-development.md#原生网络请求)。

窗口入口中的 `ctx.audio.spectrum` 与主插件入口一致，用于读取或订阅音频频谱。使用前仍需在 manifest 中声明 `capabilities.audioSpectrum: true`。

窗口入口中的 `ctx.fs` 与主插件入口一致，用于将本地文件转换为可渲染 URL，或在声明 `capabilities.localFiles: true` 后扫描、读取本地媒体文件、读取音频 metadata，以及写入当前插件目录内的缓存、图片或导出文件。`readAudioMetadata(filePath)` 需要包含该 API 的 EchoMusic 主程序版本；依赖它的插件应通过 `requires.echoMusicVersion` 做版本门槛。

窗口入口中的 `ctx.fonts` 与主插件入口一致，可通过 `getAll()` 获取系统字体列表，通过 `getOptions({ includeFollow: true })` 获取适合设置面板的字体选项，通过 `buildFamily(fontName)` 构建可直接用于 inline style 的 CSS `font-family`。
