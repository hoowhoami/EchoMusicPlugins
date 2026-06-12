# EchoMusic 插件系统

本仓库收录 EchoMusic 插件开发文档与示例插件。

## 在线插件源

EchoMusic 2.2.6-beta.11 起支持在"插件管理"中浏览在线插件源。本仓库根目录提供 `echo-plugins.json`，可以直接作为插件源添加：

```text
https://github.com/hoowhoami/EchoMusicPlugins
```

添加后，EchoMusic 会读取仓库根目录的 `echo-plugins.json`。这个文件只是插件源索引，负责告诉 EchoMusic“有哪些插件、插件仓库在哪里、插件目录在哪里”。插件的名称、版本、描述、作者、图标、入口文件、能力声明和兼容性要求，都以插件仓库里的 `manifest.json` 为准。

刷新在线插件列表时，EchoMusic 会先读取插件源索引，再根据每个条目的 `repo` 和 `path` 读取对应插件目录下的 `manifest.json`。安装时会下载插件仓库 zip，只提取 `path` 指向的目录并再次校验其中的 `manifest.json`。

插件源索引格式：

```json
{
  "name": "EchoMusic 官方插件源",
  "homepage": "https://github.com/hoowhoami/EchoMusicPlugins",
  "plugins": [
    {
      "id": "hello-echo",
      "path": "hello-echo",
      "repo": "https://github.com/owner/repo",
      "homepage": "https://github.com/owner/repo/tree/main/hello-echo",
      "tags": ["example"]
    }
  ]
}
```

字段说明：

- `id`：推荐填写。用于标识索引条目；如果填写，必须和插件 `manifest.json` 中的 `id` 一致。
- `path` / `packagePath`：可选。插件目录相对仓库 zip 根目录的路径，目录内必须包含 `manifest.json`。留空字符串时表示插件就在仓库根目录。
- `repo`：可选。插件源码仓库地址；留空时默认使用插件源仓库。可以填写 `owner/repo` 或 GitHub 仓库 URL。
- `homepage`：可选。插件详情页或说明页地址，主要用于展示。
- `tags`：可选。用于在线插件列表的分类和搜索。

不要在 `echo-plugins.json` 中维护插件 `version`、`description`、`author`、`icon`、`main`、`style`、`capabilities`、`requires` 等字段。这些信息属于插件自身清单，应写在插件目录的 `manifest.json` 中。插件更新版本时，只需要更新插件仓库里的 `manifest.json`，插件源索引无需同步修改版本号。

插件目录中的 `manifest.json` 示例：

```json
{
  "id": "hello-echo",
  "name": "Hello Echo",
  "version": "1.0.0",
  "description": "EchoMusic 插件示例",
  "author": "EchoMusic User",
  "icon": "icon.svg",
  "main": "index.js",
  "requires": {
    "echoMusicVersion": ">=2.2.6"
  }
}
```

如果插件本身就是一个独立 GitHub 仓库，并且 `manifest.json` 位于仓库根目录，可以这样写：

```json
{
  "id": "echo-hello",
  "path": "",
  "repo": "https://github.com/xxx/echo-hello",
  "homepage": "https://github.com/xxx/echo-hello",
  "tags": ["lyrics"]
}
```

如果插件仓库中还有外层目录，例如 zip 解压后需要安装 `packages/echo-plugin`，则把 `path` 写成对应相对路径即可。EchoMusic 会读取 `packages/echo-plugin/manifest.json` 作为该插件的权威清单。

## 插件开发文档

EchoMusic 支持在线插件源和本地插件。用户可以在"插件管理"中添加 GitHub 插件源并在线安装，也可以手动将插件目录放入本地插件目录后启用。插件定位接近 VS Code / Obsidian 的高自由度本地扩展：插件可以注册 UI、监听播放器状态、访问 Pinia store、注入 CSS、调用受控的播放器/队列/存储 API，也可以通过 selector 把 Vue 组件挂到主界面的任意 DOM 位置。

扩展文档：

- [插件浮窗与 Now Playing](docs/windows.md)：声明独立桌面浮窗、订阅当前播放/歌词快照、发送播放与歌词命令。
- `water-lyrics`：页面歌词动效示例，演示 `ctx.lyricEffects.register()` 的 style/decorator 接入方式。

插件属于用户信任后运行的本地代码。当前插件运行在渲染进程的浏览器 ESM 环境中，EchoMusic 不声明也不伪装成权限沙箱；请只启用来源可信的插件。如果插件导致界面异常，可以在插件管理页启用"插件安全模式"、禁用或卸载对应插件。

## 安全模式与故障恢复

"插件管理"提供全局插件安全模式。开启后不会加载任何插件，但会保留每个插件原本的启用状态，方便排查后恢复。

EchoMusic 会记录插件启动阶段和运行阶段的活动插件列表。如果插件导致渲染进程异常退出，主进程会尝试自动切到安全模式并重载主窗口；如果应用被迫关闭或渲染进程无响应，下次启动时也会自动进入安全模式。插件管理页会在对应插件卡片上用警告标记展示启动失败、运行异常或最近一次疑似故障；点击后可查看异常来源、时间、消息和堆栈，也可以清除该插件的异常记录。也可以通过命令行主动进入安全模式：

```bash
EchoMusic --safe-mode
```

开发环境可使用：

```bash
pnpm exec electron . --safe-mode
```

插件禁用或卸载前，运行时会调用插件的 `deactivate(ctx)`，随后清理通过宿主 API 注册的页面、统一设置、歌曲菜单、命令、事件监听、`ctx.css.inject` 样式、manifest 样式、`ctx.lyricEffects` 歌词动效、`ctx.ui.mount` / `ctx.ui.teleport` 挂载组件和 `ctx.dom.observe` 监听。插件如果直接修改 DOM 或注册了宿主无法感知的全局副作用，应通过 `ctx.dispose(() => ...)` 或 `deactivate(ctx)` 自行归还。

卸载插件会删除插件目录、移除启用状态、清除已追踪的插件私有 KV 数据，并清除与该插件相关的最近故障记录。

## 插件目录

在"插件管理"中点击"打开目录"。EchoMusic 的本地插件目录会直接包含各个插件文件夹；本仓库中的 `cover-fallback`、`lyric-info-scroll` 这类文件夹复制进去即可，不需要额外套一层 `plugins`。

```text
<EchoMusic 插件目录>/
  hello-echo/
    manifest.json
    index.js
    style.css
```

## manifest.json

