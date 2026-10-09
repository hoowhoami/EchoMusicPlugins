// 视频资源独立于插件代码；主题设置只保存文件引用，不保存临时媒体 URL。
const isFileRef = (file) =>
  file === null ||
  (file &&
    typeof file === "object" &&
    ((file.kind === "selected-file" &&
      typeof file.fileId === "string" &&
      !!file.fileId) ||
      (file.kind === "directory-file" &&
        typeof file.directoryId === "string" &&
        !!file.directoryId &&
        typeof file.relativePath === "string" &&
        !!file.relativePath)));

export function activate(ctx) {
  if (
    !ctx.theme?.register ||
    !ctx.fs?.requestFiles ||
    !ctx.fs?.openMedia ||
    !ctx.net?.download
  ) {
    throw new Error("视频主题示例需要包含文件授权与下载 API 的 EchoMusic");
  }
  const {
    defineComponent,
    defineAsyncComponent,
    h,
    ref,
    shallowRef,
    watch,
    nextTick,
    onBeforeUnmount,
  } = ctx.vue;
  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Input = defineAsyncComponent(ctx.ui.components.Input);
  const Slider = defineAsyncComponent(ctx.ui.components.Slider);
  const task = shallowRef(null),
    snapshot = shallowRef(null),
    downloaded = shallowRef(null);
  const transferError = ref(""),
    playbackError = ref(""),
    starting = ref(false);
  let disposed = false,
    stopProgress;
  ctx.dispose(() => {
    disposed = true;
    stopProgress?.();
  });
  const activeTransfer = () =>
    starting.value ||
    (snapshot.value &&
      !["completed", "failed", "canceled", "interrupted"].includes(
        snapshot.value.state,
      ));

  const Settings = defineComponent({
    name: "VideoThemeDemoSettings",
    setup() {
      const theme = ctx.theme.useTheme(),
        url = ref(""),
        selecting = ref(false),
        localError = ref("");
      let alive = true,
        selectionRevision = 0;
      onBeforeUnmount(() => {
        alive = false;
        selectionRevision++;
      });
      const useFile = (file, label, revision) => {
        if (!alive || disposed || revision !== selectionRevision) return;
        theme.updateSettings({ file, label });
      };
      const chooseLocal = async () => {
        const revision = ++selectionRevision;
        selecting.value = true;
        localError.value = "";
        try {
          const result = await ctx.fs.requestFiles({
            purpose: "作为视频主题背景",
            persist: true,
            multiple: false,
            filters: [
              { name: "视频", extensions: ["mp4", "webm", "mov", "m4v"] },
            ],
          });
          if (!result.ok) throw new Error(result.error.message);
          if (result.canceled || !alive || revision !== selectionRevision)
            return;
          const file = result.files[0];
          const stat = await ctx.fs.stat(file);
          useFile(file, stat.name, revision);
        } catch (error) {
          if (alive && revision === selectionRevision)
            localError.value = error.message;
        } finally {
          if (alive) selecting.value = false;
        }
      };
      const download = async () => {
        if (activeTransfer()) return;
        const revision = ++selectionRevision;
        starting.value = true;
        transferError.value = "";
        downloaded.value = null;
        stopProgress?.();
        task.value = null;
        snapshot.value = null;
        try {
          const source = new URL(url.value.trim());
          if (!["http:", "https:"].includes(source.protocol))
            throw new Error("请输入 HTTP/HTTPS 视频直链");
          const label = decodeURIComponent(
            source.pathname.split("/").pop() || "video.mp4",
          );
          const extension =
            label.match(/\.(mp4|webm|mov|m4v)$/i)?.[1].toLowerCase() ?? "mp4";
          const directory = await ctx.fs.getPrivateDirectory({ kind: "data" });
          if (disposed || !alive) return;
          const handle = await ctx.net.download({
            url: source.href,
            target: {
              directoryId: directory.id,
              relativePath: `videos/${globalThis.crypto.randomUUID?.() ?? Date.now() + "-" + Math.random().toString(16).slice(2)}.${extension}`,
            },
            name: "视频主题素材",
            conflict: "fail",
          });
          task.value = handle;
          stopProgress = handle.subscribe((value) => {
            if (!disposed) snapshot.value = value;
          });
          const result = await handle.wait();
          if (disposed) return;
          downloaded.value = { file: result.file, label };
          useFile(result.file, label, revision);
        } catch (error) {
          if (!disposed) transferError.value = error.message;
        } finally {
          starting.value = false;
          stopProgress?.();
          stopProgress = undefined;
        }
      };
      const cancel = async () => {
        try {
          await task.value?.cancel();
        } catch (error) {
          if (!disposed) transferError.value = error.message;
        }
      };
      const progress = () => {
        const value = snapshot.value;
        if (!value) return starting.value ? "准备下载…" : "";
        const titles = {
          queued: "排队中",
          connecting: "连接中",
          downloading: "下载中",
          paused: "已暂停",
          interrupted: "已中断",
          verifying: "校验中",
          committing: "保存中",
          completed: "下载完成",
          failed: "下载失败",
          canceled: "已取消",
        };
        const size = (value.receivedBytes / 1024 / 1024).toFixed(1);
        const total =
          value.totalBytes === undefined
            ? ""
            : ` / ${(value.totalBytes / 1024 / 1024).toFixed(1)}`;
        return `${titles[value.state] ?? value.state} · ${size}${total} MiB`;
      };
      return () =>
        h("div", { style: "padding:16px 0;display:grid;gap:12px" }, [
          h(
            "p",
            theme.settings.value.label
              ? `当前视频：${theme.settings.value.label}`
              : "尚未选择视频。选择本地文件，或下载视频后使用。",
          ),
          h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
            h(
              Button,
              {
                disabled: selecting.value || activeTransfer(),
                onClick: chooseLocal,
              },
              () => "选择本地视频",
            ),
            h(
              Button,
              {
                variant: "secondary",
                disabled:
                  selecting.value ||
                  activeTransfer() ||
                  !theme.settings.value.file,
                onClick: () => {
                  ++selectionRevision;
                  theme.updateSettings({ file: null, label: "" });
                },
              },
              () => "清除选择",
            ),
          ]),
          h(Input, {
            modelValue: url.value,
            placeholder: "HTTP/HTTPS 视频直链",
            disabled: activeTransfer(),
            "aria-label": "视频下载地址",
            "onUpdate:modelValue": (value) => {
              url.value = String(value);
            },
          }),
          h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
            h(
              Button,
              {
                disabled:
                  !url.value.trim() || selecting.value || activeTransfer(),
                onClick: download,
              },
              () => "下载并使用",
            ),
            activeTransfer()
              ? h(
                  Button,
                  {
                    variant: "secondary",
                    disabled:
                      !task.value ||
                      ["verifying", "committing"].includes(
                        snapshot.value?.state,
                      ),
                    onClick: cancel,
                  },
                  () => "取消下载",
                )
              : null,
            downloaded.value
              ? h(
                  Button,
                  {
                    variant: "secondary",
                    disabled: activeTransfer(),
                    onClick: () =>
                      useFile(
                        downloaded.value.file,
                        downloaded.value.label,
                        ++selectionRevision,
                      ),
                  },
                  () => "使用已下载视频",
                )
              : null,
          ]),
          progress() ? h("p", { role: "status" }, progress()) : null,
          localError.value || transferError.value || playbackError.value
            ? h(
                "p",
                { role: "alert" },
                localError.value || transferError.value || playbackError.value,
              )
            : null,
          h("label", `背景遮罩 ${theme.settings.value.shade}%`),
          h(Slider, {
            min: 0,
            max: 80,
            step: 5,
            modelValue: theme.settings.value.shade,
            "onUpdate:modelValue": (shade) => theme.updateSettings({ shade }),
          }),
          h("label", [
            "视频填充 ",
            h(
              "select",
              {
                value: theme.settings.value.fit,
                onChange: (event) =>
                  theme.updateSettings({ fit: event.target.value }),
              },
              [
                h("option", { value: "cover" }, "铺满"),
                h("option", { value: "contain" }, "完整显示"),
              ],
            ),
          ]),
          h(
            "p",
            { style: "font-size:12px;opacity:.7" },
            "下载完成后可离线使用。关闭设置不会取消下载，重新打开后可使用已下载视频；清除选择会保留文件。",
          ),
        ]);
    },
  });

  const Background = defineComponent({
    name: "VideoThemeDemoBackground",
    setup() {
      const theme = ctx.theme.useTheme(),
        video = ref(null),
        mediaUrl = ref("");
      let alive = true,
        revision = 0,
        lease;
      const clear = () => {
        const element = video.value;
        if (element) {
          element.pause();
          element.removeAttribute("src");
          element.load();
        }
        mediaUrl.value = "";
        lease?.release();
        lease = undefined;
      };
      const sync = async () => {
        const element = video.value;
        const current = revision;
        if (!alive || !element) return;
        if (!theme.motionEnabled.value) {
          element.pause();
          return;
        }
        element.muted = element.defaultMuted = true;
        try {
          await element.play();
          if (!alive || current !== revision || !theme.motionEnabled.value)
            element.pause();
        } catch (error) {
          if (alive && current === revision && error.name !== "AbortError")
            playbackError.value = "视频无法播放，请检查编码或重新选择文件。";
        }
      };
      watch(
        () => JSON.stringify(theme.settings.value.file),
        async (key) => {
          const file = JSON.parse(key);
          const current = ++revision;
          clear();
          playbackError.value = "";
          if (!file) return;
          try {
            const next = await ctx.fs.openMedia(file);
            if (!alive || current !== revision) {
              next.release();
              return;
            }
            lease = next;
            mediaUrl.value = next.url;
            await nextTick();
            if (alive && current === revision) await sync();
          } catch (error) {
            if (alive && current === revision)
              playbackError.value = `视频不可用：${error.message}`;
          }
        },
        { immediate: true },
      );
      watch(theme.motionEnabled, sync);
      onBeforeUnmount(() => {
        alive = false;
        ++revision;
        clear();
      });
      const fill = {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      };
      return () =>
        h(
          "div",
          { "aria-hidden": "true", style: { ...fill, overflow: "hidden" } },
          [
            mediaUrl.value
              ? h("video", {
                  ref: video,
                  src: mediaUrl.value,
                  muted: true,
                  loop: true,
                  playsinline: true,
                  preload: "auto",
                  onLoadeddata: sync,
                  onCanplay: sync,
                  onError: () => {
                    playbackError.value =
                      "视频无法播放，请检查文件格式或重新授权。";
                  },
                  style: { ...fill, objectFit: theme.settings.value.fit },
                })
              : null,
            h("div", {
              style: {
                ...fill,
                background: "#000000",
                opacity: theme.settings.value.shade / 100,
              },
            }),
          ],
        );
    },
  });
  const light = {
    tokens: {
      shell: "#dce8ec",
      main: "#f0f5f7",
      text: "#182b36",
      secondary: "#4f6672",
    },
    accent: "#1789a3",
    background: { gradient: "linear-gradient(135deg, #b2ccd7, #c7c1dc)" },
  };
  const dark = {
    tokens: {
      shell: "#121a27",
      main: "#1b2637",
      text: "#f3f6fb",
      secondary: "#bac8da",
    },
    accent: "#83b9eb",
    background: { gradient: "linear-gradient(135deg, #112a36, #29243e)" },
  };
  ctx.theme.register({
    id: "video",
    title: "视频主题 Demo",
    type: "dynamic",
    defaultMode: "dark",
    description: "选择本地视频，或下载外置素材后离线使用。",
    variants: { light, dark },
    settings: {
      defaults: { file: null, label: "", shade: 30, fit: "cover" },
      validate: (values) =>
        isFileRef(values.file) &&
        typeof values.label === "string" &&
        Number.isFinite(values.shade) &&
        values.shade >= 0 &&
        values.shade <= 80 &&
        ["cover", "contain"].includes(values.fit),
      component: Settings,
    },
    decorations: { background: Background },
  });
  ctx.ui.sidebar?.shortcuts?.register({
    id: "appearance",
    title: "主题工作台",
    icon: "tabler:palette",
    order: 100,
    onClick: () => ctx.theme.openThemes(),
  });
}
