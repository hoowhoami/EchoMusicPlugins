/**
 * 开机自启管家 (echo-boot-guard) v1.7.0
 *
 * 开机自启后：本周期已经签到过、而且用户没在听歌，就安静地退出应用，把内存让出来。
 * 退出之前先静默等一会儿，再弹一张小卡片，卡片上能点「保留」——不想退就点一下。
 *
 * v1.7.0：新老客户端通吃 —— 有开机时长接口就按系统开机时间判断，没有就退回按应用运行时长判断。
 * v1.6.0：改用系统真实开机时长判断“是不是开机自启”，不再看应用自己跑了多久。
 * v1.5.0：去掉总开关；三个时间各给三档（1/5/10 分钟、30/60/90 秒、5/10/15 秒）；播放检查间隔不再出现在设置里。
 * v1.4.0：四个时间改成可直接填写的输入框，超出范围自动夹回。
 * v1.3.0：几个时间都能在设置里改（启动窗口 / 安静等待 / 卡片停留 / 检查间隔）。
 * v1.2.0：加了「启动窗口」，只有应用启动后的头几分钟才介入，重载插件、长时间使用都不会被关。
 * v1.1.0：签到判定 —— 期次 id 变了，或 id 没变但记录的那一周就是本周，都算本期已签。
 *
 * 读不到签到记录就不动作；读到的风险只是"不签到"，绝不误关。
 * 每天最多自动退出一次（记录 quitDate）。
 */

const TRACE_KEY = "plugin:auto-team-vip:lastPeriodId";
const REC_KEY = "record";
const SETTINGS_KEY = "settings";
const WEEK_FIRST_DAY = 3; // 周三

/* 默认值（毫秒/秒都在这里集中） */
const BOOT_WINDOW_DEFAULT_MS = 5 * 60 * 1000;
const QUIET_DEFAULT_MS = 60 * 1000;
const PROMPT_DEFAULT_SEC = 15;
const POLL_DEFAULT_MS = 15 * 1000;

/** 三个时间项各自的档位（秒）；存进来的值不在档位里就落到最近的一档 */
export const OPTIONS = {
  bootWindowSec: [30, 60, 300, 600],
  quietSec: [15, 30, 60, 90],
  promptSec: [3, 5, 10, 15],
};

export const DEFAULT_SETTINGS = {
  bootWindowSec: 300,
  quietSec: 60,
  promptSec: 15,
  pollSec: 15,
};

let uptimeOverride = null;

export function __setUptime(value) {
  uptimeOverride = typeof value === "number" ? value : null;
}

export function uptimeMs() {
  if (uptimeOverride !== null) return uptimeOverride;
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  } catch (err) {
    /* ignore */
  }
  return 0;
}

/** 把存下来的设置洗干净：缺的补默认，坏的改默认，越界的夹回范围 */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  const keys = Object.keys(OPTIONS);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const list = OPTIONS[key];
    let n = Number(src[key]);
    if (!Number.isFinite(n)) n = DEFAULT_SETTINGS[key];
    let best = list[0];
    for (let j = 1; j < list.length; j += 1) {
      if (Math.abs(list[j] - n) < Math.abs(best - n)) best = list[j];
    }
    out[key] = best;
  }
  /* 播放状态检查间隔不在设置界面里，固定 15 秒 */
  let poll = Number(src.pollSec);
  if (!Number.isFinite(poll)) poll = DEFAULT_SETTINGS.pollSec;
  out.pollSec = Math.min(120, Math.max(3, Math.round(poll)));
  return out;
}

export function inBootWindow(bootWindowMs) {
  const win = typeof bootWindowMs === "number" ? bootWindowMs : BOOT_WINDOW_DEFAULT_MS;
  return uptimeMs() <= win;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/** 本周三（零点起算），例如 2026-11-11 */
export function weekKey(date) {
  const d = date instanceof Date ? date : new Date();
  const back = (d.getDay() - WEEK_FIRST_DAY + 7) % 7;
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}

/** 今天，例如 2026-11-14 */
export function todayKey(date) {
  const d = date instanceof Date ? date : new Date();
  return dateKey(d);
}

/** 把 KV 值（"306" / 306 / {value:"306"}）统一成期次 id */
export function toId(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const keys = ["value", "periodId", "period_id", "id"];
    for (let i = 0; i < keys.length; i += 1) {
      const v = value[keys[i]];
      if (v !== null && v !== undefined && typeof v !== "object") return String(v).trim();
    }
  }
  return "";
}

