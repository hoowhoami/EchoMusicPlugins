const BACKUP_EXTENSION = ".echomusic-backup";
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getlastmodified/><getcontentlength/></prop></propfind>';

export const DEFAULT_WEBDAV_CONFIG = Object.freeze({
  enabled: false,
  url: "",
  username: "",
  password: "",
  directory: "EchoMusic",
  rememberPassword: false,
});

const asText = (value) => String(value ?? "").trim();

const normalizeDirectory = (value) => {
  const source = asText(value || DEFAULT_WEBDAV_CONFIG.directory).replace(
    /\\/g,
    "/",
  );
  const segments = source.split("/").filter(Boolean);
  if (segments.length === 0) return DEFAULT_WEBDAV_CONFIG.directory;
  if (segments.length > 20) throw new Error("远端目录层级过深");
  for (const segment of segments) {
    if (segment === "." || segment === "..")
      throw new Error("远端目录不能包含 . 或 ..");
    if (segment.length > 100 || /[\u0000-\u001f\u007f]/.test(segment)) {
      throw new Error("远端目录包含无效字符");
    }
  }
  return segments.join("/");
};

export const normalizeWebDavConfig = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(source.enabled),
    url: asText(source.url),
    username: asText(source.username),
    password: String(source.password ?? ""),
    directory: normalizeDirectory(source.directory),
    rememberPassword: Boolean(source.rememberPassword),
  };
};

export const resolveWebDavConfig = (value) => {
  const config = normalizeWebDavConfig(value);
  if (!config.url) throw new Error("请填写 WebDAV 服务地址");

  let url;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("WebDAV 服务地址无效");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WebDAV 服务地址仅支持 http:// 或 https://");
  }
  if (url.username || url.password) {
    throw new Error("请不要把用户名或密码写入 WebDAV URL");
  }
  if (url.search || url.hash)
    throw new Error("WebDAV 服务地址不能包含查询参数或锚点");
  if (config.username && !config.password)
    throw new Error("请输入 WebDAV 密码");
  if (!config.username && config.password)
    throw new Error("请输入 WebDAV 用户名");

  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return {
    ...config,
    url: url.toString(),
    directory: normalizeDirectory(config.directory),
  };
};

const encodeBasicAuthorization = (username, password) => {
  if (!username && !password) return "";
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
};

const buildHeaders = (config, extra = {}) => {
  const authorization = encodeBasicAuthorization(
    config.username,
    config.password,
  );
  return {
    Accept: "*/*",
    ...(authorization ? { Authorization: authorization } : {}),
    ...extra,
  };
};

const appendDirectorySegment = (url, segment) =>
  new URL(`${encodeURIComponent(segment)}/`, url).toString();

export const buildWebDavDirectoryUrl = (value) => {
  const config = resolveWebDavConfig(value);
  return config.directory
    .split("/")
    .filter(Boolean)
    .reduce(appendDirectorySegment, config.url);
};

const isBackupFileName = (value) =>
  typeof value === "string" && value.toLowerCase().endsWith(BACKUP_EXTENSION);

const assertBackupFileName = (value) => {
  const name = asText(value);
  if (
    !name ||
    name.length > 240 ||
    !isBackupFileName(name) ||
    /[\\/\u0000-\u001f\u007f]/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error("备份文件名无效");
  }
  return name;
};

export const buildWebDavFileUrl = (value, fileName) =>
  new URL(
    encodeURIComponent(assertBackupFileName(fileName)),
    buildWebDavDirectoryUrl(value),
  ).toString();

const responseDetail = (response) => {
  if (typeof response?.data !== "string") return "";
  const text = response.data.replace(/\s+/g, " ").trim().slice(0, 160);
  return text ? `：${text}` : "";
};

const assertStatus = (response, expected, action) => {
  if (expected.includes(Number(response?.status))) return response;
  throw new Error(
    `${action}失败（HTTP ${Number(response?.status) || 0}）${responseDetail(response)}`,
  );
};

const request = (ctx, config, options) =>
  ctx.net.request({
    timeoutMs: 120000,
    maxRedirects: 5,
    ...options,
    headers: buildHeaders(config, options.headers),
  });

