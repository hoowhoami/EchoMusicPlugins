/**
 * 每日自动领取酷狗概念版 VIP
 *
 * 登录 EchoMusic 后自动完成两件事（每天一次）：
 *   1. POST /youth/v1/recharge/receive_vip_listen_song  -> 畅听会员 (tvip) 24h
 *   2. POST /youth/v1/listen_song/upgrade_vip_reward    -> 概念会员 (svip) 24h
 *
 * 概念版接口使用独立签名：md5(salt + 按 key 排序的 k=v 串 + body + salt)
 * 账号凭证从 EchoMusic 的 Pinia 用户/设备 state 中读取，无需手动填 Cookie。
 *
 * 领取成功后调用 user store 的 fetchUserInfo()，让 App 立即识别会员状态。
 */

const SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const GATEWAY = 'https://gateway.kugou.com';
const UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';
const SOURCE_ID = '90139';

const RETRY_MS = 15000;            // 未登录时的重试间隔
const RETRY_MAX = 40;              // 未登录时最多重试 40 次（约 10 分钟）
const CHECK_MS = 30 * 60 * 1000;   // 之后每 30 分钟检查一次

const CODE_ALREADY = 131001;       // 今日已领取
const CODE_ALREADY_UPGRADE = 297002; // 今日已升级
const CODE_RISK = 20028;           // 风控，需要手机端

const LOG = '[auto-daily-vip]';

/* ---------------- MD5 ---------------- */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

function md5(input) {
  const bytes = new TextEncoder().encode(String(input));
  const len = bytes.length;
  const bitLen = len * 8;
  const withPad = (((len + 8) >>> 6) + 1) * 64;
  const buf = new Uint8Array(withPad);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(withPad - 8, bitLen >>> 0, true);
  view.setUint32(withPad - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let chunk = 0; chunk < withPad; chunk += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }

      const tmp = D;
      D = C;
      C = B;
      const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
      B = (B + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
      A = tmp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  let hex = '';
  for (let i = 0; i < 16; i++) hex += out.getUint8(i).toString(16).padStart(2, '0');
  return hex;
}

/* ---------------- 工具 ---------------- */
function todayKey() {
  // 酷狗 receive_day 使用北京时间自然日，手动拼装避免各引擎 locale 差异
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nowSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

function sortParams(params) {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('');
}

function pickStore(ctx, id) {
  try {
    const state = ctx.pinia?.state?.value;
    if (state && state[id]) return state[id];
    return ctx.pinia?._s?.get(id) ?? null;
  } catch {
    return null;
  }
}

// 兜底：在 Pinia state 里递归找带 token+userid 的对象（防止 store id 变化）
function findCredsDeep(ctx) {
  try {
    const state = ctx.pinia?.state?.value;
    if (!state) return null;
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return null;
      seen.add(node);
      if (typeof node.token === 'string' && node.token && (node.userid || node.userId)) return node;
      for (const key of Object.keys(node)) {
        const found = walk(node[key], depth + 1);
        if (found) return found;
      }
      return null;
    };
    return walk(state, 0);
  } catch {
    return null;
  }
}

function readCredentials(ctx) {
  const user = pickStore(ctx, 'user') || {};
  const device = pickStore(ctx, 'device') || {};
  let info = user.info || {};
  let dev = device.info || {};

  if (!info.token) {
    const deep = findCredsDeep(ctx);
    if (deep) info = { ...info, ...deep };
  }

  return {
    token: String(info.token || ''),
    userid: String(info.userid || info.userId || ''),
    mid: String(dev.mid || ''),
    dfid: String(dev.dfid || ''),
    nickname: String(info.nickname || ''),
    store: user,
  };
}

async function readJson(res) {
  if (res == null) return null;
  const data = res.data !== undefined ? res.data : res.body;
  if (data == null) return null;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return data;
}

/* ---------------- 接口 ---------------- */
async function postYouth(ctx, creds, path, extra) {
  const params = {
    appid: '3116',
    clientver: '11440',
    clienttime: nowSeconds(),
    mid: creds.mid,
    dfid: creds.dfid,
    uuid: '-',
    token: creds.token,
    userid: creds.userid,
    ...extra,
  };
  params.signature = md5(SALT + sortParams(params) + '' + SALT);

  const query = Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const res = await ctx.net.request({
    url: `${GATEWAY}${path}?${query}`,
    method: 'POST',
    responseType: 'text',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `token=${creds.token}; userid=${creds.userid}; dfid=${creds.dfid}; KUGOU_API_MID=${creds.mid}`,
      'User-Agent': UA,
      'kg-rc': '1',
      'kg-thash': '5d816a0',
      'kg-rec': '1',
      'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
    },
    body: '',
    timeoutMs: 15000,
  });

  return readJson(res);
}

function claimDailyVip(ctx, creds) {
  return postYouth(ctx, creds, '/youth/v1/recharge/receive_vip_listen_song', {
    source_id: SOURCE_ID,
    receive_day: todayKey(),
  });
}

function upgradeVip(ctx, creds) {
  return postYouth(ctx, creds, '/youth/v1/listen_song/upgrade_vip_reward', {
    kugouid: creds.userid,
    ad_type: '1',
  });
}