```json
{
  "id": "hello-echo",
  "name": "Hello Echo",
  "version": "1.0.0",
  "description": "EchoMusic 插件示例",
  "author": "EchoMusic User",
  "icon": "icon.svg",
  "main": "index.js",
  "style": "style.css",
  "runtime": {
    "miniPlayer": false,
    "desktopLyric": false
  },
  "capabilities": {
    "audioSource": false,
    "audioSpectrum": false,
    "kugouApi": false,
    "localFiles": false,
    "lyricEffects": false,
    "lyrics": false,
    "process": false
  },
  "requires": {
    "echoMusicVersion": ">=2.2.6-beta.9"
  }
}
```

`main` 默认为 `index.js`，支持 `.js` / `.mjs`。`style` 可选，仅支持 `.css`。
`icon` 可选，用于插件管理页卡片图标，建议使用插件根目录下的 `icon.svg`。该字段支持插件目录内的相对图片路径、`https` 图片和 `data:image/*`。

`runtime.miniPlayer` 可选。设为 `true` 后，EchoMusic 会在 mini 播放器窗口中单独加载该插件。mini 是独立窗口，只需要影响主窗口的插件不应开启该项；如果插件同时影响主窗口和 mini 窗口，需要把两边看成两个独立运行时，它们不共享 JS 内存。

`runtime.desktopLyric` 可选。设为 `true` 后，EchoMusic 会在桌面歌词窗口中单独加载该插件。桌面歌词同样是独立窗口，只需要影响主窗口或 mini 窗口的插件不应开启该项。

`capabilities.audioSource` 可选。插件如需通过 `ctx.player.audioSource.register()` 接管特定歌曲的播放 URL 解析，必须显式设为 `true`。适合 WebDAV、本地媒体库、私有网盘或其他自定义来源的歌曲。

`capabilities.kugouApi` 可选。插件如需通过 `ctx.kugou` 调用 EchoMusic 内置的酷狗音乐、歌词、写真和推荐接口，必须显式设为 `true`。插件只传业务参数，不需要也不能传入 token、dfid、mid 等鉴权信息；宿主会使用当前 EchoMusic 登录态和设备态完成请求。

`capabilities.audioSpectrum` 可选。插件如需通过 `ctx.audio.spectrum` 读取或订阅音频频谱数据，必须显式设为 `true`。该能力会启动系统音频捕获订阅，请只在可视化或音频分析插件中声明。

`capabilities.localFiles` 可选。插件如需通过 `ctx.fs.listFiles()` 扫描本地音乐目录，或通过 `ctx.fs.readTextFile()` / `ctx.fs.readFileBytes()` 读取用户本地文件内容，必须显式设为 `true`。适合本地播放、本地媒体库、CUE/M3U/LRC 解析等插件。播放音频文件本身应使用 `ctx.fs.getFileUrl()` 转成 URL 后交给播放器，不要通过 IPC 读取整首音频。

`capabilities.lyricEffects` 可选。插件如需通过 `ctx.lyricEffects.register()` 调整页面歌词排版、动效或挂载歌词装饰层，必须显式设为 `true`。适合水波歌词、KTV 字幕模板、当前行辉光、歌词背景水印等视觉插件。该能力只影响页面歌词显示，不提供歌词内容解析；提供歌词内容请使用 `capabilities.lyrics`。

`capabilities.lyrics` 可选。插件如需通过 `ctx.lyrics.registerResolver()` 为特定歌曲提供歌词内容，必须显式设为 `true`。适合 WebDAV 旁挂 `.lrc`、本地媒体库内嵌歌词或私有歌词服务。

`capabilities.process` 可选。插件如需通过 `ctx.process.launch()` 启动插件目录内的本地辅助程序，必须显式设为 `true`。未声明时主程序会拒绝启动进程。该能力只表示插件可以请求启动自己目录内的可执行文件，不表示启动后的程序运行在沙箱内。

`requires.echoMusicVersion` 可选，表示插件要求的 EchoMusic 主程序版本范围，使用 semver range。常见写法是 `>=2.2.6`；如果插件明确不支持下一个大版本，也可以写 `>=2.2.6 <3`。如果只写 `2.2.6`，EchoMusic 会按 `>=2.2.6` 处理。版本范围写错会被标记为 manifest 无效；范围有效但当前主程序不满足时，插件管理页会提示“版本不兼容”并阻止启用。

`contributes.windows` 可选，用于声明由主进程创建的插件独立浮窗，详见 [插件浮窗与 Now Playing](docs/windows.md)。窗口清单支持 `transparent`、`alwaysOnTop`、`skipTaskbar`、`rememberBounds` 等显示参数；`allowOutsideWorkArea: true` 可允许透明浮窗使用完整显示器范围，适合需要贴近或覆盖 Windows 任务栏区域的歌词/工具条插件。窗口入口中的 `ctx.window.setAlwaysOnTop(alwaysOnTop)` 可用于实现浮窗内的图钉按钮；macOS 下宿主会在需要时重建窗口以切换 `panel` / `toolbar` 类型。

## 最小插件

```js
export function activate(ctx) {
  ctx.toast.success(`${ctx.manifest.name} 已启用`);

  const { defineAsyncComponent, defineComponent, h, ref } = ctx.vue;
  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);

  const SettingsPanel = defineComponent({
    setup() {
      const enabled = ref(true);

      ctx.storage.get("settings").then((saved) => {
        if (saved && typeof saved.enabled === "boolean") {
          enabled.value = saved.enabled;
        }
      });

      const save = async () => {
        await ctx.storage.set("settings", { enabled: enabled.value });
        ctx.toast.info(enabled.value ? "提示已启用" : "提示已关闭");
      };

      return () =>
        h("div", { style: "display: grid; gap: 12px;" }, [
          h(
            "label",
            {
              style:
                "display: flex; justify-content: space-between; gap: 12px;",
            },
            [
              h("span", "启用提示"),
              h(Switch, {
                modelValue: enabled.value,
                "onUpdate:modelValue": (value) => {
                  enabled.value = Boolean(value);
                },
              }),
            ],
          ),
          h(Button, { size: "xs", onClick: save }, { default: () => "保存" }),
        ]);
    },
  });

  ctx.ui.settings.define({
    title: "Hello Echo 设置",
    component: SettingsPanel,
  });

  ctx.ui.addSongContextMenuItem({
    id: "copy-song-title",
    label: "复制歌曲标题",
    async onSelect(song) {
      await navigator.clipboard.writeText(song.title || "");
      ctx.toast.success("已复制歌曲标题");
    },
  });

  ctx.events.onTrackChange((track) => {
    console.log("[hello-echo] track changed:", track);
  });
}
```

插件入口是浏览器 ESM 单文件。未打包插件不要直接写 `import { defineComponent } from 'vue'` 这类 bare import；可以使用 `ctx.vue`：

