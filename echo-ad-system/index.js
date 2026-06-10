/**
 * EchoMusic 广告系统插件 v1.0.0
 *
 * 功能：
 *   1. 启动音效 — 开启软件时播放自定义音频（支持 mp3/wav/ogg 等）
 *   2. 开屏广告 — 启动时全屏广告，带倒计时
 *   3. 播放中插播 — 音乐播放随机时长后暂停弹广告
 *   4. Bing 每日壁纸 — 广告背景可选 Bing 今日/近8天随机壁纸
 *   5. 用户自定义 — 图片、文案、颜色、弹窗时间、音频全部可配
 *   6. 主题感知 — UI 自动跟随 EchoMusic 暗色/亮色主题变化
 *
 * 作者: ZHCOOL520
 * GitHub: https://github.com/ZHCOOL520
 */

export function activate(ctx) {
  const {
    defineComponent,
    defineAsyncComponent,
    h,
    ref,
    watch,
  } = ctx.vue;

  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const Input = defineAsyncComponent(ctx.ui.components.Input);
  const InputNumber = defineAsyncComponent(ctx.ui.components.InputNumber);

  // ==================== 插件目录检测 ====================

  let pluginDir = "";

  /**
   * 跨平台路径规范化
   *   - 反斜杠 → 正斜杠
   *   - 压缩连续斜杠为单个
   *   - 去除末尾斜杠（便于后续拼接）
   *
   * @param {string} p - 原始路径
   * @returns {string} 规范化后的 POSIX 风格路径
   */
  function normalizePath(p) {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  }

  /**
   * 将文件系统路径转为可播放的 file:// URL
   *
   * 为什么不用简单的 "file:///" + encodeURI(path)：
   *   encodeURI 不编码 # 字符。如果路径中含 #（如某些下载目录），
   *   会被解析为 URL fragment 导致资源定位失败。此处额外将 # → %23。
   *
   * @param {string} filePath - 已规范化为正斜杠的文件系统路径
   * @returns {string} file:// URL
   */
  function toFileUrl(filePath) {
    // encodeURI 保留 : / 等 URL 结构字符（盘符 C: 和路径分隔符 / 必须保留），
    // 但会编码空格、中文等。额外处理 # 字符
    const encoded = encodeURI(filePath).replace(/#/g, "%23");
    return "file:///" + encoded;
  }

  /**
   * 从 file:// URL 还原文件系统路径
   *
   * @param {string} fileUrl - file:// 开头的 URL
   * @returns {string} 文件系统原生路径（Windows 反斜杠，Unix 正斜杠）
   */
  function fileUrlToPath(fileUrl) {
    if (!fileUrl.startsWith("file:///")) return fileUrl;
    let p = decodeURI(fileUrl.slice("file:///".length));
    // Windows 盘符路径：C:/Users/... → C:\Users\...
    if (/^[A-Za-z]:\//.test(p)) p = p.replace(/\//g, "\\");
    return p;
  }

  /**
   * 通过 import.meta.url（ESM 标准）获取插件根目录
   *
   * import.meta.url 始终指向当前 JS 文件的 file:// URL，从中提取目录路径
   * 即可定位插件文件夹。不依赖用户名、系统环境变量或 Electron API，
   * 确保跨设备 / 跨用户兼容。
   *
   * @returns {string} 以 / 结尾的插件目录路径（POSIX 风格），失败返回 ""
   */
  function resolvePluginRoot() {
    try {
      const url = new URL(import.meta.url);
      // Windows 上 url.pathname 形如 /C:/path/to/index.js
      let dir = decodeURIComponent(url.pathname);
      // 去掉 Windows 前导斜杠： /C:/... → C:/...
      if (/^\/[A-Za-z]:\//.test(dir)) dir = dir.slice(1);
      // 统一斜杠、去掉文件名保留末尾 /
      dir = normalizePath(dir);
      const idx = dir.lastIndexOf("/");
      return idx > 0 ? dir.slice(0, idx + 1) : dir + "/";
    } catch (err) {
      console.warn("[echo-ad-system] 无法通过 import.meta.url 解析插件根目录:", err.message || err);
      return "";
    }
  }

  /**
   * 解析插件资源的完整路径
   *
   * 路径解析优先级：
   *   1. 已是绝对 URL（http://, https://, file://, data:, blob:）→ 直接返回
   *   2. 已是系统绝对路径（C:\... 或 /...）→ 转为 file:// 协议
   *   3. 相对路径 → 基于插件目录构建 file:// URL
   *
   * 跨设备兼容保证：
   *   import.meta.url 动态指向当前文件位置，无论安装在哪个用户目录、
   *   哪个盘符，解析出的 pluginDir 始终正确。
   *
   * @param {string} relativePath - 相对或绝对路径
   * @returns {string} 可用的资源 URL
   */
  function resolvePluginPath(relativePath) {
    if (!relativePath) return "";

    // ★ 绝对 URL 检测必须在 normalizePath 之前——
    //    normalizePath 的 /\/+/g 会压缩 http:// → http:/，破坏协议前缀
    if (/^(https?:|file:|data:|blob:)\/\//.test(relativePath)) {
      return relativePath;
    }

    // 统一斜杠方向后处理剩余情况
    const normalized = normalizePath(relativePath);

    // 已是绝对路径（Windows: C:/... 或 Unix: /...）
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
      return toFileUrl(normalized);
    }

    // 相对路径 → 基于插件目录解析
    // 每次重新尝试解析（不缓存首次失败结果），应对极端初始化时序
    if (!pluginDir) {
      pluginDir = resolvePluginRoot();
    }
    if (!pluginDir) {
      console.warn("[echo-ad-system] 插件根目录未解析，无法处理相对路径:", relativePath);
      return relativePath;
    }

    const fullPath = normalizePath(pluginDir + "/" + normalized);
    return toFileUrl(fullPath);
  }

  // ==================== 常量 ====================

  const BING_API = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
  const BING_BASE = "https://www.bing.com";

  const IMAGE_SOURCE_OPTIONS = [
    { value: "bing-today", label: "Bing 今日壁纸" },
    { value: "bing-random", label: "Bing 近 8 天随机" },
    { value: "custom-list", label: "自定义图片列表" },
    { value: "bing-or-custom", label: "Bing + 自定义混合随机" },
    { value: "none", label: "纯色背景（无图片）" },
  ];

  // ==================== 默认设置 ====================

  const DEFAULT_SETTINGS = {
    enabled: true,

    // 启动音效
    startupAudioEnabled: true,
    startupAudioSrc: "audio/hello-kugou.mp3",
    startupAudioVolume: 0.8,

    // 开屏广告
    splashEnabled: true,
    splashDuration: 5,
    splashSkippableAfter: 2,
    splashAds: [
      {
        id: "splash-1",
        title: "发现好音乐",
        subtitle: "百万正版曲库，尽在 EchoMusic",
        imageUrl: "",
        linkUrl: "https://github.com/hoowhoami/EchoMusic",
        bgColor: "#1a1a2e",
        textColor: "#ffffff",
        accentColor: "#e94560",
        imageSource: "bing-today",
        customImages: [],
      },
    ],

    // 播放中广告
    playbackAdEnabled: true,
    playbackAdMinInterval: 300,
    playbackAdMaxInterval: 600,
    playbackAdDuration: 8,
    playbackAdSkippableAfter: 3,
    playbackAds: [
      {
        id: "playback-1",
        title: "升级 Pro 会员",
        subtitle: "解锁无损音质 · 离线下载 · 去广告",
        imageUrl: "",
        linkUrl: "https://github.com/ZHCOOL520",
        bgColor: "#0f3460",
        textColor: "#ffffff",
        accentColor: "#16c79a",
        imageSource: "bing-random",
        customImages: [],
      },
    ],
  };

  // ==================== 运行时状态 ====================

  let settings = { ...DEFAULT_SETTINGS };
  let playbackTimer = null;
  let countdownInterval = null;
  let adOverlayEl = null;
  let startupAudioEl = null;
  let currentAdId = "";           // 当前广告 ID，用于去重渲染
  let lastRenderedCd = -1;        // 上次渲染的倒计时值

  const isSplashShowing = ref(false);
  const isPlaybackAdShowing = ref(false);
  const currentAd = ref(null);
  const countdown = ref(0);
  const bingCache = ref([]);
  const bingCacheDate = ref("");

  // ==================== 启动音效 ====================

  /**
   * 将音频路径解析为可在 Electron 中正确播放的 URL
   *
   * 三层回退策略（按优先级）：
   *   1. ctx.fs.getFileUrl() — EchoMusic 官方 API，返回宿主原生文件 URL
   *   2. XMLHttpRequest 加载 file:// 为 blob URL — XHR 在 Electron 中
   *      支持 file:// 协议（window.fetch 不支持），blob URL 不受 CSP 限制
   *   3. 降级返回原始 file:// URL — 最后手段
   *
   * 相对路径先通过 resolvePluginPath 利用 import.meta.url 转为跨用户兼容
   * 的绝对路径，确保无论用户名是什么都能找到插件目录下的音频文件。
   *
   * @param {string} rawPath - 音频文件路径（相对路径、绝对路径或在线 URL）
   * @returns {Promise<string>} 可播放的音频 URL
   */
  async function getAudioUrl(rawPath) {
    if (!rawPath) return "";

    // 在线 URL（http/https）或已生成的 blob/data URL 直接使用
    if (/^(https?:|blob:|data:)\/\//.test(rawPath)) {
      return rawPath;
    }

    // 先通过 resolvePluginPath 将相对路径解析为基于插件目录的绝对 file:// URL
    const fileUrl = resolvePluginPath(rawPath);

    // —— 策略1：ctx.fs.getFileUrl（EchoMusic 官方 API）——
    // 注意：该 API 返回的 URL 可能是 app:// 协议（可被 new Audio() 直接播放），
    // 也可能仍是 file:// 协议（在 Electron 渲染进程中会被 CSP 拦截）。
    // 只有返回非 file:// 协议（app:// 或自定义协议）才可信任为可播放 URL。
    const fsPath = fileUrlToPath(fileUrl);
    try {
      const result = await ctx.fs.getFileUrl(fsPath);
      if (result?.ok && result.url) {
        console.log("[echo-ad-system] 策略1 成功 (ctx.fs.getFileUrl):", result.url);
        // ★ 关键：若 API 仍返回 file:// 协议，不要立即返回——
        //   file:// URL 在 Electron 渲染进程中 new Audio() 无法播放（CSP 拦截），
        //   必须继续走策略2 转为 blob:// URL。
        if (!result.url.startsWith("file://")) {
          return result.url;
        }
        console.log("[echo-ad-system] 策略1 返回 file:// 协议，继续尝试策略2...");
      }
    } catch (err) {
      console.warn("[echo-ad-system] 策略1 失败 (ctx.fs.getFileUrl):", err.message || err);
    }

    // —— 策略2：XMLHttpRequest 加载 file:// 为 blob URL ——
    // XHR 在 Electron 渲染进程中通常支持 file:// 协议（window.fetch 不支持），
    // 生成的 blob:// URL 不受 Content Security Policy 限制，new Audio() 可保证播放
    try {
      const blob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", fileUrl, true);
        xhr.responseType = "blob";
        xhr.onload = () => {
          // file:// 协议返回 status 0（而非 200）
          if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
          else reject(new Error("XHR status " + xhr.status));
        };
        xhr.onerror = () => reject(new Error("XHR error"));
        xhr.send();
      });
      if (blob && blob.size > 0) {
        const blobUrl = URL.createObjectURL(blob);
        console.log("[echo-ad-system] 策略2 成功 (XHR→blob), 大小:", blob.size, "bytes");
        return blobUrl;
      }
    } catch (err) {
      console.warn("[echo-ad-system] 策略2 失败 (XHR→blob):", err.message || err);
    }

    // —— 策略3：降级原始 file:// URL ——
    console.warn("[echo-ad-system] 策略3 降级，使用原始 file:// URL:", fileUrl);
    return fileUrl;
  }

  /**
   * 播放启动音效
   *
   * 流程：
   *   1. 停止已有的音频播放
   *   2. 通过 getAudioUrl 获取可播放的 URL（支持本地文件和在线地址）
   *   3. 在线 URL 和 file:// URL 都先转为 blob URL 再播放（绕过 CORS / CSP / 自动播放限制）
   *   4. blob: / data: / app: 等协议直接用 Audio 播放
   *
   * 注意：浏览器自动播放策略下，首次可能需要用户交互后才能播放。
   */
  async function playStartupAudio() {
    if (!settings.enabled || !settings.startupAudioEnabled) return;
    if (!settings.startupAudioSrc) return;

    try {
      if (startupAudioEl) {
        startupAudioEl.pause();
        startupAudioEl = null;
      }

      const src = await getAudioUrl(settings.startupAudioSrc);
      if (!src) return;

      // http/https 和 file:// 都需要先转为 blob URL 再播放：
      //   - http/https → window.fetch（可能有 CORS）
      //   - file:// → XMLHttpRequest（Electron 中支持 file:// 协议）
      if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("file://")) {
        tryLoadAudioBlob(src).then((blobUrl) => {
          if (startupAudioEl) {
            startupAudioEl.pause();
            startupAudioEl = null;
          }
          const finalSrc = blobUrl || src;
          startupAudioEl = playAudioFromSrc(finalSrc, settings.startupAudioVolume);
          if (startupAudioEl) {
            startupAudioEl.addEventListener("ended", () => {
              startupAudioEl = null;
            });
          }
        });
      } else {
        startupAudioEl = playAudioFromSrc(src, settings.startupAudioVolume);
        if (startupAudioEl) {
          startupAudioEl.addEventListener("ended", () => {
            startupAudioEl = null;
          });
        }
      }
    } catch (err) {
      console.warn("[echo-ad-system] 启动音效异常:", err);
    }
  }

  /**
   * 尝试将音频资源转为 blob URL
   *
   * 双通道加载策略：
   *   - http:// / https:// → window.fetch（标准方式）
   *   - file:// → XMLHttpRequest（Electron 中 fetch 不支持 file://，XHR 可以）
   *
   * @param {string} src - 音频资源 URL
   * @returns {Promise<string|null>} blob URL 或 null（失败时）
   */
  async function tryLoadAudioBlob(src) {
    try {
      // file:// 协议：必须用 XHR，因为 window.fetch 会抛 TypeError
      if (src.startsWith("file://")) {
        const blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", src, true);
          xhr.responseType = "blob";
          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
            else reject(new Error("XHR status " + xhr.status));
          };
          xhr.onerror = () => reject(new Error("XHR error"));
          xhr.send();
        });
        if (blob && blob.size > 0) {
          console.log("[echo-ad-system] tryLoadAudioBlob (file://→XHR→blob) 成功, 大小:", blob.size, "bytes");
          return URL.createObjectURL(blob);
        }
        return null;
      }

      // http/https：标准 fetch
      const resp = await window.fetch(src);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    } catch (_) {
      return null;
    }
  }

  /**
   * 使用指定 URL 和音量创建并播放音频
   *
   * play() 返回的 Promise 仅用于捕获播放失败（如自动播放策略阻止），
   * 并不等待播放完成——后续通过 ended 事件管理 Audio 实例生命周期。
   *
   * @param {string} src - 音频资源 URL（file:// 或 blob:）
   * @param {number} volume - 音量，范围 0~1
   * @returns {HTMLAudioElement|undefined} Audio 实例，src 为空时返回 undefined
   */
  function playAudioFromSrc(src, volume) {
    if (!src) return;
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, volume));
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((e) => {
        console.warn("[echo-ad-system] 音频播放失败:", e.message, "src:", src);
      });
    }
    return audio;
  }

  // ==================== Bing 壁纸 ====================

  /**
   * 获取 Bing 每日壁纸列表（带当日缓存）
   *
   * 双通道获取策略：
   *   1. window.fetch — Electron 渲染进程通常无 CORS 限制
   *   2. ctx.net.fetch — 部分 EchoMusic 版本的插件网络 API
   *
   * 缓存策略：同日多次调用复用缓存，避免重复请求。
   *
   * @returns {Promise<Array<{url:string, title:string, copyright:string, date:string}>>}
   */
  async function fetchBingWallpapers() {
    const today = new Date().toISOString().slice(0, 10);
    if (bingCache.value.length > 0 && bingCacheDate.value === today) {
      return bingCache.value;
    }

    try {
      let data = null;

      // 方法1: window.fetch (Electron 渲染进程中通常无 CORS 限制)
      try {
        const resp = await window.fetch(BING_API);
        if (resp.ok) {
          data = await resp.json();
        }
      } catch (_) { /* 回退 */ }

      // 方法2: ctx.net.fetch (部分版本可能是 axios 风格)
      if (!data) {
        try {
          const result = await ctx.net.fetch(BING_API);
          // ctx.net.fetch 可能直接返回数据，也可能是 Response 对象
          if (result && typeof result.json === "function") {
            data = await result.json();
          } else if (result && result.images) {
            data = result;
          } else if (result && typeof result === "string") {
            data = JSON.parse(result);
          }
        } catch (_) { /* 都失败则返回空 */ }
      }

      if (!data || !data.images || data.images.length === 0) {
        console.warn("[echo-ad-system] Bing 壁纸数据为空");
        return [];
      }

      const images = data.images.map((img) => ({
        url: BING_BASE + (img.url || "").replace("1920x1080", "UHD"),
        title: img.title || "",
        copyright: img.copyright || "",
        date: img.startdate || "",
      }));

      bingCache.value = images;
      bingCacheDate.value = today;
      return images;
    } catch (err) {
      console.warn("[echo-ad-system] Bing 壁纸获取失败:", err);
      return [];
    }
  }

  /**
   * 根据广告配置解析最终展示的图片 URL
   *
   * 优先级：
   *   1. ad.imageUrl 直接填写 → 最优先，覆盖来源设置
   *   2. bing-today → Bing 今日壁纸
   *   3. bing-random → Bing 近 8 天随机
   *   4. custom-list → 自定义列表随机
   *   5. bing-or-custom → Bing + 自定义混合池随机
   *   6. none → 纯色背景（返回空字符串）
   *
   * @param {Object} ad - 广告配置对象
   * @param {string} ad.imageSource - 图片来源策略
   * @param {string} [ad.imageUrl] - 手动指定的图片 URL
   * @param {string[]} [ad.customImages] - 自定义图片列表
   * @returns {Promise<string>} 图片 URL，纯色背景时为空字符串
   */
  async function resolveAdImage(ad) {
    const source = ad.imageSource || "none";

    if (ad.imageUrl && ad.imageUrl.trim()) {
      return ad.imageUrl.trim();
    }

    switch (source) {
      case "bing-today": {
        const imgs = await fetchBingWallpapers();
        return imgs.length > 0 ? imgs[0].url : "";
      }
      case "bing-random": {
        const imgs = await fetchBingWallpapers();
        if (imgs.length === 0) return "";
        return imgs[Math.floor(Math.random() * imgs.length)].url;
      }
      case "custom-list": {
        const list = ad.customImages || [];
        if (list.length === 0) return "";
        return list[Math.floor(Math.random() * list.length)];
      }
      case "bing-or-custom": {
        const bing = await fetchBingWallpapers();
        const custom = ad.customImages || [];
        const pool = [...bing.map((i) => i.url), ...custom];
        if (pool.length === 0) return "";
        return pool[Math.floor(Math.random() * pool.length)];
      }
      case "none":
      default:
        return "";
    }
  }

  // ==================== 工具函数 ====================

  /**
   * 从数组中随机取一个元素
   * @param {Array} arr - 源数组
   * @returns {*|null} 随机元素，空数组返回 null
   */
  function randomFrom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * 生成 [min, max] 范围内的随机整数
   * @param {number} min - 下限（含）
   * @param {number} max - 上限（含）
   * @returns {number}
   */
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * HTML 文本转义，防止 XSS
   * 用于 innerHTML 拼接用户输入的标题/副标题等文本
   * @param {string} str - 原始文本
   * @returns {string} 转义后的安全文本
   */
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ==================== 广告展示 / 隐藏公共逻辑 ====================

  /**
   * 启动广告倒计时定时器
   *
   * 每秒递减 countdown.value，归零时调用 hideFn 隐藏广告，否则仅更新倒计时数字。
   * 提取为独立函数以消除 showSplashAd 与 triggerPlaybackAd 中重复的 setInterval 逻辑。
   *
   * @param {Function} hideFn - 倒计时归零时调用的隐藏函数
   */
  function startAdCountdown(hideFn) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0) {
        hideFn();
      } else {
        updateCountdownOnly();
      }
    }, 1000);
  }

  /**
   * 广告隐藏的公共核心逻辑
   *
   * 包含所有广告类型共用的状态重置：关闭显示标记、清空当前广告、
   * 清除倒计时定时器、移除 DOM。hidePlaybackAd 会在此之后额外恢复播放。
   *
   * @param {import('vue').Ref<boolean>} isShowingRef - 广告显示状态 ref
   */
  function hideAdCore(isShowingRef) {
    isShowingRef.value = false;
    currentAd.value = null;
    currentAdId = "";
    lastRenderedCd = -1;
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    clearAdDom();
  }

  /**
   * 广告展示的公共核心逻辑
   *
   * 统一的广告启动流程：解析图片 → 设置响应式状态 → 渲染 DOM → 启动倒计时。
   * 消除 showSplashAd 与 triggerPlaybackAd 中的图片解析 + 状态设置 + 定时器启动重复代码。
   *
   * @param {Object} ad - 广告配置对象
   * @param {import('vue').Ref<boolean>} isShowingRef - 广告显示状态 ref
   * @param {number} duration - 广告展示时长（秒）
   * @param {Function} hideFn - 倒计时归零时调用的隐藏函数
   */
  async function showAdCore(ad, isShowingRef, duration, hideFn) {
    let imgUrl = "";
    try {
      imgUrl = await resolveAdImage(ad);
    } catch (err) {
      console.warn("[echo-ad-system] 广告图片解析失败:", err);
      imgUrl = "";
    }
    currentAd.value = { ...ad, _resolvedImage: imgUrl };
    currentAdId = ad.id;
    lastRenderedCd = -1;
    countdown.value = duration;
    isShowingRef.value = true;
    renderCurrentAd();
    startAdCountdown(hideFn);
  }

  // ==================== 开屏广告 ====================

  /**
   * 显示开屏广告
   *
   * 启动时调用，从 splashAds 列表中随机选取一条，全屏展示并开始倒计时。
   * 倒计时归零后自动调用 hideSplashAd() 关闭。
   */
  async function showSplashAd() {
    if (!settings.enabled || !settings.splashEnabled) return;
    const ad = randomFrom(settings.splashAds);
    if (!ad) return;
    await showAdCore(ad, isSplashShowing, settings.splashDuration, hideSplashAd);
  }

  /**
   * 隐藏开屏广告
   * 还原所有状态并清除 DOM，不放音乐（开屏时音乐本就在播放）。
   */
  function hideSplashAd() {
    hideAdCore(isSplashShowing);
  }

  // ==================== 播放中广告 ====================

  /**
   * 安排下一次播放中插播广告
   *
   * 在 minInterval ~ maxInterval 之间随机取一个时间间隔，
   * 到期后触发 triggerPlaybackAd()。
   */
  function scheduleNextPlaybackAd() {
    if (!settings.enabled || !settings.playbackAdEnabled) return;
    if (playbackTimer) clearTimeout(playbackTimer);

    const interval = randomInt(settings.playbackAdMinInterval, settings.playbackAdMaxInterval) * 1000;
    playbackTimer = setTimeout(() => triggerPlaybackAd(), interval);
  }

  /**
   * 触发播放中插播广告
   *
   * 仅在播放状态下触发（force=true 的测试模式除外）。
   * 显示广告前自动暂停音乐，倒计时结束后恢复播放。
   *
   * @param {boolean} [force=false] - 强制触发（测试模式），跳过播放状态检查且不暂停音乐
   */
  async function triggerPlaybackAd(force = false) {
    if (!settings.enabled || !settings.playbackAdEnabled) return;
    // 非强制模式下，仅在播放状态触发
    if (!force && !ctx.player.isPlaying.value) {
      scheduleNextPlaybackAd();
      return;
    }

    const ad = randomFrom(settings.playbackAds);
    if (!ad) {
      if (!force) scheduleNextPlaybackAd();
      return;
    }

    // 暂停音乐（测试模式不暂停）
    if (!force && ctx.player.isPlaying.value) {
      ctx.player.toggle();
    }

    await showAdCore(ad, isPlaybackAdShowing, settings.playbackAdDuration, hidePlaybackAd);
  }

  /**
   * 隐藏播放中广告
   *
   * 在公共隐藏逻辑之外，额外执行：恢复音乐播放、安排下一次插播。
   */
  function hidePlaybackAd() {
    hideAdCore(isPlaybackAdShowing);

    // 恢复播放（如果之前被暂停且当前未播放）
    if (ctx.player.currentTrack.value && !ctx.player.isPlaying.value) {
      ctx.player.toggle();
    }

    scheduleNextPlaybackAd();
  }

  // ==================== DOM 渲染（防闪烁） ====================

  /**
   * 完整渲染当前广告到 DOM
   *
   * 防闪烁策略——display 切换而非 DOM 重建：
   *   广告层（#echo-ad-system-overlay）在 init 时创建并永久挂载于 body，
   *   通过 display:none/block 控制显隐。渲染时用 innerHTML 完全替换内容，
   *   避免反复 createElement/removeChild 导致的布局抖动和闪烁。
   *
   * 为什么用 innerHTML 而非 Vue 响应式：
   *   广告层不在 Vue 组件树内，且内容高度动态（innerHTML 模板字符串拼接）。
   *   用户输入的文本通过 escapeHtml() 转义防止 XSS。
   */
  function renderCurrentAd() {
    if (!adOverlayEl || !currentAd.value) return;

    const ad = currentAd.value;
    const isSplash = isSplashShowing.value;
    const cd = countdown.value;
    const dur = isSplash ? settings.splashDuration : settings.playbackAdDuration;
    const skipAfter = isSplash ? settings.splashSkippableAfter : settings.playbackAdSkippableAfter;
    const canSkip = cd <= (dur - skipAfter);

    const imgBlock = ad._resolvedImage
      ? `<div class="ad-image-wrapper"><img src="${escapeHtml(ad._resolvedImage)}" alt="${escapeHtml(ad.title)}" class="ad-image" draggable="false" onerror="this.parentElement.style.display='none'"/></div>`
      : "";

    const skipBtn = `<button class="ad-skip-btn" id="ad-skip-btn"${canSkip ? "" : " style=\"display:none\""}>跳过 ×</button>`;

    const ctaBtn = ad.linkUrl
      ? `<button class="ad-cta-btn" id="ad-cta-btn">了解更多 →</button>`
      : "";

    adOverlayEl.style.display = "block";
    adOverlayEl.innerHTML = `
      <div class="ad-overlay ${isSplash ? "ad-splash" : "ad-playback"}"
           style="--ad-bg: ${ad.bgColor || "#1a1a2e"}; --ad-text: ${ad.textColor || "#fff"}; --ad-accent: ${ad.accentColor || "#e94560"};">
        <div class="ad-backdrop" id="ad-backdrop"></div>
        <div class="ad-card">
          <div class="ad-header">
            <div class="ad-countdown-badge">
              <span class="ad-countdown-number" id="ad-cd-num">${cd}</span>
              <span class="ad-countdown-label">s</span>
            </div>
            ${skipBtn}
          </div>
          <div class="ad-content">
            ${imgBlock}
            <div class="ad-text-block">
              <h2 class="ad-title">${escapeHtml(ad.title || "广告")}</h2>
              ${ad.subtitle ? `<p class="ad-subtitle">${escapeHtml(ad.subtitle)}</p>` : ""}
            </div>
            ${ctaBtn}
          </div>
          <div class="ad-progress-track">
            <div class="ad-progress-bar" style="animation-duration: ${dur}s;"></div>
          </div>
        </div>
      </div>
    `;

    lastRenderedCd = cd;
  }

  /**
   * 仅更新倒计时数字和跳过按钮显隐状态
   *
   * 性能优化关键：倒计时每秒变化时，只修改 #ad-cd-num 的 textContent，
   * 不重新 innerHTML 整个广告卡片。避免每秒重建 DOM 导致的：
   *   - 图片闪烁（重新加载）
   *   - CSS 动画重置（进度条重头开始）
   *   - 事件监听器丢失
   *
   * 同时检测倒计时是否已达可跳过阈值，显示跳过按钮。
   */
  function updateCountdownOnly() {
    if (!adOverlayEl) return;
    const numEl = adOverlayEl.querySelector("#ad-cd-num");
    if (numEl) {
      numEl.textContent = countdown.value;
    }

    // 检查是否需要显示跳过按钮
    const isSplash = isSplashShowing.value;
    const dur = isSplash ? settings.splashDuration : settings.playbackAdDuration;
    const skipAfter = isSplash ? settings.splashSkippableAfter : settings.playbackAdSkippableAfter;
    const shouldShowSkip = countdown.value <= (dur - skipAfter);

    if (shouldShowSkip) {
      const skipBtn = adOverlayEl.querySelector("#ad-skip-btn");
      if (skipBtn) {
        skipBtn.style.display = "";
      }
    }
  }

  /**
   * 清除广告 DOM 内容并隐藏层
   * 隐藏（display:none）而非移除 DOM 节点，避免后续重建开销。
   */
  function clearAdDom() {
    if (adOverlayEl) {
      adOverlayEl.style.display = "none";
      adOverlayEl.innerHTML = "";
    }
  }

  // ==================== 广告层挂载 & 事件 ====================

  /**
   * 将广告层 DOM 挂载到 body
   * 只在 init() 时调用一次，后续通过 display 控制显隐。
   */
  function mountAdLayer() {
    adOverlayEl = document.createElement("div");
    adOverlayEl.id = "echo-ad-system-overlay";
    adOverlayEl.style.display = "none";
    document.body.appendChild(adOverlayEl);
  }

  /**
   * 从 body 移除广告层 DOM
   * 仅在插件 dispose 时调用，彻底清理。
   */
  function unmountAdLayer() {
    if (adOverlayEl?.parentNode) {
      adOverlayEl.parentNode.removeChild(adOverlayEl);
      adOverlayEl = null;
    }
  }

  /**
   * 绑定广告层事件委托
   *
   * 通过 document 级别的 click 委托处理所有广告交互，而非在每个按钮上单独绑定：
   *   - #ad-skip-btn → 隐藏当前广告
   *   - #ad-cta-btn → 打开跳转链接（新窗口）
   *   - #ad-backdrop（仅播放中广告）→ 点击背景关闭广告
   *
   * 使用事件委托的原因：innerHTML 重建会丢失直接绑定的事件监听器。
   */
  function bindOverlayEvents() {
    document.addEventListener("click", (e) => {
      const id = e.target.id;

      if (id === "ad-skip-btn") {
        e.preventDefault();
        if (isSplashShowing.value) hideSplashAd();
        else if (isPlaybackAdShowing.value) hidePlaybackAd();
        return;
      }

      if (id === "ad-cta-btn" && currentAd.value?.linkUrl) {
        e.preventDefault();
        window.open(currentAd.value.linkUrl, "_blank");
        return;
      }

      if (id === "ad-backdrop" && isPlaybackAdShowing.value) {
        hidePlaybackAd();
      }
    });
  }

  // ==================== 初始化 ====================

  /**
   * 等待 document.body 就绪
   *
   * 使用 MutationObserver 监听 DOM 变化，确保在 body 可用之后再挂载广告层。
   * 这是因为插件 activate 可能在 DOM 完全构建之前被调用。
   *
   * @returns {Promise<void>}
   */
  function waitForBody() {
    return new Promise((resolve) => {
      if (document.body) {
        resolve();
        return;
      }
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    });
  }

  /**
   * 插件初始化入口
   *
   * 执行顺序：
   *   1. 加载持久化设置（与默认值合并）
   *   2. 等待 DOM 就绪
   *   3. 挂载广告层 + 绑定事件
   *   4. 播放启动音效
   *   5. requestAnimationFrame 后显示开屏广告（确保首帧渲染完成）
   *   6. 安排播放中插播广告
   *   7. 监听播放状态变化
   */
  async function init() {
    const saved = await ctx.storage.get("adSettings");
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...saved };
    }

    await waitForBody();

    mountAdLayer();
    bindOverlayEvents();

    playStartupAudio();

    // requestAnimationFrame 延迟一帧显示开屏广告，避免与首帧渲染冲突
    requestAnimationFrame(() => {
      showSplashAd();
    });

    scheduleNextPlaybackAd();

    ctx.events.onPlaybackChange((playing) => {
      if (playing && !isPlaybackAdShowing.value) {
        scheduleNextPlaybackAd();
      }
    });

    ctx.events.onTrackChange((track) => {
      // 预留：可在此处基于曲目变化扩展广告触发逻辑
    });
  }

  init();

  // ==================== 主题检测 ====================

  /**
   * 检测宿主 EchoMusic 当前主题
   *
   * 优先级：
   *   1. <html data-theme="light|dark"> — EchoMusic 设置的主题属性
   *   2. prefers-color-scheme 媒体查询 — 系统级主题偏好
   *
   * CSS 通过 [data-theme="light"] 选择器自动切换变量，
   * 此处保留 JS 端 ref 供未来扩展（如条件渲染）。
   */
  const appTheme = ref(
    document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );

  // 监听宿主主题切换（MutationObserver 监听 html[data-theme]）
  const themeObserver = new MutationObserver(() => {
    const newTheme = document.documentElement.getAttribute("data-theme");
    if (newTheme && newTheme !== appTheme.value) {
      appTheme.value = newTheme;
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // 同时监听系统主题变化（当 data-theme 未设置时作为后备）
  const sysThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  sysThemeQuery.addEventListener("change", (e) => {
    if (!document.documentElement.getAttribute("data-theme")) {
      appTheme.value = e.matches ? "dark" : "light";
    }
  });

  // ==================== 设置面板 ====================

  const SettingsPanel = defineComponent({
    setup() {
      const local = ref(JSON.parse(JSON.stringify(settings)));
      const saveStatus = ref("");
      const bingPreview = ref([]);
      const bingLoading = ref(false);

      ctx.storage.get("adSettings").then((saved) => {
        if (saved) {
          settings = { ...DEFAULT_SETTINGS, ...saved };
          local.value = JSON.parse(JSON.stringify(settings));
        }
      });

      const save = async () => {
        settings = JSON.parse(JSON.stringify(local.value));
        await ctx.storage.set("adSettings", settings);
        saveStatus.value = "已保存 ✓";
        ctx.toast.success("广告设置已保存");
        setTimeout(() => (saveStatus.value = ""), 2000);
      };

      const resetDefaults = () => {
        local.value = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        ctx.toast.info("已恢复默认值，点击保存生效");
      };

      const previewBing = async () => {
        bingLoading.value = true;
        try {
          const imgs = await fetchBingWallpapers();
          bingPreview.value = imgs;
          if (imgs.length === 0) ctx.toast.warning("未获取到壁纸，请检查网络");
        } catch {
          bingPreview.value = [];
          ctx.toast.danger("获取失败");
        }
        bingLoading.value = false;
      };

      const renderAdEditor = (ad, index, type) => {
        const updateField = (field, value) => {
          ad[field] = value;
        };

        return h("div", { class: "ad-editor-card", key: ad.id || index }, [
          h("div", { class: "ad-editor-header" }, [
            h("span", { class: "ad-editor-label" }, `广告 #${index + 1}`),
            h(
              Button,
              {
                size: "xs",
                variant: "ghost",
                onClick: () => {
                  const list = type === "splash" ? local.value.splashAds : local.value.playbackAds;
                  if (list.length > 1) list.splice(index, 1);
                },
              },
              { default: () => "删除" }
            ),
          ]),

          h("label", { class: "ad-setting-row" }, [
            h("span", "标题"),
            h(Input, {
              modelValue: ad.title,
              "onUpdate:modelValue": (v) => updateField("title", v),
              placeholder: "广告标题",
              style: "flex: 1 1 auto; min-width: 50px; max-width: 100%;",
            }),
          ]),

          h("label", { class: "ad-setting-row" }, [
            h("span", "副标题"),
            h(Input, {
              modelValue: ad.subtitle,
              "onUpdate:modelValue": (v) => updateField("subtitle", v),
              placeholder: "广告副标题（可选）",
              style: "flex: 1 1 auto; min-width: 50px; max-width: 100%;",
            }),
          ]),

          h("label", { class: "ad-setting-row" }, [
            h("span", "跳转链接"),
            h(Input, {
              modelValue: ad.linkUrl,
              "onUpdate:modelValue": (v) => updateField("linkUrl", v),
              placeholder: "https://example.com",
              style: "flex: 1 1 auto; min-width: 50px; max-width: 100%;",
            }),
          ]),

          h("label", { class: "ad-setting-row" }, [
            h("span", "图片来源"),
            h(
              "select",
              {
                class: "ad-select",
                value: ad.imageSource || "none",
                style: "flex-shrink: 0; max-width: 160px;",
                onChange: (e) => updateField("imageSource", e.target.value),
              },
              IMAGE_SOURCE_OPTIONS.map((opt) =>
                h("option", { value: opt.value }, opt.label)
              )
            ),
          ]),

          h("label", { class: "ad-setting-row ad-setting-col" }, [
            h("span", "自定义图片 URL"),
            h(Input, {
              modelValue: ad.imageUrl,
              "onUpdate:modelValue": (v) => updateField("imageUrl", v),
              placeholder: "留空则使用图片来源设置",
              style: "flex: 1 1 auto; min-width: 0;",
            }),
            h("div", { class: "ad-setting-hint" }, "填写后将覆盖图片来源设置，直接使用此图片"),
          ]),

          ad.imageSource === "custom-list" || ad.imageSource === "bing-or-custom"
            ? h("div", { class: "ad-setting-col" }, [
                h("span", { class: "ad-setting-row-label" }, "自定义图片列表"),
                ...((ad.customImages || []).map((url, i) =>
                  h("div", { class: "ad-custom-img-row", key: i }, [
                    h(Input, {
                      modelValue: url,
                      "onUpdate:modelValue": (v) => {
                        if (!ad.customImages) ad.customImages = [];
                        ad.customImages[i] = v;
                      },
                      placeholder: `图片 URL #${i + 1}`,
                      style: "flex: 1; min-width: 0;",
                    }),
                    h(
                      Button,
                      {
                        size: "xs",
                        variant: "ghost",
                        onClick: () => ad.customImages.splice(i, 1),
                      },
                      { default: () => "✕" }
                    ),
                  ])
                )),
                h(
                  Button,
                  {
                    size: "xs",
                    onClick: () => {
                      if (!ad.customImages) ad.customImages = [];
                      ad.customImages.push("");
                    },
                  },
                  { default: () => "+ 添加图片" }
                ),
              ])
            : null,

          h("div", { class: "ad-color-row" }, [
            h("label", { class: "ad-color-item" }, [
              h("span", "背景色"),
              h("input", {
                type: "color",
                value: ad.bgColor || "#1a1a2e",
                onChange: (e) => updateField("bgColor", e.target.value),
              }),
            ]),
            h("label", { class: "ad-color-item" }, [
              h("span", "文字色"),
              h("input", {
                type: "color",
                value: ad.textColor || "#ffffff",
                onChange: (e) => updateField("textColor", e.target.value),
              }),
            ]),
            h("label", { class: "ad-color-item" }, [
              h("span", "强调色"),
              h("input", {
                type: "color",
                value: ad.accentColor || "#e94560",
                onChange: (e) => updateField("accentColor", e.target.value),
              }),
            ]),
          ]),
        ]);
      };

      /**
       * 设置面板渲染函数
       *
       * 布局策略——「标签固定 + 控件推右」弹性布局：
       *
       *   Switch 行：flex-shrink:0 + margin-left:auto
       *     不压缩开关组件，同时 margin-left:auto 将开关推至行右端。
       *     为什么不用 CSS justify-content:space-between？
       *       space-between 在行宽不足时会导致标签与控件重叠；
       *       margin-left:auto 配合父级 overflow:hidden 可安全截断。
       *
       *   InputNumber 行：flex:0 1 auto + margin-left:auto
       *     允许适度收缩（flex-basis:auto, flex-shrink:1），
       *     min-width:60px 保证最小值，max-width:130px 防止过宽。
       *
       *   编辑器 Input 行：flex:1 1 auto
       *     输入框填充行内所有剩余空间，min-width:0 允许收缩。
       *     Flex 默认 min-width:auto(=内容宽度) 会阻止收缩，
       *     显式设 0 才能在窄窗口下压缩输入框而不溢出。
       *
       *   select 下拉框：flex-shrink:0 + max-width:160px
       *     不压缩防止文字截断，max-width 限制最大宽度保持视觉一致。
       */
      return () =>
        h("div", { class: "ad-settings-panel" }, [
          // ===== 全局 =====
          h("div", { class: "ad-setting-group" }, [
            h("h3", { class: "ad-setting-title" }, "🎛️ 全局设置"),
            h("label", { class: "ad-setting-row" }, [
              h("span", "启用广告系统"),
              h(Switch, {
                modelValue: local.value.enabled,
                "onUpdate:modelValue": (v) => (local.value.enabled = Boolean(v)),
                style: "flex-shrink: 0; margin-left: auto;"
              }),
            ]),
          ]),

          // ===== 启动音效 =====
          h("div", { class: "ad-setting-group" }, [
            h("h3", { class: "ad-setting-title" }, "🔊 启动音效"),
            h("label", { class: "ad-setting-row" }, [
              h("span", "启用启动音效"),
              h(Switch, {
                modelValue: local.value.startupAudioEnabled,
                "onUpdate:modelValue": (v) => (local.value.startupAudioEnabled = Boolean(v)),
                style: "flex-shrink: 0; margin-left: auto;"
              }),
            ]),
            h("label", { class: "ad-setting-row ad-setting-col" }, [
              h("span", "音频文件路径"),
              h("div", { class: "ad-audio-path-row" }, [
                h(Input, {
                  modelValue: local.value.startupAudioSrc,
                  "onUpdate:modelValue": (v) => (local.value.startupAudioSrc = v),
                  placeholder: "点击右侧按钮选择音频文件...",
                  style: "flex: 1;",
                }),
                h(
                  Button,
                  {
                    size: "xs",
                    variant: "outline",
                    onClick: async () => {
                      try {
                        const result = await ctx.dialog.selectFiles({
                          title: "选择启动音频文件",
                          filters: [
                            { name: "音频文件", extensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac", "wma"] },
                            { name: "所有文件", extensions: ["*"] },
                          ],
                        });
                        if (!result.canceled && result.paths && result.paths.length > 0) {
                          local.value.startupAudioSrc = result.paths[0];
                          ctx.toast.success("已选择: " + result.paths[0].split(/[\\/]/).pop());
                        }
                      } catch (e) {
                        ctx.toast.danger("文件选择失败");
                      }
                    },
                  },
                  { default: () => "📁 选择" }
                ),
              ]),
              h("div", { class: "ad-setting-hint" }, '支持格式：mp3 / wav / ogg / m4a / aac / flac。点击「选择」按钮浏览本地音频文件，也可手动输入插件目录相对路径或 https:// 在线地址'),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "音量"),
              h(InputNumber, {
                modelValue: Math.round(local.value.startupAudioVolume * 100),
                min: 0,
                max: 100,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.startupAudioVolume = (Number(v) || 80) / 100),
              }),
            ]),
            h("div", { class: "ad-setting-hint" }, "软件启动时自动播放音效，如「哈喽酷狗」。因浏览器自动播放策略限制，首次可能需要用户交互后才能播放。"),
            h(
              Button,
              {
                size: "xs",
                onClick: async () => {
                  const rawSrc = local.value.startupAudioSrc;
                  if (!rawSrc) return ctx.toast.warning("请先填写或选择音频路径");
                  try {
                    const src = await getAudioUrl(rawSrc);
                    if (!src) return ctx.toast.danger("无法解析音频路径");
                    let finalSrc = src;
                    // 在线 URL：先 fetch 为 blob；本地 URL：直接用
                    if (src.startsWith("http://") || src.startsWith("https://")) {
                      const blobUrl = await tryLoadAudioBlob(src);
                      if (blobUrl) finalSrc = blobUrl;
                    }
                    const audio = playAudioFromSrc(finalSrc, local.value.startupAudioVolume);
                    if (audio) {
                      ctx.toast.success("正在播放...");
                    } else {
                      ctx.toast.danger("无法播放");
                    }
                  } catch (e) {
                    ctx.toast.danger("播放失败: " + (e.message || e));
                  }
                },
              },
              { default: () => "🔊 测试播放" }
            ),
          ]),

          // ===== 开屏广告 =====
          h("div", { class: "ad-setting-group" }, [
            h("h3", { class: "ad-setting-title" }, "🚀 开屏广告"),
            h("label", { class: "ad-setting-row" }, [
              h("span", "启用"),
              h(Switch, {
                modelValue: local.value.splashEnabled,
                "onUpdate:modelValue": (v) => (local.value.splashEnabled = Boolean(v)),
                style: "flex-shrink: 0; margin-left: auto;"
              }),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "展示时长（秒）"),
              h(InputNumber, {
                modelValue: local.value.splashDuration,
                min: 3,
                max: 30,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.splashDuration = Number(v) || 5),
              }),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "几秒后可跳过"),
              h(InputNumber, {
                modelValue: local.value.splashSkippableAfter,
                min: 1,
                max: 15,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.splashSkippableAfter = Number(v) || 2),
              }),
            ]),

            ...local.value.splashAds.map((ad, i) => renderAdEditor(ad, i, "splash")),
            h(
              Button,
              {
                size: "xs",
                onClick: () =>
                  local.value.splashAds.push({
                    id: `splash-${Date.now()}`,
                    title: "新广告",
                    subtitle: "",
                    imageUrl: "",
                    linkUrl: "",
                    bgColor: "#1a1a2e",
                    textColor: "#ffffff",
                    accentColor: "#e94560",
                    imageSource: "bing-today",
                    customImages: [],
                  }),
              },
              { default: () => "+ 添加开屏广告" }
            ),
          ]),

          // ===== 播放中广告 =====
          h("div", { class: "ad-setting-group" }, [
            h("h3", { class: "ad-setting-title" }, "🎵 播放中插播广告"),
            h("label", { class: "ad-setting-row" }, [
              h("span", "启用"),
              h(Switch, {
                modelValue: local.value.playbackAdEnabled,
                "onUpdate:modelValue": (v) => (local.value.playbackAdEnabled = Boolean(v)),
                style: "flex-shrink: 0; margin-left: auto;"
              }),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "最短间隔（秒）"),
              h(InputNumber, {
                modelValue: local.value.playbackAdMinInterval,
                min: 60,
                max: 3600,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.playbackAdMinInterval = Number(v) || 300),
              }),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "最长间隔（秒）"),
              h(InputNumber, {
                modelValue: local.value.playbackAdMaxInterval,
                min: 60,
                max: 7200,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.playbackAdMaxInterval = Number(v) || 600),
              }),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "展示时长（秒）"),
              h(InputNumber, {
                modelValue: local.value.playbackAdDuration,
                min: 3,
                max: 60,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.playbackAdDuration = Number(v) || 8),
              }),
            ]),
            h("label", { class: "ad-setting-row" }, [
              h("span", "几秒后可跳过"),
              h(InputNumber, {
                modelValue: local.value.playbackAdSkippableAfter,
                min: 1,
                max: 30,
                style: "flex: 0 1 auto; min-width: 60px; max-width: 130px; margin-left: auto;",
                "onUpdate:modelValue": (v) => (local.value.playbackAdSkippableAfter = Number(v) || 3),
              }),
            ]),
            h("div", { class: "ad-setting-hint" }, "播放中广告会自动暂停音乐，倒计时结束后自动恢复播放。仅在播放状态触发，默认最少间隔 5 分钟。"),

            ...local.value.playbackAds.map((ad, i) => renderAdEditor(ad, i, "playback")),
            h(
              Button,
              {
                size: "xs",
                onClick: () =>
                  local.value.playbackAds.push({
                    id: `playback-${Date.now()}`,
                    title: "新广告",
                    subtitle: "",
                    imageUrl: "",
                    linkUrl: "",
                    bgColor: "#0f3460",
                    textColor: "#ffffff",
                    accentColor: "#16c79a",
                    imageSource: "bing-random",
                    customImages: [],
                  }),
              },
              { default: () => "+ 添加播放中广告" }
            ),
          ]),

          // ===== Bing 壁纸预览 =====
          h("div", { class: "ad-setting-group" }, [
            h("h3", { class: "ad-setting-title" }, "🖼️ Bing 每日壁纸预览"),
            h(
              Button,
              {
                size: "sm",
                onClick: previewBing,
                disabled: bingLoading.value,
              },
              { default: () => (bingLoading.value ? "加载中..." : "获取今日壁纸") }
            ),
            bingPreview.value.length > 0
              ? h("div", { class: "ad-bing-grid" },
                  bingPreview.value.map((img) =>
                    h("div", { class: "ad-bing-thumb", key: img.url }, [
                      h("img", {
                        src: img.url + "&w=320&h=180",
                        alt: img.title,
                        draggable: false,
                      }),
                      h("div", { class: "ad-bing-info" }, [
                        h("span", { class: "ad-bing-title" }, img.title),
                        h("span", { class: "ad-bing-date" }, img.date),
                      ]),
                    ])
                  )
                )
              : null,
          ]),

          // ===== 操作按钮 =====
          h("div", { class: "ad-setting-actions" }, [
            h(Button, { size: "sm", onClick: save }, { default: () => "💾 保存设置" }),
            h(Button, { size: "sm", variant: "ghost", onClick: resetDefaults }, { default: () => "恢复默认" }),
            saveStatus.value ? h("span", { class: "ad-save-status" }, saveStatus.value) : null,
          ]),

          // ===== 测试 =====
          h("div", { class: "ad-setting-group" }, [
            h("h3", { class: "ad-setting-title" }, "🧪 测试"),
            h("div", { class: "ad-test-btns" }, [
              h(
                Button,
                {
                  size: "xs",
                  onClick: async () => {
                    settings = JSON.parse(JSON.stringify(local.value));
                    await showSplashAd();
                  },
                },
                { default: () => "预览开屏广告" }
              ),
              h(
                Button,
                {
                  size: "xs",
                  onClick: async () => {
                    settings = JSON.parse(JSON.stringify(local.value));
                    await triggerPlaybackAd(true);
                  },
                },
                { default: () => "预览播放中广告" }
              ),
            ]),
          ]),

          // ===== 关于作者 =====
          h("div", { class: "ad-setting-group ad-about" }, [
            h("h3", { class: "ad-setting-title" }, "👤 关于作者"),
            h("div", { class: "ad-about-content" }, [
              h("div", { class: "ad-about-avatar" }, "🎵"),
              h("div", { class: "ad-about-info" }, [
                h("div", { class: "ad-about-name" }, "ZHCOOL520"),
                h("div", { class: "ad-about-desc" }, "EchoMusic 插件开发者"),
                h(
                  "a",
                  {
                    class: "ad-about-link",
                    href: "https://github.com/ZHCOOL520",
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  "🔗 github.com/ZHCOOL520"
                ),
              ]),
            ]),
            h("div", { class: "ad-about-version" }, [
              h("span", null, "广告系统插件 v1.0.0"),
              h("span", { class: "ad-about-sep" }, "·"),
              h("span", null, "基于 EchoMusic 插件 API"),
            ]),
          ]),
        ]);
    },
  });

  // 注册设置 & 页面
  ctx.ui.settings.define({ title: "广告系统", component: SettingsPanel });

  ctx.ui.addPage({
    id: "ad-system",
    title: "广告系统",
    icon: "tabler:ad-2",
    component: SettingsPanel,
    sidebar: true,
  });

  // 注册命令
  ctx.commands.register("ad-system.show-splash", () => showSplashAd());
  ctx.commands.register("ad-system.show-playback-ad", () => triggerPlaybackAd());
  ctx.commands.register("ad-system.play-audio", () => playStartupAudio());

  // 清理
  ctx.dispose(() => {
    hideSplashAd();
    hidePlaybackAd();
    if (playbackTimer) clearTimeout(playbackTimer);
    if (startupAudioEl) {
      startupAudioEl.pause();
      startupAudioEl = null;
    }
    unmountAdLayer();
    themeObserver.disconnect();
  });
}

export async function deactivate() {}
