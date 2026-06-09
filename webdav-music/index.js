/* ===================================================================
 * EchoMusic WebDAV Music Plugin (refactored)
 * 连接 WebDAV 服务器，浏览和播放云端音乐文件
 * =================================================================== */

/* ---- Constants ---- */
const STORAGE_KEY = "settings";
const AUDIO_EXTENSIONS = [
  "mp3", "flac", "wav", "aac", "ogg", "wma",
  "m4a", "ape", "opus", "aiff", "alac", "dsf", "dff",
];
const COVER_NAMES = [
  "cover.jpg", "cover.png", "cover.webp",
  "folder.jpg", "folder.png",
  "front.jpg", "front.png",
  "album.jpg", "album.png",
  "albumart.jpg", "albumart.png",
];
const DEFAULT_SETTINGS = {
  serverUrl: "",
  username: "",
  password: "",
  rootPath: "/",
};


/* ===================================================================
 * Cover Fallback — 跟随主应用兜底封面机制
 * 监听 cover-fallback 插件的 BroadcastChannel，动态计算兜底封面 URL
 * =================================================================== */

/** 主应用兜底封面默认值（与 @/plugins/coverFallback.ts 的 DEFAULT_COVER_URL 一致） */
const DEFAULT_COVER_URL = "https://imge.kugou.com/soft/collection/default.jpg";

/** 模块级兜底封面 ref（Vue ref，不依赖组件生命周期，由 activate 初始化，BroadcastChannel 更新） */
let _fallbackCoverUrlRef = null;

/** 模块级 BroadcastChannel，由 activate 初始化、deactivate 关闭 */
let _bcChannel = null;

/**
 * 将封面 URL 转换为 JPEG data URL，确保主进程 SMTC 可正常下载和使用
 * 
 * 问题：
 * 1. Blob URL（URL.createObjectURL）仅在渲染进程有效，主进程 fetch 无法访问
 * 2. SVG data URL 无法被 native addon 的 image crate 解码（无 rsvg 特性）
 * 
 * 解决：通过 Canvas 将任意图片格式转换为 JPEG data URL，
 *      主进程可直接 fetch，native addon 也能快速处理（JPEG 直达路径）。
 */
const convertCoverForSmtc = async (url) => {
  if (!url) return url;

  // 远程 HTTP(S) URL：主进程 fetch 可以正常下载，无需转换
  if (/^https?:\/\//.test(url)) return url;

  // 已经是 JPEG data URL：主进程 fetch 可处理，native addon 有 JPEG 快速路径
  if (/^data:image\/jpeg/.test(url)) return url;

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    console.log(
      '[webdav-music] SMTC cover converted to JPEG:',
      'original:', url?.substring(0, 60),
      'size:', jpegDataUrl?.length,
    );
    return jpegDataUrl;
  } catch (e) {
    console.warn('[webdav-music] SMTC cover conversion failed, fallback to original:', e);
    return url;
  }
};

const escapeXml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const readCssColor = (variableName, fallback) => {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.color = `var(${variableName})`;
  document.documentElement.appendChild(probe);
  const color = getComputedStyle(probe).color.trim();
  probe.remove();
  return color || fallback;
};

const parseRgb = (color) => {
  const text = String(color || "").trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const val = hex[1];
    const full = val.length === 3 ? val.split("").map((c) => c + c).join("") : val;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
  }
  const rgb = text.match(/rgba?\(([^)]+)\)/i);
  if (!rgb) return null;
  const [r, g, b] = rgb[1].split(",").slice(0, 3).map((c) => parseFloat(c.trim()));
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
};

const resolveReadableTextColor = (backgroundColor) => {
  const rgb = parseRgb(backgroundColor);
  if (!rgb) return "#ffffff";
  const normalize = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = 0.2126 * normalize(rgb.r) + 0.7152 * normalize(rgb.g) + 0.0722 * normalize(rgb.b);
  return lum > 0.46 ? "#111827" : "#ffffff";
};

