# 服务请求拦截 API（ctx.server）

`ctx.server.intercept()` 允许插件像抓包代理一样介入主程序发往酷狗服务端的每一次 API 调用，链路为：

```
主程序业务代码 → 插件拦截器链（按优先级排列）→ 酷狗 server
```

拦截器可以**观察、修改、屏蔽（Mock）、转发**请求，也可以加工响应。

## 声明能力

该能力可以读取 Authorization 中的登录 token、用户 id 和设备标识，以及全部听歌数据，并可篡改请求与响应，敏感度与 `unrestrictedNetwork` 同级。必须在 `manifest.json` 中显式声明：

```json
{
  "capabilities": {
    "serverIntercept": true
  }
}
```

需要把请求转发到第三方/自建服务时，还需同时声明 `unrestrictedNetwork: true`（使用 `ctx.net.request` 转发，无 CORS 限制）。建议在 `requires.echoMusicVersion` 中要求包含该能力的 EchoMusic 版本。

## 快速上手

```js
module.exports.activate = (ctx) => {
  ctx.server.intercept(
    async (req, next) => {
      // 1. 观察请求
      console.log(req.method, req.url, req.params);

      // 2. 修改请求参数（签名由宿主基于新参数自动重算，不会失效）
      if (req.url === '/search/complex') {
        req.params.keyword = String(req.params.keyword ?? '').trim();
      }

      // 3. 交给链上的下一个拦截器 / 真实服务
      const res = await next();

      // 4. 加工响应
      return res;
    },
    { name: 'my-interceptor' },
  );
};
```

`intercept(handler, options?)` 返回注销函数；插件停用时宿主也会自动注销，无需手动清理。同一插件可注册多个拦截器。

## 请求与响应对象

`handler(request, next)` 收到的 `request`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `method` | `string` | `'GET'` / `'POST'` |
| `url` | `string` | 服务路由，如 `'/song/url'` |
| `params` | `object` | 查询参数（活对象，可原地修改） |
| `data` | `any` | POST 请求体，可能不存在 |
| `headers` | `object` | 请求头，**已包含注入后的 Authorization** |
| `origin` | `object` | 固定为 `{ type: 'host' }`。插件自己经 `ctx.kugou` 发起的请求不会进入拦截链 |

`next()` 解析为响应对象：

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `number` | HTTP 状态码 |
| `body` | `any` | 服务端响应体 |
| `headers` | `object` | 响应头，可能不存在 |
| `cookie` | `string[]` | Set-Cookie，可能不存在 |
| `mocked` | `boolean` | 该响应是否被链上某个拦截器短路（未真实出网） |
| `handledBy` | `string` | 短路该请求的插件 id |

## 三个核心决策

### 1. priority：拦截器排在链上的位置

多个插件（或同一插件的多个拦截器）组成一条**洋葱链**。排序规则：`priority` 数值越大越靠外层（请求阶段越早执行、响应阶段越晚收到结果）；同优先级按注册先后排列。每次请求开始时顺序冻结。

建议档位（约定，非强制）：

| priority | 用途 |
|---|---|
| `100` | 观测：流量日志、耗时统计（最外层能看到经过全部加工后的最终结果） |
| `0`（默认） | 数据转换：补参数、清洗响应 |
| `-100` | Mock / 转发：最内层接管，其结果仍可被外层观测与加工 |

### 2. match：决定是否应用于本次请求

`options.match` 支持三种形式，不匹配时 handler **不会被调用**（零开销透明跳过）：

```js
// 字符串：路由前缀匹配
ctx.server.intercept(handler, { match: '/song/' });

// 正则：对 url 执行 test
ctx.server.intercept(handler, { match: /^\/(song|privilege)\// });

// 函数：拿到完整请求自行判断（可读 method/params/data/headers）
ctx.server.intercept(handler, {
  match: (req) => req.method === 'GET' && req.url.startsWith('/privilege/'),
});
```

`match` 在链上逐层即时求值：外层拦截器改写了 `url`，内层按改写后的值重新判定。更复杂的动态条件（如读插件设置开关）也可以直接在 handler 内 `if (!cond) return next()`。

### 3. next：决定是否继续向下传递

| 写法 | 行为 |
|---|---|
| `return next()` | 透传给下一个匹配的拦截器（可在其返回后加工响应） |
| `return next({ params: {...}, headers: {...} })` | 以补丁形式修改请求后透传（浅合并，headers 深合并） |
| 不调用 `next`，`return { status, body }` | **短路接管**：后续拦截器与真实 server 都不会被触达，响应自动标记 `mocked: true` |
| 不调用 `next` 且抛错/返回非法值 | 宿主自动放行原请求（fail-open），并在插件管理页记录该插件异常 |

`next()` 是幂等的：重复调用拿到同一个结果，不会产生第二次网络请求。

> 注意：**不要用 `throw` 来"阻断"请求**——异常会被 fail-open 兜底放行。要屏蔽请求，请返回一个错误形态的 Mock 响应（如 `{ status: 403, body: {...} }`）。

## 典型场景

### Mock / 屏蔽请求

```js
ctx.server.intercept(
  () => ({ status: 200, body: { status: 1, data: { count: 0 } } }),
  { match: '/some/counter', priority: -100, name: 'counter-mock' },
);
```

Mock 响应会继续经过主程序既有的统一处理（登录过期检测、错误码包装等），请返回业务上合理的 body。

### 转发到自建服务（Map Remote）

拦截后不调用 `next`，改用 `ctx.net.request` 转发（需同时声明 `unrestrictedNetwork`）：

```js
ctx.server.intercept(
  async (req) => {
    const external = await ctx.net.request({
      method: 'POST',
      url: `https://my-server.example.com/kugou${req.url}`,
      body: { params: req.params, data: req.data },
    });
    return { status: external.status, body: external.data };
  },
  { match: /^\/song\//, priority: -100 },
);
```

### 修改响应 / 感知内层 Mock

```js
ctx.server.intercept(
  async (req, next) => {
    const res = await next();
    if (res.mocked) {
      console.log(`响应已被 ${res.handledBy} 接管，选择透传或覆盖`);
    }
    if (req.url === '/song/url' && res.body?.data) {
      res.body.data = patchSongUrl(res.body.data);
    }
    return res;
  },
  { priority: 100, name: 'response-patcher' },
);
```

当多个拦截器都想接管同一请求时，结果由优先级确定：内层先生效，外层保留最终覆盖权。

### 运行时开关

功能开关频繁切换时不必反复注销，在 handler 内读自身状态即可：

```js
let enabled = true;
ctx.server.intercept(
  (req, next) => (enabled ? doIntercept(req, next) : next()),
  { match: '/song/', name: 'optional-patch' },
);
```

## 边界与注意事项

1. 拦截点在**逻辑 API 层**（路由 + params + data + headers），发生在请求签名之前——改参数不会破坏签名，宿主会自动重算；
2. 看不到也不能改 server 内部生成的签名、默认设备参数和最终出网域名（透明换网关请用主程序的网络代理设置）；
3. 音频流、封面图片直连、WebSocket、`ctx.net.*` 自身发起的请求**不在拦截范围**；
4. 插件经 `ctx.kugou.*` 发起的请求标记为 plugin 来源，**不会进入拦截链**，因此拦截器中可以自由调用 `ctx.kugou` 而不会递归；
5. 拦截器异常一律 fail-open 放行，不能用崩溃方式阻断网络；出错信息会出现在插件管理页的插件异常记录中；
6. 主窗口、Mini Player、桌面歌词是独立运行时，拦截器只影响它所在窗口发起的请求（业务流量集中在主窗口）。