```js
export default {
  activate(ctx) {
    const Page = ctx.vue.defineComponent({
      setup() {
        return () =>
          ctx.vue.h("div", { class: "hello-page" }, [
            ctx.vue.h("h2", "Hello Echo"),
            ctx.vue.h("p", "这是插件注册的独立页面。"),
          ]);
      },
    });

    ctx.ui.addPage({
      id: "home",
      title: "Hello Echo",
      icon: "tabler:sparkles",
      component: Page,
      sidebar: true,
    });
  },
};
```

如果要使用 TypeScript、Vue SFC 或第三方依赖，请自行将插件打包为单文件 ESM，再放入插件目录。

## 可用上下文

插件的 `activate(ctx)` 会获得高自由度宿主上下文：

| API                                                                   | 说明                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.vue`                                                             | Vue 运行时，包含 `defineComponent`、`h`、`ref`、`computed`、`watch` 等                                                                                                                                                                                                                                                                                                                                        |
| `ctx.app` / `ctx.router` / `ctx.pinia`                                | 主应用实例、路由和 Pinia 实例                                                                                                                                                                                                                                                                                                                                                                                 |
| `ctx.stores.player` / `.playlist` / `.lyric` / `.settings` / `.theme` | 应用核心 store                                                                                                                                                                                                                                                                                                                                                                                                |
| `ctx.player`                                                          | 播放控制便捷 API：`currentTrack/currentTrackId/currentTime/duration/isPlaying/playbackRate/volume/playMode`（computed）、`play()`、`playTrack()`、`playSong()`、`playNext()`、`replaceQueueAndPlay()`、`toggle()`、`stop()`、`next()`、`prev()`、`seek(time)`、`setVolume(vol)`、`setPlaybackRate(rate)`、`setPlayMode(mode)`、`setAudioQuality(quality)`、`setAudioEffect(effect)`、`toggleLyricView(open?)` |
| `ctx.player.audioSource.register(options)`                            | 注册自定义音源解析器，要求 manifest 声明 `capabilities.audioSource: true`                                                                                                                                                                                                                                                                                                                                     |
| `ctx.audio.spectrum`                                                  | 读取或订阅音频频谱：`getStatus()`、`getSnapshot()`、`subscribe(options, handler)`，要求 manifest 声明 `capabilities.audioSpectrum: true`                                                                                                                                                                                                                                                                      |
| `ctx.playlist`                                                        | 播放队列便捷 API：读取当前队列/队列歌曲、替换队列、追加歌曲、播放歌曲、加入下一首、清空、移除、重排和切换活动队列                                                                                                                                                                                                                                                                                             |
| `ctx.lyric` / `ctx.settings`                                          | 歌词 store 与设置 store 的快捷引用，等价于 `ctx.stores.lyric` / `ctx.stores.settings`                                                                                                                                                                                                                                                                                                                         |
| `ctx.lyrics`                                                          | 歌词稳定 API：`registerResolver(options)` 注册自定义歌词解析器（要求 `capabilities.lyrics: true`）、`getSnapshot()`、`onSnapshot(handler)`、`command(command)`                                                                                                                                                                                                                                                |
| `ctx.lyricEffects`                                                    | 页面歌词动效 API：`register(options)` 注册歌词视觉效果（要求 `capabilities.lyricEffects: true`），支持注入 CSS class、挂载 overlay 装饰层、订阅歌词播放快照                                                                                                                                                                                                                                                    |
| `ctx.appearance`                                                      | 外观快照 API：`getSnapshot()` / `onSnapshot(handler)`，读取深浅色、主题色和字体信息                                                                                                                                                                                                                                                                                                                           |
| `ctx.kugou`                                                           | 调用 EchoMusic 内置酷狗业务接口，要求 manifest 声明 `capabilities.kugouApi: true`；鉴权信息由宿主自动注入                                                                                                                                                                                                                                                                                                     |
| `ctx.storage`                                                         | 插件私有 KV 存储，按插件 id 自动隔离                                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.dialog.selectDirectory(options?)`                                | 打开系统文件夹选择对话框，返回 `{ canceled, paths }`                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.dialog.selectFiles(options?)`                                    | 打开系统文件选择对话框，支持 `multiple` 和 `filters`                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.fs.listFiles(directory, options?)`                               | 枚举本地文件，支持 `recursive`、`limit`、`kinds`、`extensions`、`includeHidden` 和 `maxDepth`，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                             |
| `ctx.fs.listImageFiles(directory, options?)`                          | 枚举指定文件夹内图片，返回文件路径、`file://` URL、大小和修改时间；兼容旧插件，建议新插件优先使用 `ctx.fs.listFiles()`                                                                                                                                                                                                                                                                                        |
| `ctx.fs.getFileUrl(filePath)`                                         | 将用户选择的本地文件路径转换为可播放或可渲染的 `file://` URL                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.fs.readTextFile(filePath, options?)`                             | 读取本地文本文件片段，默认最多 1 MB，最大 4 MB，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                                                                            |
| `ctx.fs.readFileBytes(filePath, options?)`                            | 读取本地文件字节片段，适合解析音频头部或标签，默认最多 1 MB，最大 4 MB，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                                                    |
| `ctx.process.launch(options)`                                         | 启动插件目录内的本地辅助程序，要求 manifest 声明 `capabilities.process: true`                                                                                                                                                                                                                                                                                                                                 |
| `ctx.process.terminate(pid)`                                          | 终止当前插件通过 `ctx.process.launch()` 启动的进程                                                                                                                                                                                                                                                                                                                                                            |
| `ctx.theme.surface.set(options)`                                      | 请求宿主调整主界面表面透明度和模糊效果，适合背景图、沉浸皮肤等插件                                                                                                                                                                                                                                                                                                                                            |
| `ctx.theme.surface.clear()`                                           | 清理当前插件提交的表面效果                                                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.theme.pageTransition.set(options)`                               | 请求宿主调整页面切换动效，适合页面动效和无障碍偏好插件                                                                                                                                                                                                                                                                                                                                                        |
| `ctx.theme.pageTransition.clear()`                                    | 清理当前插件提交的页面动效设置                                                                                                                                                                                                                                                                                                                                                                                |
| `ctx.nowPlaying`                                                      | 当前播放/歌词/外观快照 API，可读取快照、订阅变化、发送播放与歌词命令                                                                                                                                                                                                                                                                                                                                          |
| `ctx.scroll`                                                          | 页面滚动容器 API：`queryContainers()`、`getCurrentContainer()`、`getState(el)`、`scrollToTop(el?)`、`scrollToBottom(el?)`、`observeContainers(handler)`；用于滚动增强插件，避免依赖宿主内部 DOM 类名                                                                                                                                                                                                            |
| `ctx.windows`                                                         | 控制当前插件在 manifest 中声明的独立窗口：`show()`、`hide()`、`close()`、`move()`、`getBounds()`、`setIgnoreMouseEvents()` 等；`show()` 可临时覆盖 `alwaysOnTop` 和 `allowOutsideWorkArea`                                                                                                                                                                                                                     |
| `ctx.toast`                                                           | 应用内提示：`info()`、`success()`、`warning()`、`danger()`                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.net.fetch`                                                       | 网络请求                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ctx.electron`                                                        | 当前 preload 暴露的 Electron API                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.electron.platform`                                               | 当前平台：`'darwin'` / `'win32'` / `'linux'`                                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.css.inject(cssText, options?)`                                   | 注入全局 CSS，禁用插件时自动清理                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.commands.register(id, handler)`                                  | 注册插件命令                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.events.onTrackChange(handler)`                                   | 监听当前曲目变化                                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.events.onPlaybackChange(handler)`                                | 监听播放/暂停状态变化                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.dom.query(selector)` / `ctx.dom.queryAll(selector)`              | 查询主界面 DOM                                                                                                                                                                                                                                                                                                                                                                                                |
| `ctx.dom.observe(selector, handler)`                                  | 监听动态出现的 DOM，禁用插件时自动断开                                                                                                                                                                                                                                                                                                                                                                        |
| `ctx.ui.settings.define(options)`                                     | 声明插件设置入口，必须提供自定义 Vue 组件                                                                                                                                                                                                                                                                                                                                                                     |
| `ctx.ui.sidebar.addItem(item)`                                        | 注册正式侧边栏导航入口，支持路由匹配、高亮和折叠侧栏图标                                                                                                                                                                                                                                                                                                                                                      |
| `ctx.ui.cover.setFallback(resolver)`                                  | 设置无封面或封面加载失败时的兜底图片 URL，resolver 必须同步返回字符串                                                                                                                                                                                                                                                                                                                                         |
| `ctx.ui.components`                                                   | 异步加载宿主 UI 组件：`Avatar`、`Badge`、`Button`、`Cover`、`Dialog`、`Drawer`、`Input`、`InputNumber`、`Popover`、`Scrollbar`、`Select`、`Slider`、`Switch`、`Tabs`、`TabsContent`、`TabsList`、`TabsTrigger`、`Textarea`、`Tooltip`                                                                                                                                                                         |
| `ctx.icons`                                                           | 宿主图标库（Iconify 格式）                                                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.commands.execute(id, ...args)`                                   | 执行已注册的插件命令                                                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.dispose(fn)`                                                     | 注册资源清理回调，禁用时自动调用                                                                                                                                                                                                                                                                                                                                                                              |