/** 生成文字封面 SVG（与 cover-fallback 插件完全一致的逻辑） */
const createSvgCoverUrl = (settings, size) => {
  const fontSize = Math.round((Number(settings.fontSize) || 42) * (size / 400));
  const subFontSize = Math.max(14, Math.round(fontSize * 0.38));
  const text = escapeXml(settings.text || "EchoMusic");
  const subtext = escapeXml(settings.subtext || "");
  const showSubtext = Boolean(settings.showSubtext && subtext);
  const mainY = showSubtext ? "48%" : "54%";
  const bg = readCssColor("--color-primary", "#31cfa1");
  const fg = resolveReadableTextColor(bg);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${escapeXml(bg)}"/>` +
    `<text x="50%" y="${mainY}" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(fg)}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="800">${text}</text>` +
    (showSubtext
      ? `<text x="50%" y="62%" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(fg)}" opacity="0.72" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${subFontSize}" font-weight="650">${subtext}</text>`
      : "") +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** 根据 cover-fallback 插件设置，计算当前应使用的兜底封面 URL */
const computeFallbackCoverUrl = (settings) => {
  if (!settings || !settings.enabled) return DEFAULT_COVER_URL;
  if (settings.mode === "image" && settings.imageUrl && /^(https?:\/\/|file:\/\/|data:image\/)/i.test(String(settings.imageUrl)))
    return settings.imageUrl;
  if (settings.mode === "text") return createSvgCoverUrl(settings, 92);
  return DEFAULT_COVER_URL;
};


/* ===================================================================
 * Embedded Tag Parser — ID3v2 / FLAC
 * =================================================================== */
const readTagText = (data, offset, maxLen, encoding) => {
  const slice = data.slice(offset, offset + maxLen);
  let end = slice.length;
  if (encoding === 0 || encoding === 3) { const ni = slice.indexOf(0); if (ni >= 0) end = ni; }
  else { for (let i = 0; i + 1 < slice.length; i += 2) { if (slice[i] === 0 && slice[i + 1] === 0) { end = i; break; } } }
  const trimmed = data.slice(offset, offset + end);
  const charset = encoding === 3 ? "utf-8" : encoding === 0 ? "iso-8859-1" : "utf-16le";
  return new TextDecoder(charset).decode(trimmed).replace(/\0/g, "").trim();
};
const parseID3v2 = (buffer) => {
  const result = { title: "", artist: "", album: "", lyric: "", duration: 0, coverData: null, coverMime: "" };
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const readSynch = (off, len) => { let v = 0; for (let i = 0; i < len; i++) v = (v << 7) | dv.getUint8(off + i); return v; };
  const ver = dv.getUint8(3); if (ver < 2 || ver > 4) return result;
  const tagSize = readSynch(6, 4); let off = 10;
  if (ver >= 3 && (dv.getUint8(5) & 0x40)) off += 4 + readSynch(off, 4);
  const end = Math.min(off + tagSize, buffer.length);
  while (off + 6 <= end) {
    let frameId, frameSize;
    if (ver === 2) { frameId = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2)); frameSize = (dv.getUint8(off + 3) << 16) | (dv.getUint8(off + 4) << 8) | dv.getUint8(off + 5); off += 6; }
    else { frameId = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3)); frameSize = ver === 4 ? readSynch(off + 4, 4) : dv.getUint32(off + 4); off += 8; }
    if (frameSize <= 0 || off + frameSize > end) break;
    const fd = buffer.slice(off, off + frameSize); off += frameSize;
    const isText = ver === 2 ? (frameId[0] === "T" && frameId.length === 3 && frameId !== "TXX") : (frameId[0] === "T" && frameId !== "TXXX");
    if (isText) {
      const enc = fd[0]; const text = readTagText(fd, 1, frameSize - 1, enc);
      const key = ver === 2 ? { TT2: "TIT2", TP1: "TPE1", TAL: "TALB", TLE: "TLEN" }[frameId] || frameId : frameId;
      if (key === "TIT2" && !result.title) result.title = text; else if (key === "TPE1" && !result.artist) result.artist = text;
      else if (key === "TALB" && !result.album) result.album = text; else if (key === "TLEN") { const d = parseInt(text, 10); if (d > 0) result.duration = Math.round(d / 1000); }
      continue;
    }
    if (frameId === "USLT" || frameId === "ULT") {
      const enc = fd[0]; let pos = 4;
      if (enc === 0 || enc === 3) { while (pos < frameSize && fd[pos] !== 0) pos++; }
      else { while (pos + 1 < frameSize && !(fd[pos] === 0 && fd[pos + 1] === 0)) pos += 2; pos += 2; }
      pos++; if (pos < frameSize) result.lyric = readTagText(fd, pos, frameSize - pos, enc);
      continue;
    }
    if (frameId === "APIC" || frameId === "PIC") {
      const enc = fd[0]; let pos = 1; while (pos < frameSize && fd[pos] !== 0) pos++;
      result.coverMime = String.fromCharCode(...fd.slice(1, pos)); pos += 2;
      if (enc === 0 || enc === 3) { while (pos < frameSize && fd[pos] !== 0) pos++; }
      else { while (pos + 1 < frameSize && !(fd[pos] === 0 && fd[pos + 1] === 0)) pos += 2; pos += 2; }
      pos++; if (pos < frameSize) result.coverData = fd.slice(pos);
    }
  }
  return result;
};
const parseFLAC = (buffer) => {
  const result = { title: "", artist: "", album: "", lyric: "", duration: 0, coverData: null, coverMime: "" };
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength); let off = 4;
  while (off + 4 <= buffer.length) {
    const header = dv.getUint8(off); const blockType = header & 0x7F;
    const blockSize = (dv.getUint8(off + 1) << 16) | (dv.getUint8(off + 2) << 8) | dv.getUint8(off + 3); off += 4;
    if (off + blockSize > buffer.length) break;
    const bd = buffer.slice(off, off + blockSize); off += blockSize;
    if (blockType === 0 && blockSize >= 34) { const bdv = new DataView(bd.buffer, bd.byteOffset, bd.byteLength); const totalSamples = (bdv.getUint32(10) & 0xF) * 0x100000000 + bdv.getUint32(14); const sampleRate = bdv.getUint32(18) >> 12; if (sampleRate > 0) result.duration = Math.round(totalSamples / sampleRate); }
    else if (blockType === 4) { const bdv = new DataView(bd.buffer, bd.byteOffset, bd.byteLength); const vendorLen = bdv.getUint32(0, true); let pos = 4 + vendorLen; const numComments = bdv.getUint32(pos, true); pos += 4; for (let i = 0; i < numComments; i++) { if (pos + 4 > bd.length) break; const len = bdv.getUint32(pos, true); pos += 4; if (pos + len > bd.length) break; const comment = new TextDecoder().decode(bd.slice(pos, pos + len)); pos += len; const eq = comment.indexOf("="); if (eq <= 0) continue; const key = comment.slice(0, eq).toUpperCase(), value = comment.slice(eq + 1); if (key === "TITLE" && !result.title) result.title = value; else if (key === "ARTIST" && !result.artist) result.artist = value; else if (key === "ALBUM" && !result.album) result.album = value; else if (key === "LYRICS" && !result.lyric) result.lyric = value; } }
    else if (blockType === 6 && blockSize > 4) { const bdv = new DataView(bd.buffer, bd.byteOffset, bd.byteLength); let p = 4; const mimeLen = bdv.getUint32(p); p += 4; result.coverMime = new TextDecoder().decode(bd.slice(p, p + mimeLen)); p += mimeLen; const descLen = bdv.getUint32(p); p += 4 + descLen; p += 16; const picLen = bdv.getUint32(p); p += 4; if (p + picLen <= bd.length) result.coverData = bd.slice(p, p + picLen); }
    if (header & 0x80) break;
  }
  return result;
};
const readFileHead = async (ctx, settings, filePath) => {
  const url = joinUrl(settings.serverUrl, filePath); const headers = {}; const auth = buildAuthHeader(settings);
  if (auth) headers["Authorization"] = auth; headers["Range"] = "bytes=0-262143";
  const res = await ctx.net.fetch(url, { headers }); if (!res.ok) throw new Error("HTTP " + res.status);
  const ab = await res.arrayBuffer(); return new Uint8Array(ab);
};
const readEmbeddedTags = async (ctx, settings, filePath) => {
  try { const head = await readFileHead(ctx, settings, filePath); if (head.length < 4) return null; if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return parseID3v2(head); if (head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43) return parseFLAC(head); return null; }
  catch (err) { console.error("[webdav-music] readEmbeddedTags error:", filePath, err); return null; }
};



