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
- [任务中心 API](docs/tasks.md)：后台任务、进度、中止信号与终态保留策略。
- [备份与恢复 API](docs/backups.md)：命令式备份操作、存储提供方注册与 WebDAV 示例。
- [Graphics 绘图 API](/docs/graphics.md)：为插件提供绘图能力。
- [本地 Web 服务与 WebSocket](docs/web-server.md)：本机 HTTP 页面/接口，以及同一端口上的 WebSocket。
- [TCP 网络 API](docs/tcp.md)：主进程 TCP 连接、AbortSignal、半关闭与 keepalive。
- [`openrgb`](openrgb)：独立的 OpenRGB 音乐灯效，支持频谱铺展、音量律动与低频节拍。
- [`mv-enhancer`](mv-enhancer)：上下排列多个完整 MV 详情，并集中选择默认视频编码与分辨率。
- [`playback-control-order`](playback-control-order)：统一管理侧边栏、首页播放栏和播放器页控制栏的显示、隐藏与排序。
- [`webdav-backup`](webdav-backup)：将主程序备份与恢复界面接入用户自己的 WebDAV 存储。
- [`example-plugin`](example-plugin)：覆盖常用宿主能力的综合示例。

EchoMusic 插件不是 Chrome 扩展，也不运行在强安全沙盒中。Manifest capability 用于能力声明、兼容性检查和宿主 API 开关，不能替代对插件来源和代码的信任。请只安装可信插件；出现异常时可在 EchoMusic 插件管理中启用安全模式。

## 许可证

除非插件目录另有说明，本仓库按 [MIT License](LICENSE) 分发。

`apple-music-lyrics/` 因包含 `@applemusic-like-lyrics/core`，其目录及构建产物按 `AGPL-3.0-only` 分发，详见 [LICENSE](apple-music-lyrics/LICENSE) 与 [NOTICE](apple-music-lyrics/NOTICE.md)。