### 平台判断

```js
const isMac = ctx.electron.platform === "darwin";
const isWindows = ctx.electron.platform === "win32";
const isLinux = ctx.electron.platform === "linux";
```

### 本地辅助进程

插件可以用 `ctx.process.launch(options)` 启动随插件一起分发的本地辅助程序。使用前必须在 `manifest.json` 中声明：

```json
{
  "capabilities": {
    "process": true
  }
}
```

启动规则：

- `executable` 必须是插件目录内的相对路径。EchoMusic 会解析真实路径，阻止通过 `..` 或符号链接跳出插件目录。
- 启动使用 Node.js `spawn` 且 `shell: false`，不接受 shell 命令字符串；参数只能通过 `args: string[]` 传入。
- `cwd` 可选，默认是插件目录；如果传入，也必须位于插件目录内。
- Windows 只支持 `.exe` / `.com`；macOS 和 Linux 要求目标文件具有执行权限。
- 首次启动每个插件的每个可执行文件前，EchoMusic 会提示用户确认风险。授权按插件 id、插件版本、可执行文件相对路径和 SHA-256 记录；插件升级、路径变化或文件内容变化后会重新确认。
- 插件禁用、安全模式、卸载、更新或应用退出时，EchoMusic 会尝试终止该插件启动的进程。

```js
let helperPid = 0;

export async function activate(ctx) {
  const result = await ctx.process.launch({
    executable:
      ctx.electron.platform === "win32" ? "bin/helper.exe" : "bin/helper",
    args: ["--plugin-id", ctx.id],
    cwd: "bin",
    env: {
      ECHO_HELPER_MODE: "plugin",
    },
  });

  if (!result.ok) {
    if (!result.canceled) ctx.toast.warning(result.error);
    return;
  }

  helperPid = result.pid;
}

export async function deactivate(ctx) {
  if (helperPid) await ctx.process.terminate(helperPid);
}
```

该能力只是限制“从哪里启动”和“由谁确认”。启动后的程序拥有当前系统用户权限，可能访问本地文件、网络和系统资源；请只在确实需要原生能力且用户能够理解风险时使用。

### 响应式访问播放状态

`ctx.player.currentTrack` 和 `ctx.player.isPlaying` 是 Vue `computed`，在 Vue 组件的 `setup` 中直接使用即可自动响应更新：

```js
const MyWidget = ctx.vue.defineComponent({
  setup() {
    const track = ctx.player.currentTrack;
    const playing = ctx.player.isPlaying;
    return () =>
      ctx.vue.h("span", playing.value ? `♫ ${track.value?.title}` : "已暂停");
  },
});
```

在非组件上下文中，也可以用 `ctx.vue.watch` 监听：

```js
ctx.vue.watch(ctx.player.currentTrack, (track) => {
  console.log("曲目变化:", track?.title);
});
```

### 自定义音源解析

插件可以注册音源解析器，在 EchoMusic 内置酷狗/云盘解析前优先处理特定歌曲。典型场景是 WebDAV 或私有媒体库：歌曲对象已经带有自己的播放地址，不应再走酷狗 `hash` 解析。

使用前在 manifest 中声明：

```json
{
  "capabilities": {
    "audioSource": true
  }
}
```

注册示例：

```js
export function activate(ctx) {
  ctx.player.audioSource.register({
    id: "webdav",
    order: 100,
    match({ track }) {
      return track.source === "webdav" && Boolean(track.audioUrl);
    },
    resolve({ track }) {
      return {
        url: track.audioUrl,
        quality: "flac",
        effect: "none",
        timeLength: (track.duration || 0) * 1000,
      };
    },
  });
}
```

`resolve` 可以返回字符串 URL，也可以返回对象：

```ts
{
  url: string;
  quality?: "128" | "320" | "flac" | "high" | "super";
  effect?: "none";
  loudness?: { lufs: number; gain: number; peak: number };
  timeLength?: number; // 毫秒
}
```