export function isSignedThisPeriod(traceId, rec, wk) {
  if (!traceId) return false;
  if (!rec || !rec.id) return false;
  if (traceId !== rec.id) return true;
  return rec.week === wk;
}

/** 纯决策：什么时候该退、什么时候别动 */
export function decide(state) {
  if (!state.enabled) return "skip-disabled";
  const win = typeof state.bootWindowMs === "number" ? state.bootWindowMs : BOOT_WINDOW_DEFAULT_MS;
  if (state.bootUptimeSec === null || state.bootUptimeSec === undefined) {
    /* 老版本客户端（没有 system:get-boot-info）：退回按应用自身运行时长判断 */
    if (!(state.uptime <= win)) return "skip-uptime";
  } else if (!(state.bootUptimeSec * 1000 <= win)) {
    /* 有新接口：只有“开机后不久就启动”才算开机自启，白天手动打开的应用一律不碰 */
    return "skip-manual";
  }
  if (state.quitDate && state.quitDate === state.today) return "skip-done";
  if (!state.traceId) return "wait";
  const signed = isSignedThisPeriod(state.traceId, { id: state.recId || "", week: state.recWeek || "" }, state.week);
  if (!signed) return "wait";
  if (state.playing) return "wait";
  return "quit";
}

function electronApi(ctx) {
  try {
    if (typeof window !== "undefined" && window.electron) return window.electron;
  } catch (err) {
    /* ignore */
  }
  return ctx && ctx.electron ? ctx.electron : null;
}

/** 读系统开机时长（秒）；老版本客户端没有这个接口，返回 null */
export async function readBootInfo(ctx) {
  const api = electronApi(ctx);
  const sys = api && api.system ? api.system : null;
  if (!sys || typeof sys.getBootInfo !== "function") return null;
  try {
    const info = await sys.getBootInfo();
    const sec = Number(info && info.uptimeSec);
    return Number.isFinite(sec) ? sec : null;
  } catch (err) {
    return null;
  }
}

async function readTraceId(ctx) {
  const api = electronApi(ctx);
  const store = api && api.storage ? api.storage : null;
  if (!store || typeof store.getKv !== "function") return "";
  try {
    return toId(await store.getKv(TRACE_KEY));
  } catch (err) {
    return "";
  }
}

function quitApp(ctx) {
  const api = electronApi(ctx);
  const senders = [];
  if (api && api.ipcRenderer) senders.push(api.ipcRenderer);
  try {
    if (typeof window !== "undefined" && window.electron && window.electron.ipcRenderer) {
      senders.push(window.electron.ipcRenderer);
    }
  } catch (err) {
    /* ignore */
  }
  for (let i = 0; i < senders.length; i += 1) {
    try {
      senders[i].send("quit-app");
      return true;
    } catch (err) {
      /* next */
    }
  }
  return false;
}

export function isPlayingNow(ctx) {
  try {
    const p = ctx && ctx.player ? ctx.player : null;
    if (!p) return false;
    const v = p.isPlaying;
    if (v && typeof v === "object" && "value" in v) return Boolean(v.value);
    return Boolean(v);
  } catch (err) {
    return false;
  }
}

/* ---------------- 退出前的小卡片 ---------------- */

