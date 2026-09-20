const STORAGE_KEY = "settings";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  hideDefaultFavorite: true,
  hideHomeComments: false,
  hideHomeMv: false,
  hideHomeSleepTimer: false,
  hideHomeVolume: false,
  hideHomeSpeed: false,
  hideHomeShare: false,
  hideHomeEffect: false,
  hideHomeDesktopLyric: false,
  hidePlayerComments: false,
  hidePlayerBarrage: false,
  hidePlayerSleepTimer: false,
  hidePlayerVolume: false,
  hidePlayerSpeed: false,
  hidePlayerShare: false,
  hidePlayerEffect: false,
  hidePlayerDesktopLyric: false,
});

const BOOLEAN_KEYS = Object.keys(DEFAULT_SETTINGS);

export const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    BOOLEAN_KEYS.map((key) => [key, typeof source[key] === "boolean" ? source[key] : DEFAULT_SETTINGS[key]]),
  );
};

const HOME_ATTRIBUTE_KEYS = {
  hideHomeComments: "homeComments",
  hideHomeMv: "homeMv",
  hideHomeSleepTimer: "homeSleepTimer",
  hideHomeVolume: "homeVolume",
  hideHomeSpeed: "homeSpeed",
  hideHomeShare: "homeShare",
  hideHomeEffect: "homeEffect",
  hideHomeDesktopLyric: "homeDesktopLyric",
};

const PLAYER_ATTRIBUTE_KEYS = {
  hidePlayerComments: "playerComments",
  hidePlayerBarrage: "playerBarrage",
  hidePlayerSleepTimer: "playerSleepTimer",
  hidePlayerVolume: "playerVolume",
  hidePlayerSpeed: "playerSpeed",
  hidePlayerShare: "playerShare",
  hidePlayerEffect: "playerEffect",
  hidePlayerDesktopLyric: "playerDesktopLyric",
};

export const isHomeRoute = (route) => {
  const name = String(route?.name ?? "");
  const path = String(route?.path ?? "");
  return name === "home" || path === "/main/home";
};

export const getVisibilityAttributes = (settings, home) => {
  const normalized = normalizeSettings(settings);
  const attributes = {
    enabled: normalized.enabled,
    home: Boolean(home),
  };
  for (const [key, name] of Object.entries(HOME_ATTRIBUTE_KEYS)) {
    // “首页播放控件”实际属于普通布局的底部播放栏；切到探索发现等栏目后，
    // 播放栏仍然是同一个组件，因此不能跟着路由恢复显示。
    attributes[name] = normalized.enabled && normalized[key];
  }
  for (const [key, name] of Object.entries(PLAYER_ATTRIBUTE_KEYS)) {
    attributes[name] = normalized.enabled && normalized[key];
  }
  return attributes;
};

export const isDefaultFavoriteItem = (element) => {
  if (!element || typeof element.querySelectorAll !== "function") return false;
  return [...element.querySelectorAll("span")].some(
    (node) => String(node.textContent ?? "").trim() === "默认收藏",
  );
};