`match` 和 `resolve` 都可以是异步函数。多个插件同时注册时，`order` 越小越先执行；第一个返回有效 `url` 的 resolver 会接管本次播放。返回 `null`、`undefined`、`false` 或空 URL 时，EchoMusic 会继续尝试下一个插件 resolver，最后回到内置解析流程。

为了让没有酷狗 `hash` 的自定义歌曲可以进入播放流程，插件导入的歌曲至少应提供 `audioUrl`，并设置可识别的 `source`，例如 `source: "webdav"`。如果播放地址需要临时签名，也可以在 `resolve` 中按需刷新 URL 后返回。

### 自定义歌词解析

插件可以注册歌词解析器，在 EchoMusic 内置酷狗歌词搜索前优先处理特定歌曲。典型场景是 WebDAV 歌曲旁边有同名 `.lrc` 文件，或私有媒体库能直接返回歌词内容。

使用前在 manifest 中声明：

```json
{
  "capabilities": {
    "lyrics": true
  }
}
```

注册示例：

```js
export function activate(ctx) {
  ctx.lyrics.registerResolver({
    id: "webdav-lrc",
    order: 100,
    match({ track }) {
      return track?.source === "webdav";
    },
    async resolve({ track }) {
      const lrc = await loadWebDavSidecarLrc(track);
      if (!lrc) return null;
      return {
        source: "WebDAV",
        lyric: lrc,
      };
    },
  });
}
```

`resolve` 可以返回 LRC/KRC/YRC 字符串，也可以返回对象：

```ts
{
  lyric?: string;
  decodeContent?: string;
  content?: string;
  source?: string;
}
```

`match` 和 `resolve` 都可以是异步函数。多个插件同时注册时，`order` 越小越先执行；第一个返回有效歌词文本的 resolver 会接管本次歌词加载。返回 `null`、`undefined`、`false` 或空文本时，EchoMusic 会继续尝试下一个插件 resolver，最后回到内置酷狗歌词搜索。

如果用户已经在歌词来源面板为当前歌曲手动选择过歌词，EchoMusic 会优先保留用户手动选择，不再用插件 resolver 覆盖。

### 酷狗 API

插件可以通过 `ctx.kugou` 调用 EchoMusic 已封装的酷狗接口。使用前在 manifest 中声明：

```json
{
  "capabilities": {
    "kugouApi": true
  }
}
```

插件无需传入 token，也不会拿到用户 token。`ctx.kugou` 内部复用 EchoMusic 的请求层，调用时会自动带上当前登录态和设备态；如果用户未登录或登录过期，请求结果会和主程序内置功能保持一致。部分接口会修改用户账号数据，例如收藏、删除、关注、上传播放历史等，插件应只在用户明确触发对应操作时调用。

`ctx.kugou` 会按 EchoMusic 内部 `src/renderer/api/*.ts` 的文件名动态生成命名空间，`external.ts` 这类非酷狗请求模块不包含在内。后续主程序新增酷狗 API 文件或导出函数后，插件可以直接通过 `ctx.kugou.<模块名>.<函数名>()` 调用，不需要插件运行时再单独维护映射。

常用模块：

| 命名空间             | 来源文件          | 示例                                            |
| -------------------- | ----------------- | ----------------------------------------------- |
| `ctx.kugou.music`    | `api/music.ts`    | `ctx.kugou.music.getSongUrl(hash)`              |
| `ctx.kugou.user`     | `api/user.ts`     | `ctx.kugou.user.getUserDetail()`                |
| `ctx.kugou.playlist` | `api/playlist.ts` | `ctx.kugou.playlist.getUserPlaylists()`         |
| `ctx.kugou.video`    | `api/video.ts`    | `ctx.kugou.video.getVideoDetail(id)`            |
| `ctx.kugou.search`   | `api/search.ts`   | `ctx.kugou.search.search(keyword)`              |
| `ctx.kugou.artist`   | `api/artist.ts`   | `ctx.kugou.artist.getArtistDetail(id)`          |
| `ctx.kugou.album`    | `api/album.ts`    | `ctx.kugou.album.getAlbumDetail(id)`            |
| `ctx.kugou.comment`  | `api/comment.ts`  | `ctx.kugou.comment.getMusicComments(mixSongId)` |

示例：在自定义歌词解析器里复用 EchoMusic 登录态搜索酷狗歌词。由于这里同时注册歌词 resolver，manifest 也需要声明 `lyrics` 能力：

```json
{
  "capabilities": {
    "kugouApi": true,
    "lyrics": true
  }
}
```

```js
export function activate(ctx) {
  ctx.lyrics.registerResolver({
    id: "kugou-login-lyric",
    order: 200,
    match({ track }) {
      return Boolean(track?.hash);
    },
    async resolve({ track }) {
      const result = await ctx.kugou.music.searchLyric(
        track.hash,
        track.duration,
      );
      const candidates = result?.candidates || result?.data?.candidates || [];
      const first = candidates[0];
      if (!first?.id || !first?.accesskey) return null;

      const detail = await ctx.kugou.music.getLyric(
        String(first.id),
        String(first.accesskey),
      );
      return {
        source: "酷狗",
        lyric:
          detail?.decodeContent || detail?.content || detail?.data?.content,
      };
    },
  });
}
```

### 使用宿主图标

`ctx.icons` 提供项目内置的 Iconify 图标对象，可直接用于 `Icon` 组件：

```js
const { h } = ctx.vue;
const Icon = ctx.vue.resolveComponent("Icon");
h(Icon, { icon: ctx.icons.iconPictureInPicture, width: 16, height: 16 });
```

## UI 能力

插件既可以用稳定的宿主贡献 API，也可以直接介入主界面 DOM。

- `ctx.ui.addPage(...)`：注册完整插件页面，可通过 `/main/plugin/:pluginId/:pageId` 访问；传入 `sidebar` 后会同时注册正式侧边栏入口。
- `ctx.ui.sidebar.addItem(...)`：为插件页面或自定义动作注册正式侧边栏导航入口，支持路由匹配、高亮和折叠侧栏图标。
- `ctx.ui.settings.define(...)`：声明插件设置入口，传入自定义 Vue 组件自由渲染。
- `ctx.ui.cover.setFallback(...)`：设置无封面或封面加载失败时的显示图片。
- `ctx.ui.addSongContextMenuItem(...)`：注册歌曲右键菜单项。
- `ctx.ui.mount(selectorOrElement, component, options)`：把 Vue 组件挂载到任意 DOM 位置。
- `ctx.ui.teleport(component, options)`：把 Vue 组件挂载到 `document.body`，适合全局浮层/悬浮窗。