const propfind = (ctx, config, url, depth, signal) =>
  request(ctx, config, {
    url,
    method: "PROPFIND",
    headers: {
      Depth: String(depth),
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: PROPFIND_BODY,
    responseType: "text",
    maxResponseBytes: 4 * 1024 * 1024,
    signal,
  });

export const ensureWebDavDirectory = async (ctx, value, options = {}) => {
  const config = resolveWebDavConfig(value);
  const { signal } = options;
  const baseResponse = await propfind(ctx, config, config.url, 0, signal);
  assertStatus(baseResponse, [200, 207], "访问 WebDAV 服务");

  let currentUrl = config.url;
  for (const segment of config.directory.split("/").filter(Boolean)) {
    currentUrl = appendDirectorySegment(currentUrl, segment);
    const probe = await propfind(ctx, config, currentUrl, 0, signal);
    if ([200, 207].includes(Number(probe.status))) continue;
    if (Number(probe.status) !== 404) {
      assertStatus(probe, [200, 207], `访问远端目录 ${segment}`);
    }
    const created = await request(ctx, config, {
      url: currentUrl,
      method: "MKCOL",
      responseType: "text",
      signal,
    });
    assertStatus(created, [200, 201, 204, 405], `创建远端目录 ${segment}`);
  }
  return currentUrl;
};

const decodeXml = (value) =>
  String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

const readXmlTag = (block, tag) => {
  const match = new RegExp(
    `<(?:(?:[\\w.-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${tag}\\s*>`,
    "i",
  ).exec(block);
  return match ? decodeXml(match[1].replace(/<[^>]*>/g, "")).trim() : "";
};

const safeDecodeURIComponent = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const parseWebDavEntries = (xml, directoryUrl) => {
  const blocks = String(xml ?? "").match(
    /<(?:(?:[\w.-]+):)?response\b[^>]*>[\s\S]*?<\/(?:(?:[\w.-]+):)?response\s*>/gi,
  );
  if (!blocks) return [];

  const entries = [];
  const seen = new Set();
  for (const block of blocks) {
    if (/<(?:(?:[\w.-]+):)?collection\b/i.test(block)) continue;
    const href = readXmlTag(block, "href");
    if (!href) continue;
    let pathname;
    try {
      pathname = new URL(href, directoryUrl).pathname;
    } catch {
      continue;
    }
    const rawName = pathname.split("/").filter(Boolean).at(-1) || "";
    const name = safeDecodeURIComponent(rawName);
    if (!isBackupFileName(name) || seen.has(name)) continue;
    seen.add(name);

    const rawSize = readXmlTag(block, "getcontentlength");
    const size = rawSize ? Number(rawSize) : Number.NaN;
    entries.push({
      id: name,
      name,
      ...(normalizeDate(readXmlTag(block, "getlastmodified"))
        ? { createdAt: normalizeDate(readXmlTag(block, "getlastmodified")) }
        : {}),
      ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
    });
  }

  return entries.sort((left, right) => {
    const byDate = String(right.createdAt || "").localeCompare(
      String(left.createdAt || ""),
    );
    return byDate || left.name.localeCompare(right.name, "zh-CN");
  });
};

export const createWebDavProvider = (ctx, value) => {
  const config = resolveWebDavConfig(value);
  const directoryUrl = buildWebDavDirectoryUrl(config);
  const location = new URL(directoryUrl);
  let directoryReady = false;

  const ensureDirectory = async (signal) => {
    if (directoryReady) return directoryUrl;
    const readyUrl = await ensureWebDavDirectory(ctx, config, { signal });
    directoryReady = true;
    return readyUrl;
  };

  return {
    id: "webdav",
    name: "WebDAV 备份",
    description: `${location.host} · ${config.directory}`,

    async save({ fileName, data, signal }) {
      await ensureDirectory(signal);
      const response = await request(ctx, config, {
        url: buildWebDavFileUrl(config, fileName),
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
        responseType: "text",
        signal,
      });
      assertStatus(response, [200, 201, 204], "上传备份");
    },

    async list({ signal }) {
      await ensureDirectory(signal);
      const response = await propfind(ctx, config, directoryUrl, 1, signal);
      assertStatus(response, [200, 207], "读取备份列表");
      return parseWebDavEntries(response.data, directoryUrl);
    },

    async load({ id, signal }) {
      await ensureDirectory(signal);
      const response = await request(ctx, config, {
        url: buildWebDavFileUrl(config, id),
        method: "GET",
        responseType: "arrayBuffer",
        maxResponseBytes: 256 * 1024 * 1024,
        signal,
      });
      assertStatus(response, [200], "下载备份");
      return response.data;
    },

    async remove({ id, signal }) {
      await ensureDirectory(signal);
      const response = await request(ctx, config, {
        url: buildWebDavFileUrl(config, id),
        method: "DELETE",
        responseType: "text",
        signal,
      });
      assertStatus(response, [200, 202, 204, 404], "删除备份");
    },
  };
};

const STORAGE_KEY = "settings";

let state = null;
let providerDispose = null;
let settingsDispose = null;
let settingsStyleDispose = null;

const SETTINGS_CSS = `
.echo-webdav-backup-settings {
  display: grid;
  gap: 14px;
  color: var(--color-text-main, #f8fafc);
}

.echo-webdav-backup-card {
  display: grid;
  gap: 12px;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--color-text-main, #f8fafc) 12%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-elevated-base, #111827) 72%, transparent);
  padding: 14px;
}

.echo-webdav-backup-heading,
.echo-webdav-backup-switch,
.echo-webdav-backup-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.echo-webdav-backup-heading-copy,
.echo-webdav-backup-switch-copy,
.echo-webdav-backup-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.echo-webdav-backup-heading h3,
.echo-webdav-backup-field label {
  margin: 0;
  font-size: 13px;
  font-weight: 760;
}

.echo-webdav-backup-heading p,
.echo-webdav-backup-switch small,
.echo-webdav-backup-field small,
.echo-webdav-backup-warning,
.echo-webdav-backup-message {
  margin: 0;
  color: var(--color-text-secondary, rgba(148, 163, 184, 0.9));
  font-size: 11px;
  line-height: 1.55;
}

.echo-webdav-backup-status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 4px 9px;
  background: color-mix(in srgb, var(--color-text-main, #f8fafc) 8%, transparent);
  color: var(--color-text-secondary, rgba(148, 163, 184, 0.9));
  font-size: 10px;
  font-weight: 760;
}

.echo-webdav-backup-status.is-active {
  background: color-mix(in srgb, var(--color-primary, #31cfa1) 16%, transparent);
  color: var(--color-primary, #31cfa1);
}

.echo-webdav-backup-status.is-error {
  background: color-mix(in srgb, #ef4444 13%, transparent);
  color: #ef4444;
}

.echo-webdav-backup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.echo-webdav-backup-field.is-wide {
  grid-column: 1 / -1;
}

.echo-webdav-backup-input input {
  width: 100%;
  min-width: 0;
  height: 38px;
  border-radius: 9px;
  padding-left: 12px;
  padding-right: 34px;
  font-size: 12px;
}

.echo-webdav-backup-switch {
  align-items: flex-start;
}

.echo-webdav-backup-switch-copy span {
  font-size: 12px;
  font-weight: 700;
}

.echo-webdav-backup-actions {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.echo-webdav-backup-message.is-success {
  color: var(--color-primary, #31cfa1);
}

.echo-webdav-backup-message.is-error,
.echo-webdav-backup-warning strong {
  color: #ef4444;
}

@media (max-width: 640px) {
  .echo-webdav-backup-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .echo-webdav-backup-field.is-wide {
    grid-column: auto;
  }
}
`;

const getErrorMessage = (error, fallback) =>
  error instanceof Error && error.message ? error.message : fallback;

export const toPersistedWebDavConfig = (value) => {
  const settings = normalizeWebDavConfig(value);
  return {
    ...settings,
    password: settings.rememberPassword ? settings.password : "",
  };
};

const disposeProvider = () => {
  providerDispose?.();
  providerDispose = null;
};

const applySettings = (ctx, value) => {
  const next = normalizeWebDavConfig(value);
  disposeProvider();
  state.settings = next;

  if (!next.enabled) {
    state.providerStatus = {
      kind: "disabled",
      label: "未启用",
      detail: "启用并保存后，存储位置才会出现在主程序备份与恢复界面。",
    };
    return;
  }

  try {
    const resolved = resolveWebDavConfig(next);
    providerDispose = ctx.backups.registerProvider(
      createWebDavProvider(ctx, resolved),
    );
    state.providerStatus = {
      kind: "active",
      label: "已接入",
      detail: "主程序现在可以选择此 WebDAV 存储位置。",
    };
  } catch (error) {
    state.providerStatus = {
      kind: "error",
      label: "待配置",
      detail: getErrorMessage(error, "WebDAV 配置不完整"),
    };
  }
};

const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "WebDavBackupSettings",
    setup() {
      const { defineAsyncComponent, h, onUnmounted, reactive, ref, watch } =
        ctx.vue;
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      const Input = defineAsyncComponent(ctx.ui.components.Input);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const draft = reactive(normalizeWebDavConfig(state.settings));
      const saving = ref(false);
      const testing = ref(false);
      const message = ref("");
      const messageKind = ref("");
      let testController = null;

      watch(
        () => state.settings,
        (settings) => {
          if (!saving.value)
            Object.assign(draft, normalizeWebDavConfig(settings));
        },
        { deep: true },
      );

      onUnmounted(() => testController?.abort());

      const updateDraft = (key, value) => {
        draft[key] = value;
        message.value = "";
        messageKind.value = "";
      };

      const testConnection = async () => {
        if (testing.value) return;
        testing.value = true;
        message.value = "";
        messageKind.value = "";
        testController?.abort();
        testController = new AbortController();
        try {
          const config = resolveWebDavConfig({ ...draft });
          await ensureWebDavDirectory(ctx, config, {
            signal: testController.signal,
          });
          message.value = "连接成功，备份目录已就绪";
          messageKind.value = "success";
          ctx.toast.success("WebDAV 连接成功");
        } catch (error) {
          if (testController.signal.aborted) return;
          const text = getErrorMessage(error, "WebDAV 连接失败");
          message.value = text;
          messageKind.value = "error";
          ctx.toast.warning(text);
        } finally {
          testing.value = false;
        }
      };

      const saveSettings = async () => {
        if (saving.value) return;
        saving.value = true;
        message.value = "";
        messageKind.value = "";
        try {
          const next = normalizeWebDavConfig({ ...draft });
          if (next.enabled) resolveWebDavConfig(next);
          await ctx.storage.set(STORAGE_KEY, toPersistedWebDavConfig(next));
          applySettings(ctx, next);
          Object.assign(draft, next);
          message.value = next.enabled
            ? "设置已保存并接入主程序"
            : "设置已保存，Provider 已停用";
          messageKind.value = "success";
          ctx.toast.success("WebDAV 备份设置已保存");
        } catch (error) {
          const text = getErrorMessage(error, "设置保存失败");
          message.value = text;
          messageKind.value = "error";
          ctx.toast.warning(text);
        } finally {
          saving.value = false;
        }
      };

      const renderInput = (key, options = {}) =>
        h(Input, {
          modelValue: draft[key],
          class: "echo-webdav-backup-input",
          showClear: options.showClear ?? true,
          type: options.type || "text",
          placeholder: options.placeholder || "",
          "onUpdate:modelValue": (value) =>
            updateDraft(key, String(value ?? "")),
        });

      const renderField = (label, key, options = {}) =>
        h(
          "div",
          {
            class: ["echo-webdav-backup-field", options.wide ? "is-wide" : ""],
          },
          [
            h("label", label),
            renderInput(key, options),
            options.hint ? h("small", options.hint) : null,
          ],
        );

      const renderSwitch = (label, description, key) =>
        h("div", { class: "echo-webdav-backup-switch" }, [
          h("div", { class: "echo-webdav-backup-switch-copy" }, [
            h("span", label),
            h("small", description),
          ]),
          h(Switch, {
            modelValue: Boolean(draft[key]),
            disabled: saving.value || testing.value,
            "onUpdate:modelValue": (value) => updateDraft(key, Boolean(value)),
          }),
        ]);

      return () =>
        h("div", { class: "echo-webdav-backup-settings" }, [
          h("section", { class: "echo-webdav-backup-card" }, [
            h("div", { class: "echo-webdav-backup-heading" }, [
              h("div", { class: "echo-webdav-backup-heading-copy" }, [
                h("h3", "WebDAV 备份存储"),
                h("p", state.providerStatus.detail),
              ]),
              h(
                "span",
                {
                  class: [
                    "echo-webdav-backup-status",
                    state.providerStatus.kind === "active" ? "is-active" : "",
                    state.providerStatus.kind === "error" ? "is-error" : "",
                  ],
                },
                state.providerStatus.label,
              ),
            ]),
            renderSwitch(
              "启用存储位置",
              "启用且配置完整后，主程序的备份与恢复界面才会显示此位置。",
              "enabled",
            ),
          ]),
          h("section", { class: "echo-webdav-backup-card" }, [
            h("div", { class: "echo-webdav-backup-grid" }, [
              renderField("WebDAV 服务地址", "url", {
                wide: true,
                placeholder:
                  "https://dav.example.com/remote.php/dav/files/user/",
                hint: "填写 WebDAV 根目录地址，不要在 URL 中包含用户名或密码。",
              }),
              renderField("用户名", "username", {
                placeholder: "WebDAV 用户名",
              }),
              renderField("密码或应用专用密码", "password", {
                type: "password",
                showClear: false,
                placeholder: "WebDAV 密码",
              }),
              renderField("远端备份目录", "directory", {
                wide: true,
                placeholder: "EchoMusic",
                hint: "支持多级相对目录，例如 EchoMusic/Backups；缺失目录会在测试或首次备份时创建。",
              }),
            ]),
            renderSwitch(
              "记住密码",
              "关闭时密码仅在当前运行会话有效；重启后需重新输入并保存。",
              "rememberPassword",
            ),
            h("p", { class: "echo-webdav-backup-warning" }, [
              h("strong", "安全提示："),
              "插件 storage 不是系统钥匙串。开启记住密码会把凭据保存在插件数据中；备份本身也未加密，请优先使用 HTTPS 和应用专用密码。",
            ]),
            h("div", { class: "echo-webdav-backup-actions" }, [
              h(
                Button,
                {
                  variant: "outline",
                  size: "xs",
                  loading: testing.value,
                  disabled: saving.value || testing.value,
                  onClick: testConnection,
                },
                { default: () => (testing.value ? "测试中…" : "测试连接") },
              ),
              h(
                Button,
                {
                  variant: "primary",
                  size: "xs",
                  loading: saving.value,
                  disabled: saving.value || testing.value,
                  onClick: saveSettings,
                },
                { default: () => (saving.value ? "保存中…" : "保存并应用") },
              ),
              message.value
                ? h(
                    "span",
                    {
                      class: [
                        "echo-webdav-backup-message",
                        messageKind.value ? `is-${messageKind.value}` : "",
                      ],
                    },
                    message.value,
                  )
                : null,
            ]),
          ]),
        ]);
    },
  });

const registerSettings = (ctx) => {
  settingsDispose?.();
  settingsStyleDispose?.();
  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, {
    id: "webdav-backup-settings",
  });
  settingsDispose = ctx.ui.settings.define({
    title: "WebDAV 备份",
    description: "把 EchoMusic 备份保存到自己的 WebDAV 存储。",
    component: createSettingsComponent(ctx),
  });
};

export async function activate(ctx) {
  const saved = normalizeWebDavConfig(await ctx.storage.get(STORAGE_KEY));
  state = ctx.vue.reactive({
    settings: saved,
    providerStatus: {
      kind: "disabled",
      label: "未启用",
      detail: "启用并保存后，存储位置才会出现在主程序备份与恢复界面。",
    },
  });
  registerSettings(ctx);
  applySettings(ctx, saved);
}

export function deactivate() {
  disposeProvider();
  settingsDispose?.();
  settingsDispose = null;
  settingsStyleDispose?.();
  settingsStyleDispose = null;
  state = null;
}