/**
 * 将充实后的元数据同步到播放队列、当前播放器快照和歌词 store
 * 
 * 关键：lyricStore 通过 playTrack 中的 ensureLyricsForCurrentTrack 加载歌词，
 * 但此时 track 还没有 lyric（enrich 是异步的）。当 enrich 完成后，
 * currentTrackSnapshot 虽然被更新了，但 ensureLyricsForCurrentTrack 的 watch
 * 只监听 currentTrack.value?.id（未变），不会重新触发。
 * 
 * 因此必须在此处直接调用 lyricStore.setLyric() 将歌词注入歌词系统。
 */
const syncToStores = (ctx, songId, patch) => {
  try {
    const playlist = ctx.stores.playlist;
    const player = ctx.stores.player;
    const lyric = ctx.stores.lyric;
    const sid = String(songId);
    // 1) 更新播放队列中的歌曲（重新赋值触发响应式）
    const queue = playlist.activeQueue;
    if (queue && Array.isArray(queue.songs)) {
      const idx = queue.songs.findIndex((s) => String(s.id) === sid);
      if (idx >= 0) {
        queue.songs[idx] = { ...queue.songs[idx], ...patch };
      }
    }
    // 2) 如果是当前播放的歌曲，重新赋值快照触发 UI 更新
    //    currentTrackSnapshot 是 markRaw 对象，Object.assign 不触发响应式
    if (player.currentTrackId && String(player.currentTrackId) === sid) {
      let snapshot = player.currentTrackSnapshot;
      if (snapshot) {
        // 合并 patch 生成新快照（消除冗余二次读取）
        snapshot = { ...snapshot, ...patch };
        player.currentTrackSnapshot = snapshot;
      }
      // 3) 注入歌词到 lyricStore（解决歌词异步加载的时序问题）
      if (patch.lyric) {
        console.log("[webdav-music] Injecting lyric into lyricStore, length:", patch.lyric.length);
        lyric.setLyric(patch.lyric, sid);
      }
      // 4) 元数据充实后同步刷新 Windows SMTC
      if (snapshot && window.electron?.mediaControls) {
        const rawCoverUrl = patch.coverUrl || _fallbackCoverUrlRef.value;
        convertCoverForSmtc(rawCoverUrl).then((coverUrl) => {
          window.electron.mediaControls.updateMetadata({
            title: snapshot.title || "未知歌曲",
            artist: snapshot.artist || "未知歌手",
            album: snapshot.album || "",
            durationMs: (snapshot.duration || 0) * 1000,
            coverUrl,
          });
        });
      }
    }
  } catch (err) {
    console.error("[webdav-music] syncToStores error:", err);
  }
};

/** 已充实过元数据的歌曲 ID 集合（防止重复请求） */
const enrichedIds = new Set();

/**
 * 从嵌入标签充实歌曲元数据（模块级，可被组件和 activate watcher 共用）
 * 
 * 支持以下场景：
 * - WebDAV 浏览页双击/点击播放（由组件的 enrichSong 调用）
 * - 上一首/下一首切歌（由 activate 中的 currentTrackId watcher 调用）
 * - 重启应用后恢复播放（由 activate 中的 currentTrackId watcher 触发）
 */
const enrichTrack = async (ctx, state, song) => {
  if (!song._filePath) return song;
  const sid = String(song.id);
  if (enrichedIds.has(sid)) return song;
  enrichedIds.add(sid);
  console.log("[webdav-music] enrichTrack started for:", song._filePath);
  const tags = await readEmbeddedTags(ctx, state.settings, song._filePath);
  if (!tags) return song;
  console.log("[webdav-music] Embedded tags:", "title:", !!tags.title, "artist:", !!tags.artist, "album:", !!tags.album, "cover:", !!tags.coverData, "lyric:", !!tags.lyric, "duration:", tags.duration);
  const patch = {};
  if (tags.title) { song.title = tags.title; song.name = tags.title; patch.title = tags.title; patch.name = tags.title; }
  if (tags.artist) { song.artist = tags.artist; song.artists = [{ name: tags.artist }]; song.singers = [{ name: tags.artist }]; patch.artist = tags.artist; patch.artists = [{ name: tags.artist }]; patch.singers = [{ name: tags.artist }]; }
  if (tags.album) { song.album = tags.album; song.albumName = tags.album; patch.album = tags.album; patch.albumName = tags.album; }
  if (tags.coverData) { const blob = new Blob([tags.coverData], { type: tags.coverMime || "image/jpeg" }); const cu = URL.createObjectURL(blob); song.coverUrl = cu; song.cover = cu; patch.coverUrl = cu; patch.cover = cu; }
  if (tags.lyric) { song.lyric = tags.lyric; patch.lyric = tags.lyric; }
  if (tags.duration > 0) { song.duration = tags.duration; patch.duration = tags.duration; }
  syncToStores(ctx, song.id, patch);
  console.log("[webdav-music] enrichTrack done:", song._filePath);
  return song;
};

/* ---- Helpers ---- */
const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return { ...DEFAULT_SETTINGS, ...source };
};
const isAudioFile = (name) => {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return AUDIO_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
};
const isCoverFile = (name) =>
  COVER_NAMES.some((c) => name.toLowerCase() === c.toLowerCase());
const parseTitleArtist = (filename) => {
  const dot = filename.lastIndexOf(".");
  let base = dot > 0 ? filename.slice(0, dot) : filename;
  // 去除可能的音轨编号前缀 (如 "01.", "01-", "01 ")
  base = base.replace(/^\d+[\.\-\s]+/, "").trim();
  // 尝试多种分隔符：空格-空格、短横线、半长横线、全长横线
  const seps = [" - ", " – ", " — ", "-", "–", "—"];
  for (const sep of seps) {
    const idx = base.indexOf(sep);
    if (idx > 0) {
      const artist = base.slice(0, idx).trim();
      const title = base.slice(idx + sep.length).trim();
      if (artist && title) return { artist, title };
    }
  }
  return { artist: "", title: base };
};
const buildAuthHeader = (settings) => {
  if (!settings.username) return null;
  const creds = settings.username + ":" + (settings.password || "");
  const bytes = new TextEncoder().encode(creds);
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return "Basic " + btoa(binStr);
};
const encodePath = (path) =>
  path.split("/").map((seg) => encodeURIComponent(seg)).join("/");
