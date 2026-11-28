import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(await readFile(new URL("../echo-boot-guard/index.js", import.meta.url))).toString("base64"),
);

const source = await readFile(new URL("../echo-boot-guard/index.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  await readFile(new URL("../echo-boot-guard/manifest.json", import.meta.url), "utf8"),
);

const BASE = {
  uptime: 1000,
  bootUptimeSec: 30,
  bootWindowMs: 5 * 60 * 1000,
  quitDate: "",
  today: "2026-11-29",
  traceId: "306",
  recId: "306",
  recWeek: "2026-11-25",
  week: "2026-11-25",
  playing: false,
};

/** 每个用例只改自己关心的字段 */
const decide = (patch) => api.decide({ ...BASE, ...patch });

test("decide only quits when this period is signed, nothing is playing and the launch is an autostart", () => {
  assert.equal(decide(), "quit");
  assert.equal(decide({ playing: true }), "wait");
  assert.equal(decide({ traceId: "" }), "wait");
  /* 期次编号没动、但上次见到它的不是本周 → 本期还没签 */
  assert.equal(decide({ recWeek: "2026-11-18" }), "wait");
  /* 期次编号前进了就算本期已签 */
  assert.equal(decide({ traceId: "307", recId: "306", recWeek: "2026-11-18" }), "quit");
  assert.equal(decide({ quitDate: "2026-11-29" }), "skip-done");
});

test("decide keeps the two boot-window flavours apart", () => {
  /* 新客户端：开机后 30 秒启动 → 算自启；开机一小时后才启动 → 不碰 */
  assert.equal(decide({ bootUptimeSec: 30 }), "quit");
  assert.equal(decide({ bootUptimeSec: 3600 }), "skip-manual");
  /* 老客户端：退回应用自身运行时长 */
  assert.equal(decide({ bootUptimeSec: null, uptime: 60 * 1000 }), "quit");
  assert.equal(decide({ bootUptimeSec: null, uptime: 10 * 60 * 1000 }), "skip-uptime");
});

test("resolveDeadline turns the boot window into a hard stop time", () => {
  /* 新客户端：开机 60 秒时激活，窗口 5 分钟，剩 4 分钟；再加安静等待与倒计时 */
  assert.equal(
    api.resolveDeadline({
      now: 1000,
      uptime: 0,
      bootUptimeSec: 60,
      bootWindowMs: 5 * 60 * 1000,
      quietMs: 15 * 1000,
      promptSec: 3,
    }),
    1000 + 240 * 1000 + 15 * 1000 + 3000,
  );

  /* 老客户端：用应用运行时长凑同一个截止点 */
  assert.equal(
    api.resolveDeadline({
      now: 1000,
      uptime: 60 * 1000,
      bootUptimeSec: null,
      bootWindowMs: 5 * 60 * 1000,
      quietMs: 60 * 1000,
      promptSec: 15,
    }),
    1000 + 240 * 1000 + 60 * 1000 + 15 * 1000,
  );

  /* 开机已经很久：截止点落在过去，调用方据此直接收摊 */
  const late = api.resolveDeadline({
    now: 10 * 1000,
    uptime: 0,
    bootUptimeSec: 3600,
    bootWindowMs: 5 * 60 * 1000,
    quietMs: 60 * 1000,
    promptSec: 15,
  });
  assert.ok(late < Date.now());
});

test("bootstrap stops at the deadline and registers its cleanup once", () => {
  assert.doesNotMatch(source, /skip-disabled/);
  assert.match(source, /const deadlineAt = resolveDeadline\(\{/);
  assert.match(source, /if \(expired\(\)\) return;/);
  assert.match(source, /if \(!stopped && !pending && !expired\(\)\) timer = setInterval/);
  /* 启动窗口只由 decide 判定，bootstrap 里不再自己判一遍 */
  assert.doesNotMatch(source, /if \(!inBootWindow/);
  /* 清理函数只登记一次，重试不再累积 disposables */
  assert.equal(source.match(/ctx\.dispose\(stop\)/g).length, 1);
  assert.equal(source.match(/ctx\.dispose\(function/g), null);
});

test("settings snap to the nearest preset and stay in range", () => {
  assert.deepEqual(api.normalizeSettings(null), {
    bootWindowSec: 300,
    quietSec: 60,
    promptSec: 15,
    pollSec: 15,
  });
  assert.deepEqual(api.normalizeSettings({ bootWindowSec: 45, quietSec: 3, promptSec: 1, pollSec: 999 }), {
    bootWindowSec: 30,
    quietSec: 15,
    promptSec: 3,
    pollSec: 120,
  });
});

test("period ids and week keys keep the signing check stable", () => {
  assert.equal(api.toId("306"), "306");
  assert.equal(api.toId(306), "306");
  assert.equal(api.toId({ value: "306" }), "306");
  assert.equal(api.toId({ periodId: 306 }), "306");
  assert.equal(api.toId({}), "");
  assert.equal(api.toId(null), "");

  assert.equal(api.weekKey(new Date(2026, 10, 29)), "2026-11-25"); // 周日 → 本周三
  assert.equal(api.weekKey(new Date(2026, 10, 25)), "2026-11-25");
  assert.equal(api.isSignedThisPeriod("306", { id: "", week: "" }, "2026-11-25"), false);
  assert.equal(api.isSignedThisPeriod("306", { id: "306", week: "2026-11-18" }, "2026-11-25"), false);
  assert.equal(api.isSignedThisPeriod("306", { id: "306", week: "2026-11-25" }, "2026-11-25"), true);
  assert.equal(api.isSignedThisPeriod("307", { id: "306", week: "2026-11-18" }, "2026-11-25"), true);
});

test("manifest version matches the module header", () => {
  assert.match(source, new RegExp("\\* 开机自启管家 \\(echo-boot-guard\\) v" + manifest.version.replace(/\./g, "\\.")));
  assert.match(manifest.description, /开机自启动/);
});
