# 水波歌词动效

为 EchoMusic 页面歌词添加水面波纹、可选斜体、错位排版和雨滴斜线效果。

## 功能

- 使用 `ctx.lyricEffects.register()` 接入宿主歌词动效扩展点。
- 为当前歌词行添加 SVG turbulence 水波扰动。
- 根据当前行位置为上下歌词生成错位排版。
- 歌词斜体可独立开关，默认开启。
- 可开启/关闭截图风格的雨滴斜线，并为当前行附近添加水滴端点。
- 支持强度、行错位和辉光调节。
- 遵守系统“减少动态效果”偏好，自动降低波纹动画。

## 兼容性

需要 EchoMusic `>=2.2.6-beta.20`，因为插件依赖 `capabilities.lyricEffects` 和 `ctx.lyricEffects` 宿主能力。

## 安装

推荐在 EchoMusic 的“插件管理”中添加本仓库插件源后在线安装。也可以将 `water-lyrics` 整个文件夹复制到 EchoMusic 插件目录。