const joinUrl = (base, path) => {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return b + "/" + p;
};
const buildAuthUrl = (settings, path) => {
  const base = settings.serverUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  const fullPath = encodePath(p);
  if (settings.username) {
    const encUser = encodeURIComponent(settings.username);
    const encPass = encodeURIComponent(settings.password || "");
    const proto = base.startsWith("https://") ? "https://" : "http://";
    const rest = base.slice(proto.length);
    return proto + encUser + ":" + encPass + "@" + rest + fullPath;
  }
  return base + fullPath;
};

/** 规范化目录路径：去重斜杠、确保以 / 结尾 */
const normalizeDir = (path) => path.replace(/\/+/g, "/").replace(/\/$/, "") + "/";

/** 格式化文件大小（字节转可读串） */
const formatSize = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};
const webdavFetch = async (ctx, settings, path, options = {}) => {
  const url = joinUrl(settings.serverUrl, path);
  const headers = { ...options.headers };
  const auth = buildAuthHeader(settings);
  if (auth) headers["Authorization"] = auth;
  return ctx.net.fetch(url, { ...options, headers });
};
const webdavFetchRaw = async (settings, path, options = {}) => {
  const url = buildAuthUrl(settings, path);
  return fetch(url, { ...options });
};
const generateSongId = (path) => {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i);
    hash |= 0;
  }
  return "webdav_" + Math.abs(hash).toString(36);
};

/** 构建歌曲对象（统一 createSong 和 playFolder 中的重复逻辑） */
const createSongObject = (entryName, filePath, opts = {}) => {
  const { album = "WebDAV", coverUrl = "" } = opts;
  const { artist, title } = parseTitleArtist(entryName);
  const id = generateSongId(filePath);
  return {
    id,
    songId: id,
    title: title || entryName,
    name: title || entryName,
    artist: artist || "未知歌手",
    artists: artist ? [{ name: artist }] : [],
    singers: artist ? [{ name: artist }] : [],
    album,
    albumName: album,
    duration: 0,
    coverUrl,
    cover: coverUrl,
    hash: id,
    source: "webdav",
    mixSongId: id,
    privilege: 0,
    _filePath: filePath,
  };
};

/* ---- WebDAV PROPFIND ---- */
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getcontenttype/>
    <D:getlastmodified/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

const parsePropfindXml = (xmlText) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) {
    console.warn("[webdav-music] XML parse error");
    return [];
  }
  const results = [];
  const responses = doc.getElementsByTagNameNS
    ? doc.getElementsByTagNameNS("DAV:", "response")
    : doc.querySelectorAll("response, D\\:response, d\\:response");

  for (const resp of responses) {
    const getText = (tag) => {
      const el = resp.getElementsByTagNameNS?.("DAV:", tag)?.[0] ??
        resp.querySelector(tag + ", D\\:" + tag + ", d\\:" + tag);
      return el?.textContent?.trim() ?? "";
    };
    const href = getText("href");
    const displayName = getText("displayname");
    const contentLength = parseInt(getText("getcontentlength") || "0", 10);
    const contentType = getText("getcontenttype");
    const lastModified = getText("getlastmodified");

    let isCollection = false;
    const resourceType = resp.getElementsByTagNameNS?.("DAV:", "resourcetype")?.[0];
    if (resourceType) {
      isCollection =
        !!resourceType.getElementsByTagNameNS?.("DAV:", "collection")?.[0] ||
        !!resourceType.querySelector("collection, D\\:collection, d\\:collection");
    }
    let decodedHref = href;
    try { decodedHref = decodeURIComponent(href); } catch { /* ignore */ }
    const name = displayName || decodedHref.split("/").filter(Boolean).pop() || "";
    results.push({ href: decodedHref, name, isCollection, contentLength, contentType, lastModified });
  }
  return results;
};

const propfind = async (ctx, settings, path) => {
  const res = await webdavFetch(ctx, settings, path, {
    method: "PROPFIND",
    headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
    body: PROPFIND_BODY,
  });
  if (!res.ok) throw new Error(`PROPFIND failed: ${res.status} ${res.statusText}`);
  return parsePropfindXml(await res.text());
};

const findCover = async (settings, dirPath) => {
  const normDir = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  for (const coverName of COVER_NAMES) {
    const res = await webdavFetchRaw(settings, normDir + coverName, { method: "HEAD" });
    if (res.ok) return buildAuthUrl(settings, normDir + coverName);
  }
  return "";
};