function showPrompt(seconds, onKeep, onQuit) {
  if (typeof document === "undefined" || !document.body) {
    setTimeout(onQuit, seconds * 1000);
    return { close: function () {} };
  }

  const card = document.createElement("div");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "开机自启管家");
  card.style.cssText = [
    "position:fixed", "right:24px", "bottom:24px", "z-index:2147483000",
    "width:308px", "box-sizing:border-box", "padding:16px",
    "border-radius:14px", "background:rgba(28,28,30,.94)", "color:#fff",
    "box-shadow:0 12px 36px rgba(0,0,0,.4)", "backdrop-filter:blur(12px)",
    "font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif",
    "display:flex", "flex-direction:column", "gap:10px",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "本周期已签到";
  title.style.cssText = "font-weight:600;font-size:14px;";

  const body = document.createElement("div");
  body.style.cssText = "opacity:.75;font-size:12.5px;";
  body.textContent = "还有 " + seconds + " 秒自动退出应用。";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:2px;";

  const keep = document.createElement("button");
  keep.type = "button";
  keep.textContent = "保留";
  keep.style.cssText = "padding:7px 14px;border-radius:9px;border:0;cursor:pointer;" +
    "background:#22c55e;color:#fff;font:inherit;font-weight:600;";

  const now = document.createElement("button");
  now.type = "button";
  now.textContent = "立即退出";
  now.style.cssText = "padding:7px 14px;border-radius:9px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(255,255,255,.22);background:transparent;color:inherit;";

  row.appendChild(now);
  row.appendChild(keep);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(row);
  document.body.appendChild(card);

  let left = seconds;
  const tick = setInterval(function () {
    left -= 1;
    body.textContent = "还有 " + Math.max(0, left) + " 秒自动退出应用。";
    if (left <= 0) {
      done();
      onQuit();
    }
  }, 1000);

  function done() {
    clearInterval(tick);
    if (card.parentNode) card.parentNode.removeChild(card);
  }

  keep.addEventListener("click", function () { done(); onKeep(); });
  now.addEventListener("click", function () { done(); onQuit(); });

  return { close: done };
}

/* ---------------- 主流程 ---------------- */

async function loadSettings(ctx) {
  let saved = null;
  try {
    saved = await ctx.storage.get(SETTINGS_KEY);
  } catch (err) {
    saved = null;
  }
  return normalizeSettings(saved);
}

/** 给设置页用：立刻读一次当前状态，不做任何动作 */
export async function inspect(ctx) {
  const settings = await loadSettings(ctx);
  const stored = (await ctx.storage.get(REC_KEY)) || {};
  const traceId = await readTraceId(ctx);
  const wk = weekKey();
  const signed = isSignedThisPeriod(traceId, { id: stored.id || "", week: stored.week || "" }, wk);
  const bootUptimeSec = await readBootInfo(ctx);
  return {
    settings: settings,
    traceId: traceId,
    week: wk,
    recId: stored.id || "",
    recWeek: stored.week || "",
    quitDate: stored.quitDate || "",
    signed: signed,
    bootUptimeSec: bootUptimeSec,
    autostart: bootUptimeSec !== null && bootUptimeSec * 1000 <= settings.bootWindowSec * 1000,
    legacy: bootUptimeSec === null,
    uptimeMs: uptimeMs(),
    inWindow: inBootWindow(settings.bootWindowSec * 1000),
  };
}