这些挂点由宿主管理生命周期。插件禁用后，已注册的页面、按钮、菜单、样式和监听器会被自动清理。

### `ctx.ui.mount` 定位说明

`ctx.ui.mount(target, component, options)` 的 `options.position` 控制 DOM 插入位置：

| position           | 行为                             |
| ------------------ | -------------------------------- |
| `'append'`（默认） | 作为目标元素的最后一个子元素插入 |
| `'prepend'`        | 作为目标元素的第一个子元素插入   |
| `'before'`         | 插入到目标元素之前（同级）       |
| `'after'`          | 插入到目标元素之后（同级）       |
| `'replace'`        | 包裹替换目标元素                 |

插入后的视觉位置取决于目标容器的 CSS 布局。对于 flex 布局的容器，DOM 插入顺序即为视觉顺序；对于使用绝对定位的容器，插件需要自行通过 `ctx.css.inject` 或 inline style 控制视觉定位。

## 独立页面示例

注册插件页面后，可以通过路由跳转打开：

```js
export function activate(ctx) {
  const Page = ctx.vue.defineComponent({
    setup() {
      return () => ctx.vue.h("div", { class: "p-6" }, "Hello Echo 页面");
    },
  });

  ctx.ui.addPage({
    id: "home",
    title: "Hello Echo",
    icon: "tabler:sparkles",
    component: Page,
    sidebar: {
      section: "plugins",
      sectionTitle: "插件",
      order: 10,
    },
  });

  ctx.router.push(`/main/plugin/${encodeURIComponent(ctx.id)}/home`);
}
```

`sidebar` 也可以简写为 `true`，此时入口会使用页面的 `id`、`title`、`icon` 并放入默认的“插件”分组。如果页面已经注册，也可以单独调用 `ctx.ui.sidebar.addItem(...)`：

```js
ctx.ui.sidebar.addItem({
  id: "home-entry",
  title: "Hello Echo",
  icon: "tabler:sparkles",
  pageId: "home",
  section: "plugins",
  order: 10,
});
```

## 插件设置示例

插件设置入口会显示在插件管理页对应插件卡片上。设置页需要提供自定义 Vue 组件；组件可以通过 `ctx.ui.components` 复用 EchoMusic 的现成控件，也可以自己组织布局、读取和保存设置。

```js
export function activate(ctx) {
  const { defineAsyncComponent, defineComponent, h, reactive } = ctx.vue;
  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Input = defineAsyncComponent(ctx.ui.components.Input);
  const Select = defineAsyncComponent(ctx.ui.components.Select);
  const Slider = defineAsyncComponent(ctx.ui.components.Slider);
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);

  const defaults = {
    enabled: true,
    name: "Hello Echo",
    opacity: 80,
    mode: "normal",
    folderPath: "",
  };

  const SettingsPanel = defineComponent({
    setup() {
      const draft = reactive({ ...defaults });

      ctx.storage.get("settings").then((saved) => {
        if (saved && typeof saved === "object") {
          Object.assign(draft, { ...defaults, ...saved });
        }
      });

      const save = async () => {
        await ctx.storage.set("settings", { ...draft });
        ctx.toast.success("设置已保存");
      };

      const selectFolder = async () => {
        const result = await ctx.dialog.selectDirectory({
          title: "选择插件文件夹",
        });
        if (!result.canceled && result.paths[0]) {
          draft.folderPath = result.paths[0];
        }
      };

      return () =>
        h("div", { style: "display: grid; gap: 12px;" }, [
          h(
            "label",
            {
              style:
                "display: flex; justify-content: space-between; gap: 12px;",
            },
            [
              h("span", "启用"),
              h(Switch, {
                modelValue: draft.enabled,
                "onUpdate:modelValue": (value) => {
                  draft.enabled = Boolean(value);
                },
              }),
            ],
          ),
          h(Input, {
            modelValue: draft.name,
            placeholder: "名称",
            "onUpdate:modelValue": (value) => {
              draft.name = String(value ?? "");
            },
          }),
          h(Select, {
            modelValue: draft.mode,
            options: [
              { label: "普通", value: "normal" },
              { label: "紧凑", value: "compact" },
            ],
            "onUpdate:modelValue": (value) => {
              draft.mode = value === "compact" ? "compact" : "normal";
            },
          }),
          h(Slider, {
            modelValue: draft.opacity,
            min: 0,
            max: 100,
            step: 1,
            showValue: true,
            valueSuffix: "%",
            "onUpdate:modelValue": (value) => {
              draft.opacity = Number(value);
            },
          }),
          h("div", { style: "display: flex; gap: 8px; align-items: center;" }, [
            h(
              "span",
              { style: "flex: 1; overflow: hidden; text-overflow: ellipsis;" },
              draft.folderPath || "未选择文件夹",
            ),
            h(
              Button,
              { variant: "outline", size: "xs", onClick: selectFolder },
              { default: () => "选择" },
            ),
          ]),
          h(Button, { size: "xs", onClick: save }, { default: () => "保存" }),
        ]);
    },
  });

  ctx.ui.settings.define({
    title: "Hello Echo 设置",
    component: SettingsPanel,
  });
}
```

文件和文件夹选择由插件组件主动调用 `ctx.dialog.selectFiles(...)` / `ctx.dialog.selectDirectory(...)`。设置里通常保存本地路径，不是可直接渲染的 `file://` URL；需要展示或播放本地文件时，先通过 `ctx.fs.getFileUrl(filePath)` 转换。

本地播放或本地媒体库插件应在 manifest 中声明 `capabilities.localFiles: true`，然后使用 `ctx.fs.listFiles()` 扫描用户选择的目录：

```js
const result = await ctx.fs.listFiles(folderPath, {
  recursive: true,
  kinds: ["audio", "lyric", "image", "playlist", "cue"],
  limit: 5000,
});

if (result.ok) {
  const audioFiles = result.files.filter((file) => file.kind === "audio");
  const first = audioFiles[0];
  const urlResult = first ? await ctx.fs.getFileUrl(first.path) : null;
  if (urlResult?.ok) {
    // 把 urlResult.url 写入歌曲对象的 audioUrl，或由 audioSource resolver 返回。
  }
}
```

`ctx.fs.readTextFile(filePath, options?)` 适合读取 `.lrc`、`.cue`、`.m3u` 等文本片段；`ctx.fs.readFileBytes(filePath, options?)` 适合读取音频头部做标签解析。两者默认最多读取 1 MB，最大 4 MB；播放整首音频请使用 `getFileUrl()`，不要通过 IPC 读取完整音频文件。

