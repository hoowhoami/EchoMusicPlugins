# EchoMusic 插件系统

本仓库收录 EchoMusic 插件开发文档与示例插件。

## 插件系统定位

EchoMusic 内置一套完全自研、深度耦合主程序的定制化插件运行体系，整体设计思路与 Chromium 系浏览器插件有着本质区别——不兼容 Chrome 插件规范、沙盒隔离模型与权限清单机制。

### 超高拓展自由度，无强制权限沙盒

插件运行环境与主程序原生打通，不存在分层安全沙盒隔离。主程序向插件完整开放音频内核、本地文件、数据库、窗口、网络、外设等底层接口。开发者可基于完整程序能力实现音源接入、界面重构、音频实时处理、系统联动、本地媒体批量管理等深度定制功能，拓展边界不受框架硬性限制。

### 安全权责交由用户自主把控

程序不会主动限制插件操作权限。插件的安装、启用、卸载、信任与否全部由用户自主决策，第三方插件带来的使用风险由用户自行知悉并承担。项目不做强制插件审核，充分下放使用选择权。

### 配套安全模式，兼顾自由度与程序稳定性

为解决无沙盒环境下插件异常、恶意代码、逻辑崩溃导致主程序卡死、闪退、配置损坏等问题，系统内置安全模式：

- **自动触发**：插件运行出错、内存溢出、死循环、非法调用底层接口时，程序自动切入安全模式，禁用全部第三方插件，完成故障隔离与自动恢复，保障播放器本体可正常启动。
- **手动开启**：用户可在设置内主动切换至安全模式，临时禁用所有自定义插件，用于排查插件冲突、清理异常插件、修复损坏配置。

自由插件模式与安全模式为两套互补运行方案：日常使用可关闭安全模式，享受完整插件拓展能力；遇到程序异常、插件冲突时，可通过自动/手动安全模式快速恢复至纯净运行状态，在高拓展自由度和程序稳定性之间做出平衡取舍。

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
- [插件窗口拖动与缩放](docs/plugin-window-resize.md)：使用 `ctx.window.resize.bind()` / `ctx.windows.resize.bind()` 添加统一窗口缩放交互。
- `water-lyrics`：页面歌词动效示例，演示 `ctx.lyricEffects.register()` 的 style/decorator 接入方式。
- `apple-music-lyrics`：页面歌词 AMLL 渲染示例，演示通过 decorator 扩展点接入 `@applemusic-like-lyrics/core`。

## 许可证

除非子目录另有说明，本仓库插件代码默认按根目录 [LICENSE](LICENSE) 的 MIT License 分发。

`apple-music-lyrics/` 是例外：该插件打包了 `@applemusic-like-lyrics/core`，插件目录及其构建产物按 `AGPL-3.0-only` 分发。详见 [apple-music-lyrics/LICENSE](apple-music-lyrics/LICENSE) 和 [apple-music-lyrics/NOTICE.md](apple-music-lyrics/NOTICE.md)。

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