async function bootstrap(ctx) {
  const settings = await loadSettings(ctx);

  const bootWindowMs = settings.bootWindowSec * 1000;
  const quietMs = settings.quietSec * 1000;
  const promptSec = settings.promptSec;
  const pollMs = settings.pollSec * 1000;

  const bootUptimeSec = await readBootInfo(ctx);
  if (bootUptimeSec === null) {
    /* 老版本客户端：沿用“应用启动后 N 分钟内”的老判断 */
    if (!inBootWindow(bootWindowMs)) return;
  } else if (!(bootUptimeSec * 1000 <= bootWindowMs)) {
    return;
  }

  const stored = (await ctx.storage.get(REC_KEY)) || {};
  const today = todayKey();
  if (stored.quitDate === today) return;

  const wk = weekKey();
  let rec = { id: stored.id || "", week: stored.week || "" };
  let timer = null;
  let stopped = false;
  let pending = false;

  const stop = function () {
    stopped = true;
    if (timer !== null) { clearInterval(timer); timer = null; }
  };
  if (typeof ctx.dispose === "function") ctx.dispose(stop);

  const kill = function () {
    stop();
    ctx.storage.set(REC_KEY, { id: rec.id, week: rec.week, quitDate: today }).catch(function () {}).then(function () {
      quitApp(ctx);
    });
  };

  const arm = function () {
    if (pending || stopped) return;
    pending = true;
    const quiet = setTimeout(function () {
      if (stopped) return;
      if (isPlayingNow(ctx)) { pending = false; return; }
      showPrompt(promptSec, function () {
        ctx.storage.set(REC_KEY, { id: rec.id, week: rec.week, quitDate: today }).catch(function () {}).then(function () {
          try { ctx.toast.info("好的，今天不再自动退出"); } catch (e) {}
        });
        stop();
      }, kill);
    }, quietMs);
    if (typeof ctx.dispose === "function") ctx.dispose(function () { clearTimeout(quiet); });
  };

  const check = async function () {
    if (stopped || pending) return;
    let traceId = "";
    try {
      traceId = await readTraceId(ctx);
    } catch (err) {
      traceId = "";
    }
    if (traceId && (traceId !== rec.id || wk !== rec.week)) {
      rec = { id: traceId, week: wk };
      await ctx.storage.set(REC_KEY, { id: rec.id, week: rec.week, quitDate: stored.quitDate || "" }).catch(function () {});
    }
    const verdict = decide({
      enabled: true,
      uptime: uptimeMs(),
      bootUptimeSec: bootUptimeSec,
      bootWindowMs: bootWindowMs,
      quitDate: stored.quitDate || "",
      today: today,
      traceId: traceId,
      recId: rec.id,
      recWeek: rec.week,
      week: wk,
      playing: isPlayingNow(ctx),
    });
    if (verdict === "quit") arm();
    else if (verdict === "skip-manual" || verdict === "skip-uptime" || verdict === "skip-done") stop();
  };

  await check();
  if (!stopped && !pending) timer = setInterval(check, pollMs);
}

/* ---------------- 设置页 ---------------- */

const ROW_STYLE = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;";
const LABEL_STYLE = "font-size:13.5px;";

/** 三个时间项，每项三档（存储仍用秒） */
const OPTION_ROWS = [
  { key: "bootWindowSec", label: "开机后多久内算自启", choices: [[30, "30 秒"], [60, "1 分钟"], [300, "5 分钟"], [600, "10 分钟"]] },
  { key: "quietSec", label: "退出前静默等待", choices: [[15, "15 秒"], [30, "30 秒"], [60, "60 秒"], [90, "90 秒"]] },
  { key: "promptSec", label: "退出倒计时", choices: [[3, "3 秒"], [5, "5 秒"], [10, "10 秒"], [15, "15 秒"]] },
];

/* 三档按钮等宽，三行上下对齐 */
const PILL_BASE = "width:64px;box-sizing:border-box;padding:5px 0;text-align:center;" +
  "border-radius:8px;font:inherit;font-size:12.5px;cursor:pointer;";

function segStyle(active) {
  if (active) {
    return PILL_BASE + "border:1px solid transparent;background:#22c55e;color:#fff;font-weight:600;";
  }
  return PILL_BASE + "border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;opacity:.85;";
}