设置值和跨窗口消息都应使用可克隆的普通数据。不要把 Vue `reactive` / `ref`、DOM 节点、函数、`File`、`Error` 等对象写入 `ctx.storage`、IPC 或 `BroadcastChannel`。如果插件开启了 `runtime.miniPlayer` / `runtime.desktopLyric` 并需要同步设置，建议先归一化并展开成普通对象：

```js
const broadcastSettings = (settings) => {
  channel.postMessage({
    type: "settings",
    settings: normalizeSettings({ ...settings }),
  });
};
```

## 封面兜底接入

`ctx.ui.cover.setFallback(...)` 用于定制无封面或封面加载失败时的图片。resolver 必须同步返回字符串、`null` 或 `undefined`；不能在 resolver 中 `await`。如果兜底图片来自本地文件，应在设置保存或初始化阶段提前调用 `ctx.fs.getFileUrl(...)`，把结果缓存成可直接返回的 URL。

```js
let fallbackImageUrl = "";

async function applySettings(ctx, values = {}) {
  const imagePath = String(values?.imagePath || "");
  if (imagePath) {
    const result = await ctx.fs.getFileUrl(imagePath);
    fallbackImageUrl = result?.ok ? result.url : "";
  }
}

export async function activate(ctx) {
  await applySettings(ctx, await ctx.storage.get("settings"));

  ctx.ui.cover.setFallback({
    id: "default",
    resolveUrl(context) {
      if (context.reason === "empty" && fallbackImageUrl)
        return fallbackImageUrl;
      return null;
    },
  });
}
```

封面兜底是全局行为，建议只由一个插件负责。若多个插件同时注册兜底，后注册的插件会成为当前兜底。

## 主题表面接入

需要让主界面露出背景图、动态壁纸或沉浸式皮肤时，插件应优先使用 `ctx.theme.surface.set(...)`，不要直接覆盖 `.bg-bg-main`、`.player-bar`、`.dialog-content` 等宿主选择器。宿主会统一调整主内容、侧栏、卡片、弹层和播放器的语义背景 token，并在插件禁用时自动清理。

```js
export function activate(ctx) {
  ctx.theme.surface.set({
    enabled: true,
    mainOpacity: 82,
    sidebarOpacity: 82,
    cardOpacity: 86,
    elevatedOpacity: 88,
    dialogOpacity: 90,
    playerOpacity: 92,
    backdropFilter: "blur(10px)",
    playerBackdropFilter: "blur(20px) saturate(180%)",
  });
}
```

`mainOpacity`、`sidebarOpacity`、`cardOpacity`、`elevatedOpacity`、`dialogOpacity`、`playerOpacity` 支持 `0-100` 数字、`0-1` 小数或百分比字符串。`ctx.theme.surface.set(...)` 返回提前清理函数，插件禁用时宿主也会自动清理。多个插件同时提交时，后提交的插件对同一字段优先生效。

## 页面动效接入

插件可以用 `ctx.theme.pageTransition.set(...)` 调整 EchoMusic 主窗口页面切换动画。宿主会统一应用到顶层路由和主界面子路由，并在插件禁用时自动恢复默认动效。

```js
export function activate(ctx) {
  ctx.theme.pageTransition.set({
    enabled: true,
    mode: "out-in",
    appear: true,
    durationMs: 450,
    easing: "ease-out",
    enterOpacity: 0,
    leaveOpacity: 0,
    enterTranslateY: 6,
  });
}
```

常用字段：

- `enabled`：是否启用页面切换动效。设为 `false` 可由插件关闭宿主页面动画。
- `name`：自定义 Vue transition 名称。默认使用宿主内置的 `page`。
- `css`：可选。传入自定义 transition CSS，宿主会随页面动效贡献一起注入和清理。
- `mode`：`"out-in"`、`"in-out"` 或 `"default"`。
- `appear`：首次渲染页面时是否播放动效。
- `durationMs`：动画时长，数字按毫秒处理。
- `easing`、`enterOpacity`、`leaveOpacity`、`enterTranslateX/Y`、`leaveTranslateX/Y`、`enterScale`、`leaveScale`、`enterFilter`、`leaveFilter`：宿主内置 `page` 动画会读取这些变量。

自定义 CSS 时，顶层路由使用 Vue transition 类名：`.你的名称-enter-active`、`.你的名称-enter-from`、`.你的名称-leave-active`、`.你的名称-leave-to`。主界面子路由使用 `.你的名称-route-enter-active`：

```js
export function activate(ctx) {
  ctx.theme.pageTransition.set({
    name: "spring-page",
    mode: "out-in",
    appear: true,
    css: `
.spring-page-enter-active,
.spring-page-leave-active {
  transition:
    opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 360ms cubic-bezier(0.16, 1, 0.3, 1);
}

