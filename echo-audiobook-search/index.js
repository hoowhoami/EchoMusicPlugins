/**
 * 听书搜索助手 (echo-audiobook-search)
 * 让「专辑」搜索能搜到酷狗的有声书，点进去沿用主程序原有的专辑页收听。
 */

const SETTINGS_KEY = "settings";
const STATS_KEY = "stats";
const DIAG_KEY = "diag";
const MODE_MIXED = "mixed";
const MODE_BOOK = "book";
const MODE_OFF = "off";

const MODES = [
  { value: MODE_MIXED, label: "混合搜索", desc: "音乐专辑和有声书一起出现", category: "0" },
  { value: MODE_BOOK, label: "只看有声书", desc: "专辑列表里只保留有声书", category: "2" },
  { value: MODE_OFF, label: "关闭", desc: "保持主程序默认的搜索范围", category: null },
];

function isAlbumSearch(url, params) {
  const u = String(url || "");
  if (!u || u.indexOf("search") < 0) return false;
  if (u.indexOf("search/album") >= 0) return true;
  if (u === "/search" || u.indexOf("/search?") === 0) {
    return String((params && params.type) || "song") === "album";
  }
  return false;
}

async function getMode(ctx) {
  try {
    const saved = await ctx.storage.get(SETTINGS_KEY);
    if (saved && typeof saved === "object" && typeof saved.mode === "string") return saved.mode;
  } catch (err) {
    /* ignore */
  }
  return MODE_MIXED;
}

function categoryFor(mode) {
  const hit = MODES.filter(function (m) { return m.value === mode; })[0];
  return hit ? hit.category : "0";
}

function noteDiag(ctx, req, changed) {
  try {
    ctx.storage.get(DIAG_KEY).then(function (list) {
      const arr = Array.isArray(list) ? list : [];
      arr.push({
        t: Date.now(),
        method: String((req && req.method) || ""),
        url: String((req && req.url) || "").slice(0, 120),
        type: req && req.params ? String(req.params.type || "") : "",
        category: req && req.params ? String(req.params.category || "") : "",
        changed: Boolean(changed),
      });
      while (arr.length > 20) arr.shift();
      return ctx.storage.set(DIAG_KEY, arr);
    }).catch(function () {});
    if (changed) {
      ctx.storage.get(STATS_KEY).then(function (s) {
        const stats = s && typeof s === "object" ? s : {};
        stats.injected = (Number(stats.injected) || 0) + 1;
        return ctx.storage.set(STATS_KEY, stats);
      }).catch(function () {});
    }
  } catch (err) {
    /* 诊断失败不影响搜索 */
  }
}

export function activate(ctx) {
  if (!ctx.server || typeof ctx.server.intercept !== "function") {
    try { ctx.toast.warning("听书搜索助手：当前版本不支持，插件未生效"); } catch (e) {}
    return;
  }

  mountSettings(ctx);

  const handler = function (req, next) {
    return getMode(ctx).then(function (mode) {
      let changed = false;
      try {
        const category = categoryFor(mode);
        if (category && req && req.params && isAlbumSearch(req.url, req.params)) {
          if (String(req.params.category || "") !== category) {
            req.params.category = category;
            changed = true;
          }
        }
      } catch (err) {
        /* 参数不可写时静默跳过，不改坏请求 */
      }
      noteDiag(ctx, req, changed);
      return next();
    });
  };

  try {
    ctx.server.intercept(handler, {
      name: "echo-audiobook-search",
      priority: 0,
      match: function (req) {
        return Boolean(req && req.url && String(req.url).toLowerCase().indexOf("search") >= 0);
      },
    });
  } catch (err) {
    try { ctx.toast.warning("听书搜索助手启动失败，请重试或联系作者"); } catch (e) {}
  }
}

export function deactivate() {
  /* 拦截器由宿主自动注销 */
}

/* ---------------- 设置页 ---------------- */

const GREEN = "#22c55e";
const TRACK_OFF = "rgba(127,127,127,.38)";

function rowStyle() {
  return "display:flex;align-items:center;justify-content:space-between;gap:14px;" +
    "padding:10px 2px;cursor:pointer;-webkit-user-select:none;user-select:none;";
}
function textWrapStyle() {
  return "display:flex;flex-direction:column;gap:2px;min-width:0;";
}
function titleStyle() {
  return "font-size:14px;line-height:1.3;";
}
function descStyle() {
  return "font-size:12px;line-height:1.4;opacity:.55;";
}
function trackStyle(on) {
  return "position:relative;flex:0 0 auto;width:42px;height:24px;border-radius:999px;" +
    "transition:background .18s ease;background:" + (on ? GREEN : TRACK_OFF) + ";";
}
function knobStyle(on) {
  return "position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:999px;background:#fff;" +
    "box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s ease;" +
    "transform:translateX(" + (on ? "18px" : "0px") + ");";
}
function ghostBtnStyle() {
  return "padding:4px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.3);" +
    "background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;";
}

