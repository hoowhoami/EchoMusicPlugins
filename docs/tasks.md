# 任务中心 API

插件可以通过 `ctx.tasks` 把长时间运行的工作接入 EchoMusic 任务中心。一次 `register()` 代表一次独立运行，并返回绑定该运行世代的 task handle。

## 快速开始

```js
export function activate(ctx) {
  const task = ctx.tasks.register({
    id: `${ctx.id}:sync-library`,
    name: "同步媒体库",
    status: "running",
    retention: "transient",
    progress: {
      done: 0,
      total: 100,
      percent: 0,
      label: "准备中",
    },
  });

  void runSync(task);
}

async function runSync(task) {
  try {
    for (let done = 0; done < 100; done += 1) {
      if (task.signal.aborted) return;
      await syncOneItem(done, { signal: task.signal });
      task.update({
        progress: {
          done: done + 1,
          total: 100,
          percent: done + 1,
          label: `${done + 1} / 100`,
        },
      });
    }

    task.finish("completed", {
      progress: { label: "同步完成" },
    });
  } catch (error) {
    if (task.signal.aborted) return;
    task.finish("error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

## 生命周期

任务状态包括：

- `running`：任务正在执行。
- `completed`：任务成功结束。
- `error`：任务失败。
- `aborted`：任务已中止。

生命周期规则：

- `register()` 创建一轮新任务并返回 handle。
- `update()` 只更新当前运行，不允许改变状态。
- `finish()` 是从 `running` 进入终态的唯一方式。
- 重试或重新运行必须再次调用 `register()`，获得新的 handle。
- 同一插件使用相同 ID 重新注册时，旧 handle 和旧定时器立即失效。
- handle 失效后，`update()`、`finish()`、`cancel()` 和 `dismiss()` 返回 `false`。
- 任务被替换、关闭、自动清理或插件停用时，`task.signal` 会触发 abort。
- `finish("aborted")` 会立即触发 abort，并按保留策略展示中止状态。

不要在异步回调中只保存任务 ID，也不要自行维护 `runId`。应直接捕获本次 `register()` 返回的 handle。

## 保留策略

每个任务必须显式声明 `retention`，任务来源和按钮样式不会隐式改变生命周期。

### transient

适用于普通后台工作：

```text
retention: "transient"
```

- `completed`：展示 5 秒后自动清理。
- `aborted`：展示 3 秒后自动清理。
- `error`：保留到用户手动关闭。

### action-required

适用于完成后仍需要安装、确认、查看结果等操作的任务：

```text
retention: "action-required"
```

- `completed`：手动关闭。
- `error`：手动关闭。
- `aborted`：展示 3 秒后自动清理。

任务中心会为手动保留的终态提供统一“关闭”按钮。

### 自定义策略

```text
retention: {
  completed: { mode: "auto", delayMs: 8000 },
  error: { mode: "manual" },
  aborted: { mode: "auto", delayMs: 2000 },
}
```

`delayMs` 必须是 `0` 到 `2147483647` 之间的有限数字。

## Task handle

### active

```js
task.active;
```

表示该 handle 是否仍拥有当前任务条目。终态在保留期间仍为 active；判断业务是否应继续执行时，应同时检查 `task.signal.aborted`。

### signal

```js
task.signal;
```

标准 `AbortSignal`。应传给支持 signal 的 Fetch、读取或业务函数，并在每个不可撤销副作用前检查：

```js
if (!task.active || task.signal.aborted) return;
```

### update(patch)

更新名称、图标、优先级、进度、错误文本或 actions。普通更新不会延长终态清理时间。

```js
task.update({
  progress: { percent: 60, label: "正在同步" },
});
```

### finish(status, patch?)

结束当前运行。`status` 只能是 `completed`、`error` 或 `aborted`。

```js
task.finish("completed", {
  progress: { label: "处理完成" },
});
```

### cancel()

只触发当前运行的 `AbortSignal`，不删除条目，也不自动改变显示状态。调用方应在业务停止后执行 `finish("aborted")` 或 `dismiss()`。

```js
if (task.cancel()) {
  task.finish("aborted", { progress: { label: "已取消" } });
}
```

### dismiss()

立即移除当前任务并触发 `AbortSignal`。

```js
task.dismiss();
```

## Actions

```js
const task = ctx.tasks.register({
  id: `${ctx.id}:download-model`,
  name: "下载模型",
  status: "running",
  retention: "action-required",
  actions: [
    {
      id: "cancel",
      label: "取消",
      variant: "ghost",
      onClick() {
        if (task.cancel()) {
          task.finish("aborted", { progress: { label: "已取消" } });
        }
      },
    },
  ],
});
```

Action 字段：

- `id`：同一任务内唯一，用作按钮标识。
- `label`：按钮文字。
- `variant`：`ghost`、`primary` 或 `danger`，只控制视觉层级。
- `closePanel`：触发后是否关闭任务中心面板。
- `onClick`：同步或异步回调。

`variant` 不影响保留策略，Action 失败也不会自动改变任务状态。

## ID 和插件停用

- `echo:` 是主程序保留前缀，插件不能注册。
- 任务 ID 在当前任务中心全局唯一，推荐使用 `${ctx.id}:用途` 命名。
- 插件不能覆盖或操作其他插件的任务。
- 插件开始停用时，任务会话会先失效，所有任务被移除，迟到的异步回调无法重新创建或更新旧任务。

这是破坏性的新任务 API，不提供旧版按 ID `ctx.tasks.update(id, patch)` / `ctx.tasks.dismiss(id)` 兼容层。