插件禁用或卸载前，运行时会调用插件的 `deactivate(ctx)`，随后清理通过宿主 API 注册的页面、统一设置、歌曲菜单、命令、事件监听、应用内快捷键、系统级全局快捷键、`ctx.css.inject` 样式、manifest 样式、`ctx.lyricEffects` 歌词动效、`ctx.ui.mount` / `ctx.ui.teleport` 挂载组件和 `ctx.dom.observe` 监听。插件如果直接修改 DOM 或注册了宿主无法感知的全局副作用，应通过 `ctx.dispose(() => ...)` 或 `deactivate(ctx)` 自行归还。

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
    "kugouVerification": false,
    "localFiles": false,
    "lyricEffects": false,
    "lyrics": false,
    "process": false,
    "sqlite": false,
    "webServer": false
  },
  "requires": {
    "echoMusicVersion": ">=2.2.6-beta.9"
  }
}
```

`main` 默认为 `index.js`，支持 `.js` / `.mjs`。`style` 可选，仅支持 `.css`。
`icon` 可选，用于插件管理页卡片图标，建议使用插件根目录下的 `icon.svg`。该字段支持插件目录内的相对图片路径、`https` 图片和 `data:image/*`。

`runtime.miniPlayer` 可选。设为 `true` 后，EchoMusic 会在 mini 播放器窗口中单独加载该插件。mini 是独立窗口，只需要影响主窗口的插件不应开启该项；如果插件同时影响主窗口和 mini 窗口，需要把两边看成两个独立运行时，它们不共享 JS 内存。

`runtime.desktopLyric` 可选。设为 `true` 后，EchoMusic 会在桌面歌词窗口中单独加载该插件。桌面歌词同样是独立窗口，只需要影响主窗口或 mini 窗口的插件不应开启该项。需要改变原桌面歌词窗口的布局、动效或窗口尺寸时，应同时使用 `ctx.lyricEffects.register({ scope: "desktop", ... })` 和 `ctx.desktopLyric`。

`capabilities.audioSource` 可选。插件如需通过 `ctx.player.audioSource.register()` 在指定兜底阶段解析音源，或使用 `transform` 检查、替换、加工内置/插件音源，必须显式设为 `true`。适合 WebDAV、本地媒体库、私有网盘、代理签名或其他自定义来源的歌曲。

`capabilities.kugouApi` 可选。插件如需通过 `ctx.kugou` 调用 EchoMusic 内置的酷狗音乐、歌词、写真和推荐接口，必须显式设为 `true`。插件只传业务参数，不需要也不能传入 token、dfid、mid 等鉴权信息；宿主会使用当前 EchoMusic 登录态和设备态完成请求。

`capabilities.kugouVerification` 可选。插件如需把酷狗接口返回的 `ssaCode` / `eventId` 交给 EchoMusic 完成安全验证，必须显式设为 `true`。插件只发起验证请求，不需要传 `v_type`，也不直接处理验证码提交、登录确认或 `sid` / `edt` 生成；宿主会通过 `/get/verify/info` 读取验证类型，并复用主程序验证弹窗，验证通过后插件应自行重试原业务请求。

`capabilities.audioSpectrum` 可选。插件如需通过 `ctx.audio.spectrum` 读取或订阅音频频谱数据，必须显式设为 `true`。该能力会启动系统音频捕获订阅，请只在可视化或音频分析插件中声明。

`capabilities.localFiles` 可选。插件如需通过 `ctx.fs.listFiles()` 扫描本地音乐目录，通过 `ctx.fs.readTextFile()` / `ctx.fs.readFileBytes()` / `ctx.fs.readAudioMetadata()` 读取用户本地文件信息，或通过 `ctx.fs.writeFile()` 写入插件目录内文件，必须显式设为 `true`。适合本地播放、本地媒体库、CUE/M3U/LRC 解析、插件生成缓存图片或图标等场景。播放音频文件本身应使用 `ctx.fs.getFileUrl()` 转成 URL 后交给播放器，不要通过 IPC 读取整首音频。

`capabilities.lyricEffects` 可选。插件如需通过 `ctx.lyricEffects.register()` 调整页面歌词或桌面歌词排版、动效或挂载歌词装饰层，必须显式设为 `true`。适合水波歌词、KTV 字幕模板、当前行辉光、歌词背景水印、竖排桌面歌词等视觉插件。该能力只影响歌词显示，不提供歌词内容解析；提供歌词内容请使用 `capabilities.lyrics`。

`capabilities.lyrics` 可选。插件如需通过 `ctx.lyrics.registerResolver()` 为特定歌曲提供歌词内容，必须显式设为 `true`。适合 WebDAV 旁挂 `.lrc`、本地媒体库内嵌歌词或私有歌词服务。

`capabilities.process` 可选。插件如需通过 `ctx.process.launch()` 启动插件目录内的本地辅助程序，必须显式设为 `true`。未声明时主程序会拒绝启动进程。该能力只表示插件可以请求启动自己目录内的可执行文件，不表示启动后的程序运行在沙箱内。

`capabilities.sqlite` 可选。插件如需通过 `ctx.sqlite` 使用 SQLite 私有数据库，必须显式设为 `true`。数据库由宿主创建在 EchoMusic 用户数据目录下，并按插件 id 隔离；插件只能访问自己的命名数据库，不能传入任意本地路径。

`capabilities.webServer` 可选。插件如需通过 `ctx.webServer.listen()` 创建可被其他本机软件访问的 HTTP 页面或接口，必须显式设为 `true`。服务默认只监听 `127.0.0.1`，适合 Wallpaper Engine、OBS、本地脚本或其他桌面软件读取 EchoMusic 当前状态、歌词页面、可视化页面等场景。插件禁用、卸载、安全模式、运行上下文销毁或应用退出时，宿主会自动释放端口。

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
| `ctx.player`                                                          | 播放控制便捷 API：`currentTrack/currentTrackId/currentTime/duration/isPlaying/isLoading/playbackState/playbackTargetTrackId/playbackRate/volume/playMode`（computed）、`play()`、`playTrack()`、`playSong()`、`playNext()`、`playLast()`、`replaceQueueAndPlay()`、`toggle()`、`stop()`、`next()`、`prev()`、`dislikePersonalFm()`、`seek(time)`、`setVolume(vol)`、`setPlaybackRate(rate)`、`setPlayMode(mode)`、`setAudioQuality(quality)`、`setAudioEffect(effect)`、`toggleLyricView(open?)`。其中 `volume` 和 `setVolume(vol)` 使用 `0-100` 音量百分比：`0` 为静音，`100` 为原始音量；`currentTime` 是播放引擎最近一次推送的离散进度（秒），适合状态展示和控制逻辑；歌词逐帧渲染请使用 `ctx.lyricEffects` 的 `timelineMs`，或 `ctx.lyrics` / `ctx.nowPlaying` 快照里的 `playback.currentTime + updatedAt + playbackRate` 自行推算。 |
| `ctx.player.audioSource.register(options)`                            | 注册分阶段音源解析器或音源 `transform`，支持在曲库解析前、曲库失败后、云盘失败后接管，以及加工/拒绝任意阶段产生的候选；要求 manifest 声明 `capabilities.audioSource: true`                                                                                                                                                                         |
| `ctx.audio.spectrum`                                                  | 读取或订阅音频频谱：`getStatus()`、`getSnapshot()`、`subscribe(options, handler)`，要求 manifest 声明 `capabilities.audioSpectrum: true`                                                                                                                                                                                                                                                                      |
| `ctx.playlist`                                                        | 播放队列便捷 API：读取当前队列/队列歌曲、替换队列、追加歌曲、播放歌曲、加入下一首（插队）、排队候播（顺序追加到下一首播放队列末尾）、清空、移除、重排和切换活动队列                                                                                                                                                                                                                                                                                             |
| `ctx.lyric` / `ctx.settings`                                          | 歌词 store 与设置 store 的快捷引用，等价于 `ctx.stores.lyric` / `ctx.stores.settings`                                                                                                                                                                                                                                                                                                                         |
| `ctx.lyrics`                                                          | 歌词稳定 API：`registerResolver(options)` 注册自定义歌词解析器（要求 `capabilities.lyrics: true`）、`getSnapshot()`、`onSnapshot(handler)`、`command(command)`                                                                                                                                                                                                                                                |
| `ctx.lyricEffects`                                                    | 歌词动效 API：`register(options)` 注册页面歌词或桌面歌词视觉效果（要求 `capabilities.lyricEffects: true`），支持注入 CSS class、挂载 overlay 装饰层、订阅歌词播放快照                                                                                                                                                                                                                                        |
| `ctx.appearance`                                                      | 外观快照 API：`getSnapshot()` / `onSnapshot(handler)`，读取深浅色、主题色和字体信息                                                                                                                                                                                                                                                                                                                           |
| `ctx.fonts`                                                           | 系统字体 API：`getAll()` 获取字体名列表、`getOptions(options?)` 获取可直接传给宿主 `Select` 的选项、`buildFamily(fontName)` 构建 CSS `font-family` 字符串                                                                                                                                                                                                                                                     |
| `ctx.kugou`                                                           | 调用 EchoMusic 内置酷狗业务接口，要求 manifest 声明 `capabilities.kugouApi: true`；鉴权信息由宿主自动注入                                                                                                                                                                                                                                                                                                     |
| `ctx.kugouVerification.request(challenge)`                            | 请求宿主完成酷狗安全验证，`challenge` 可传 `ssaCode` / `eventId` 字符串，或 `{ eventId }` / `{ ssaCode }`；插件不需要传 `v_type`，宿主会按 `eventId` 读取验证信息；返回 `{ ok: true, eventId }` 或 `{ ok: false, error, canceled? }`，要求 manifest 声明 `capabilities.kugouVerification: true`                                                                                                                                    |
| `ctx.storage`                                                         | 插件私有 KV 存储，按插件 id 自动隔离                                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.dialog.selectDirectory(options?)`                                | 打开系统文件夹选择对话框，返回 `{ canceled, paths }`                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.dialog.selectFiles(options?)`                                    | 打开系统文件选择对话框，支持 `multiple` 和 `filters`                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.fs.listFiles(directory, options?)`                               | 枚举本地文件，支持 `recursive`、`limit`、`kinds`、`extensions`、`includeHidden` 和 `maxDepth`，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                             |
| `ctx.fs.listImageFiles(directory, options?)`                          | 枚举指定文件夹内图片，返回文件路径、`file://` URL、大小和修改时间；兼容旧插件，建议新插件优先使用 `ctx.fs.listFiles()`                                                                                                                                                                                                                                                                                        |
| `ctx.fs.getFileUrl(filePath)`                                         | 将用户选择的本地文件路径转换为可播放或可渲染的 `file://` URL                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.fs.readTextFile(filePath, options?)`                             | 读取本地文本文件片段，默认最多 1 MB，最大 4 MB，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                                                                            |
| `ctx.fs.readFileBytes(filePath, options?)`                            | 读取本地文件字节片段，适合解析音频头部或标签，默认最多 1 MB，最大 4 MB，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                                                    |
| `ctx.fs.readAudioMetadata(filePath)`                                  | 读取本地音频标签和时长，返回标准化标题、歌手、专辑、年份、曲序等信息，要求 manifest 声明 `capabilities.localFiles: true`；新增插件使用时请通过 `requires.echoMusicVersion` 限制到包含该 API 的主程序版本                                                                                                                                                                                                       |
| `ctx.fs.writeFile(filePath, data, options?)`                          | 写入插件目录内文件，支持字符串、`ArrayBuffer`、`Uint8Array` 和 `{ type: "base64", data }`，默认不覆盖已有文件，最大 8 MB，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                  |
| `ctx.fs.deleteFile(filePath)`                                         | 删除插件目录内文件，仅删除文件不删除目录，要求 manifest 声明 `capabilities.localFiles: true`                                                                                                                                                                                                                                                                                                                  |
| `ctx.appIcons.refresh()`                                              | 重新读取插件存储中的应用图标配置并尝试刷新托盘、任务栏/窗口和桌面快捷方式图标                                                                                                                                                                                                                                                                                                                                  |
| `ctx.appIcons.restoreDefaultDesktopIcon()`                            | 恢复桌面快捷方式图标为默认（Windows/Linux，修改快捷方式文件）                                                                                                                                                                                                                                                                                                                                                |
| `ctx.appIcons.restoreDefaultTaskbarIcon()`                            | 恢复任务栏快捷方式图标为默认（仅 Windows，修改快捷方式文件）                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.appIcons.setRuntimeWindowIcon(iconPath)`                         | 立即设置运行中窗口的任务栏/Dock 图标（所有平台，立即生效）                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.appIcons.restoreDefaultWindowIcon()`                             | 立即恢复运行中窗口的图标为默认（所有平台，立即生效）                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.process.launch(options)`                                         | 启动插件目录内的本地辅助程序，要求 manifest 声明 `capabilities.process: true`                                                                                                                                                                                                                                                                                                                                 |
| `ctx.process.terminate(pid)`                                          | 终止当前插件通过 `ctx.process.launch()` 启动的进程                                                                                                                                                                                                                                                                                                                                                            |
| `ctx.sqlite`                                                          | 插件私有 SQLite API：`open(options?)`、`listDatabases()`、`deleteDatabase(name?)`，打开后可用 `db.exec/run/get/all/transaction/close`，要求 manifest 声明 `capabilities.sqlite: true`                                                                                                                                                                                                                          |
| `ctx.webServer`                                                       | 本地 HTTP 服务 API：`listen(handler, options?)`、`status()`、`close()`、`onRequest(handler)`，要求 manifest 声明 `capabilities.webServer: true`；默认监听 `127.0.0.1`，可供访问                                                                                                                                                                                              |
| `ctx.theme.surface.set(options)`                                      | 请求宿主调整主界面表面透明度和模糊效果，适合背景图、沉浸皮肤等插件                                                                                                                                                                                                                                                                                                                                            |
| `ctx.theme.surface.clear()`                                           | 清理当前插件提交的表面效果                                                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.theme.pageTransition.set(options)`                               | 请求宿主调整页面切换动效，适合页面动效和无障碍偏好插件                                                                                                                                                                                                                                                                                                                                                        |
| `ctx.theme.pageTransition.clear()`                                    | 清理当前插件提交的页面动效设置                                                                                                                                                                                                                                                                                                                                                                                |
| `ctx.theme.accentGradient.set(options)`                               | 请求宿主调整顶部主题色渐变氛围层（横跨侧栏与内容顶部的色带），支持颜色、角度、高度、透明度与暗色独立覆盖 |
| `ctx.theme.accentGradient.clear()`                                    | 清理当前插件提交的顶部渐变配置 |
| `ctx.cover.createThemedIconCoverUrl({ icon, color? })`                | 生成与 EchoMusic 内置详情页一致的主题色图标封面；不传 `color` 时主插件上下文跟随当前主题色，插件浮窗建议显式传入快照里的 `appearance.accentColor` |
| `ctx.nowPlaying`                                                      | 当前播放/歌词/外观快照 API，可读取快照、订阅变化、发送播放与歌词命令                                                                                                                                                                                                                                                                                                                                          |
| `ctx.desktopLyric`                                                    | 桌面歌词 API：`getSnapshot()`、`getWindow()`、`show()`、`hide()`、`updateSettings(partial)`、`updateWindow(bounds)`；可调整原桌面歌词窗口设置和受控窗口尺寸                                                                                                                                                                                                                                                     |
| `ctx.scroll`                                                          | 页面滚动容器 API：`queryContainers()`、`getCurrentContainer()`、`getState(el)`、`scrollToTop(el?)`、`scrollToBottom(el?)`、`observeContainers(handler)`；用于滚动增强插件，避免依赖宿主内部 DOM 类名                                                                                                                                                                                                            |
| `ctx.windows`                                                         | 控制当前插件在 manifest 中声明的独立窗口：`show()`、`hide()`、`close()`、`move()`、`getBounds()`、`setIgnoreMouseEvents()` 等；推荐使用 `drag.bind(windowId, element)` 绑定可拖动 DOM 元素，宿主会处理多屏/DPI、pointer capture、取消、窗口卸载和 session 生命周期；`drag.start/move/end/cancel` 仅用于需要自行管理 pointer 生命周期的高级场景；`show()` 可临时覆盖 `alwaysOnTop` 和 `allowOutsideWorkArea` |
| `ctx.toast`                                                           | 应用内提示：`info()`、`success()`、`warning()`、`danger()`                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.net.fetch`                                                       | 网络请求                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ctx.electron`                                                        | 当前 preload 暴露的 Electron API                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.electron.platform`                                               | 当前平台：`'darwin'` / `'win32'` / `'linux'`                                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.css.inject(cssText, options?)`                                   | 注入全局 CSS，禁用插件时自动清理                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.commands.register(id, handler)`                                  | 注册插件命令                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ctx.shortcuts.register(accelerator, handler)`                        | 注册应用内快捷键，窗口获得焦点时生效；支持 `'Ctrl+A'`、`'Shift+Right'`、`'CmdOrCtrl+S'` 等标准 Electron 加速器格式；返回清理函数，插件卸载时自动解绑                                                                                                                                                                                                                                                        |
| `ctx.shortcuts.registerGlobal(accelerator, handler)`                  | 注册系统级全局快捷键，EchoMusic 在后台时也可触发；返回 `Promise<dispose>`，注册失败时抛出冲突或格式错误；依赖该 API 的插件建议设置 `requires.echoMusicVersion` 到包含该能力的 EchoMusic 版本                                                                                                                                                                                                                |
| `ctx.events.onTrackChange(handler)`                                   | 监听当前曲目变化                                                                                                                                                                                                                                                                                                                                                                                              |
| `ctx.events.onPlaybackChange(handler)`                                | 监听播放/暂停状态变化                                                                                                                                                                                                                                                                                                                                                                                         |
| `ctx.events.onPlaybackStateChange(handler)`                           | 监听播放展示状态变化，handler 收到 `loading` / `playing` / `paused` / `error`                                                                                                                                                                                                                                                                                                                                |
| `ctx.events.onPlay(handler, options?)` / `onPause` / `onEnded` / `onSeek` / `onError` / `onTimeUpdate` / `on(event, handler)` | 监听播放生命周期事件，handler 收到统一负载 `{ event, track, trackId, currentTime, duration, isPlaying }`；详见下文「播放事件」                                                                                                                                                                                                                                                  |
| `ctx.dom.query(selector)` / `ctx.dom.queryAll(selector)`              | 查询主界面 DOM                                                                                                                                                                                                                                                                                                                                                                                                |
| `ctx.dom.observe(selector, handler)`                                  | 监听动态出现的 DOM，禁用插件时自动断开                                                                                                                                                                                                                                                                                                                                                                        |
| `ctx.ui.settings.define(options)`                                     | 声明插件设置入口，必须提供自定义 Vue 组件                                                                                                                                                                                                                                                                                                                                                                     |
| `ctx.ui.sidebar.addItem(item)`                                        | 注册正式侧边栏导航入口，支持路由匹配、高亮和折叠侧栏图标                                                                                                                                                                                                                                                                                                                                                      |
| `ctx.ui.cover.setFallback(resolver)`                                  | 设置无封面或封面加载失败时的兜底图片 URL，resolver 必须同步返回字符串；resolver 会收到包含尺寸、来源信息和当前主题色的 `context`，详见下文「封面兜底」                                                                                                                                                                                                                                                                                                         |
| `ctx.ui.components`                                                   | 异步加载宿主 UI 组件，键为文件名（不含扩展名）；目前覆盖 `ui/`（基础控件）、`music/`（音乐业务组件）、`player/`（播放器弹层）三类，后续新增自动出现。调用方式：`defineAsyncComponent(ctx.ui.components.Button)` 或 `await ctx.ui.components.Button()`。同名组件按目录优先级合并：`ui` > `music` > `player`。                                                                                                      |
| `ctx.icons`                                                           | 宿主图标库（Iconify 格式）                                                                                                                                                                                                                                                                                                                                                                                    |
| `ctx.commands.execute(id, ...args)`                                   | 执行已注册的插件命令                                                                                                                                                                                                                                                                                                                                                                                          |
| `ctx.dispose(fn)`                                                     | 注册资源清理回调，禁用时自动调用                                                                                                                                                                                                                                                                                                                                                                              |

### 酷狗安全验证

当插件调用酷狗相关接口并遇到安全验证时，业务响应通常会携带 `ssaCode`，或响应头里有 `ssa-code`。插件不应自己拼验证码页面，也不应直接处理用户 token、设备参数或行为数据；推荐把事件标识交给宿主验证，验证通过后重试原请求。

```js
async function requestWithVerification(ctx, requestOnce) {
  const body = await requestOnce();
  const eventId = body?.ssaCode || body?.eventId || "";
  const errorCode = Number(body?.error_code || 0);
  const failed = Number(body?.status || 0) === 0;

  if (!eventId || (errorCode !== 20028 && !failed)) {
    return body;
  }

  const verified = await ctx.kugouVerification.request(eventId);
  if (!verified.ok) {
    if (!verified.canceled) ctx.toast.warning(verified.error || "安全验证失败");
    return body;
  }

  return requestOnce();
}
```

`ctx.kugouVerification.request()` 会打开 EchoMusic 主程序的安全验证流程。插件只需要传事件标识；宿主会先用 `eventId` 拉取验证信息，从中获取 `v_type`、`txappid` 等字段，再复用现有的图形验证码、短信验证码和登录确认处理。多个插件或多个请求遇到同一个 `eventId` 时，宿主会复用同一个验证 Promise；不同事件会排队弹出。

### 播放事件

`ctx.events` 提供播放生命周期事件订阅。事件源是常驻的播放器事件总线，从 App 启动到退出全程存活，不依赖任何视图挂载，也不会因为插件加载得早或晚而漏事件——插件在 `activate` 时订阅即可接收此后所有事件。

```js
const off = ctx.events.onPlay((payload) => {
  console.log("开始播放", payload.track?.title, payload.currentTime);
});

ctx.events.onEnded((payload) => {
  // 当前曲目自然播放结束（手动切歌不会触发）
  reportScrobble(payload.track);
});

ctx.events.onTimeUpdate((payload) => {
  // 节流约 1 秒触发一次
  updateProgress(payload.currentTime, payload.duration);
});

ctx.events.onPlaybackStateChange((state) => {
  // state: "loading" | "playing" | "paused" | "error"
  updatePlaybackBadge(state);
});

// 通用订阅
ctx.events.on("seek", (payload) => console.log("跳转到", payload.currentTime));

off(); // 主动退订；插件禁用/卸载时也会自动退订
```

可订阅的事件：

| 事件 / 方法 | 触发时机 |
| --- | --- |
| `onPlay` / `"play"` | 开始或恢复播放 |
| `onPause` / `"pause"` | 暂停 |
| `onEnded` / `"ended"` | 当前曲目**自然播放结束**，手动切歌不触发 |
| `onTrackChange` / `"trackchange"` | 切歌（覆盖快捷键、媒体控制、mini 播放器等所有路径） |
| `onPlaybackStateChange` | 播放展示状态变化：`loading` / `playing` / `paused` / `error` |
| `onSeek` / `"seek"` | 进度跳转 |
| `onError` / `"error"` | 播放失败，`payload.error` 为错误码 |
| `onTimeUpdate` / `"timeupdate"` | 进度推进，**节流约 1 秒**一次 |

统一负载 `payload`：

| 字段 | 说明 |
| --- | --- |
| `event` | 事件名 |
| `track` | 当前曲目快照（可能为 `null`） |
| `trackId` | 当前曲目 id（可能为 `null`） |
| `currentTime` | 事件触发时播放引擎的进度快照（秒），不是逐帧时钟 |
| `duration` | 当前曲目时长（秒） |
| `isPlaying` | 是否正在播放；切歌加载期间如果用户意图仍是播放，会保持 `true` |
| `error` | 仅 `error` 事件存在，错误码 |

每个订阅方法返回退订函数，且会在插件禁用/卸载时自动解绑；单个 handler 抛错不会影响播放器或其它插件。`onPlay(handler, { immediate: true })` 可在订阅时若当前已在播放，立即用当前状态回调一次，便于晚加载的插件同步初始状态（也可随时通过 `ctx.player.isPlaying` / `ctx.player.isLoading` / `ctx.player.playbackState` / `ctx.player.currentTrack` 同步查询当前状态）。

> 说明：真正的播放引擎只在主窗口运行，这些事件在**主窗口运行时**精确触发。mini 播放器、桌面歌词是独立运行时、只镜像状态、不跑引擎，请在这些运行时改用 `ctx.nowPlaying.onSnapshot` 观察跨窗口同步的播放状态。

### 封面兜底

`ctx.ui.cover.setFallback(resolver)` 用于接管「无封面」或「封面加载失败」时的显示。同一时刻只有最后注册的兜底生效，禁用插件时自动清理。

如果只是想生成一张和内置「我最喜爱」「私人 FM」风格一致的图标封面，使用 `ctx.cover.createThemedIconCoverUrl(...)` 即可，不需要注册全局兜底。

```js
const dispose = ctx.ui.cover.setFallback({
  id: "cover-fallback", // 可选，缺省为 "default"
  resolveUrl(context) {
    // 必须同步返回字符串（图片 URL / data: URI）；返回 null/undefined 表示放弃，回退到宿主默认封面
    if (context.reason === "empty") {
      // 无封面：用主题色生成一张占位图
      return ctx.cover.createThemedIconCoverUrl({
        icon: ctx.icons.iconMusic,
        color: context.accentColor,
      });
    }
    return null; // 封面加载失败时交还宿主默认处理
  },
});
```

`resolveUrl(context)` 的 `context` 字段：

| 字段             | 说明                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `url`            | 原始封面地址（可能为空字符串）                                        |
| `normalizedUrl`  | 宿主归一化后的封面地址                                                |
| `failedUrl`      | 加载失败的地址（仅 `reason === "error"` 时有值）                      |
| `size`           | 期望的封面尺寸（像素）                                                |
| `reason`         | `"empty"`（无封面）或 `"error"`（封面加载失败）                       |
| `scope`          | 调用场景标识，如 `"cover"`、`"lyric-background"`                      |
| `alt`            | 封面的可选替代文本                                                    |
| `accentColor`    | 当前**最终主题色**（已按深浅色归一化的 hex），稳定值，不随主题过渡动画逐帧抖动 |
| `accentColorRgb` | 上述主题色的 `"r, g, b"` 形式，方便拼 `rgba()`                        |

需要让兜底封面跟随主题色时，请直接读取 `context.accentColor` / `context.accentColorRgb`，**不要**自己去探针读取 `--color-primary` 等 CSS 变量或监听 `document` 的样式变化：宿主主题色切换带有过渡动画，逐帧读取会拿到中间色，监听样式变化还会导致封面在列表中反复闪烁。`context.accentColor` 已是动画的目标终值，且 resolver 读取它后，主题色变化会自动驱动相关封面重绘，无需插件自行监听。

### 平台判断

```js
const isMac = ctx.electron.platform === "darwin";
const isWindows = ctx.electron.platform === "win32";
const isLinux = ctx.electron.platform === "linux";
```

### 文件操作

插件可以通过 `ctx.fs` 读写插件目录内的文件。文件操作需要在 `manifest.json` 中声明：

```json
{
  "capabilities": {
    "localFiles": true
  }
}
```

`ctx.fs` 下的文件枚举、URL 转换、文本读取、字节读取、音频 metadata 读取、写入和删除接口均为异步 Promise。插件应使用 `await`，不要在渲染循环或同步 resolver 中直接等待文件 IO；需要展示封面、播放本地文件或返回歌词时，先在初始化、设置保存或用户选择文件阶段把 URL/metadata 预取并缓存到插件状态。

#### 删除文件

```js
// 删除插件目录内的缓存文件
const result = await ctx.fs.deleteFile('cache/temp.json');

if (result.ok) {
  console.log('已删除:', result.name);
  console.log('文件之前存在:', result.existed);
} else {
  console.error('删除失败:', result.error);
}

// 批量清理缓存
async function cleanCache(ctx) {
  const cacheFiles = [
    'cache/images.json',
    'cache/metadata.json',
    'temp/data.bin',
  ];
  
  for (const file of cacheFiles) {
    await ctx.fs.deleteFile(file);
  }
  
  ctx.toast.success('缓存已清理');
}
```

安全限制：
- 只能删除插件自己目录内的文件
- 不能删除目录，只能删除文件
- 不能通过 `..` 或符号链接跳出插件目录
- 删除不存在的文件不会报错（幂等性）

### 应用图标管理

插件可以通过 `ctx.appIcons` 管理应用图标。EchoMusic 提供两类图标API：

#### 1. 运行时窗口图标（立即生效，所有平台）⭐

直接作用于运行中的窗口，适合动态场景如主题切换、状态指示：

```js
// 设置自定义窗口图标（立即生效）
const result = await ctx.appIcons.setRuntimeWindowIcon('/path/to/icon.ico');

if (result.ok && result.applied) {
  ctx.toast.success('窗口图标已更新');
} else {
  console.error('更新失败:', result.error);
}

// 恢复默认窗口图标（立即生效）
await ctx.appIcons.restoreDefaultWindowIcon();
```

**主题图标系统示例：**

```js
export async function activate(ctx) {
  const pluginDir = await ctx.electron.plugins.getDirectory();
  const iconBasePath = `${pluginDir}/${ctx.id}/icons`;

  // 监听系统主题变化
  const updateIcon = async () => {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const iconPath = `${iconBasePath}/${isDark ? 'dark' : 'light'}.ico`;
    
    await ctx.appIcons.setRuntimeWindowIcon(iconPath);
  };

  // 初始应用
  await updateIcon();

  // 监听主题变化
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', updateIcon);

  // 清理
  ctx.dispose(() => {
    mediaQuery.removeEventListener('change', updateIcon);
    ctx.appIcons.restoreDefaultWindowIcon();
  });
}
```

**状态指示示例：**

```js
// 根据播放状态切换图标
ctx.events.onPlaybackChange((isPlaying) => {
  const iconPath = isPlaying 
    ? '/path/to/playing-icon.ico'
    : '/path/to/paused-icon.ico';
  ctx.appIcons.setRuntimeWindowIcon(iconPath);
});
```

#### 2. 快捷方式图标（需要重新固定，持久化）

修改桌面/任务栏快捷方式文件，适合持久化的图标更改：

```js
// 恢复桌面快捷方式图标为默认（Windows/Linux）
const desktopResult = await ctx.appIcons.restoreDefaultDesktopIcon();

if (desktopResult.ok && desktopResult.applied) {
  ctx.toast.success('桌面图标已恢复（重启后完全生效）');
} else {
  console.error('恢复失败:', desktopResult.error);
}

// 恢复任务栏快捷方式图标为默认（仅Windows）
if (ctx.electron.platform === 'win32') {
  const taskbarResult = await ctx.appIcons.restoreDefaultTaskbarIcon();
  
  if (taskbarResult.ok && taskbarResult.applied) {
    ctx.toast.success('任务栏快捷方式图标已恢复（需要重新固定到任务栏）');
  }
}
```

**⚠️ 重要说明：**
- **任务栏快捷方式图标**：修改的是快捷方式文件（.lnk），Windows会缓存已固定的图标。需要**从任务栏取消固定，然后重新固定**才能看到变化。
- **桌面快捷方式图标**：重启应用后生效。
- 如果需要**立即更改运行中的窗口图标**，请使用 `setRuntimeWindowIcon()` API（见上方"运行时窗口图标"）。

**图标API对比：**

| 功能 | 运行时窗口图标 | 快捷方式图标 |
|------|--------------|-------------|
| 作用对象 | 运行中的窗口 | 桌面/任务栏快捷方式文件 |
| 生效时机 | ⚡ 立即生效 | 🔄 需要重启或重新固定 |
| Windows支持 | ✅ 任务栏图标 | ✅ 快捷方式文件（.lnk） |
| macOS支持 | ✅ Dock图标 | ❌ 系统限制 |
| Linux支持 | ✅ 任务栏图标 | ✅ .desktop文件 |
| 使用场景 | 动态切换、状态指示 | 持久化更改 |
| Windows任务栏 | 立即可见 | 需要重新固定 |

**图标文件要求：**
- Windows: `.ico` 格式（支持多尺寸）
- macOS: `.icns` 或 `.png`
- Linux: `.png` 或 `.svg`

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

该能力只是限制”从哪里启动”和”由谁确认”。启动后的程序拥有当前系统用户权限，可能访问本地文件、网络和系统资源；请只在确实需要原生能力且用户能够理解风险时使用。

### SQLite 私有数据库

插件可以用 `ctx.sqlite` 打开宿主托管的 SQLite 数据库。使用前必须在 `manifest.json` 中声明：

```json
{
  "capabilities": {
    "sqlite": true
  }
}
```

数据库按插件 id 隔离，默认库名是 `main`。插件只能通过库名访问自己的私有数据库，不能传入本机路径：

```js
export async function activate(ctx) {
  const db = await ctx.sqlite.open({
    name: "library",
    migrations: [
      {
        version: 1,
        sql: `
          CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_notes_song_id ON notes(song_id);
        `,
      },
    ],
  });

  if (!db.ok) {
    ctx.toast.warning(db.error);
    return;
  }

  await db.run(
    "INSERT INTO notes (song_id, text, created_at) VALUES (?, ?, ?)",
    [ctx.player.currentTrackId.value || "", "喜欢这一段", Date.now()],
  );

  const latest = await db.get(
    "SELECT id, text, created_at FROM notes WHERE song_id = ? ORDER BY id DESC",
    [ctx.player.currentTrackId.value || ""],
  );
  if (latest.ok && latest.row) console.log(latest.row);

  ctx.dispose(() => {
    void db.close();
  });
}
```

打开数据库：

```js
const db = await ctx.sqlite.open({
  name: "main",
  migrations: [
    { version: 1, sql: "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT)" },
    { version: 2, sql: "ALTER TABLE cache ADD COLUMN updated_at INTEGER DEFAULT 0" },
  ],
  busyTimeoutMs: 3000,
});
```

`open(options?)` 返回 `{ ok, pluginId, databaseId, name, version }`，并在成功结果上附加数据库方法：

| 方法 | 说明 |
| --- | --- |
| `db.exec(sql)` | 执行一段 SQL，适合建表、建索引、批量 schema 变更 |
| `db.run(sql, params?)` | 执行写入语句，返回 `{ changes, lastInsertRowid }` |
| `db.get(sql, params?)` | 查询第一行，返回 `{ ok: true, row }`，没有结果时 `row` 为 `null` |
| `db.all(sql, params?, options?)` | 查询多行，`options.limit` 默认 1000，最大 5000 |
| `db.transaction(statements)` | 在事务中顺序执行多条写入语句 |
| `db.close()` | 关闭当前数据库连接 |

事务示例：

```js
await db.transaction([
  { sql: "INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)", params: ["a", "1", Date.now()] },
  { sql: "INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)", params: ["b", "2", Date.now()] },
]);
```

二进制 BLOB：

```js
await db.exec("CREATE TABLE IF NOT EXISTS covers (id TEXT PRIMARY KEY, data BLOB)");

// 写入 hex 或 base64 均可；宿主会按 SQLite BLOB 绑定参数。
await db.run("INSERT OR REPLACE INTO covers (id, data) VALUES (?, ?)", [
  "album-cover",
  { type: "base64", data: "iVBORw0KGgo=" },
]);

const row = await db.get("SELECT data FROM covers WHERE id = ?", ["album-cover"]);
if (row.ok && row.row?.data?.type === "hex") {
  console.log(row.row.data.data); // 查询 BLOB 时统一返回 hex 字符串
}
```

管理数据库：

```js
const list = await ctx.sqlite.listDatabases();
if (list.ok) console.table(list.databases);

await ctx.sqlite.deleteDatabase("library");
```

限制与生命周期：

- 数据库文件存放在 EchoMusic 用户数据目录的插件私有区，插件无法访问其他插件或主程序数据库。
- 数据库名默认 `main`，只能包含字母、数字、点、下划线和短横线，且必须以字母或数字开头。
- 参数只支持数组形式的 `string`、`number`、`boolean`、`null`、`{ type: "hex", data }` 和 `{ type: "base64", data }`；二进制参数会作为 SQLite BLOB 写入。
- 查询结果中的 BLOB 会返回 `{ type: "hex", data }`，`data` 为小写 hex 字符串。
- 宿主会拦截 `ATTACH`、`DETACH`、`VACUUM INTO`、`load_extension()`、`PRAGMA database_list` 等可能越界或泄露路径的语句。
- 单条 SQL 最长约 256 KB；单次查询最多 5000 行，结果 JSON 最大约 8 MB；单个事务最多 500 条语句。
- 插件禁用、安全模式、运行上下文销毁或 EchoMusic 退出时会自动关闭连接；插件卸载时会删除该插件的 SQLite 私有目录。
- `ctx.sqlite` 也会出现在插件浮窗上下文中，适合浮窗直接读取或写入当前插件的配置、缓存和历史数据。

### 本地 Web 服务

插件可以用 `ctx.webServer.listen(handler, options?)` 创建本机 HTTP 服务，把插件生成的页面或接口暴露给其他软件访问。使用前必须在 `manifest.json` 中声明：

```json
{
  "capabilities": {
    "webServer": true
  }
}
```

最小示例：

```js
export async function activate(ctx) {
  const result = await ctx.webServer.listen(() => ({
    headers: { "content-type": "text/html; charset=utf-8" },
    body: "<!doctype html><title>EchoMusic</title><h1>Hello EchoMusic</h1>",
  }));

  if (!result.ok) {
    ctx.toast.warning(result.error);
    return;
  }

  ctx.toast.success(`本地页面已启动：${result.url}`);
  console.log("复制这个地址给 Wallpaper Engine / OBS / 浏览器：", result.url);
}
```

`listen()` 默认使用随机可用端口并绑定 `127.0.0.1`，返回：

```js
{
  ok: true,
  pluginId: "my-plugin",
  host: "127.0.0.1",
  port: 53217,
  origin: "http://127.0.0.1:53217",
  url: "http://127.0.0.1:53217/",
  startedAt: 1710000000000
}
```

也可以指定端口：

```js
await ctx.webServer.listen(handler, { port: 38123 });
```

`handler(request)` 收到的请求对象：

| 字段 | 说明 |
| --- | --- |
| `requestId` | 本次请求 id，普通插件通常不需要关心 |
| `method` | HTTP 方法，如 `"GET"` / `"POST"` |
| `url` | 路径和 query，如 `"/lyrics?theme=dark"` |
| `path` | URL pathname，如 `"/lyrics"` |
| `query` | query 对象；重复参数会变成字符串数组 |
| `headers` | 请求头对象 |
| `body` | 请求体 `ArrayBuffer` |
| `remoteAddress` | 远端地址，通常是本机地址 |

返回值可以是字符串、普通 JSON、二进制，或完整响应对象：

```js
ctx.webServer.listen(async (request) => {
  if (request.path === "/api/now-playing") {
    const snapshot = await ctx.nowPlaying.getSnapshot();
    return {
      headers: { "content-type": "application/json; charset=utf-8" },
      body: {
        title: snapshot.playback?.title || "",
        artist: snapshot.playback?.artist || "",
        lyric: snapshot.lyric?.lines?.[snapshot.lyric.currentIndex]?.text || "",
      },
    };
  }

  return {
    status: 404,
    body: "Not Found",
  };
});
```

给 Wallpaper Engine 做歌词/状态页面时，可以直接返回 HTML，并让页面用同源接口轮询：

```js
export async function activate(ctx) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        background: transparent;
        color: white;
        font: 600 42px system-ui, sans-serif;
        text-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      }
      small {
        display: block;
        margin-top: 12px;
        font-size: 18px;
        opacity: 0.72;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main>
      <div id="lyric">EchoMusic</div>
      <small id="track"></small>
    </main>
    <script>
      async function tick() {
        const data = await fetch("/api/now-playing").then((r) => r.json());
        document.getElementById("lyric").textContent = data.lyric || data.title || "EchoMusic";
        document.getElementById("track").textContent = [data.title, data.artist].filter(Boolean).join(" - ");
      }
      tick();
      setInterval(tick, 1000);
    </script>
  </body>
</html>`;

  const result = await ctx.webServer.listen(async (request) => {
    if (request.path === "/api/now-playing") {
      const snapshot = await ctx.nowPlaying.getSnapshot();
      return {
        headers: { "content-type": "application/json; charset=utf-8" },
        body: {
          title: snapshot.playback?.title || "",
          artist: snapshot.playback?.artist || "",
          lyric: snapshot.lyric?.lines?.[snapshot.lyric.currentIndex]?.text || "",
        },
      };
    }

    return {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: html,
    };
  });

  if (result.ok) ctx.toast.success(`Wallpaper 页面：${result.url}`);
}
```

生命周期与限制：

- 服务只监听 `127.0.0.1`，不会暴露到局域网；`host: "localhost"` 也会归一化为 `127.0.0.1`。
- 同一插件同一时间只有一个服务；再次 `listen()` 会替换请求处理器，必要时重启端口。
- 插件禁用、卸载、安全模式、运行上下文销毁或 EchoMusic 退出时会自动关闭服务；也可手动调用 `ctx.webServer.close()`。
- `ctx.webServer.status()` 可查看当前服务是否运行、端口和未完成请求数。
- 单次请求体最大 2 MB，单次响应体最大 8 MB，请求处理超时约 15 秒。
- `handler` 抛错时宿主会记录插件运行异常并返回 500，不会拖垮播放器主流程。
- `ctx.webServer` 也会出现在插件浮窗上下文中，适合由浮窗里的开关控制服务启停。

### 注册应用内快捷键

插件可以使用 `ctx.shortcuts.register(accelerator, handler)` 注册应用内快捷键。应用内快捷键只在 EchoMusic 窗口获得焦点时生效，适合插件页面、播放页增强和临时操作：

```js
export function activate(ctx) {
  // 注册 Shift+Right 快进 10 秒
  ctx.shortcuts.register('Shift+Right', () => {
    const currentTime = ctx.player.currentTime.value;
    const duration = ctx.player.duration.value;
    const newTime = Math.min(duration, currentTime + 10);
    ctx.player.seek(newTime);
    ctx.toast.success('快进 10 秒');
  });

  // 注册 Shift+Left 快退 10 秒
  ctx.shortcuts.register('Shift+Left', () => {
    const currentTime = ctx.player.currentTime.value;
    const newTime = Math.max(0, currentTime - 10);
    ctx.player.seek(newTime);
    ctx.toast.success('快退 10 秒');
  });

  // 使用 CmdOrCtrl（macOS 上是 Cmd，其他系统是 Ctrl）
  ctx.shortcuts.register('CmdOrCtrl+K', () => {
    ctx.toast.info('自定义快捷键触发');
  });

  // 多修饰键组合
  ctx.shortcuts.register('Ctrl+Shift+P', () => {
    const current = ctx.player.currentTime.value;
    const duration = ctx.player.duration.value;
    const progress = duration > 0 ? (current / duration * 100).toFixed(1) : 0;
    ctx.toast.info(`播放进度: ${progress}%`);
  });
}
```

**支持的加速器格式：**
- 单键：`'A'`, `'Space'`, `'Enter'`, `'Escape'`, `'F1'`-`'F24'`
- 方向键：`'Left'`, `'Right'`, `'Up'`, `'Down'`
- 组合键：`'Ctrl+A'`, `'Shift+Space'`, `'Alt+F4'`
- 多修饰键：`'Ctrl+Shift+A'`, `'Cmd+Alt+Delete'`
- 跨平台：`'CmdOrCtrl+S'` (macOS 上是 ⌘+S，其他系统是 Ctrl+S)

**注意事项：**
- 快捷键会在应用窗口获得焦点时生效，不是全局快捷键
- 建议使用不常见的组合键，避免与应用内置快捷键冲突
- `ctx.shortcuts.register()` 返回清理函数，插件卸载时会自动解绑
- 同一个快捷键可以被多个插件注册，按注册顺序依次触发

### 注册全局快捷键

插件可以使用 `ctx.shortcuts.registerGlobal(accelerator, handler)` 注册系统级全局快捷键。全局快捷键在 EchoMusic 处于后台时也会触发，适合媒体控制、外部设备联动、全局显示/隐藏浮窗等场景。

如果插件依赖该能力，请在 manifest 中用 `requires.echoMusicVersion` 限制到包含该 API 的 EchoMusic 版本，例如：

```json
{
  "requires": {
    "echoMusicVersion": ">=2.2.9-beta.24"
  }
}
```

基础用法：

```js
export async function activate(ctx) {
  if (!ctx.shortcuts.registerGlobal) {
    ctx.toast.warning("当前 EchoMusic 版本不支持插件全局快捷键");
    return;
  }

  await ctx.shortcuts.registerGlobal("CmdOrCtrl+Alt+Right", () => {
    const currentTime = ctx.player.currentTime.value;
    const duration = ctx.player.duration.value;
    ctx.player.seek(Math.min(duration, currentTime + 10));
    ctx.toast.success("全局快进 10 秒");
  });

  await ctx.shortcuts.registerGlobal("CmdOrCtrl+Alt+Left", () => {
    const currentTime = ctx.player.currentTime.value;
    ctx.player.seek(Math.max(0, currentTime - 10));
    ctx.toast.success("全局快退 10 秒");
  });
}
```

**注意事项：**
- 全局快捷键不需要额外 manifest capability，但需要 EchoMusic 版本支持该 API
- `ctx.shortcuts.registerGlobal()` 返回 `Promise<dispose>`；插件卸载时会自动解绑，也可以手动调用返回的清理函数
- 如果快捷键已被系统、EchoMusic 内置全局快捷键或其他插件占用，注册会抛出错误
- 同一个全局快捷键同一时间只能有一个注册者，建议使用带多个修饰键的组合
- macOS 首次使用全局快捷键时可能受系统权限、输入法或其他应用占用影响；注册失败时应给用户清晰提示

### 控制播放位置（快进快退）

插件可以通过三种方式实现快进快退。推荐优先复用宿主的 `seekForward` / `seekBackward` 命令，这样会自动使用用户在 EchoMusic 设置中配置的快进/快退步长。

#### 方式 1：直接使用 `ctx.player.seek()`

```js
export function activate(ctx) {
  ctx.commands.register('fastForward', () => {
    const currentTime = ctx.player.currentTime.value;
    const duration = ctx.player.duration.value;
    // 快进 5 秒，确保不超过歌曲总时长
    const newTime = Math.min(duration, currentTime + 5);
    ctx.player.seek(newTime);
  }, { title: '快进 5 秒' });

  ctx.commands.register('fastBackward', () => {
    const currentTime = ctx.player.currentTime.value;
    // 快退 5 秒，确保不小于 0
    const newTime = Math.max(0, currentTime - 5);
    ctx.player.seek(newTime);
  }, { title: '快退 5 秒' });
}
```

#### 方式 2：使用宿主快进快退命令

EchoMusic 支持 `seekForward` 和 `seekBackward` 命令，偏移量由用户在设置中配置：

```js
export function activate(ctx) {
  // 使用用户设置的快进快退步长
  ctx.shortcuts.register('Alt+Right', () => {
    ctx.nowPlaying.command('seekForward');
  });

  ctx.shortcuts.register('Alt+Left', () => {
    ctx.nowPlaying.command('seekBackward');
  });
}
```

也可以注册成系统级全局快捷键：

```js
export async function activate(ctx) {
  if (!ctx.shortcuts.registerGlobal) return;

  try {
    await ctx.shortcuts.registerGlobal("CmdOrCtrl+Alt+Right", () => {
      ctx.nowPlaying.command("seekForward");
    });
    await ctx.shortcuts.registerGlobal("CmdOrCtrl+Alt+Left", () => {
      ctx.nowPlaying.command("seekBackward");
    });
  } catch (error) {
    ctx.toast.warning(`全局快进快退快捷键注册失败：${error?.message || error}`);
  }
}
```

#### 方式 3：百分比跳转

```js
export function activate(ctx) {
  // 跳转到 25%、50%、75% 位置
  ctx.shortcuts.register('Ctrl+1', () => {
    const duration = ctx.player.duration.value;
    ctx.player.seek(duration * 0.25);
  });

  ctx.shortcuts.register('Ctrl+2', () => {
    const duration = ctx.player.duration.value;
    ctx.player.seek(duration * 0.5);
  });

  ctx.shortcuts.register('Ctrl+3', () => {
    const duration = ctx.player.duration.value;
    ctx.player.seek(duration * 0.75);
  });
}
```

### 响应式访问播放状态

`ctx.player.currentTrack`、`ctx.player.isPlaying`、`ctx.player.isLoading`、`ctx.player.playbackState` 和 `ctx.player.playbackTargetTrackId` 是 Vue `computed`，在 Vue 组件的 `setup` 中直接使用即可自动响应更新：

```js
const MyWidget = ctx.vue.defineComponent({
  setup() {
    const track = ctx.player.currentTrack;
    const playing = ctx.player.isPlaying;
    const playbackState = ctx.player.playbackState;
    return () =>
      ctx.vue.h(
        "span",
        playbackState.value === "loading"
          ? "加载中..."
          : playing.value
            ? `♫ ${track.value?.title}`
            : "已暂停",
      );
  },
});
```

`ctx.player.playbackState` 的取值为 `loading`、`playing`、`paused`、`error`，适合驱动按钮、徽标或悬浮窗 UI；`ctx.player.isPlaying` 表示播放意图或实际播放状态，切歌加载期间如果用户仍在播放，会保持 `true`。插件应通过 `ctx.player` 的方法控制播放，不要直接修改 `ctx.stores.player` 的内部状态。

在非组件上下文中，也可以用 `ctx.vue.watch` 监听：

```js
ctx.vue.watch(ctx.player.currentTrack, (track) => {
  console.log("曲目变化:", track?.title);
});

ctx.events.onPlaybackStateChange((state) => {
  console.log("播放展示状态:", state);
});
```

### 私人 FM「不喜欢」

`ctx.player.dislikePersonalFm()` 对当前播放的私人 FM 曲目执行「不喜欢」：向服务端上报 `garbage`、从私人 FM 队列移除该曲目并自动切到下一首，与应用内私人 FM 页面的不喜欢按钮行为一致。

仅当当前正在播放私人 FM（即 `nowPlaying.playback.isPersonalFM` 为 `true`）时生效；否则直接返回 `false` 不做任何操作。方法返回 `Promise<boolean>`，`true` 表示已执行不喜欢。建议调用前先做能力探测：`if (ctx.player.dislikePersonalFm) { ... }`。

```js
export function activate(ctx) {
  ctx.commands.register('dislikeFm', async () => {
    const handled = await ctx.player.dislikePersonalFm?.();
    if (!handled) ctx.toast.info('当前不在私人 FM 播放中');
  }, { title: '私人 FM 不喜欢' });
}
```

### 自定义音源解析

插件可以把 `resolve` 放到指定的播放器兜底位置，也可以使用 `transform` 检查、替换、加工或拒绝已经解析成功的候选音源。典型场景包括：

- WebDAV、本地媒体库等歌曲已经带有自己的地址，应在曲库解析前直接接管；
- 酷狗 `song/url` 不可用时，再向自定义服务请求备用地址；
- 为官方地址补充代理签名、备用 URL 或其他播放参数；
- 拒绝当前环境不支持的格式，让 EchoMusic 继续尝试下一候选。

使用前在 manifest 中声明：

```json
{
  "capabilities": {
    "audioSource": true
  }
}
```

#### 解析顺序与 position

普通曲库歌曲的解析顺序为：

```text
before-catalog
  → catalog（内置 song/url，包括音质、音效和兼容候选）
  → after-catalog
  → cloud
  → final-fallback
```

`position` 只控制当前注册项的 `resolve` 在哪一级执行：

| position | 执行时机 | 典型用途 |
| --- | --- | --- |
| `before-catalog` | 内置 `song/url` 之前；默认值 | WebDAV、本地媒体库、完全自定义来源 |
| `after-catalog` | 所有曲库候选均不可用或被 transform 拒绝后，云盘兜底之前 | 非 VIP 备用源、第三方曲库兜底 |
| `final-fallback` | 曲库和云盘均不可用后 | 最后的代理、转码或提示音源 |

云盘页面歌曲或用户明确选择云盘来源时，宿主可以优先使用云盘地址；有效候选仍会经过 `transform`。旧插件不填写 `position` 时仍按 `before-catalog` 执行。

曲库解析失败后接管的示例：

```js
export function activate(ctx) {
  ctx.player.audioSource.register({
    id: "listen-together-fallback",
    position: "after-catalog",
    order: 100,
    match({ track }) {
      return track.source === "listen-together";
    },
    async resolve({ track, quality, position }) {
      const result = await resolveFallbackUrl({
        hash: track.originalHash || track.hash,
        mixSongId: track.mixSongId || track.albumAudioId,
        quality,
      });

      if (!result?.url) return null;
      return { url: result.url, urls: result.urls, quality, effect: "none" };
    },
  });
}
```

`resolve` 上下文包含：

```ts
{
  track: Song;
  quality: "128" | "320" | "flac" | "high" | "viper_tape";
  effect: AudioEffectValue;
  forceReload: boolean;
  position: "before-catalog" | "after-catalog" | "final-fallback";
}
```

`resolve` 可以返回字符串 URL，也可以返回音源对象：

```ts
{
  url: string;
  urls?: string[];
  source?: { url: string; audioTrackId?: number | null };
  sources?: Array<{ url: string; audioTrackId?: number | null }>;
  audioTrackId?: number | null;
  quality?: "128" | "320" | "flac" | "high" | "viper_tape";
  effect?: AudioEffectValue;
  loudness?: { lufs: number; gain: number; peak: number };
  sourceKind?: "catalog" | "cloud" | "plugin";
  noticeCode?: string;
}
```

`match` 和 `resolve` 都可以是异步函数。多个插件同时注册时，`order` 越小越先执行；第一个返回有效 `url` 的 resolver 会接管本次播放。返回 `null`、`undefined`、`false` 或空 URL 时，EchoMusic 会继续尝试下一个插件 resolver，最后回到内置解析流程。

为了让没有酷狗 `hash` 的自定义歌曲可以进入播放流程，插件导入的歌曲至少应提供 `audioUrl`，并设置可识别的 `source`，例如 `source: "webdav"`。如果播放地址需要临时签名，也可以在 `resolve` 中按需刷新 URL 后返回。

#### transform：加工或拒绝候选

`transform` 会在候选解析成功后、交给播放器之前执行。它与 `resolve.position` 相互独立；可以通过 `transformStages` 限制处理范围：

| stage | 候选来源 |
| --- | --- |
| `before-catalog` | 前置插件 resolver |
| `catalog` | 内置 `song/url` |
| `after-catalog` | 曲库之后的插件 resolver |
| `cloud` | 云盘 |
| `final-fallback` | 最终插件 resolver |

如果省略 `transformStages`，该 transform 会处理全部阶段。可传单个阶段或阶段数组。

```js
export function activate(ctx) {
  ctx.player.audioSource.register({
    id: "catalog-url-transform",
    order: 50,
    transformStages: ["catalog", "cloud"],
    match({ track }) {
      return Boolean(track.hash);
    },
    async transform({ track, source, stage, forceReload }) {
      // source 是前一个步骤已经标准化的候选，包含 url、urls、quality、
      // effect、loudness、sourceKind 等字段。
      const signedUrl = await signPlaybackUrl(source.url, {
        track,
        stage,
        forceReload,
      });

      if (!signedUrl) return null;
      return {
        url: signedUrl,
        // 显式保留原地址作为播放器的下一候选；只返回字符串则完全替换地址。
        urls: [signedUrl, ...(source.urls || [])],
      };
    },
  });
}
```

`transform` 的返回值语义：

| 返回值 | 行为 |
| --- | --- |
| `null` / `undefined` | 不修改当前候选 |
| 字符串 URL | 替换主 URL，并清除原候选列表 |
| 部分音源对象 | 与当前候选合并；返回 `url` 时可同时用 `urls` 指定完整候选顺序 |
| `false` | 拒绝当前候选，继续同阶段的下一解析器/曲库候选，再进入后续兜底 |

多个 transform 同样按 `order` 从小到大串行执行，后一个 transform 会收到前一个 transform 的结果。某个 transform 抛出异常时，宿主会上报插件运行时错误并保留当时仍有效的候选，不会因为单个插件异常中断播放。

只使用 transform 的注册项可以省略 `resolve`；只使用 resolve 的旧写法也保持兼容。每个注册项至少要提供二者之一。若需要同时提供二者，请注意：`position` 只约束 `resolve`，`transformStages` 才约束 `transform`。

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

### 主题图标封面

`ctx.cover.createThemedIconCoverUrl({ icon, color? })` 会返回一段 `data:image/svg+xml` URL，用于生成和内置详情页一致的主题色图标封面。主插件上下文中不传 `color` 会使用当前主题色；如果你需要和某首歌、某个窗口快照或自定义页面主题对齐，可以传入十六进制颜色。

```js
const favoriteCover = ctx.cover.createThemedIconCoverUrl({
  icon: ctx.icons.iconHeartFilled,
});

const cloudCover = ctx.cover.createThemedIconCoverUrl({
  icon: ctx.icons.iconCloud,
  color: "#0ea5e9",
});
```

插件浮窗也提供同名 API 和 `ctx.icons`。浮窗运行时没有主界面的主题 store，推荐从 `ctx.nowPlaying` 快照取当前外观色：

```js
const snapshot = await ctx.nowPlaying.getSnapshot();
const coverUrl = ctx.cover.createThemedIconCoverUrl({
  icon: ctx.icons.iconPulse,
  color: snapshot.appearance.accentColor,
});
```

## UI 能力

插件既可以用稳定的宿主贡献 API，也可以直接介入主界面 DOM。

- `ctx.ui.addPage(...)`：注册完整插件页面，可通过 `/main/plugin/:pluginId/:pageId` 访问；传入 `sidebar` 后会同时注册正式侧边栏入口。
- `ctx.ui.sidebar.addItem(...)`：为插件页面或自定义动作注册正式侧边栏导航入口，支持路由匹配、高亮和折叠侧栏图标。
- `ctx.ui.settings.define(...)`：声明插件设置入口，传入自定义 Vue 组件自由渲染。
- `ctx.ui.cover.setFallback(...)`：设置无封面或封面加载失败时的显示图片。
- `ctx.cover.createThemedIconCoverUrl(...)`：生成 EchoMusic 内置风格的主题色图标封面。
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

字体选择可以直接复用 `ctx.fonts` 和宿主 `Select` 组件。`getOptions()` 默认包含“系统默认”，传入 `includeFollow: true` 后会额外包含“跟随全局”：

```js
const fontOptions = ctx.vue.ref([]);

ctx.fonts.getOptions({ includeFollow: true }).then((options) => {
  fontOptions.value = options;
});

h(Select, {
  filterable: true,
  modelValue: draft.fontFamily || "follow",
  options: fontOptions.value,
  "onUpdate:modelValue": (value) => {
    draft.fontFamily = String(value || "follow");
  },
});

h("div", {
  style:
    draft.fontFamily && draft.fontFamily !== "follow"
      ? { fontFamily: ctx.fonts.buildFamily(draft.fontFamily) }
      : undefined,
});
```

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

`listFiles()` 返回的 `kind` 由宿主统一分类：`audio`、`image`、`lyric`、`playlist`、`cue` 或 `other`。其中 `audio` 使用 EchoMusic 本地播放格式清单，当前包括 `aac`、`aif`、`aiff`、`alac`、`ape`、`caf`、`dff`、`dsf`、`flac`、`m4a`、`mp3`、`oga`、`ogg`、`opus`、`wav`、`wave`、`webm`、`wma`、`wv`。云盘上传额外支持的业务格式不等同于本地播放清单。

如果只需要音频文件，可以显式传 `kinds: ["audio"]`；如果插件自己维护扩展名白名单，也可以传 `extensions`。`extensions` 和 `kinds` 都会在主进程侧过滤，适合大目录扫描。

`ctx.fs.readAudioMetadata(filePath)` 适合本地媒体库构建歌名、歌手、专辑和时长索引；它在主进程异步解析，不需要插件通过 `readFileBytes()` 自己读取音频头部：

```js
const metadata = await ctx.fs.readAudioMetadata(first.path);
if (metadata.ok) {
  console.log(metadata.title, metadata.artist, metadata.duration);
} else {
  console.warn(metadata.error);
}
```

成功结果会包含文件信息 `name`、`path`、`url`、`size`、`modifiedAt`、`extension`、`relativePath`、`kind`，以及音频信息 `title`、`artist`、`album`、`duration`、`year`、`track`、`disk`、`genre`。`title` 一定有值：标签解析失败时宿主会按文件名降级；`metadataParsed` 表示是否成功读到标签，`metadataError` 会在解析失败但文件本身可用时返回错误摘要。

该 API 需要包含本地音频 metadata 能力的 EchoMusic 主程序版本。插件如果依赖它，应在 `manifest.json` 中设置合适的 `requires.echoMusicVersion`，避免旧主程序启用后运行时报错。

`ctx.fs.readTextFile(filePath, options?)` 适合读取 `.lrc`、`.cue`、`.m3u` 等文本片段；`ctx.fs.readFileBytes(filePath, options?)` 适合读取小型二进制片段或自定义格式头部。两者默认最多读取 1 MB，最大 4 MB；播放整首音频请使用 `getFileUrl()`，不要通过 IPC 读取完整音频文件。

`ctx.fs.writeFile(filePath, data, options?)` 只允许写入当前插件目录内的文件，目标路径可以是相对插件目录的路径，也可以是插件目录内的绝对路径。默认自动创建父目录，默认不覆盖已有文件；如需覆盖，显式传入 `overwrite: true`。单次写入最大 8 MB，适合保存插件生成的缓存、图片、图标或配置导出文件。

```js
const picked = await ctx.dialog.selectFiles({
  title: "选择应用图标",
  filters: [{ name: "Images", extensions: ["png", "ico", "icns", "jpg", "webp"] }],
});
const sourcePath = picked.paths[0];
const source = sourcePath
  ? await ctx.fs.readFileBytes(sourcePath, { maxBytes: 4 * 1024 * 1024 })
  : null;
const ext = sourcePath?.split(".").pop() || "png";

const result = source?.ok
  ? await ctx.fs.writeFile(`generated/app-icon.${ext}`, source.data, {
      overwrite: true,
    })
  : { ok: false };

if (result.ok) {
  await ctx.storage.set("appIcons", {
    trayIconPath: result.path,
    taskbarIconPath: result.path,
    desktopIconPath: result.path,
  });
  await ctx.appIcons.refresh();
}
```

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

## 应用图标替换

插件可以通过私有存储声明自定义应用图标，由 EchoMusic 主进程在启动或刷新时读取并应用。图标文件可以是插件目录内相对路径、插件目录内绝对路径或 `file://` 地址，支持 `.png`、`.ico`、`.icns`、`.jpg`、`.webp`、`.bmp`。建议先用 `ctx.fs.writeFile()` 将生成或用户选择的图标保存到插件目录，再写入 `ctx.storage`。

```js
await ctx.storage.set("appIcons", {
  trayIconPath: "generated/tray.png",
  taskbarIconPath: "generated/taskbar.ico",
  desktopIconPath: "generated/desktop.ico",
});

const result = await ctx.appIcons.refresh();
if (!result.desktopApplied && result.desktopError) {
  ctx.toast.warning(result.desktopError);
}
```

也可以按平台分别提供路径：

```js
await ctx.storage.set("appIcons", {
  win32: {
    trayIconPath: "icons/tray.ico",
    taskbarIconPath: "icons/taskbar.ico",
    desktopIconPath: "icons/desktop.ico",
  },
  linux: {
    trayIconPath: "icons/tray.png",
    taskbarIconPath: "icons/taskbar.png",
    desktopIconPath: "icons/desktop.png",
  },
  darwin: {
    trayIconPath: "icons/trayTemplate.png",
    taskbarIconPath: "icons/dock.icns",
  },
});
await ctx.appIcons.refresh();
```

支持的存储 key：

- `appIcons` / `appIcon` / `customAppIcons` / `customAppIcon`：推荐写对象，可包含 `trayIconPath`、`taskbarIconPath`、`desktopIconPath`，也可包含 `win32`、`linux`、`darwin` 平台分支。
- `trayIconPath`、`trayIcon`、`trayPath`：单独配置托盘图标。
- `taskbarIconPath`、`windowIconPath`、`dockIconPath`、`appIconPath`：单独配置运行中窗口、任务栏或 Dock 图标。
- `desktopIconPath`、`desktopShortcutIconPath`、`shortcutIconPath`：单独配置桌面快捷方式图标。

平台说明：

- 托盘图标：运行时刷新。
- 任务栏图标：运行中的窗口使用 `BrowserWindow.setIcon` 刷新；Windows 会额外尝试更新已存在的任务栏固定快捷方式 `.lnk`。
- 桌面图标：Windows 更新已存在的桌面 `.lnk`；Linux 尝试更新桌面上的 EchoMusic `.desktop` 文件；macOS 不运行时写 App Bundle 图标，只支持 Dock/窗口运行时图标。
- EchoMusic 不允许插件写入 `resources/icons/` 或应用安装目录。图标文件应保存在插件目录或用户选择的安全位置。

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

## 顶部渐变接入

主窗口顶部有一条横跨侧栏与内容区的「主题色渐变氛围层」。插件可以用 `ctx.theme.accentGradient.set(...)` 调整它的颜色、角度、高度和透明度，宿主会在插件禁用时自动恢复默认渐变。调用前建议先做能力探测：`if (ctx.theme?.accentGradient?.set) { ... }`。

```js
export function activate(ctx) {
  if (!ctx.theme?.accentGradient?.set) {
    ctx.toast.warning('当前 EchoMusic 版本不支持顶部渐变插件能力');
    return;
  }

  const dispose = ctx.theme.accentGradient.set({
    color: '#ff5c8a',
    angle: 180,
    height: '46%',
    peakOpacity: 0.28,
    midOpacity: 0.1,
    midPosition: 60,
    dark: {
      peakOpacity: 0.4,
      midOpacity: 0.16,
    },
  });

  ctx.dispose(dispose);
}
```

字段说明：

- `enabled`：为 `false` 时隐藏整条渐变（等效 `opacity: 0`）。
- `opacity`：整层不透明度倍率，支持 `0-1` 小数、`0-100` 数字或百分比字符串。
- `color`：渐变基础颜色，支持十六进制（`#ff5c8a`）或 `'r,g,b'` 字符串；不传则跟随宿主主题色。
- `angle`：渐变角度，数字按 `deg` 处理（`180` 等价 `'180deg'`），也接受 `turn/rad/grad`。
- `height`：色带高度，数字按百分比处理（`46` → `'46%'`），也接受 `'240px'`、`'46%'`。
- `midPosition`：中段色标位置，规则同 `height`，默认 `60%`。
- `peakOpacity` / `midOpacity`：顶部与中段色标的透明度（rgba alpha），支持 `0-1` / `0-100` / 百分比。
- `background`：完整 `background` 覆盖（逃生通道），设置后忽略上面的颜色/透明度字段，可用于多色或径向渐变。
- `dark`：暗色模式专属覆盖，仅支持 `color`、`peakOpacity`、`midOpacity`、`background`；不提供时暗色沿用上面的基础配置（基础也未提供时用宿主默认）。

`ctx.theme.accentGradient.set(...)` 返回提前清理函数，插件禁用时宿主也会自动清理。多个插件同时提交时，后提交的插件对同一字段优先生效。使用自定义壁纸（半透明表面）模式时，宿主会自动隐藏该渐变层。

## 歌词动效接入

插件可以用 `ctx.lyricEffects.register(...)` 调整主窗口页面歌词或原桌面歌词窗口的视觉表现。宿主仍负责歌词解析、逐字高亮、滚动和播放时钟；插件只提交样式、装饰层或轻量 DOM 更新。这样适合做水波歌词、字幕模板、当前行辉光、错位排版、歌词装饰线、竖排桌面歌词等效果。

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
| `scope`     | 作用范围，支持 `"page"` 和 `"desktop"`，也可传数组同时作用于多个歌词 host。 |
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
| `host.getSnapshot()` | 读取当前歌词快照，包括 `lines`、`currentIndex`、`scrollIndex`、`timelineMs`、`isPlaying`、`lyricsMode`、`collapsed`、`reducedMotion`、`appearance` 等。`timelineMs` 是宿主统一后的歌词时间轴（毫秒，已包含歌词偏移），适合逐帧动画、逐字高亮和滚动计算；不要用 `ctx.player.currentTime` 代替它。`currentIndex` 与宿主写入的 `data-echo-lyric-current` / `data-echo-lyric-current-index` 使用同一稳定索引源。`appearance` 包含宿主歌词外观语义，如 `playedColor`、`unplayedColor`、`fontFamily`、`fontScale`、`fontWeight`，插件应优先复用这些字段而不是读取原生歌词 DOM 样式。 |
| `host.subscribe(handler)` | 订阅歌词快照更新，返回取消订阅函数；插件停用时宿主也会兜底清理。       |
| `host.setAutoScrollHandler(handler)` | 接管页面歌词自动跟随滚动。handler 收到 `{ index, targetTop, smooth, collapsed, snapshot }`，返回 `true` 表示插件已处理，宿主不再执行默认 `scrollTo`。 |
| `host.requestUpdate()` | 请求宿主立即向订阅者派发一次当前快照。                                  |

宿主会在歌词 DOM 上提供稳定标记和 CSS 变量：

| 选择器/变量                                      | 说明                                 |
| ------------------------------------------------ | ------------------------------------ |
| `[data-echo-lyric-host="page"]`                  | 页面歌词 host 根节点。               |
| `[data-echo-lyric-host="desktop"]`               | 桌面歌词 host 根节点。               |
| `[data-echo-lyric-scroller="page"]`              | 歌词滚动容器。                       |
| `[data-echo-lyric-scroller="desktop"]`           | 桌面歌词滚动/切换容器。              |
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
- CSS 动效可以直接使用 `[data-echo-lyric-current="true"]` 等宿主标记；在 `host.subscribe()` 的 JS 回调中，请优先以 `snapshot.currentIndex` / `snapshot.timelineMs` 为准计算状态，避免自行覆盖宿主的 `data-echo-lyric-*` 属性。
- 优先叠加样式和装饰层，不要替换宿主歌词滚动容器；完整替换渲染器会更脆弱。
- 尊重 `snapshot.reducedMotion` 或根节点 `data-echo-lyric-reduced-motion="true"`，降低或关闭高频动画。
- 桌面歌词插件如需在桌面歌词独立窗口运行，需要在 manifest 中设置 `runtime.desktopLyric: true`。只在主窗口注册 `scope: "desktop"` 不会影响已经打开的桌面歌词窗口。

### 桌面歌词窗口 API

`ctx.desktopLyric` 可调整原桌面歌词窗口，而不是新开插件浮窗：

```js
export function activate(ctx) {
  if (!ctx.desktopLyric) return;

  let previousSettings = null;
  let previousWindow = null;

  Promise.all([
    ctx.desktopLyric.getSnapshot(),
    ctx.desktopLyric.getWindow(),
  ]).then(([snapshot, bounds]) => {
    previousSettings = snapshot.settings;
    previousWindow = bounds;
    ctx.desktopLyric.updateSettings({ layout: "vertical" });
    ctx.desktopLyric.updateWindow({ width: 220, height: 760 });
  });

  ctx.lyricEffects.register({
    id: "vertical-desktop",
    title: "竖排桌面歌词",
    scope: "desktop",
    className: "vertical-desktop-lyric",
    css: `
.vertical-desktop-lyric[data-echo-lyric-host="desktop"] {
  padding: 14px;
}

.vertical-desktop-lyric [data-echo-lyric-scroller="desktop"] {
  writing-mode: vertical-rl;
}

.vertical-desktop-lyric [data-echo-lyric-row] {
  width: auto;
  height: 100%;
}
    `,
  });

  ctx.dispose(() => {
    if (previousSettings) ctx.desktopLyric.updateSettings({ layout: previousSettings.layout });
    if (previousWindow) ctx.desktopLyric.updateWindow(previousWindow);
  });
}
```

`ctx.desktopLyric.updateSettings(partial)` 接收桌面歌词设置片段，目前可用 `layout: "horizontal" | "vertical"` 切换宿主原生横排/竖排渲染。`ctx.desktopLyric.getWindow()` 返回当前桌面歌词窗口边界；`ctx.desktopLyric.updateWindow(bounds)` 接收 `{ x?, y?, width?, height? }`，主进程只做基础有效值和显示器工作区边界约束，然后持久化窗口位置与尺寸。窗口设置会持久化，插件停用时如需恢复用户原布局，应像示例一样在 `ctx.dispose()` 中还原。
- 如果接管自动滚动，只处理播放自动跟随场景；用户滚轮浏览时应交还宿主默认滚动。
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