function mountSettings(ctx) {
  const ui = ctx.ui;
  const vue = ctx.vue || {};
  if (!ui || !ui.settings || typeof ui.settings.define !== "function") return;
  if (typeof vue.defineComponent !== "function" || typeof vue.h !== "function" || typeof vue.ref !== "function") return;
  const h = vue.h;
  const ref = vue.ref;

  const Panel = vue.defineComponent({
    name: "EchoAudiobookSearchSettings",
    setup() {
      const mode = ref(MODE_MIXED);
      const open = ref(false);
      const stats = ref({});
      const diag = ref([]);

      const refresh = function () {
        return Promise.all([
          ctx.storage.get(STATS_KEY).then(function (s) { stats.value = s && typeof s === "object" ? s : {}; }),
          ctx.storage.get(DIAG_KEY).then(function (l) { diag.value = Array.isArray(l) ? l.slice(-8).reverse() : []; }),
        ]).catch(function () {});
      };

      ctx.storage.get(SETTINGS_KEY).then(function (s) {
        if (s && typeof s === "object" && typeof s.mode === "string") mode.value = s.mode;
      });

      const choose = function (value) {
        if (mode.value === value) return;
        mode.value = value;
        ctx.storage.set(SETTINGS_KEY, { mode: value }).catch(function () {});
      };

      const toggleOpen = function () {
        open.value = !open.value;
        if (open.value) refresh();
      };

      const renderRow = function (item, last) {
        const on = mode.value === item.value;
        return h("div", {
          role: "switch",
          "aria-checked": on ? "true" : "false",
          tabindex: "0",
          style: rowStyle() + (last ? "" : "border-bottom:1px solid rgba(127,127,127,.16);"),
          onClick: function () { choose(item.value); },
          onKeydown: function (e) {
            if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); choose(item.value); }
          },
        }, [
          h("div", { style: textWrapStyle() }, [
            h("div", { style: titleStyle() }, item.label),
            h("div", { style: descStyle() }, item.desc),
          ]),
          h("div", { style: trackStyle(on) }, [h("div", { style: knobStyle(on) })]),
        ]);
      };

      const renderDiag = function () {
        const head = h("div", {
          role: "button",
          "aria-expanded": open.value ? "true" : "false",
          tabindex: "0",
          style: "display:flex;align-items:center;justify-content:space-between;gap:8px;" +
            "padding:8px 2px;cursor:pointer;-webkit-user-select:none;user-select:none;" +
            "font-size:12px;opacity:.5;",
          onClick: toggleOpen,
          onKeydown: function (e) {
            if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleOpen(); }
          },
        }, [
          h("span", {}, "诊断信息"),
          h("span", { style: "font-size:9px;transition:transform .18s ease;" + (open.value ? "transform:rotate(180deg);" : "") }, "▼"),
        ]);

        if (!open.value) return head;

        const body = [];
        body.push(h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px 2px 6px;" }, [
          h("button", { type: "button", style: ghostBtnStyle(), onClick: function () { refresh(); } }, "刷新"),
          h("button", {
            type: "button",
            style: ghostBtnStyle(),
            onClick: function () {
              ctx.storage.set(DIAG_KEY, []).then(function () { diag.value = []; ctx.toast.info("已清空记录"); }).catch(function () {});
            },
          }, "清空记录"),
          h("span", { style: "font-size:12px;opacity:.6;" }, "已改写 " + (Number(stats.value.injected) || 0) + " 次"),
        ]));

        if (diag.value.length) {
          const lines = diag.value.map(function (d) {
            return (d.changed ? "✓ " : "· ") + (d.method || "") + " " + (d.url || "") +
              (d.type ? " type=" + d.type : "") + (d.category ? " cat=" + d.category : "");
          });
          body.push(h("div", {
            style: "font-size:11px;opacity:.6;white-space:pre-wrap;word-break:break-all;" +
              "font-family:ui-monospace,SFMono-Regular,monospace;padding:2px;" +
              "max-height:180px;overflow:auto;",
          }, lines.join("\n")));
        } else {
          body.push(h("div", { style: "font-size:12px;opacity:.45;padding:2px;" }, "还没有搜索记录"));
        }

        return h("div", { style: "display:flex;flex-direction:column;" }, [
          head,
          h("div", { style: "border-top:1px solid rgba(127,127,127,.14);padding-top:6px;" }, body),
        ]);
      };

      return function () {
        const rows = MODES.map(function (item, i) { return renderRow(item, i === MODES.length - 1); });
        return h("div", { style: "display:flex;flex-direction:column;" }, rows.concat([
          h("div", { style: "border-top:1px solid rgba(127,127,127,.16);margin-top:2px;" }),
          renderDiag(),
        ]));
      };
    },
  });

  try {
    ui.settings.define({ title: "听书搜索助手", component: Panel });
  } catch (err) {
    /* ignore */
  }
}