const CSS = `
html[data-echo-ui-visibility-home-comments="true"] .player-bar button[aria-label="详情及评论"],
html[data-echo-ui-visibility-home-mv="true"] .player-bar button[aria-label="播放 MV"],
html[data-echo-ui-visibility-home-share="true"] .player-bar button[aria-label="分享"],
html[data-echo-ui-visibility-home-effect="true"] .player-bar .echo-popover-trigger:has(> button[aria-label="音效与均衡器"]),
html[data-echo-ui-visibility-home-desktop-lyric="true"] .player-bar .relative:has(> button[aria-label*="桌面歌词"]),
html[data-echo-ui-visibility-player-comments="true"] .lyric-bar button[aria-label="评论"],
html[data-echo-ui-visibility-player-barrage="true"] .lyric-bar .barrage-toolbar.is-lyric button[aria-label="弹幕设置与发送"],
html[data-echo-ui-visibility-player-share="true"] .lyric-bar button[aria-label="分享"],
html[data-echo-ui-visibility-player-effect="true"] .lyric-bar .echo-popover-trigger:has(> button[aria-label="音效与均衡器"]),
html[data-echo-ui-visibility-player-desktop-lyric="true"] .lyric-bar .relative:has(> button[aria-label*="桌面歌词"]) {
  display: none !important;
}

/* Popover 的触发器自带一层 inline-flex 包装，连包装层一起移除，避免留下空隙。 */
html[data-echo-ui-visibility-home-sleep-timer="true"] .player-bar .echo-popover-trigger:has(> button.sleep-timer-trigger),
html[data-echo-ui-visibility-home-volume="true"] .player-bar .echo-popover-trigger:has(> button[aria-label="静音"]),
html[data-echo-ui-visibility-home-volume="true"] .player-bar .echo-popover-trigger:has(> button[aria-label="取消静音"]),
html[data-echo-ui-visibility-home-speed="true"] .player-bar .echo-popover-trigger:has(> button[aria-label="倍速播放"]),
html[data-echo-ui-visibility-player-sleep-timer="true"] .lyric-bar .echo-popover-trigger:has(> button.sleep-timer-trigger),
html[data-echo-ui-visibility-player-volume="true"] .lyric-bar .echo-popover-trigger:has(> button[aria-label="静音"]),
html[data-echo-ui-visibility-player-volume="true"] .lyric-bar .echo-popover-trigger:has(> button[aria-label="取消静音"]),
html[data-echo-ui-visibility-player-speed="true"] .lyric-bar .echo-popover-trigger:has(> button[aria-label="倍速播放"]) {
  display: none !important;
}

html[data-echo-ui-visibility-hide-default-favorite="true"] .echo-ui-visibility-default-favorite {
  display: none !important;
}

.echo-ui-visibility-settings {
  display: grid;
  gap: 16px;
}

.echo-ui-visibility-group {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--control-muted-bg);
}

.echo-ui-visibility-group-title {
  color: var(--color-text-main);
  font-size: 13px;
  font-weight: 800;
}

.echo-ui-visibility-group-description {
  margin-bottom: 4px;
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 11px;
  line-height: 1.45;
}

.echo-ui-visibility-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 30px;
  color: var(--color-text-main);
  font-size: 12px;
}

.echo-ui-visibility-field-copy {
  min-width: 0;
}
`;

const fieldGroups = [
  {
    title: "首页",
    description: "隐藏侧栏中的默认收藏；底部播放栏控件在所有普通栏目中也保持隐藏。",
    fields: [
      ["hideDefaultFavorite", "默认收藏"],
      ["hideHomeComments", "评论及详情"],
      ["hideHomeMv", "播放 MV"],
      ["hideHomeSleepTimer", "定时关闭"],
      ["hideHomeVolume", "音量"],
      ["hideHomeSpeed", "倍速播放"],
      ["hideHomeShare", "分享"],
      ["hideHomeEffect", "歌曲音效"],
      ["hideHomeDesktopLyric", "桌面歌词"],
    ],
  },
  {
    title: "播放器页",
    description: "作用于歌词播放器页底部控制栏。",
    fields: [
      ["hidePlayerComments", "评论"],
      ["hidePlayerBarrage", "弹幕"],
      ["hidePlayerSleepTimer", "定时关闭"],
      ["hidePlayerVolume", "音量"],
      ["hidePlayerSpeed", "倍速播放"],
      ["hidePlayerShare", "分享"],
      ["hidePlayerEffect", "歌曲音效"],
      ["hidePlayerDesktopLyric", "桌面歌词"],
    ],
  },
];

let runtimeCtx = null;
let state = null;
let styleDispose = null;
let settingsDispose = null;
let routeDispose = null;
const favoriteRows = new Set();

const currentRoute = () => runtimeCtx?.router?.currentRoute?.value ?? {};

const applyRootAttributes = () => {
  if (!runtimeCtx || !state || typeof document === "undefined") return;
  const root = document.documentElement;
  const attributes = getVisibilityAttributes(state.settings, isHomeRoute(currentRoute()));
  for (const [name, value] of Object.entries(attributes)) {
    root.dataset[`echoUiVisibility${name[0].toUpperCase()}${name.slice(1)}`] = String(value);
  }
  root.dataset.echoUiVisibilityHideDefaultFavorite = String(
    state.settings.enabled && state.settings.hideDefaultFavorite,
  );
  applyFavoriteRows();
};

const applyFavoriteRow = (row) => {
  if (!row) return;
  const hidden =
    Boolean(state?.settings?.enabled) &&
    Boolean(state?.settings?.hideDefaultFavorite) &&
    isDefaultFavoriteItem(row);
  row.classList.toggle("echo-ui-visibility-default-favorite", hidden);
  if (hidden) row.dataset.echoUiVisibilityHidden = "true";
  else delete row.dataset.echoUiVisibilityHidden;
};

