# 文件授权与下载 API

适用于包含本次资源 API 的 EchoMusic 构建（当前开发版本 `2.3.2-beta.10`）。发布前请确认实际发布版本并更新插件的最低版本要求。主程序提供通用服务，没有下载进度窗或主题素材管理页面；插件自行处理内容目录、清晰度、资源更新、离线清单和 UI。

```json
{
  "capabilities": { "localFiles": true, "downloads": true },
  "requires": { "echoMusicVersion": ">=2.3.2-beta.10" }
}
```

普通下载需要两项能力，本地文件操作和复制只需要 `localFiles`。这些能力是受信任插件的 API 开关，不构成强安全沙盒。旧的裸路径文件接口仍兼容；新接口使用宿主登记的授权引用。

## 目录和文件引用

```js
const selection = await ctx.fs.requestDirectory({
  access: "read-write", // 或 read
  purpose: "保存插件资源",
  persist: true, // 默认 true；false 只在本次主进程会话有效
});
if (!selection.ok) throw new Error(selection.error.message);
if (selection.canceled) return;
const directory = selection.directory;
const file = {
  kind: "directory-file",
  directoryId: directory.id,
  relativePath: "resources/background.mp4",
};
```

`DirectoryRef` 包含 `id/name/access/kind/available/displayPath`。`displayPath` 仅用于显示；操作使用 ID 与相对路径，不拼接裸路径。相对路径不接受越界、绝对路径、链接、Windows 设备名等无法安全落盘的路径。

| 接口                                                                   | 返回与语义                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `fs.requestDirectory(options)`                                         | `{ok:true,canceled:true}` 或 `{ok:true,canceled:false,directory}`，错误为 `{ok:false,error}` |
| `fs.requestFiles({purpose,persist?,multiple?,filters?})`               | 同样的结果结构，成功为 `files: FileRef[]`；单个文件授权只读                                  |
| `fs.listDirectoryGrants()`                                             | 已登记目录，包括不可用/已撤销目录；不包含单个文件                                            |
| `fs.reauthorizeDirectoryGrant(id, options)`                            | 再次打开系统选择器；同一路径保留 ID，另一目录返回新的 ID                                     |
| `fs.revokeDirectoryGrant(id)` / `fs.revokeFileGrant(id)`               | 撤销访问，保留实际文件；中断相关传输，关闭媒体租约                                           |
| `fs.getPrivateDirectory({kind})`                                       | `kind` 为 `data` 或 `cache`；本安装身份的私有目录，不打开选择器                              |
| `fs.stat(file)`                                                        | 文件名、大小、修改时间、是否目录                                                             |
| `fs.mkdir(file)`                                                       | 创建授权目录内的子目录，包括父目录                                                           |
| `fs.listFiles(directory, options?)`                                    | `{ok:true,files,limitReached}`；条目带 `file` 引用，支持 `video` 分类                        |
| `fs.readTextFile(file, options?)` / `fs.readFileBytes(file, options?)` | `{ok:true,content/data,size,bytesRead,truncated}`；默认最多 1 MiB，最多 4 MiB                |
| `fs.readAudioMetadata(file)`                                           | 返回音频元数据；失败抛出带 code 的错误                                                       |
| `fs.writeFile(file,data,options?)`                                     | `{ok:true,file,bytesWritten}`；最多 8 MiB；`overwrite:true` 才替换                           |
| `fs.deleteFile(file)`                                                  | 仅删除文件，不递归删除目录                                                                   |
| `fs.copyFile(source,target,{conflict?})`                               | 主进程流式复制，返回同下载一样的句柄，无 8 MiB 限制                                          |
| `fs.openMedia(file)`                                                   | `{id,url,release()}`；用于 video/audio/img 的 src，不将大文件传入 renderer                   |

`request*`、引用重载的 `listFiles/readTextFile/readFileBytes/writeFile` 返回结果对象。其余新接口通过 Promise 抛出带 `code/message/retryable` 的错误。引用读取音频元数据与旧裸路径重载的结果结构不同。