.spring-page-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.spring-page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.spring-page-route-enter-active {
  animation: spring-page-route-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes spring-page-route-enter {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
    `,
  });
}
```

多个插件同时提交页面动效时，后提交的插件优先生效。

## 页面歌词动效接入

插件可以用 `ctx.lyricEffects.register(...)` 调整主窗口页面歌词的视觉表现。宿主仍负责歌词解析、逐字高亮、滚动和播放时钟；插件只提交样式、装饰层或轻量 DOM 更新。这样适合做水波歌词、字幕模板、当前行辉光、错位排版、歌词装饰线等效果。

使用前在 manifest 中声明：

```json
{
  "capabilities": {
    "lyricEffects": true
  }
}
```

注册示例：

```js
export function activate(ctx) {
  ctx.lyricEffects.register({
    id: "water",
    title: "水波歌词",
    scope: "page",
    layer: "decorator",
    className: "my-water-lyrics",
    css: `
.my-water-lyrics [data-echo-lyric-line] {
  font-style: italic;
  letter-spacing: 0.16em;
  transform: skewX(-7deg);
}

.my-water-lyrics [data-echo-lyric-line][data-echo-lyric-current="true"] {
  filter: url("#my-water-lyric-filter");
}
    `,
    mount(host) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.innerHTML = `
        <filter id="my-water-lyric-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.038" numOctaves="2" />
          <feDisplacementMap in="SourceGraphic" scale="2" />
        </filter>
      `;
      host.overlay.appendChild(svg);
      return () => svg.remove();
    },
  });
}
```

`register` 字段：

| 字段        | 说明                                                                 |
| ----------- | -------------------------------------------------------------------- |
| `id`        | 当前插件内的动效 id，默认 `default`。同插件同 id 会覆盖旧动效。       |
| `title`     | 动效名称，用于错误来源和调试信息。                                   |
| `scope`     | 作用范围，当前支持 `"page"`，表示主窗口页面歌词。                    |
| `layer`     | `"style"` 或 `"decorator"`。需要 overlay、SVG、Canvas 时用 `decorator`。 |
| `order`     | 多个动效并存时的排序，数字越小越早应用。                             |
| `className` | 添加到歌词 host 根节点的 class，可传多个空格分隔的类名。             |
| `css`       | 宿主管理的全局 CSS，插件停用时自动移除。                             |
| `mount`     | 可选。歌词 host 出现时调用，返回清理函数；适合挂 SVG filter/canvas。 |

`mount(host)` 的 `host` 对象：

| 字段/方法        | 说明                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `host.root`      | 歌词动效根节点，即 `.echo-lyric-effect-host`。                                |
| `host.scroller`  | 歌词滚动容器。                                                               |
| `host.overlay`   | 宿主管理的装饰层，默认 `pointer-events: none`，适合挂 SVG、Canvas、光效层。   |
| `host.getSnapshot()` | 读取当前歌词快照，包括 `lines`、`currentIndex`、`scrollIndex`、`timelineMs`、`isPlaying`、`lyricsMode`、`collapsed`、`reducedMotion` 等。 |
| `host.subscribe(handler)` | 订阅歌词快照更新，返回取消订阅函数；插件停用时宿主也会兜底清理。       |
| `host.requestUpdate()` | 请求宿主立即向订阅者派发一次当前快照。                                  |

宿主会在歌词 DOM 上提供稳定标记和 CSS 变量：

| 选择器/变量                                      | 说明                                 |
| ------------------------------------------------ | ------------------------------------ |
| `[data-echo-lyric-host="page"]`                  | 页面歌词 host 根节点。               |
| `[data-echo-lyric-scroller="page"]`              | 歌词滚动容器。                       |
| `[data-echo-lyric-row]`                          | 歌词行外层，带 `data-echo-lyric-index/current/distance/abs-distance/scroll-distance`。 |
| `[data-echo-lyric-line]`                         | 歌词文本容器，带当前行和滚动高亮状态。 |
| `[data-echo-lyric-primary]`                      | 主歌词文本。                         |
| `[data-echo-lyric-secondary]`                    | 翻译/音译文本，带 `data-echo-lyric-secondary-kind`。 |
| `[data-echo-lyric-char]`                         | 逐字歌词字符。                       |
| `[data-echo-lyric-effect-overlay]`               | 装饰层。                             |
| `--echo-lyric-distance`                          | 当前行距离，当前行为 `0`，上一行为 `-1`，下一行为 `1`。 |
| `--echo-lyric-abs-distance`                      | 当前行绝对距离。                     |
| `--echo-lyric-scroll-distance`                   | 距离滚动目标行的距离。               |
| `--echo-lyric-line-start-ms`                     | 当前行起始时间，毫秒。               |

最佳实践：

- 用 `className` 限定 CSS 作用域，例如 `.my-water-lyrics [data-echo-lyric-line]`，避免影响其它页面。
- 优先叠加样式和装饰层，不要替换宿主歌词滚动容器；完整替换渲染器会更脆弱。
- 尊重 `snapshot.reducedMotion` 或根节点 `data-echo-lyric-reduced-motion="true"`，降低或关闭高频动画。
- `mount()` 中创建的 DOM、RAF、事件监听和订阅都要返回清理函数；宿主会在插件停用和歌词页卸载时调用。
- 如果动效需要用户配置，使用 `ctx.storage` 保存普通对象，并通过插件设置面板调整 CSS 变量或内部状态。

## 完整 UI 接入示例

把组件插入播放器右侧：

```js
export function activate(ctx) {
  const Badge = ctx.vue.defineComponent({
    setup() {
      return () =>
        ctx.vue.h(
          "button",
          {
            class: "my-plugin-badge",
            onClick: () => ctx.toast.info("插件按钮"),
          },
          "插件",
        );
    },
  });

  ctx.ui.mount(".player-actions", Badge, {
    id: "playerbar-badge",
    position: "prepend",
  });
}
```

直接挂到任意 DOM selector：

```js
export function activate(ctx) {
  const Floating = ctx.vue.defineComponent({
    setup() {
      return () =>
        ctx.vue.h("div", { class: "my-floating-widget" }, "全局浮层");
    },
  });

  ctx.ui.mount(".main-layout", Floating, {
    id: "floating-widget",
    position: "append",
  });
}
```

监听动态 DOM 并介入：

```js
export function activate(ctx) {
  ctx.dom.observe("[data-song-row]", (row) => {
    row.classList.add("my-plugin-song-row");
    return () => row.classList.remove("my-plugin-song-row");
  });
}
```

复用宿主 UI 组件：

```js
export async function activate(ctx) {
  const Button = await ctx.ui.components.Button();
  const Panel = ctx.vue.defineComponent({
    setup() {
      return () =>
        ctx.vue.h(Button, { variant: "ghost", size: "xs" }, () => "宿主按钮");
    },
  });

  ctx.ui.mount(".main-content", Panel, {
    id: "host-button",
    position: "prepend",
  });
}
```

## 跨平台 DOM 挂载示例

对于根据平台条件渲染的容器，插件应选择始终存在的父元素，并通过 CSS 定位控制视觉位置：

```js
export function activate(ctx) {
  const isMac = ctx.electron.platform === "darwin";

  const MiniButton = ctx.vue.defineComponent({
    setup() {
      const Icon = ctx.vue.resolveComponent("Icon");
      return () =>
        ctx.vue.h(
          "button",
          {
            class: "plugin-mini-btn no-drag",
            title: "mini 模式",
            onClick: () => ctx.electron.miniPlayer?.show(),
          },
          [
            ctx.vue.h(Icon, {
              icon: ctx.icons.iconPictureInPicture,
              width: 16,
              height: 16,
            }),
          ],
        );
    },
  });

  ctx.css.inject(
    `
    .plugin-mini-btn {
      position: absolute;
      top: 0;
      right: ${isMac ? "16px" : "200px"};
      height: 100%;
      width: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-main);
      opacity: 0.68;
      background: transparent;
      border: none;
      z-index: 10;
      transition: all 0.2s;
    }
    .plugin-mini-btn:hover {
      color: var(--color-primary);
      opacity: 1;
    }
  `,
    { id: "mini-btn-style" },
  );

  // 挂载到始终存在的 .overlay-header，不依赖平台条件渲染的子元素
  ctx.dom.observe(".overlay-header", (el) => {
    return ctx.ui.mount(el, MiniButton, { position: "append" });
  });
}
```
