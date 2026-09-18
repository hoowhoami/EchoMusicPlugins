# 本地 Web 服务与 WebSocket

`ctx.webServer` 在 Electron 主进程创建仅监听 `127.0.0.1` 的 HTTP 服务，把插件页面或接口暴露给本机其他软件。同一条服务支持 WebSocket 升级：协议由 `ws` 处理，插件拿到的是普通 socket，而不是自定义帧格式或回调袋。

HTTP 服务已有；WebSocket 随当前开发中的 EchoMusic 引入。依赖 WebSocket 的插件应声明 `requires.echoMusicVersion: ">=2.3.2-beta.6"`，并在运行时检查 `ctx.webServer.onConnection` 是否存在。

## 能力

```json
{ "capabilities": { "webServer": true } }
```

不需要额外声明 `tcp` 或 `unrestrictedNetwork`。服务只绑定本机回环地址，不会暴露到局域网；`host: "localhost"` 也会归一化为 `127.0.0.1`。能力声明不是安全沙箱，应只安装可信插件。

插件禁用、卸载、安全模式、运行上下文销毁或 EchoMusic 退出时，宿主会关闭端口并断开全部 WebSocket。浮窗入口里的 `ctx.webServer` 与主入口一致。

## HTTP

```js
export async function activate(ctx) {
  const result = await ctx.webServer.listen(async (request) => {
    if (request.path === "/api/now-playing") {
      const snapshot = await ctx.nowPlaying.getSnapshot();
      return {
        title: snapshot.playback?.title || "",
        artist: snapshot.playback?.artist || "",
      };
    }
    return {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!doctype html><title>EchoMusic</title><h1>Hello</h1>",
    };
  });
  if (!result.ok) {
    ctx.toast.warning(result.error);
    return;
  }
  ctx.toast.success(`本地页面：${result.url}`);
}
```

`listen()` 默认使用随机可用端口。返回值包含 `host`、`port`、`origin`、`url`。也可以指定端口，或一次传入 HTTP 和 WebSocket 处理器：

```js
await ctx.webServer.listen(handler, { port: 38123 });

await ctx.webServer.listen({
  port: 38123,
  onRequest: handler,
  onConnection(socket) {
    socket.onMessage(({ data }) => {
      void socket.send(data);
    });
  },
  path: "/live",
});
```

`handler(request)` 收到：

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

返回值可以是字符串、JSON、二进制，或 `{ status, headers, body }`。省略时返回 204。`onRequest(handler)` 可在 `listen()` 之后单独替换 HTTP 处理器。同一插件同一时间只有一个服务；再次 `listen()` 会替换 HTTP 处理器，必要时重启端口。WebSocket 可以写在同一次 `listen({ onConnection })` 里，也可以之后用 `onConnection()` 追加。

单次请求体最大 2 MB，单次响应体最大 8 MB，HTTP 处理超时约 15 秒。`handler` 抛错时宿主记录插件运行异常并返回 500。

## WebSocket

协议升级、掩码、分片、ping/pong 由宿主完成。插件只处理消息和连接生命周期。

```js
export async function activate(ctx) {
  if (typeof ctx.webServer.listen !== "function") {
    throw new Error("请升级 EchoMusic 以使用 WebSocket 插件");
  }

  const result = await ctx.webServer.listen({
    path: "/live",
    onUpgrade: (request) =>
      request.protocols.includes("echo")
        ? { accept: true, protocol: "echo" }
        : false,
    onConnection(socket) {
      socket.onMessage(async ({ data }) => {
        await socket.send(data);
      });
      socket.onClose(({ code, reason }) => {
        console.log("closed", code, reason);
      });
      socket.onError((error) => {
        console.error(error);
      });
      void socket.send("ready");
    },
  });
  if (!result.ok) return;
}
```

`onConnection(handler, options?)`：

- `path`：只接受该 pathname 的升级。省略时接受任意路径。未匹配的升级由其他处理器或默认拒绝处理，当前处理器不会主动 403。
- `onUpgrade(request)`：可选。在握手完成前决定是否接受。返回 `false` 拒绝（403）；返回 `true`、`undefined` 或 `{ accept: true, protocol }` 接受。`protocol` 必须是客户端 `Sec-WebSocket-Protocol` 里的一项；省略时使用客户端列出的第一个。
- `handler(socket)` 在连接打开后调用。可以返回清理函数，连接关闭或插件停用时由宿主调用。

`socket`：

| 字段 / 方法 | 说明 |
| --- | --- |
| `connectionId` | 连接 id |
| `protocol` | 协商后的子协议，可能为空字符串 |
| `url` / `path` / `query` / `headers` / `remoteAddress` | 升级请求信息 |
| `readyState` | `1` 打开，`3` 已关闭 |
| `send(data)` | 发送文本或二进制。字符串走文本帧，`ArrayBuffer` / `Uint8Array` / `{ type: "base64", data }` 走二进制帧 |
| `ping(data?)` | 发送 ping；pong 由宿主自动回复，插件收不到 ping/pong 事件 |
| `close(code?, reason?)` | 关闭连接。`code` 为 `1000` 或 `3000..4999` |
| `onMessage` / `onClose` / `onError` | 注册监听，返回取消函数 |

文本消息的 `event.data` 是字符串，二进制是 `ArrayBuffer`。不要假设一条消息对应一次业务命令之外的边界；那是你自己的应用协议。

客户端：

```js
const socket = new WebSocket("ws://127.0.0.1:38123/live", "echo");
socket.onmessage = (event) => console.log(event.data);
socket.send("hello");
```

## 限制

默认每个插件最多 16 条 WebSocket，单条消息最大 1 MiB。可在 `listen()` 时调整：

```js
await ctx.webServer.listen({
  maxConnections: 32,       // 同时连接数，1..64，默认 16
  maxMessageBytes: 2 << 20, // 单条消息，1 KiB..8 MiB，默认 1 MiB
  maxBufferedBytes: 8 << 20, // 每条连接未发出的排队字节，默认 4× 消息上限
});
```

`maxBufferedBytes` 管的是发送背压：插件 `send()` 太快、对端读得慢时，未写出的数据会堆在这条连接上。它必须 ≥ `maxMessageBytes`（至少能放下一条完整消息），且 ≤ 32 MiB。省略时用 `min(4 × maxMessageBytes, 32 MiB)`。超过这个上限的 `send()` 会失败，不会无限排队。

升级请求约 10 秒内必须由插件决定接受或拒绝，超时返回 503。压缩扩展关闭。`status()` 还会返回当前 `connections`。`close()` 会结束 HTTP 服务和全部 socket。

不要用 WebSocket 做任意公网入口，也不要把整首音频经 IPC 推到渲染进程。需要连出到设备协议时用 [TCP 网络 API](tcp.md)。