/* ---- About page (README rendered as HTML) ---- */
const ABOUT_HTML = `<div class="webdav-about">
<h1>WebDAV 音乐</h1>
<p>连接 WebDAV 服务器，浏览和播放云端音乐文件。</p>

<h2>功能</h2>
<ul>
<li><strong>云端音乐浏览</strong>：通过 WebDAV 协议浏览远程服务器上的音乐文件，支持目录导航和面包屑路径</li>
<li><strong>播放控制</strong>：支持双击播放单曲、播放全部、点击文件夹播放按钮一键播放整个文件夹</li>
<li><strong>元数据提取</strong>：自动读取音频文件的嵌入标签（ID3v2 / FLAC），获取标题、歌手、专辑、封面图和歌词</li>
<li><strong>封面展示</strong>：优先读取嵌入封面，其次探测目录下的封面文件（cover.jpg、folder.jpg 等），兜底跟随主应用默认封面</li>
<li><strong>文件夹管理</strong>：支持多层目录结构，文件夹与歌曲混合排序显示</li>
<li><strong>认证支持</strong>：支持 Basic Auth 用户名/密码认证</li>
</ul>

<h2>安装</h2>
<p>将插件文件夹 <code>webdav-music</code> 放入 EchoMusic 的插件目录中即可。</p>
<pre><code>EchoMusicPlugins/
└── webdav-music/
    ├── manifest.json
    ├── icon.svg
    ├── index.js
    └── style.css</code></pre>

<h2>使用</h2>
<ol>
<li>在插件设置中填写 WebDAV 服务器地址、用户名、密码和根目录路径</li>
<li>点击左侧边栏的「WebDAV」进入浏览页面</li>
<li>双击歌曲即可播放，双击文件夹进入子目录</li>
<li>点击文件夹左侧的播放按钮可直接播放文件夹内全部音乐</li>
</ol>

<h2>设置</h2>
<table>
<tr><th>设置项</th><th>说明</th><th>默认值</th></tr>
<tr><td>服务器地址</td><td>WebDAV 服务器 URL，如 <code>https://webdav.example.com</code></td><td>-</td></tr>
<tr><td>用户名</td><td>Basic Auth 用户名，留空表示无需认证</td><td>-</td></tr>
<tr><td>密码</td><td>Basic Auth 密码</td><td>-</td></tr>
<tr><td>根目录路径</td><td>浏览音乐的起始路径</td><td>/</td></tr>
</table>

<h2>支持的音频格式</h2>
<p><code>mp3</code> <code>flac</code> <code>wav</code> <code>aac</code> <code>ogg</code> <code>wma</code> <code>m4a</code> <code>ape</code> <code>opus</code> <code>aiff</code> <code>alac</code> <code>dsf</code> <code>dff</code></p>

<h2>歌曲命名格式</h2>
<p>插件通过文件名解析歌曲标题和歌手，支持以下命名格式（按优先级匹配）：</p>
<table>
<tr><th>格式</th><th>示例</th><th>解析结果</th></tr>
<tr><td><code>歌手 - 标题</code></td><td><code>周杰伦 - 晴天.mp3</code></td><td>歌手：周杰伦，标题：晴天</td></tr>
<tr><td><code>歌手 – 标题</code>（短横线）</td><td><code>Taylor Swift – Shake It Off.mp3</code></td><td>歌手：Taylor Swift，标题：Shake It Off</td></tr>
<tr><td><code>歌手 — 标题</code>（长横线）</td><td><code>Adele — Hello.flac</code></td><td>歌手：Adele，标题：Hello</td></tr>
<tr><td><code>编号. 歌手 - 标题</code></td><td><code>01. 林俊杰 - 江南.mp3</code></td><td>歌手：林俊杰，标题：江南</td></tr>
<tr><td><code>编号- 歌手 - 标题</code></td><td><code>02-陈奕迅-十年.mp3</code></td><td>歌手：陈奕迅，标题：十年</td></tr>
</table>
<blockquote>如果文件名不符合上述格式，则整个文件名（不含扩展名）作为标题，歌手显示为「未知歌手」。若音频文件包含内嵌标签（ID3v2 / FLAC），以嵌入标签为准覆盖文件名解析结果。</blockquote>

<h2>封面优先级</h2>
<ol>
<li>音频文件内嵌封面（ID3v2 APIC / FLAC Picture）</li>
<li>目录下的封面图片文件（cover.jpg、folder.jpg 等）</li>
<li>主应用兜底封面（跟随 cover-fallback 插件设置动态切换）</li>
</ol>

<h2>依赖</h2>
<p>EchoMusic >= 2.2.6-beta.11</p>

<h2>更新日志</h2>
<h3>v1.0.3</h3>
<ul>
<li>修复上一首/下一首切歌及重启应用后恢复播放时无法自动获取歌曲元数据的问题</li>
<li>主应用最低版本要求更新到 &gt;=2.2.6-beta.11</li>
</ul>
<h3>v1.0.2</h3>
<ul>
<li>设置页面新增「关于」标签页，展示 README 内容</li>
</ul>
<h3>v1.0.1</h3>
<ul>
<li>接入主应用音频源解析 API（audioSource），播放时动态构造带认证 URL</li>
<li>修复 Windows SMTC 封面显示：嵌入封面 / SVG 兜底封面自动通过 Canvas 转为 JPEG</li>
<li>优化代码结构：统一歌曲对象构建逻辑、提取公共路径规范化函数</li>
</ul>
<h3>v1.0.0</h3>
<ul>
<li>初始版本</li>
</ul>

<h2>作者</h2>
<p>Oneday5799</p>
</div>`;

/* ---- Settings UI ---- */
const createSettingsPanel = (ctx, state) => {
  const { defineAsyncComponent, defineComponent, h, reactive, ref } = ctx.vue;
  const Input = defineAsyncComponent(ctx.ui.components.Input);
  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Tabs = defineAsyncComponent(ctx.ui.components.Tabs);
  const TabsList = defineAsyncComponent(ctx.ui.components.TabsList);
  const TabsTrigger = defineAsyncComponent(ctx.ui.components.TabsTrigger);
  const TabsContent = defineAsyncComponent(ctx.ui.components.TabsContent);

  return defineComponent({
    setup() {
      const draft = reactive({ ...DEFAULT_SETTINGS, ...state.settings });
      const activeTab = ref("settings");

      const save = async () => {
        const values = { ...draft };
        state.settings = values;
        await ctx.storage.set(STORAGE_KEY, values);
        ctx.toast.success("设置已保存");
      };

      const reset = () => {
        Object.assign(draft, { ...DEFAULT_SETTINGS });
      };

      const formRow = (label, input) =>
        h("div", { style: "display: flex; align-items: center; gap: 12px;" }, [
          h("label", { style: "width: 100px; flex-shrink: 0; font-size: 13px; color: var(--color-text-main); text-align: right;" }, label),
          h("div", { style: "flex: 1;" }, [input]),
        ]);

      return () =>
        h(Tabs, { modelValue: activeTab.value, "onUpdate:modelValue": (v) => { activeTab.value = v; } }, {
          default: () => [
            h(TabsList, {}, { default: () => [
              h(TabsTrigger, { value: "settings" }, { default: () => "设置" }),
              h(TabsTrigger, { value: "about" }, { default: () => "关于" }),
            ]}),
            h(TabsContent, { value: "settings" }, { default: () =>
              h("div", { style: "display: grid; gap: 12px; padding-top: 8px;" }, [
                formRow("服务器地址", h(Input, {
                  modelValue: draft.serverUrl,
                  placeholder: "https://webdav.example.com",
                  "onUpdate:modelValue": (v) => { draft.serverUrl = String(v ?? ""); },
                })),
                formRow("用户名", h(Input, {
                  modelValue: draft.username,
                  placeholder: "可选，留空表示无需认证",
                  "onUpdate:modelValue": (v) => { draft.username = String(v ?? ""); },
                })),
                formRow("密码", h(Input, {
                  modelValue: draft.password,
                  placeholder: "可选",
                  type: "password",
                  "onUpdate:modelValue": (v) => { draft.password = String(v ?? ""); },
                })),
                formRow("根目录路径", h(Input, {
                  modelValue: draft.rootPath,
                  placeholder: "/",
                  "onUpdate:modelValue": (v) => { draft.rootPath = String(v ?? "/"); },
                })),
                h("p", { style: "font-size: 12px; color: var(--color-text-subtle); margin: 0; padding-left: 112px;" },
                  "浏览音乐文件的起始路径，默认为根目录 /"),
                h("div", { style: "display: flex; gap: 8px; justify-content: flex-end;" }, [
                  h(Button, { size: "xs", onClick: reset, variant: "outline" }, { default: () => "重置" }),
                  h(Button, { size: "xs", onClick: save }, { default: () => "保存" }),
                ]),
              ])
            }),
            h(TabsContent, { value: "about" }, { default: () =>
              h("div", { style: "padding-top: 8px; max-height: 55vh; overflow-y: auto;", innerHTML: ABOUT_HTML })
            }),
          ],
        });
    },
  });
};

