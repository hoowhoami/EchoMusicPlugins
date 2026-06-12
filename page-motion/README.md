# 页面动效

统一 EchoMusic 的页面切换动画。

## 功能

- 统一主窗口顶层页面和主界面子页面的入场动效。
- 支持启用/关闭页面切换动画。
- 默认“上滑淡入”沿用原主页面的 `0.45s ease-out`、`6px` 上滑淡入手感。
- 支持上滑淡入、柔和浮入、轻快侧滑、景深淡入和自定义 CSS。
- 支持调整动画时长。
- 支持控制首次进入页面时是否播放动效。
- 设置页会展示当前预设或自定义 CSS 的动画预览。

## 自定义 CSS

在设置里选择“自定义 CSS”后，插件会使用固定 transition 名称 `page-motion-custom`。

- 顶层路由：`.page-motion-custom-enter-active`、`.page-motion-custom-enter-from`、`.page-motion-custom-leave-active`、`.page-motion-custom-leave-to`、`.page-motion-custom-appear-active`
- 主界面子路由：`.page-motion-custom-route-enter-active`

CSS 可以使用宿主变量，例如 `var(--page-transition-duration)`。

## 兼容性

需要 EchoMusic `>=2.2.6-beta.19`，因为插件依赖 `ctx.theme.pageTransition` 宿主能力。

## 安装

推荐在 EchoMusic 的“插件管理”中添加本仓库插件源后在线安装。也可以将 `page-motion` 整个文件夹复制到 EchoMusic 插件目录。
