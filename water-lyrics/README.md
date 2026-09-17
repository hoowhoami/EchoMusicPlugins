# 沉浸水波歌词

一个带水面光斑粒子背景的竖排歌词页皮肤，歌词居中排列并用斜线分隔。

## 功能

- 使用 `ctx.ui.lyricsPage.register()` 注册自定义歌词页皮肤，替换整个歌词页内容区域。
- Canvas 绘制的水下光斑粒子背景，粒子缓慢上浮并带有柔和辉光。
- 歌词竖排居中显示，当前行放大增亮，相邻行渐隐。
- 歌词行之间用倾斜的细线连接，模拟水面波纹连线。
- 设置面板可调节：光斑数量、漂浮速度、辉光强度、行间距、分隔线透明度、字号。
- 皮肤配置由宿主按皮肤隔离持久化，插件无需自行读写存储。

## 注册方式

```js
ctx.ui.lyricsPage.register({
  id: "water",
  title: "沉浸水波歌词",
  component: MySkinComponent,
  titlebar: "host",
  settings: {
    defaults: { ... },
    validate: (values) => true,
    component: MySettingsComponent,
  },
});
```

在皮肤组件内通过 `ctx.ui.lyricsPage.useSkin()` 获取配置句柄，通过 `props.page` 获取歌词页上下文（播放控制、歌词数据等）。

## 兼容性

需要 EchoMusic `>=2.2.9-beta.6`，因为插件依赖 `capabilities.lyricsPage` 和 `ctx.ui.lyricsPage` 宿主能力。

## 安装

推荐在 EchoMusic 的"插件管理"中添加本仓库插件源后在线安装。也可以将 `water-lyrics` 整个文件夹复制到 EchoMusic 插件目录。
