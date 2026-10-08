# EchoMusicPlugins

EchoMusic 官方插件源、开发文档与示例插件仓库。

## 使用插件源

在 EchoMusic 的“插件管理”中添加以下 GitHub 插件源：

```text
https://github.com/hoowhoami/EchoMusicPlugins
```

仓库根目录的 [`echo-plugins.json`](echo-plugins.json) 只维护插件索引；名称、版本、作者、入口、能力和兼容性要求均以各插件目录中的 `manifest.json` 为准。

## 开发文档

- [完整插件开发指南](docs/plugin-development.md)：Manifest、生命周期、宿主 API、安全模式和完整 UI 接入示例。
- [独立浮窗与 Now Playing](docs/floating-windows.md)：浮窗声明、播放快照、宿主窗口控制、拖动与缩放。
- [标题栏 API](docs/titlebar.md)：统一操作注册、默认位置、用户布局、Tooltip 与生命周期。
- [播放栏 API](docs/playerbar.md)：注册播放栏与歌词页底部控制操作，支持用户布局、更多菜单、徽标和交互语义。
- [全局主题 API](docs/themes.md)：可选择主题、语义配色、主题设置与装饰层。
- [侧栏快捷卡片 API](docs/sidebar-shortcuts.md)：增加候选卡片，用户独立增删和排序。
- [全局主题示例](app-theme-example)：晨雾、暮色和主题工作台候选卡片。
- [任务中心 API](docs/tasks.md)：后台任务、进度、中止信号与终态保留策略。
- [备份与恢复 API](docs/backups.md)：命令式备份操作、存储提供方注册与 WebDAV 示例。
- [Graphics 绘图 API](/docs/graphics.md)：为插件提供绘图能力。
- [本地 Web 服务与 WebSocket](docs/web-server.md)：本机 HTTP 页面/接口，以及同一端口上的 WebSocket。
- [TCP 网络 API](docs/tcp.md)：主进程 TCP 连接、AbortSignal、半关闭与 keepalive。
- [`openrgb`](openrgb)：独立的 OpenRGB 音乐灯效，支持频谱铺展、音量律动与低频节拍。
- [`mv-enhancer`](mv-enhancer)：横向拖动浏览紧凑的 MV 版本卡片，优先选择最高画质 H.265，无法确认歌曲关联时保留原 MV 页面。
- [`webdav-backup`](webdav-backup)：将主程序备份与恢复界面接入用户自己的 WebDAV 存储。
- [`example-plugin`](example-plugin)：覆盖常用宿主能力的综合示例。

EchoMusic 插件不是 Chrome 扩展，也不运行在强安全沙盒中。Manifest capability 用于能力声明、兼容性检查和宿主 API 开关，不能替代对插件来源和代码的信任。请只安装可信插件；出现异常时可在 EchoMusic 插件管理中启用安全模式。

## 个性主题

按类型提供两个主题插件，安装后在「个性主题」中选择各款主题：

| 插件 | 包含主题 |
| --- | --- |
| [静态主题](theme-static) | 恋空、哈尼粉 |
| [动态主题](theme-dynamic) | 秋日枫叶、幻彩、金丝带、杨柳依依、旋转摩天轮 |

修改包内 `themes.json` 或共享运行代码 `scripts/theme-kit/runtime.js`，然后执行 `node scripts/build-theme-plugins.mjs`。两个插件各自包含所需素材和入口，不相互依赖。提交时保留共享源文件和生成入口；安装后不依赖根目录 `scripts`。构建、校验与提交范围见 [主题包维护脚本](scripts/README.md)。

## 许可证

除非插件目录另有说明，本仓库按 [MIT License](LICENSE) 分发。

`apple-music-lyrics/` 因包含 `@applemusic-like-lyrics/core`，其目录及构建产物按 `AGPL-3.0-only` 分发，详见 [LICENSE](apple-music-lyrics/LICENSE) 与 [NOTICE](apple-music-lyrics/NOTICE.md)。

上述 `theme-*/assets` 的素材及派生文件不适用仓库默认 MIT 许可，权利归各自权利人；详见各目录 README 与 provenance.json。
