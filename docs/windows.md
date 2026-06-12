# 插件浮窗与 Now Playing

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

窗口脚本可以导出 `activateWindow(ctx)`、`activate(ctx)` 或默认函数。入口上下文独立于主插件上下文，只提供窗口渲染所需的 Vue、容器、私有存储、CSS 注入、Now Playing、音频频谱、受控文件、本地进程和当前窗口控制 API。

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

## Now Playing

插件浮窗通过 `ctx.nowPlaying` 读取与订阅中性的当前播放快照：

- `getSnapshot()`：读取当前快照。
- `onSnapshot(handler)`：订阅播放、歌词、主题变化。
- `command(command)`：发送播放/歌词命令。

快照包含：

- `playback`：当前歌曲、封面、时长、进度、播放状态、倍速和快照更新时间。
- `lyric`：歌词行、当前行索引、翻译/音译开关、歌词偏移、加载状态。
- `appearance`：深浅色、主题色、全局字体。

### 本地进度推算

`onSnapshot` 适合订阅状态变化，但它不是逐帧歌词时钟。歌词滚动、桌面歌词这类对时序敏感的插件，应使用 `playback.currentTime`、`playback.updatedAt` 和 `playback.playbackRate` 在本地推算当前播放时间，再叠加 `lyric.timeOffset` 计算歌词行，避免显示慢半拍。

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

## 窗口控制

窗口入口中的 `ctx.window` 只控制当前插件窗口：

- `getBounds()`
- `move({ x, y, width, height })`
- `hide()`
- `close()`
- `setIgnoreMouseEvents(ignore)`
- `setAlwaysOnTop(alwaysOnTop)`

拖拽和锁定穿透应由插件窗口 UI 自己决定，但最终移动与穿透仍通过宿主 IPC 执行。

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
- `getBounds(windowId)`
- `setIgnoreMouseEvents(windowId, ignore)`

主入口也可以通过 `ctx.windows.show(windowId, { alwaysOnTop })` 临时切换置顶状态；窗口入口内更推荐使用 `ctx.window.setAlwaysOnTop()`。

窗口入口中的 `ctx.process` 与主插件入口一致，也只会绑定当前插件 id。使用前仍需在 manifest 中声明 `capabilities.process: true`，详见主 README 的“本地辅助进程”章节。

窗口入口中的 `ctx.audio.spectrum` 与主插件入口一致，用于读取或订阅音频频谱。使用前仍需在 manifest 中声明 `capabilities.audioSpectrum: true`。

窗口入口中的 `ctx.fs` 与主插件入口一致，用于将本地文件转换为可渲染 URL，或在声明 `capabilities.localFiles: true` 后扫描/读取本地媒体文件。