function mountSettings(ctx) {
  const ui = ctx.ui;
  const vue = ctx.vue || {};
  if (!ui || !ui.settings || typeof ui.settings.define !== "function") return;
  if (typeof vue.defineComponent !== "function" || typeof vue.h !== "function") return;
  const h = vue.h;
  const ref = vue.ref;

  const Panel = vue.defineComponent({
    name: "EchoBootGuardSettings",
    setup() {
      const options = ref(normalizeSettings(null));
      const info = ref({});
      const more = ref(true);

      const load = function () {
        return inspect(ctx).then(function (v) {
          options.value = v.settings || normalizeSettings(null);
          info.value = v;
        }).catch(function () {});
      };
      load();

      const persist = function (next) {
        const clean = normalizeSettings(next);
        options.value = clean;
        return ctx.storage.set(SETTINGS_KEY, clean).then(function () {
          return load();
        }).catch(function () {});
      };

      const choose = function (row, sec) {
        if (options.value[row.key] === sec) return Promise.resolve();
        const next = Object.assign({}, options.value);
        next[row.key] = sec;
        return persist(next);
      };

      const reset = function () {
        return ctx.storage.set(REC_KEY, {}).then(function () {
          return load();
        }).then(function () { ctx.toast.info("记录已重置"); }).catch(function () {});
      };

      const bootText = function (v) {
        if (v.bootUptimeSec === null || v.bootUptimeSec === undefined) {
          const run = Math.round((v.uptimeMs || 0) / 1000);
          const dur = run < 60 ? run + " 秒" : Math.round(run / 60) + " 分钟";
          return "读不到开机时间，按应用运行时长判断（本次已运行 " + dur + "）";
        }
        const dur = v.bootUptimeSec < 60 ? Math.round(v.bootUptimeSec) + " 秒" : Math.round(v.bootUptimeSec / 60) + " 分钟";
        if (v.autostart) return "开机后 " + dur + "启动，算开机自启";
        return "开机后 " + dur + "才启动，是手动打开，不介入";
      };

      const verdictText = function () {
        const v = info.value || {};
        if (!v.traceId) return "未读到签到记录（签到插件可能还没运行过）";
        if (v.signed) return "本周期已签到（期次 " + v.traceId + "）";
        return "本周期尚未签到（期次 " + v.traceId + "，记录 " + (v.recId || "-") + "）";
      };

      const optionRow = function (row) {
        const btns = [];
        for (let i = 0; i < row.choices.length; i += 1) {
          const sec = row.choices[i][0];
          const text = row.choices[i][1];
          const active = options.value[row.key] === sec;
          btns.push(h("button", {
            type: "button",
            role: "radio",
            "aria-checked": active ? "true" : "false",
            "aria-label": row.label + " " + text,
            style: segStyle(active),
            onClick: function () { choose(row, sec); },
          }, text));
        }
        return h("div", { style: ROW_STYLE }, [
          h("span", { style: LABEL_STYLE }, row.label),
          h("div", { role: "radiogroup", "aria-label": row.label, style: "display:flex;gap:6px;flex:0 0 auto;" }, btns),
        ]);
      };

      const smallBtn = function (text, onClick) {
        return h("button", {
          type: "button",
          onClick: onClick,
          style: "padding:4px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.3);" +
            "background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;",
        }, text);
      };

      return function () {
        const v = info.value || {};
        const rows = [];
        for (let i = 0; i < OPTION_ROWS.length; i += 1) rows.push(optionRow(OPTION_ROWS[i]));

        rows.push(h("div", {
          role: "button",
          tabindex: "0",
          "aria-expanded": more.value ? "true" : "false",
          style: "font-size:12px;opacity:.55;padding-top:6px;cursor:pointer;user-select:none;",
          onClick: function () { more.value = !more.value; },
          onKeydown: function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); more.value = !more.value; }
          },
        }, "状态信息 " + (more.value ? "▲" : "▼")));

        if (more.value) {
          rows.push(h("div", { style: "font-size:12px;line-height:1.7;opacity:.65;" }, [
            h("div", {}, "本周起算：" + (v.week || "-")),
            h("div", {}, "当前判定：" + verdictText()),
            h("div", {}, "上次自动退出：" + (v.quitDate || "无")),
            h("div", {}, "本次启动：" + bootText(v)),
          ]));
          rows.push(h("div", { style: "display:flex;gap:8px;" }, [
            smallBtn("重新检查", function () { load(); }),
            smallBtn("重置记录", reset),
          ]));
        }

        return h("div", { style: "display:flex;flex-direction:column;gap:8px;" }, rows);
      };
    },
  });

  try {
    ui.settings.define({
      title: "开机自启管家",
      description: "开机自启后先看本周期有没有签到记录：已签到且没在播放，就先等一会儿再弹卡片，无操作按设定时间退出；点「保留」或正在播放都不会退。只有开机后不久就启动的应用才算「开机自启」，白天手动打开不受影响。需在设置中开启【开机自启动】，同时开启【启动时最小化到托盘】效果更佳，体验更无感。",
      component: Panel,
    });
  } catch (err) {
    /* ignore */
  }
}

export function activate(ctx) {
  mountSettings(ctx);
  bootstrap(ctx).catch(function () {
    /* 静默失败，不影响应用本身 */
  });
}

export function deactivate() {
  /* 定时器由 ctx.dispose 清理 */
}