/* ---- Browser Page ---- */
const createBrowserPage = (ctx, state) => {
  const { h, ref, computed, onMounted } = ctx.vue;

  return ctx.vue.defineComponent({
    setup() {
      // resolveComponent 必须在 setup() 或 render() 内调用
      const Icon = ctx.vue.resolveComponent("Icon");
      // 规范化根路径（确保以 / 开头、以 / 结尾）
      const rootPath = normalizeDir(state.settings.rootPath || "/");
      const currentPath = ref(rootPath);
      const entries = ref([]);
      const loading = ref(false);
      const error = ref("");
      const coverCache = ref({});

      /** 面包屑：从根路径到当前路径的层级导航 */
      const breadcrumbs = computed(() => {
        const raw = currentPath.value.replace(/\/+/g, "/");
        // 获取相对于 rootPath 的子路径段
        const rel = raw.startsWith(rootPath) ? raw.slice(rootPath.length) : raw.slice(1);
        const parts = rel.split("/").filter(Boolean);
        // 第一项是根目录，始终可点击回退到 rootPath
        const rootName = rootPath.slice(0, -1).split("/").filter(Boolean).pop() || "根目录";
        const crumbs = [{ name: rootName, path: rootPath }];
        let acc = rootPath;
        for (const part of parts) {
          acc = acc.replace(/\/+$/, "") + "/" + part + "/";
          crumbs.push({ name: part, path: acc });
        }
        return crumbs;
      });

      const loadDirectory = async (path) => {
        loading.value = true;
        error.value = "";
        entries.value = [];
        try {
          // 规范化路径，确保与面包屑一致
          const dirPath = normalizeDir(path);
          const results = await propfind(ctx, state.settings, dirPath);
          // 获取当前目录自身的名称（过滤掉 PROPFIND 返回的自身引用）
          const selfName = dirPath.slice(0, -1).split("/").filter(Boolean).pop() || "";
          const dirs = results
            .filter((e) => e.isCollection && e.name && e.name !== selfName)
            .sort((a, b) => a.name.localeCompare(b.name));
          const files = results
            .filter((e) => !e.isCollection && isAudioFile(e.name))
            .sort((a, b) => a.name.localeCompare(b.name));
          const coverFiles = results.filter((e) => !e.isCollection && isCoverFile(e.name));
          if (coverFiles.length > 0) {
            coverCache.value[dirPath] = buildAuthUrl(
              state.settings,
              dirPath + coverFiles[0].name,
            );
          }
          entries.value = [...dirs, ...files];
        } catch (err) {
          error.value = "加载目录失败: " + (err.message || "未知错误");
          console.error("[webdav-music] Load error:", err);
        } finally {
          loading.value = false;
        }
      };

      const navigateTo = (path) => {
        // 规范化路径：去重斜杠、确保以 / 结尾
        const normalized = normalizeDir(path);
        currentPath.value = normalized;
        loadDirectory(normalized);
      };
      const navigateUp = () => {
        const cleaned = normalizeDir(currentPath.value).replace(/\/$/, "");
        if (cleaned === rootPath.replace(/\/$/, "") || cleaned === "") {
          navigateTo(rootPath);
          return;
        }
        const parent = cleaned.slice(0, cleaned.lastIndexOf("/")) + "/";
        navigateTo(parent.startsWith(rootPath) ? parent : rootPath);
      };
      const refresh = () => loadDirectory(currentPath.value);

      // --- Song creation & playback ---
      const createSong = (entry, dirPath) => {
        const normDir = normalizeDir(dirPath);
        const album = currentPath.value.split("/").filter(Boolean).pop() || "WebDAV";
        return createSongObject(entry.name, normDir + entry.name, {
          album,
          coverUrl: coverCache.value[normDir] || "",
        });
      };

      /** 异步从嵌入标签充实歌曲元数据（委托给模块级 enrichTrack） */
      const enrichSong = async (song) => {
        if (!song._filePath) return song;
        return enrichTrack(ctx, state, song);
      };

      const getSongs = () =>
        entries.value.filter((e) => !e.isCollection).map((e) => createSong(e, currentPath.value));

      const playSong = async (entry) => {
        console.log("[webdav-music] playSong triggered for:", entry.name);
        let song = createSong(entry, currentPath.value);
        // 异步充实元数据（不阻塞 UI）
        enrichSong(song).catch((err) => console.error("[webdav-music] enrichSong failed:", err));
        const allSongs = getSongs();
        const playlist = ctx.stores.playlist;
        const player = ctx.stores.player;
        try {
          await playlist.setPlaybackQueueWithOptions(allSongs, 0, {
            title: currentPath.value.split("/").filter(Boolean).pop() || "WebDAV",
            type: "manual",
            activate: true,
          });
          await player.playTrack(song.id, allSongs, {
            sourceQueueId: playlist.activeQueueId,
          });
        } catch (err) {
          console.error("[webdav-music] Play error:", err);
          ctx.toast.danger("播放失败");
        }
      };

      const playAll = async () => {
        const songs = getSongs();
        console.log("[webdav-music] playAll triggered, songs:", songs.length);
        if (songs.length === 0) return;
        // 异步充实第一首歌的元数据
        enrichSong(songs[0]).catch((err) => console.error("[webdav-music] enrichSong failed:", err));
        const playlist = ctx.stores.playlist;
        const player = ctx.stores.player;
        try {
          await playlist.setPlaybackQueueWithOptions(songs, 0, {
            title: currentPath.value.split("/").filter(Boolean).pop() || "WebDAV",
            type: "manual",
            activate: true,
          });
          await player.playTrack(songs[0].id, songs, {
            sourceQueueId: playlist.activeQueueId,
          });
        } catch (err) {
          console.error("[webdav-music] PlayAll error:", err);
          ctx.toast.danger("播放失败");
        }
      };

      const playFolder = async (folderPath) => {
        const normDir = normalizeDir(folderPath);
        const folderName = normDir.slice(0, -1).split("/").filter(Boolean).pop() || "WebDAV";
        let results;
        try {
          results = await propfind(ctx, state.settings, normDir);
        } catch (err) {
          console.error("[webdav-music] playFolder PROPFIND error:", err);
          ctx.toast.danger("无法读取文件夹");
          return;
        }
        const files = results
          .filter((e) => !e.isCollection && isAudioFile(e.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (files.length === 0) {
          ctx.toast.info("文件夹内没有音乐文件");
          return;
        }
        const coverFiles = results.filter((e) => !e.isCollection && isCoverFile(e.name));
        let coverUrl = "";
        if (coverFiles.length > 0) {
          coverUrl = buildAuthUrl(state.settings, normDir + coverFiles[0].name);
        }
        const songs = files.map((entry) =>
          createSongObject(entry.name, normDir + entry.name, { album: folderName, coverUrl }));
        enrichSong(songs[0]).catch((err) => console.error("[webdav-music] enrichSong failed:", err));
        const playlist = ctx.stores.playlist;
        const player = ctx.stores.player;
        try {
          await playlist.setPlaybackQueueWithOptions(songs, 0, {
            title: folderName,
            type: "manual",
            activate: true,
          });
          await player.playTrack(songs[0].id, songs, {
            sourceQueueId: playlist.activeQueueId,
          });
        } catch (err) {
          console.error("[webdav-music] playFolder error:", err);
          ctx.toast.danger("播放失败");
        }
      };

      const addToQueue = (entry) => {
        const song = createSong(entry, currentPath.value);
        const playlist = ctx.stores.playlist;
        const added = playlist.appendToPlaybackQueue?.([song]) ?? 0;
        if (added > 0) {
          ctx.toast.success(`已添加「${song.title}」到队列`);
        } else {
          ctx.toast.info("歌曲已在队列中");
        }
      };

      onMounted(() => loadDirectory(currentPath.value));

      const hasConnection = computed(() =>
        state.settings.serverUrl && state.settings.serverUrl.trim().length > 0,
      );

      return () => {
        if (!hasConnection.value) {
          return h("div", { class: "webdav-page" }, [
            h("div", { class: "webdav-empty" }, [
              h("p", { class: "webdav-empty-title" }, "未配置 WebDAV 服务器"),
              h("p", { class: "webdav-empty-desc" }, "请在插件设置中配置服务器地址后使用。"),
            ]),
          ]);
        }

        return h("div", { class: "webdav-page" }, [
          // Toolbar
          h("div", { class: "webdav-toolbar" }, [
            h("div", { class: "webdav-toolbar-left" }, [
              h("button", { class: "webdav-btn webdav-btn-icon", title: "返回上级", onClick: navigateUp }, [
                h(Icon, { icon: ctx.icons.iconArrowLeft, width: 18, height: 18 }),
              ]),
              h("button", { class: "webdav-btn webdav-btn-icon", title: "刷新", onClick: refresh }, [
                h(Icon, { icon: ctx.icons.iconRefresh, width: 18, height: 18 }),
              ]),
              h("button", { class: "webdav-btn webdav-btn-primary", onClick: playAll }, [
                h(Icon, { icon: ctx.icons.iconPlay, width: 16, height: 16 }),
                h("span", "播放全部"),
              ]),
            ]),
            h("div", { class: "webdav-toolbar-right" }, [
              h("span", { class: "webdav-count" },
                entries.value.filter((e) => !e.isCollection).length + " 首"),
            ]),
          ]),

          // Breadcrumb
          h("div", { class: "webdav-breadcrumb" },
            breadcrumbs.value.map((crumb, index) => {
              const items = [];
              if (index > 0) items.push(h("span", { class: "webdav-breadcrumb-sep" }, "/"));
              items.push(h("button", {
                class: "webdav-breadcrumb-item",
                onClick: () => navigateTo(crumb.path),
              }, crumb.name));
              return items;
            }).flat(),
          ),

          // Content — 仿主应用 SongList 布局
          h("div", { class: "webdav-content" }, [
            loading.value
              ? h("div", { class: "webdav-loading" }, "加载中...")
              : error.value
                ? h("div", { class: "webdav-error" }, error.value)
                : entries.value.length === 0
                  ? h("div", { class: "webdav-empty" }, [
                      h("p", { class: "webdav-empty-title" }, "此目录为空"),
                      h("p", { class: "webdav-empty-desc" }, "没有找到音乐文件"),
                    ])
                  : [
                      // 表头行（仿 SongListHeader）
                      h("div", { class: "webdav-list-header" }, [
                        h("div", { class: "webdav-col-index" }, "#"),
                        h("div", { class: "webdav-col-song" }, "歌曲"),
                        h("div", { class: "webdav-col-size" }, "大小"),
                      ]),
                      // 歌曲/目录列表
                      h("div", { class: "webdav-list" },
                        entries.value.map((entry, idx) => {
                          const isDir = entry.isCollection;
                          const fileIdx = isDir ? null : entries.value.filter((e, i) => i <= idx && !e.isCollection).length;
                          const filePath = normalizeDir(currentPath.value) + entry.name;
                          const songId = generateSongId(filePath);
                          const isActive = !isDir && String(ctx.stores.player.currentTrackId) === String(songId);
                          const { artist, title } = isDir ? { artist: "", title: "" } : parseTitleArtist(entry.name);
                          return h("div", {
                            class: ["webdav-row", isDir ? "webdav-row-dir" : "", isActive ? "is-active" : ""],
                            onDblclick: isDir
                              ? () => navigateTo(filePath + "/")
                              : () => playSong(entry),
                          }, [
                            // 序号列
                            h("div", { class: "webdav-col-index" }, [
                              !isDir ? [
                                isActive
                                  ? h("div", { class: "webdav-index-active" }, [h(Icon, { icon: ctx.icons.iconPlay, width: 14, height: 14 })])
                                  : [
                                      h("span", { class: "webdav-index-num" }, fileIdx),
                                      h("div", {
                                        class: "webdav-index-play",
                                        onClick: (e) => { e.stopPropagation(); playSong(entry); },
                                      }, [h(Icon, { icon: ctx.icons.iconPlay, width: 14, height: 14 })]),
                                    ],
                              ] : [
                                h("div", {
                                  class: "webdav-index-folder-play",
                                  onClick: (e) => { e.stopPropagation(); playFolder(filePath + "/"); },
                                  title: "播放此文件夹",
                                }, [h(Icon, { icon: ctx.icons.iconPlay, width: 14, height: 14 })]),
                              ],
                            ]),
                            // 歌曲列（兜底封面 + 标题/歌手）
                            h("div", { class: "webdav-col-song" }, [
                              h("div", { class: ["webdav-cover", isDir ? "webdav-cover-dir" : ""] }, [
                                isDir
                                  ? h("svg", { viewBox: "0 0 1024 1024", width: 22, height: 22, class: "webdav-folder-icon", innerHTML: '<path d="M947.2 969.728h-870.4c-42.496 0-76.8-34.304-76.8-76.8V131.072c0-42.496 34.304-76.8 76.8-76.8h449.024c42.496 0 76.8 34.304 76.8 76.8v68.608c0 14.336 11.264 25.6 25.6 25.6H947.2c42.496 0 76.8 34.304 76.8 76.8v590.848c0 42.496-34.304 76.8-76.8 76.8z m-870.4-864.256c-14.336 0-25.6 11.264-25.6 25.6v762.368c0 14.336 11.264 25.6 25.6 25.6h870.4c14.336 0 25.6-11.264 25.6-25.6V302.08c0-14.336-11.264-25.6-25.6-25.6h-318.976c-42.496 0-76.8-34.304-76.8-76.8v-68.608c0-14.336-11.264-25.6-25.6-25.6H76.8z" fill="#ffffff"/><path d="M948.224 155.136h-263.68c-14.336 0-25.6-11.264-25.6-25.6s11.264-25.6 25.6-25.6h263.68c14.336 0 25.6 11.264 25.6 25.6s-11.776 25.6-25.6 25.6z" fill="#ffffff"/>' })
                                  : h("img", { src: _fallbackCoverUrlRef.value, class: "webdav-cover-img", alt: "cover" }),
                              ]),
                              h("div", { class: "webdav-song-info" }, [
                                h("span", { class: "webdav-song-title" }, isDir ? entry.name : (title || entry.name)),
                                !isDir
                                  ? h("span", { class: "webdav-song-artist" }, artist || "未知歌手")
                                  : null,
                              ]),
                            ]),
                            // 大小列
                            h("div", { class: "webdav-col-size" }, isDir ? "" : formatSize(entry.contentLength)),
                          ]);
                        }),
                      ),
                    ],
          ]),
        ]);
      };
    },
  });
};

/* ===================================================================
 * Plugin Lifecycle
 * =================================================================== */
let state = null;

export async function activate(ctx) {
  console.log("[webdav-music] activate, ctx.electron:", !!ctx.electron, "ctx.electron.api:", !!(ctx.electron && ctx.electron.api), "ctx.stores:", !!ctx.stores);
  // 全局未捕获 Promise 拒绝捕获，避免静默失败
  const _unhandledHandler = (event) => {
    console.error("[webdav-music] Unhandled rejection:", event.reason);
  };
  window.addEventListener("unhandledrejection", _unhandledHandler);
  ctx.dispose(() => window.removeEventListener("unhandledrejection", _unhandledHandler));
  const saved = await ctx.storage.get(STORAGE_KEY);
  state = ctx.vue.reactive({ settings: normalizeSettings(saved) });

  // 注册自定义音源解析器：播放时动态构造带认证的 WebDAV URL
  ctx.player.audioSource.register({
    id: "webdav",
    match: (context) => context.track.source === "webdav" && !!context.track._filePath,
    resolve: (context) => buildAuthUrl(state.settings, context.track._filePath),
  });

  // 监听播放器切歌，自动为 webdav 音轨充实嵌入标签元数据
  // 覆盖三种场景：浏览页双击播放、上一首/下一首切歌、重启应用后恢复播放
  ctx.vue.watch(
    () => ctx.stores.player.currentTrackId,
    (trackId) => {
      if (!trackId) return;
      const track = ctx.stores.player.currentTrackSnapshot;
      if (!track || track.source !== "webdav" || !track._filePath) return;
      console.log("[webdav-music] currentTrackId changed, enriching:", track._filePath);
      enrichTrack(ctx, state, track).catch(
        (err) => console.error("[webdav-music] enrichTrack failed:", err),
      );
    },
    { immediate: true },
  );

  // 初始化模块级兜底封面 ref，不依赖组件生命周期
  _fallbackCoverUrlRef = ctx.vue.ref(DEFAULT_COVER_URL);

  // 设置 BroadcastChannel（模块级），监听 cover-fallback 插件设置变化
  if (typeof BroadcastChannel === "function") {
    _bcChannel = new BroadcastChannel("echo-plugin:cover-fallback:settings");
    _bcChannel.onmessage = (event) => {
      const payload = event.data;
      console.log("[webdav-music] BroadcastChannel 收到消息:", payload?.type);
      if (payload && payload.type === "settings" && payload.settings) {
        const url = computeFallbackCoverUrl(payload.settings);
        console.log("[webdav-music] 更新 fallbackCoverUrl:", url?.substring(0, 80) + "...");
        _fallbackCoverUrlRef.value = url;
      }
    };
    // 清理通道（deactivate 时）
    ctx.dispose(() => {
      _bcChannel?.close();
      _bcChannel = null;
    });
  }

  // Settings
  ctx.ui.settings.define({
    title: "WebDAV 音乐",
    component: createSettingsPanel(ctx, state),
  });

  // Page + sidebar (proper native sidebar entry via the host API)
  const BrowserPage = createBrowserPage(ctx, state);
  ctx.ui.addPage({
    id: "browser",
    title: "WebDAV",
    icon: "tabler:server",
    component: BrowserPage,
    sidebar: true,
  });

  // Cleanup on deactivation
  ctx.dispose(() => {
    state = null;
  });

  ctx.toast.success(`${ctx.manifest.name} 已启用`);
}

export function deactivate(_ctx) {
  state = null;
}