const applyFavoriteRows = () => {
  for (const row of favoriteRows) applyFavoriteRow(row);
};

const createSettingsComponent = (ctx) => {
  const { defineAsyncComponent, defineComponent, h, reactive } = ctx.vue;
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);

  return defineComponent({
    name: "EchoUiVisibilitySettings",
    setup() {
      const draft = reactive({ ...state.settings });
      const update = (key, value) => {
        draft[key] = Boolean(value);
        Object.assign(state.settings, normalizeSettings(draft));
        applyRootAttributes();
        void ctx.storage.set(STORAGE_KEY, { ...state.settings });
      };
      const reset = () => {
        Object.assign(draft, DEFAULT_SETTINGS);
        Object.assign(state.settings, DEFAULT_SETTINGS);
        applyRootAttributes();
        void ctx.storage.set(STORAGE_KEY, { ...state.settings });
      };

      return () =>
        h("div", { class: "echo-ui-visibility-settings" }, [
          h(
            "label",
            { class: "echo-ui-visibility-field" },
            [
              h("span", { class: "echo-ui-visibility-field-copy" }, [
                h("span", "启用界面元素隐藏"),
              ]),
              h(Switch, {
                modelValue: draft.enabled,
                "onUpdate:modelValue": (value) => update("enabled", value),
              }),
            ],
          ),
          ...fieldGroups.map((group) =>
            h("section", { class: "echo-ui-visibility-group" }, [
              h("div", { class: "echo-ui-visibility-group-title" }, group.title),
              h("div", { class: "echo-ui-visibility-group-description" }, group.description),
              ...group.fields.map(([key, label]) =>
                h(
                  "label",
                  { class: "echo-ui-visibility-field" },
                  [
                    h("span", { class: "echo-ui-visibility-field-copy" }, label),
                    h(Switch, {
                      modelValue: draft[key],
                      "onUpdate:modelValue": (value) => update(key, value),
                    }),
                  ],
                ),
              ),
            ]),
          ),
          h(
            "button",
            {
              type: "button",
              class: "app-focus-ring-soft px-3 py-2 rounded-lg text-xs font-bold justify-self-start",
              onClick: reset,
            },
            "恢复默认",
          ),
        ]);
    },
  });
};

export async function activate(ctx) {
  runtimeCtx = ctx;
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });
  styleDispose = ctx.css.inject(CSS, { id: "echo-ui-visibility" });
  settingsDispose = ctx.ui.settings.define({
    title: "界面元素隐藏",
    description: "分别隐藏首页和播放器页的播放控件。",
    component: createSettingsComponent(ctx),
  });
  routeDispose = ctx.router.afterEach(() => applyRootAttributes());
  ctx.dom.observe(".sidebar-library-item", (row) => {
    favoriteRows.add(row);
    applyFavoriteRow(row);
    return () => {
      favoriteRows.delete(row);
      row.classList.remove("echo-ui-visibility-default-favorite");
      delete row.dataset.echoUiVisibilityHidden;
    };
  });
  applyRootAttributes();
}

export function deactivate() {
  routeDispose?.();
  routeDispose = null;
  for (const row of favoriteRows) {
    row.classList.remove("echo-ui-visibility-default-favorite");
    delete row.dataset.echoUiVisibilityHidden;
  }
  favoriteRows.clear();
  if (typeof document !== "undefined") {
    for (const key of [
      "enabled",
      "home",
      "homeComments",
      "homeMv",
      "homeSleepTimer",
      "homeVolume",
      "homeSpeed",
      "homeShare",
      "homeEffect",
      "homeDesktopLyric",
      "playerComments",
      "playerBarrage",
      "playerSleepTimer",
      "playerVolume",
      "playerSpeed",
      "playerShare",
      "playerEffect",
      "playerDesktopLyric",
      "hideDefaultFavorite",
    ]) {
      delete document.documentElement.dataset[
        `echoUiVisibility${key[0].toUpperCase()}${key.slice(1)}`
      ];
    }
  }
  settingsDispose?.();
  styleDispose?.();
  settingsDispose = null;
  styleDispose = null;
  runtimeCtx = null;
  state = null;
}