`selected-file` 引用格式为 `{kind:'selected-file',fileId}`。首次选择文件或目录只打开系统选择器，选择成功后宿主登记授权，不增加额外确认弹窗。用户通过插件管理页面顶部的“已授权文件与目录”统一查看所有插件的授权，列表按所属插件分组，支持逐项撤销，包括插件已禁用时。私有 data/cache 目录由主程序自动创建和管理，不打开选择器，也不列入该管理窗口。

## 下载任务

最小下载只需地址和保存目标，可以直接写在插件代码中，无需导入辅助模块：

```js
const directory = await ctx.fs.getPrivateDirectory({ kind: "data" });
const task = await ctx.net.download({
  url: "https://your-server.example/video.mp4", // 换成自己的视频直链。
  target: {
    directoryId: directory.id,
    relativePath: "videos/background-v1.mp4",
  },
});
const result = await task.wait();
// result.file 是保存后的文件引用。
```

地址由插件提供，目录 ID 由宿主返回，相对路径由插件决定。其余参数可选：`headers` 用于请求鉴权，`name` 是任务名称，`sourceKey/idempotencyKey` 是插件自定义的资源/去重标识，`expectedBytes/checksum` 使用发布方提供的可靠大小/哈希，`maxBytes` 用于限制下载量。宿主不要求资源服务器返回固定格式的清单，也不要求每个文件都提供哈希。

订阅进度并在完成后播放：

```js
const unsubscribe = task.subscribe((snapshot) => {
  // snapshot.state/receivedBytes/totalBytes/bytesPerSecond/remainingSeconds
  // 插件自行刷新 UI；totalBytes 不确定时不显示虚假百分比。
});
try {
  const result = await task.wait();
  // 只有校验并提交成功才到 completed，result.file 是实际最终文件引用。
  const lease = await ctx.fs.openMedia(result.file);
  video.src = lease.url;
  // 切换资源时 video.pause(); video.removeAttribute('src'); video.load(); lease.release();
} finally {
  unsubscribe();
}
```

这里的 `task` 来自上面的下载调用，`video` 是插件自己的视频元素。`conflict` 可指定 `fail/rename/replace`，默认 `fail`；`resume` 控制续传，`connectTimeoutMs/idleTimeoutMs` 控制超时。完整用户界面与生命周期参考 [视频主题 Demo](../app-theme-example)。

普通下载支持 HTTP/HTTPS GET，沿用宿主代理，不自动携带宿主账号或 Cookie。URL 和请求头不落盘。跨来源重定向剥离鉴权及自定义头；最多 5 次重定向。上游必须返回 identity 编码，以保证续传偏移可靠。

网络流直接写入目标目录内的任务临时文件，保持背压；IPC 只传递命令、快照与最终文件引用。普通下载没有固定 8/32/80 MiB 文件上限，程序安装包仍有 80 MiB 下载和解压预算。全局最多 3 个活动传输，每个所有者最多 2 个；按所有者轮转，队列预算全局 100、单插件 50。默认连接超时 30 秒、读取空闲超时 60 秒，可指定 `connectTimeoutMs/idleTimeoutMs`。

| 句柄方法              | 语义                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `getSnapshot()`       | 当前权威快照                                                                                      |
| `subscribe(callback)` | 立即发送缓存快照，后续接收更新；返回取消订阅函数                                                  |
| `pause()`             | 停止传输，保留 partial；paused 不会结束 wait                                                      |
| `resume(source?)`     | 恢复 paused/interrupted 任务；重启后重新提供 `{url,headers?}`                                     |
| `retry(source?)`      | 失败任务开始新 runId；应重新调用 wait                                                             |
| `cancel()`            | 关闭传输并清理属于任务的 partial；不删除最终文件                                                  |
| `wait({signal?})`     | completed 返回 `{taskId,file,bytes,sha256?}`；failed/canceled/interrupted 拒绝；signal 只停止等待 |

状态：`queued → connecting → downloading → verifying → committing → completed`，另有 `paused/interrupted/failed/canceled`。`revision` 单调递增，`runId` 在 retry 时增加。进入 committing 后暂停/取消等待提交结束，不能将已经提交的文件改报成 canceled。`rename` 返回实际的新文件名，`replace` 只在新文件验证通过后替换旧文件。