function codeOf(body) {
  if (!body) return -1;
  return Number(body.error_code ?? body.errcode ?? 0) || 0;
}

function describe(body) {
  if (!body) return '无响应';
  if (body.status === 1) return '成功';
  const code = codeOf(body);
  if (code === CODE_ALREADY) return '今日已领取';
  if (code === CODE_ALREADY_UPGRADE) return '今日已升级';
  if (code === CODE_RISK) return '账号风控，需手机端操作';
  const msg = body.error_msg || body.msg || '';
  return `失败 (${code}${msg ? ' ' + msg : ''})`;
}

/* ---------------- 主流程 ---------------- */
export function activate(ctx) {
  const storage = ctx.storage;
  let timer = null;
  let running = false;
  let retries = 0;

  const log = (...args) => console.log(LOG, ...args);

  // 心跳：用于确认插件确实在 App 启动时被加载
  try {
    storage.set('boot', { at: Date.now(), version: '1.0.0' });
  } catch (e) {
    console.warn(LOG, '写入启动标记失败', e);
  }

  const loadState = async () => {
    try { return (await storage.get('daily')) || null; } catch { return null; }
  };
  const saveState = async (value) => {
    try { await storage.set('daily', value); } catch (e) { log('保存状态失败', e); }
  };

  async function refreshUserInfo(ctx2, creds) {
    try {
      const store = creds.store;
      if (store && typeof store.fetchUserInfo === 'function') {
        await store.fetchUserInfo();
        const vip = pickStore(ctx, 'user')?.info?.extendsInfo?.vip?.busi_vip || [];
        const active = vip.filter((v) => v && v.is_vip === 1).map((v) => v.product_type);
        log('会员状态已刷新:', active.join(',') || '无');
      }
    } catch (e) {
      log('刷新会员状态失败（不影响领取）', e);
    }
  }

  async function runOnce(reason) {
    if (running) return;
    running = true;
    try {
      const creds = readCredentials(ctx);
      if (!creds.mid) {
        try {
          const identity = await window.electron?.apiServer?.identity?.();
          if (identity?.mid) creds.mid = String(identity.mid);
        } catch (e) {
          log('读取设备 mid 失败', e);
        }
      }
      if (!creds.token || !creds.userid) {
        log('尚未登录，稍后再试');
        return;
      }

      const day = todayKey();
      const saved = await loadState();
      if (saved && saved.day === day && saved.claimed && saved.upgraded) {
        log(`今日（${day}）已领取完成，跳过`);
        return;
      }
      if (saved && saved.day === day && saved.risk) {
        log('今日已触发风控，跳过（请在手机端领取）');
        return;
      }

      log(`开始领取 ${day}（${reason}）用户 ${creds.nickname || creds.userid}`);

      const claimBody = await claimDailyVip(ctx, creds);
      const claimCode = codeOf(claimBody);
      const claimed = claimBody?.status === 1 || claimCode === CODE_ALREADY;
      log('领取畅听VIP:', describe(claimBody));

      let upgraded = false;
      let upgradeText = '跳过';
      if (claimed) {
        const upBody = await upgradeVip(ctx, creds);
        const upCode = codeOf(upBody);
        upgradeText = describe(upBody);
        upgraded = upBody?.status === 1 || upCode === CODE_ALREADY_UPGRADE;
        log('升级概念会员:', upgradeText);
      }

      const risk = claimCode === CODE_RISK;
      if (risk) log('触发风控：', claimBody?.error_msg || '');

      await saveState({
        day,
        claimed,
        upgraded,
        risk,
        claimText: describe(claimBody),
        upgradeText,
        at: Date.now(),
        user: creds.userid,
      });

      if (claimed) await refreshUserInfo(ctx, creds);

      if (claimBody?.status === 1) {
        ctx.toast.success(`已自动领取今日 VIP（${day}）`);
      } else if (claimCode === CODE_RISK) {
        ctx.toast.warning('领取被风控拦截，需要手机端操作一次');
      }
    } catch (e) {
      log('领取异常:', e);
      try {
        await saveState({
          day: todayKey(),
          claimed: false,
          upgraded: false,
          error: String((e && e.message) || e),
          at: Date.now(),
        });
      } catch {}
    } finally {
      running = false;
    }
  }

  async function tick(reason) {
    const creds = readCredentials(ctx);
    if (!creds.token || !creds.userid) {
      if (retries < RETRY_MAX) {
        retries += 1;
        log(`等待登录（${retries}/${RETRY_MAX}）`);
        timer = setTimeout(() => tick('等待登录'), RETRY_MS);
        return;
      }
      log('仍未登录，改为每 30 分钟检查一次');
    } else {
      retries = 0;
      await runOnce(reason);
    }
    timer = setTimeout(() => tick('定时检查'), CHECK_MS);
  }

  // 启动后稍等，让 Pinia 完成持久化状态恢复
  timer = setTimeout(() => tick('启动'), 3000);

  const addDisposable = ctx.dispose || ctx.addDisposable;
  if (typeof addDisposable === 'function') {
    addDisposable(() => {
      if (timer) clearTimeout(timer);
    });
  }

  log('插件已加载，等待登录');
}