```js
const snapshots = await ctx.net.downloads.list({ offset: 0, limit: 50 });
const task = await ctx.net.downloads.attach(savedTaskId);
const snapshot = await task.getSnapshot();
if (snapshot.canResume) {
  const source = await resolveResourceSource(snapshot.sourceKey);
  await task.resume(source);
  const result = await task.wait();
}
// get(id) 返回快照；remove(id) 删除终态记录和残留 partial，保留最终文件。
// interrupted 任务须先 cancel，再 remove。
```

续传校验 Range、总量和强 ETag/Last-Modified；缺少可靠验证器且无预期哈希时完整重下。服务端返回 200 时从头写入，避免拼接；416 有独立哈希和精确长度才验证提交，否则完整重下。复制任务不能在主进程重启后恢复，应取消旧任务并重新复制。

## 本地使用与离线

保存 `DirectoryRef.id`、文件相对路径、资源版本/哈希或任务 ID。不要保存媒体 URL：它是当前插件上下文的短期租约。每次启动先 stat 本地文件，存在就重新 openMedia，无需联网；是否完整、资源是否过期、选择哪个质量以及失败时的回退策略由插件负责。

下面的代码可以直接放入插件入口 `index.js`，演示已有文件优先、缺失才下载；地址需要替换为自己的素材直链：

```js
export async function activate(ctx) {
  const directory = await ctx.fs.getPrivateDirectory({ kind: "data" });
  const file = {
    kind: "directory-file",
    directoryId: directory.id,
    relativePath: "videos/background-v1.mp4",
  };
  try {
    await ctx.fs.stat(file); // 本地已有文件，不请求远端地址。
  } catch (error) {
    if (error.code !== "FILE_MISSING") throw error;
    const task = await ctx.net.download({
      url: "https://your-server.example/background-v1.mp4",
      target: { directoryId: directory.id, relativePath: file.relativePath },
    });
    await task.wait();
  }
  // 在插件自己的背景组件中调用 ctx.fs.openMedia(file)，用 lease.url 播放。
  // 组件卸载时先暂停并清空 video.src，再 lease.release()。
}
```

这个片段只演示文件流程；用户触发的下载、视频组件、进度和取消可以参考视频主题 Demo。插件入口通过 Blob URL 加载，应为自包含的单文件 ESM；上述代码不依赖额外 import。

使用用户本地视频时，将下面的函数直接写在自己的入口内，由按钮点击事件调用：

```js
async function chooseLocalVideo(ctx) {
  const selection = await ctx.fs.requestFiles({
    purpose: "作为视频主题背景",
    persist: true,
    multiple: false,
    filters: [{ name: "视频", extensions: ["mp4", "webm", "mov", "m4v"] }],
  });
  if (!selection.ok) {
    throw Object.assign(new Error(selection.error.message), selection.error);
  }
  if (selection.canceled) return null;
  return selection.files[0]; // 保存文件引用；播放时调用 openMedia，不复制大文件。
}
```

关闭插件面板不会自动取消主进程下载。禁用、安全模式或更新会关闭旧上下文的媒体租约并中断其任务；重新启用后使用新上下文 attach/resume。卸载撤销授权、移除任务和 cache，默认保留 data，可在卸载框勾选删除私有数据；用户授权目录中的正式文件始终保留。同一安装来源重新安装可重用保留的私有数据。不同来源不能沿用同 ID 的授权。

## 安装器与验证边界

宿主安装器复用传输引擎，下载 ZIP 和逐条解压都流式进行，并在正式替换前完成暂存验证。更新使用同卷事务目录、旧目录回滚与启动恢复。下载成功不等于安装完成，现有安装 Promise 在提交与 metadata 刷新结束后才返回。

当前安装 UI 保持原有安装/更新状态；尚未增加细分阶段、字节进度或用户取消安装入口，也不会自动续装重启前的程序包。独立 ZIP 发布及主题素材发布不由宿主完成。

已用真实 Electron 43.7.6 验证 10 MiB 代理下载、renderer 内受控媒体 Range 206、租约撤销、sandbox preload → IPC → runtime 下载及失效上下文拒绝。视频主题 Demo 已验证 MP4 播放及组件清理，具体 4K 编码的解码性能与清晰度切换仍需在主题插件中单独验收。
