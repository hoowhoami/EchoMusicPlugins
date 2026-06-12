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

/** 单个 WebDAV 库的默认结构 */
const createDefaultLibrary = (id) => ({
  id,
  name: "",
  serverUrl: "",
  username: "",
  password: "",
  rootPath: "/",
});

const DEFAULT_SETTINGS = {
  // 向后兼容：单库配置（已废弃，迁移到 libraries）
  serverUrl: "",
  username: "",
  password: "",
  rootPath: "/",
  coverLyricSource: "embedded", // "embedded" | "kugou"
  // 多库配置
  libraries: [],
  activeLibraryId: null,
};

/** 模块级排序状态（不依赖组件生命周期，应用关闭前持久保持） */
let _sortField = null; // 'name' | 'title' | 'size' | null
let _sortOrder = null; // 'asc' | 'desc' | null

/** 模块级歌词缓存：songId → lyric text，供歌词解析器使用 */
const _enrichedLyrics = new Map();

/** 模块级 enrichment 追踪：songId → Promise，供歌词解析器等待 */
const _pendingEnrichment = new Map();

/** 模块级库配置缓存：songId → library，供封面获取使用 */
const _songLibraryCache = new Map();


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
const convertCoverForSmtc = async (input, authHeader) => {
  if (!input) return input;

  // Uint8Array：直接转 base64 data URL
  if (input instanceof Uint8Array) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(new Blob([input], { type: "image/jpeg" }));
    });
  }

  // 已经是 JPEG data URL：直接使用
  if (/^data:image\/jpeg/.test(input)) return input;

  // URL：通过 fetch + Authorization header 获取图片数据
  // 浏览器 <img> 和 fetch 不支持 URL 内嵌凭证（user:pass@host）
  if (typeof input === "string" && authHeader) {
    try {
      const res = await fetch(input, { headers: { Authorization: authHeader } });
      if (res.ok) {
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch {}
  }

  // 其他 URL：通过 Canvas 转 JPEG data URL
  const TIMEOUT_MS = 5000;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await Promise.race([
      new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = input;
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Image load timeout')), TIMEOUT_MS)
      )
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    return input;
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
    // 2) 注入歌词到 lyricStore（解决歌词异步加载的时序问题）
    if (patch.lyric) {
      lyric.setLyric(patch.lyric, sid);
      _enrichedLyrics.set(sid, patch.lyric);
    }
    // 3) 更新当前播放歌曲的快照
    //    使用 Object.assign 就地修改，确保 Vue 响应式追踪生效
    //    （currentTrackSnapshot 由 toRawSong() 创建，用 markRaw 包装）
    if (player.currentTrackId && String(player.currentTrackId) === sid) {
      const currentSnapshot = player.currentTrackSnapshot;
      if (currentSnapshot) Object.assign(currentSnapshot, patch);
      // 4) 元数据充实后同步刷新 Windows SMTC
      const snapshotForSmtc = player.currentTrackSnapshot;
      if (snapshotForSmtc && window.electron?.mediaControls) {
        // 获取库配置以构建 Authorization header
        const lib = _songLibraryCache.get(sid);
        const authHeader = lib ? buildAuthHeader(lib) : null;
        const rawCoverUrl = patch.coverUrl || snapshotForSmtc.coverUrl || snapshotForSmtc.cover || _fallbackCoverUrlRef.value;
        (async () => {
          try {
            const coverUrl = await convertCoverForSmtc(rawCoverUrl, authHeader);
            window.electron.mediaControls.updateMetadata({
              title: snapshotForSmtc.title || "未知歌曲",
              artist: snapshotForSmtc.artist || "未知歌手",
              album: snapshotForSmtc.album || "",
              durationMs: (snapshotForSmtc.duration || 0) * 1000,
              coverUrl,
            });
          } catch (e) {
            const defaultCoverUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAoDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFRABAQAAAAAAAAAAAAAAAAAAAAf/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ApgAH/9k=';
            window.electron.mediaControls.updateMetadata({
              title: snapshotForSmtc.title || "未知歌曲",
              artist: snapshotForSmtc.artist || "未知歌手",
              album: snapshotForSmtc.album || "",
              durationMs: (snapshotForSmtc.duration || 0) * 1000,
              coverUrl: defaultCoverUrl,
            });
          }
        })();
      }
    }
  } catch (err) {
    console.error("[webdav-music] syncToStores error:", err);
  }
};

const buildPatchFromSource = (song, source, sourceType) => {
  const patch = {};
  if (sourceType === 'embedded') {
    if (source.title) { song.title = source.title; song.name = source.title; patch.title = source.title; patch.name = source.title; }
    if (source.artist) { song.artist = source.artist; song.artists = [{ name: source.artist }]; song.singers = [{ name: source.artist }]; patch.artist = source.artist; patch.artists = [{ name: source.artist }]; patch.singers = [{ name: source.artist }]; }
    if (source.album) { song.album = source.album; song.albumName = source.album; patch.album = source.album; patch.albumName = source.album; }
    if (source.coverData) { const blob = new Blob([source.coverData], { type: source.coverMime || "image/jpeg" }); const cu = URL.createObjectURL(blob); song.coverUrl = cu; song.cover = cu; patch.coverUrl = cu; patch.cover = cu; }
    if (source.lyric) { song.lyric = source.lyric; patch.lyric = source.lyric; }
    if (source.duration > 0) { song.duration = source.duration; patch.duration = source.duration; }
  } else if (sourceType === 'kugou') {
    // 从酷狗 API 结果构建 patch
    const { coverUrl, albumName, matchSinger, lyricText } = source;
    if (coverUrl && !song.coverUrl) { song.coverUrl = coverUrl; song.cover = coverUrl; patch.coverUrl = coverUrl; patch.cover = coverUrl; }
    if (albumName && !song.album) { song.album = albumName; song.albumName = albumName; patch.album = albumName; patch.albumName = albumName; }
    if (matchSinger && (!song.artist || song.artist === "未知歌手")) { song.artist = matchSinger; song.artists = [{ name: matchSinger }]; song.singers = [{ name: matchSinger }]; patch.artist = matchSinger; patch.artists = [{ name: matchSinger }]; patch.singers = [{ name: matchSinger }]; }
    if (lyricText && !song.lyric) { song.lyric = lyricText; patch.lyric = lyricText; }
  }
  
  return patch;
};

/**
 * 通过酷狗 API 搜索并补全歌曲元数据（异步 fire-and-forget，不阻塞播放）
 * 
 * 当文件嵌入标签（ID3v2/FLAC）解析失败时，作为第三优先级回退。
 * 使用 ctx.kugou 调用 EchoMusic 内置酷狗接口，无需额外鉴权。
 */
const enrichFromKugouApi = async (ctx, song) => {
  if (!song || !song.title || !ctx.kugou) return;
  const hasValidCover = song.coverUrl && /^https?:\/\//.test(song.coverUrl);
  if (hasValidCover && song.lyric) return;
  const artist = song.artist || "";
  const title = song.title;
  const keyword = artist && artist !== "未知歌手" ? `${artist} ${title}` : title;
  try {
    const result = await ctx.kugou.search.search(keyword, "song", 1, 5);
    const lists = result?.data?.lists || result?.data?.list || [];
    if (!lists.length) return;
    const match = lists[0];
    if (!match) return;
    const hasValidCoverAfterSearch = song.coverUrl && /^https?:\/\//.test(song.coverUrl);
    if (hasValidCoverAfterSearch && song.lyric) return;
    const fileHash = match.FileHash;
    const coverUrl = formatPicUrl(match.Image || match.trans_param?.union_cover || match.cover || "");
    const albumName = match.AlbumName || "";
    const matchSinger = match.SingerName || "";
    const kugouData = { coverUrl, albumName, matchSinger, lyricText: "" };
    if (fileHash && !song.lyric) {
      try {
        const lyricResult = await ctx.kugou.music.searchLyric(fileHash);
        const candidates = lyricResult?.candidates || lyricResult?.data?.candidates || [];
        const first = candidates[0];
        if (first?.id && first?.accesskey) {
          const lyricDetail = await ctx.kugou.music.getLyric(String(first.id), String(first.accesskey));
          const lyricText = lyricDetail?.decodeContent || lyricDetail?.content || lyricDetail?.data?.content;
          if (lyricText) kugouData.lyricText = lyricText;
        }
      } catch {}
    }
    const patch = buildPatchFromSource(song, kugouData, 'kugou');
    if (Object.keys(patch).length > 0) syncToStores(ctx, song.id, patch);
  } catch (err) {
    console.warn("[webdav-music] enrichFromKugouApi failed:", err.message);
  }
};

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
  const settings = state?.settings;
  let lib = null;
  if (song._libraryId && settings?.libraries) {
    lib = settings.libraries.find((l) => l.id === song._libraryId);
  }
  if (!lib && settings?.libraries?.length > 0) lib = settings.libraries[0];
  if (!lib) return song;
  _songLibraryCache.set(String(song.id), lib);
  detectAndSetQuality(ctx, { settings: lib }, song).catch(() => {});

  const coverLyricSource = settings.coverLyricSource || "embedded";
  if (coverLyricSource === "kugou") {
    await enrichFromKugouApi(ctx, song);
    const tags = await readEmbeddedTags(ctx, lib, song._filePath);
    if (tags) {
      const patch = buildPatchFromSource(song, tags, 'embedded');
      if (Object.keys(patch).length > 0) syncToStores(ctx, song.id, patch);
    }
  } else {
    const tags = await readEmbeddedTags(ctx, lib, song._filePath);
    if (!tags) { await enrichFromKugouApi(ctx, song); return song; }
    const patch = buildPatchFromSource(song, tags, 'embedded');
    syncToStores(ctx, song.id, patch);
    if (!tags.coverData || !tags.lyric) await enrichFromKugouApi(ctx, song);
  }
  return song;
};

/**
 * 检测音频音质（统一检测逻辑，供 audioSource.resolve 和 enrichTrack 使用）
 * @param {Object} settings - 插件设置
 * @param {string} filePath - 文件路径
 * @returns {Promise<string|null>} 音质标识
 */
/** 从文件扩展名检测音质（无需网络请求） */
const detectAudioQualityFromExtension = (filePath) => {
  if (!filePath) return null;
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "flac") return "flac";
  if (ext === "wav" || ext === "ape" || ext === "aiff" || ext === "alac" || ext === "wv") return "flac";
  if (ext === "dsf" || ext === "dff") return "super";
  if (ext === "mp3") return null; // MP3 需要读取头部检测比特率
  if (ext === "m4a" || ext === "aac") return "320"; // AAC/M4A 通常为 HQ
  return null;
};

const detectAudioQuality = async (settings, filePath) => {
  if (!filePath) return null;
  // 1) 优先使用扩展名检测（即时完成，无需网络请求）
  let quality = detectAudioQualityFromExtension(filePath);
  // 2) MP3 或无扩展名匹配时，尝试 Range 请求读取头部检测
  if (!quality) {
    try {
      const headBuf = await webdavFetchRaw(settings, filePath, { headers: { Range: "bytes=0-262143" } });
      if (headBuf?.ok) {
        const ab = await headBuf.arrayBuffer();
        const head = new Uint8Array(ab);
        quality = detectAudioQualityFromHead(head, filePath);
      }
    } catch (err) {
      console.warn("[webdav-music] detectAudioQuality Range request failed:", err.message);
    }
  }
  // 3) MP3 仍然检测失败时，默认设为 320
  if (!quality && filePath.toLowerCase().endsWith(".mp3")) {
    quality = "320";
  }
  return quality;
};

/** 检测音质并设置到播放器 store，锁定音质不可切换 */
const detectAndSetQuality = async (ctx, state, song) => {
  if (!state?.settings || !song._filePath || !ctx.stores?.player) return;
  const quality = await detectAudioQuality(state.settings, song._filePath);
  if (!quality) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  ctx.stores.player.currentResolvedAudioQuality = quality;
  ctx.stores.player.currentAudioQualityOverride = quality;
};

/* ---- Helpers ---- */
const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const settings = { ...DEFAULT_SETTINGS, ...source };
  
  // 向后兼容：如果旧的单库配置存在且 libraries 为空，自动迁移
  if ((!settings.libraries || settings.libraries.length === 0) && settings.serverUrl) {
    settings.libraries = [{
      id: "lib_1",
      name: "",
      serverUrl: settings.serverUrl,
      username: settings.username || "",
      password: settings.password || "",
      rootPath: settings.rootPath || "/",
    }];
    settings.activeLibraryId = "lib_1";
  }
  
  // 确保 libraries 是数组
  if (!Array.isArray(settings.libraries)) {
    settings.libraries = [];
  }
  
  // 确保 activeLibraryId 有效
  if (!settings.activeLibraryId && settings.libraries.length > 0) {
    settings.activeLibraryId = settings.libraries[0].id;
  }
  
  return settings;
};

/** 获取当前激活的库配置 */
const getActiveLibrary = (settings) => {
  if (!settings || !settings.libraries || settings.libraries.length === 0) return null;
  return settings.libraries.find((lib) => lib.id === settings.activeLibraryId) || settings.libraries[0];
};

/** 根据库 ID 获取库配置 */
const getLibraryById = (settings, libraryId) => {
  if (!settings || !settings.libraries) return null;
  return settings.libraries.find((lib) => lib.id === libraryId);
};

/** 生成唯一的库 ID */
const generateLibraryId = () => "lib_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
/** 将酷狗图片路径格式化为可用的 HTTPS URL */
const formatPicUrl = (value) => {
  if (!value) return "";
  let pic = String(value).replaceAll("{size}", "400");
  if (pic.startsWith("//")) pic = "https:" + pic;
  pic = pic.replace("http://", "https://");
  pic = pic.replace("c1.kgimg.com", "imge.kugou.com");
  return pic;
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
/** 从文件头部数据检测音质 */
const detectAudioQualityFromHead = (head, filePath = "") => {
  if (!head || head.length < 8) return null;
  // FLAC
  if (head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43) {
    // 跳过 "fLaC" + 4字节 BLOCK HEADER，进入 STREAMINFO 内容
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const blockSize = (head[5] << 16) | (head[6] << 8) | head[7];
    if (blockSize >= 34) {
      const bdv = new DataView(head.buffer, head.byteOffset + 8, blockSize);
      const sampleRate = (bdv.getUint16(10) << 4) | (bdv.getUint8(12) >> 4);
      const bps = (((bdv.getUint8(12) & 1) << 4) | (bdv.getUint8(13) >> 4)) + 1;
      if (sampleRate > 48000 || bps > 16) return "high";
    }
    return "flac";
  }
  // DSF
  if (head[0] === 0x44 && head[1] === 0x53 && head[2] === 0x44 && head[3] === 0x20) return "super";
  // DFF
  if (head[0] === 0x46 && head[1] === 0x52 && head[2] === 0x4D && head[3] === 0x38) return "super";
  // MP3：ID3v2 标签或裸 MPEG 帧
  let scanOff = 0;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    scanOff = 10 + ((dv.getUint8(6) << 21) | (dv.getUint8(7) << 14) | (dv.getUint8(8) << 7) | dv.getUint8(9));
  }
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let maxBitrate = 0;
  let framesFound = 0;
  while (scanOff + 4 <= head.length && framesFound < 3) {
    if (dv.getUint8(scanOff) === 0xFF && (dv.getUint8(scanOff + 1) & 0xE0) === 0xE0) {
      const h = dv.getUint32(scanOff);
      const ver = (h >> 19) & 0x3;
      const lay = (h >> 17) & 0x3;
      const idx = (h >> 12) & 0xF;
      if (ver !== 1 && lay !== 0 && idx !== 0 && idx !== 15) {
        let bitrate = 0;
        if (ver === 3) {
          const tbl = lay === 3 ? [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448] : lay === 2 ? [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384] : [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
          bitrate = tbl[idx];
        } else {
          const tbl = lay === 3 ? [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
          bitrate = tbl[idx];
        }
        if (bitrate > maxBitrate) maxBitrate = bitrate;
        framesFound++;
        // 计算下一帧偏移
        if (lay === 3) {
          const padding = (h >> 9) & 1;
          scanOff += (ver === 3 ? 384 : 192) * bitrate * 1000 / (dv.getUint16(scanOff + 2) >> 2) + padding;
          continue;
        }
      }
    }
    scanOff++;
  }
  if (maxBitrate > 0) return maxBitrate >= 320 ? "320" : "128";
  // 文件扩展名兜底
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  if (["wav","ape","aiff","alac"].includes(ext)) return "flac";
  if (["dsf","dff"].includes(ext)) return "super";
  return null;
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
  const { album = "WebDAV", coverUrl = "", libraryId = "" } = opts;
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
    _libraryId: libraryId,
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
<tr><td>在线匹配封面歌词</td><td>开启后使用酷狗搜索出的封面和歌词，关闭则优先使用歌曲内嵌的封面和歌词</td><td>关闭</td></tr>
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
<blockquote>编号前缀为行首的数字后跟 .、- 或空格，解析时会自动去除。如果文件名不符合上述格式，则整个文件名（不含扩展名）作为标题，歌手显示为「未知歌手」。若音频文件包含内嵌标签（ID3v2 / FLAC），解析后会以嵌入标签为准覆盖文件名解析结果。</blockquote>

<h2>封面与歌词获取</h2>
<p>插件支持两种封面和歌词获取模式，可在插件设置中切换：</p>
<h3>关闭「在线匹配封面歌词」（默认）</h3>
<p>优先使用歌曲内嵌数据，缺少时通过酷狗 API 补充：</p>
<ol>
<li>音频文件内嵌封面和歌词（ID3v2 / FLAC 标签）</li>
<li>目录下的封面图片文件（cover.jpg、folder.jpg 等）</li>
<li>酷狗 API 搜索补全缺失的封面或歌词</li>
<li>主应用兜底封面（跟随 cover-fallback 插件设置动态切换）</li>
</ol>
<h3>开启「在线匹配封面歌词」</h3>
<p>优先使用酷狗搜索结果，不保证封面和歌词的准确性：</p>
<ol>
<li>酷狗 API 搜索结果中的封面和歌词</li>
<li>音频文件内嵌数据补充酷狗未提供的字段</li>
<li>主应用兜底封面（跟随 cover-fallback 插件设置动态切换）</li>
</ol>

<h2>依赖</h2>
<p>EchoMusic &gt;= 2.2.6-beta.11</p>

<h2>作者</h2>
<p>Oneday5799</p>
</div>`;

/* ---- Settings UI ---- */
const createSettingsPanel = (ctx, state) => {
  const { defineAsyncComponent, defineComponent, h, reactive, ref, computed } = ctx.vue;
  const Input = defineAsyncComponent(ctx.ui.components.Input);
  const Button = defineAsyncComponent(ctx.ui.components.Button);
  const Switch = defineAsyncComponent(ctx.ui.components.Switch);
  const Tabs = defineAsyncComponent(ctx.ui.components.Tabs);
  const TabsList = defineAsyncComponent(ctx.ui.components.TabsList);
  const TabsTrigger = defineAsyncComponent(ctx.ui.components.TabsTrigger);
  const TabsContent = defineAsyncComponent(ctx.ui.components.TabsContent);

  return defineComponent({
    setup() {
      const draft = reactive({ ...DEFAULT_SETTINGS, ...state.settings });
      const activeTab = ref("settings");
      const expandedLibraries = ref(new Set());

      const save = async () => {
        const values = { ...draft };
        state.settings = values;
        await ctx.storage.set(STORAGE_KEY, values);
        ctx.toast.success("设置已保存");
      };

      const reset = () => {
        Object.assign(draft, { ...DEFAULT_SETTINGS, libraries: [], activeLibraryId: null });
      };

      const toggleLibrary = (libId) => {
        if (expandedLibraries.value.has(libId)) {
          expandedLibraries.value.delete(libId);
        } else {
          expandedLibraries.value.add(libId);
        }
      };

      const addLibrary = () => {
        const newId = generateLibraryId();
        draft.libraries.push(createDefaultLibrary(newId));
        expandedLibraries.value.add(newId);
      };

      const removeLibrary = (libId) => {
        const idx = draft.libraries.findIndex((lib) => lib.id === libId);
        if (idx >= 0) {
          draft.libraries.splice(idx, 1);
          expandedLibraries.value.delete(libId);
          if (draft.activeLibraryId === libId) {
            draft.activeLibraryId = draft.libraries[0]?.id || null;
          }
        }
      };

      const updateLibrary = (libId, key, value) => {
        const lib = draft.libraries.find((l) => l.id === libId);
        if (lib) lib[key] = value;
      };

      const formRow = (label, input, hint) =>
        h("div", { style: "display: flex; align-items: center; gap: 12px;" }, [
          h("label", { style: "width: 80px; flex-shrink: 0; font-size: 13px; color: var(--color-text-main); text-align: right;" }, label),
          h("div", { style: "flex: 1; display: flex; flex-direction: column; gap: 2px;" }, [
            input,
            hint ? h("span", { style: "font-size: 11px; color: var(--color-text-secondary); margin: 0;" }, hint) : null,
          ]),
        ]);

      const renderSwitchRow = (label, hint, modelValue, onUpdate) =>
        h("div", {
          style: "display: flex; align-items: center; justify-content: space-between; gap: 14px;",
        }, [
          h("div", { style: "display: grid; gap: 3px; min-width: 0;" }, [
            h("span", { style: "font-size: 13px; font-weight: 650; color: var(--color-text-main); margin: 0;" }, label),
            hint ? h("span", { style: "font-size: 12px; color: var(--color-text-secondary); margin: 0; line-height: 1.45;" }, hint) : null,
          ]),
          h(Switch, { modelValue, "onUpdate:modelValue": onUpdate }),
        ]);

      const renderLibraryCard = (lib) => {
        const isExpanded = expandedLibraries.value.has(lib.id);
        const displayName = lib.name || (lib.serverUrl ? new URL(lib.serverUrl).hostname : "未命名库");
        
        return h("div", {
          style: "border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden;",
        }, [
          // 折叠头
          h("div", {
            style: "display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; cursor: pointer; background: var(--control-muted-bg);",
            onClick: () => toggleLibrary(lib.id),
          }, [
            h("div", { style: "display: flex; align-items: center; gap: 8px;" }, [
              h("span", { style: "font-size: 13px; font-weight: 600; color: var(--color-text-main);" }, displayName),
              lib.serverUrl
                ? h("span", { style: "font-size: 11px; color: var(--color-text-secondary);" }, new URL(lib.serverUrl).hostname)
                : null,
            ]),
            h("span", {
              style: `font-size: 12px; color: var(--color-text-secondary); transition: transform 0.2s; transform: rotate(${isExpanded ? "180deg" : "0deg"});`,
            }, "▼"),
          ]),
          // 展开内容
          isExpanded
            ? h("div", { style: "padding: 12px; display: grid; gap: 10px; background: var(--color-bg-elevated);" }, [
                formRow("名称", h(Input, {
                  modelValue: lib.name,
                  placeholder: "留空则显示根目录名称",
                  "onUpdate:modelValue": (v) => updateLibrary(lib.id, "name", String(v ?? "")),
                }), "显示在浏览页面的标签页名称"),
                formRow("地址", h(Input, {
                  modelValue: lib.serverUrl,
                  placeholder: "https://webdav.example.com",
                  "onUpdate:modelValue": (v) => updateLibrary(lib.id, "serverUrl", String(v ?? "")),
                })),
                formRow("用户名", h(Input, {
                  modelValue: lib.username,
                  placeholder: "可选，留空表示无需认证",
                  "onUpdate:modelValue": (v) => updateLibrary(lib.id, "username", String(v ?? "")),
                })),
                formRow("密码", h(Input, {
                  modelValue: lib.password,
                  placeholder: "可选",
                  type: "password",
                  "onUpdate:modelValue": (v) => updateLibrary(lib.id, "password", String(v ?? "")),
                })),
                formRow("根目录", h(Input, {
                  modelValue: lib.rootPath,
                  placeholder: "/",
                  "onUpdate:modelValue": (v) => updateLibrary(lib.id, "rootPath", String(v ?? "/")),
                }), "浏览音乐文件的起始路径，默认为根目录 /"),
                h("div", { style: "display: flex; justify-content: flex-end;" }, [
                  h(Button, {
                    size: "xs",
                    variant: "outline",
                    onClick: () => removeLibrary(lib.id),
                  }, { default: () => "删除此库" }),
                ]),
              ])
            : null,
        ]);
      };

      return () =>
        h("div", { style: "display: flex; flex-direction: column;" }, [
          h(Tabs, { modelValue: activeTab.value, "onUpdate:modelValue": (v) => { activeTab.value = v; }, style: "flex: 1; min-height: 0; overflow: hidden;" }, {
            default: () => [
              h(TabsList, {}, { default: () => [
                h(TabsTrigger, { value: "settings" }, { default: () => "设置" }),
                h(TabsTrigger, { value: "about" }, { default: () => "关于" }),
              ]}),
              h(TabsContent, { value: "settings" }, { default: () =>
                h("div", { style: "max-height: 55vh; overflow-y: auto; display: grid; gap: 16px; align-content: start; padding-top: 8px;" }, [
                  // WebDAV 库列表
                  h("div", { style: "display: grid; gap: 8px;" }, [
                    h("div", { style: "display: flex; align-items: center; justify-content: space-between;" }, [
                      h("span", { style: "font-size: 14px; font-weight: 600; color: var(--color-text-main);" }, "WebDAV 库"),
                      h(Button, {
                        size: "xs",
                        variant: "outline",
                        onClick: addLibrary,
                      }, { default: () => "+ 添加库" }),
                    ]),
                    draft.libraries.length === 0
                      ? h("p", { style: "font-size: 12px; color: var(--color-text-secondary); text-align: center; padding: 16px;" }, "暂无 WebDAV 库，点击上方按钮添加")
                      : h("div", { style: "display: grid; gap: 8px;" }, draft.libraries.map((lib) => renderLibraryCard(lib))),
                  ]),
                  // 全局设置
                  h("div", { style: "border-top: 1px solid var(--border-subtle); padding-top: 12px;" }, [
                    h("span", { style: "font-size: 14px; font-weight: 600; color: var(--color-text-main); display: block; margin-bottom: 8px;" }, "全局设置"),
                    renderSwitchRow(
                      "在线匹配封面歌词",
                      "开启后使用酷狗搜索出的封面和歌词，关闭则优先使用歌曲内嵌的封面和歌词",
                      draft.coverLyricSource === "kugou",
                      (v) => { draft.coverLyricSource = v ? "kugou" : "embedded"; },
                    ),
                  ]),
                ]),
              }),
              h(TabsContent, { value: "about" }, { default: () =>
                h("div", { style: "padding-top: 8px; max-height: 55vh; overflow-y: auto;", innerHTML: ABOUT_HTML })
              }),
            ],
          }),
          // 按钮行（sticky 固定底部）
          h("div", { style: "display: flex; gap: 8px; justify-content: flex-end; padding: 12px 0 0; flex-shrink: 0; position: sticky; bottom: 0; background: inherit; z-index: 1;" }, [
            h(Button, { size: "xs", onClick: reset, variant: "outline" }, { default: () => "重置" }),
            h(Button, { size: "xs", onClick: save }, { default: () => "保存" }),
          ]),
        ]);
    },
  });
};

/* ---- Browser Page ---- */
const createBrowserPage = (ctx, state) => {
  const { h, ref, computed, onMounted, watch, nextTick, defineAsyncComponent, Teleport } = ctx.vue;

  return ctx.vue.defineComponent({
    setup() {
      const Icon = ctx.vue.resolveComponent("Icon");
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      
      // 当前激活的库
      const activeLibraryId = ref(state.settings.activeLibraryId || null);
      const currentPath = ref("");
      const entries = ref([]);
      const loading = ref(false);
      const error = ref("");
      const coverCache = ref({});
      const searchQuery = ref("");
      const sortTick = ref(0);
      const libraryPaths = ref({});
      const librarySongCounts = ref({});

      const currentLibrary = computed(() => {
        if (!state.settings.libraries || state.settings.libraries.length === 0) return null;
        return state.settings.libraries.find((lib) => lib.id === activeLibraryId.value) || state.settings.libraries[0];
      });

      const handleSort = (field) => {
        if (_sortField === field) {
          if (_sortOrder === 'asc') _sortOrder = 'desc';
          else if (_sortOrder === 'desc') { _sortField = null; _sortOrder = null; }
          else _sortOrder = 'asc';
        } else {
          _sortField = field;
          _sortOrder = 'asc';
        }
        sortTick.value++;
      };

      const sortedEntries = computed(() => {
        void sortTick.value;
        const dirs = entries.value.filter((e) => e.isCollection);
        const files = entries.value.filter((e) => !e.isCollection);
        if (!_sortField || !_sortOrder) return [...dirs, ...files];
        const sortedFiles = [...files].sort((a, b) => {
          let cmp = 0;
          if (_sortField === 'name') cmp = a.name.localeCompare(b.name);
          else if (_sortField === 'title') {
            const { title: ta } = parseTitleArtist(a.name);
            const { title: tb } = parseTitleArtist(b.name);
            cmp = (ta || a.name).localeCompare(tb || b.name);
          } else if (_sortField === 'size') cmp = (a.contentLength || 0) - (b.contentLength || 0);
          return _sortOrder === 'desc' ? -cmp : cmp;
        });
        return [...dirs, ...sortedFiles];
      });

      // 右键菜单
      const contextMenu = ref(null);
      const contextMenuRef = ref(null);
      const contextMenuPosition = ref({ x: 0, y: 0 });
      let contextMenuPoint = null;

      const updateContextMenuPosition = () => {
        if (!contextMenuPoint) return;
        const menuEl = contextMenuRef.value;
        const width = menuEl?.offsetWidth || 172;
        const height = menuEl?.offsetHeight || 120;
        const padding = 8;
        const bottomPadding = 96;
        const maxX = Math.max(padding, window.innerWidth - width - padding);
        const maxY = Math.max(padding, window.innerHeight - height - bottomPadding);
        contextMenuPosition.value = {
          x: Math.round(Math.min(Math.max(contextMenuPoint.x, padding), maxX)),
          y: Math.round(Math.min(Math.max(contextMenuPoint.y, padding), maxY)),
        };
      };

      const showContextMenu = (event, entry, isDir) => {
        event.preventDefault();
        event.stopPropagation();
        contextMenu.value = { entry, isDir };
        contextMenuPoint = { x: event.clientX, y: event.clientY };
        contextMenuPosition.value = contextMenuPoint;
        nextTick(updateContextMenuPosition);
      };
      const closeContextMenu = () => { contextMenu.value = null; contextMenuPoint = null; };

      const handleCtxPlayNow = async () => {
        const ctxMenu = contextMenu.value;
        if (!ctxMenu) return;
        contextMenu.value = null;
        if (ctxMenu.isDir) await playFolder(normalizeDir(currentPath.value) + ctxMenu.entry.name + "/");
        else await playSong(ctxMenu.entry);
      };

      const handleCtxPlayNext = async () => {
        const ctxMenu = contextMenu.value;
        if (!ctxMenu) return;
        contextMenu.value = null;
        if (ctxMenu.isDir) {
          const normDir = normalizeDir(currentPath.value);
          const folderPath = normDir + ctxMenu.entry.name + "/";
          const folderName = ctxMenu.entry.name;
          try {
            const lib = currentLibrary.value;
            if (!lib) return;
            const results = await propfind(ctx, lib, folderPath);
            const files = results.filter((e) => !e.isCollection && isAudioFile(e.name)).sort((a, b) => a.name.localeCompare(b.name));
            if (files.length === 0) { ctx.toast.info("文件夹内没有音乐文件"); return; }
            const coverFiles = results.filter((e) => !e.isCollection && isCoverFile(e.name));
            let coverUrl = "";
            if (coverFiles.length > 0) {
              try {
                const coverRes = await fetch(joinUrl(lib.serverUrl, folderPath + coverFiles[0].name), buildAuthHeader(lib) ? { headers: { Authorization: buildAuthHeader(lib) } } : {});
                if (coverRes.ok) coverUrl = URL.createObjectURL(await coverRes.blob());
              } catch {}
            }
            const songs = files.map((entry) => createSongObject(entry.name, folderPath + entry.name, { album: folderName, coverUrl, libraryId: lib.id }));
            ctx.playlist.append(songs);
            ctx.toast.success(`已添加 ${songs.length} 首到队列`);
          } catch (err) { ctx.toast.danger("读取文件夹失败"); }
        } else {
          const song = createSong(ctxMenu.entry, currentPath.value);
          if (!song) return;
          if (String(song.id) === String(ctx.player.currentTrackId ?? '')) { ctx.toast.info("当前正在播放此歌曲"); return; }
          ctx.playlist.playNext(song);
          ctx.toast.success(`已添加「${song.title}」到下一首`);
        }
      };

      const breadcrumbs = computed(() => {
        if (!currentLibrary.value) return [];
        const rootPath = normalizeDir(currentLibrary.value.rootPath || "/");
        const raw = currentPath.value.replace(/\/+/g, "/");
        const rel = raw.startsWith(rootPath) ? raw.slice(rootPath.length) : raw.slice(1);
        const parts = rel.split("/").filter(Boolean);
        const rootName = currentLibrary.value.name || rootPath.slice(0, -1).split("/").filter(Boolean).pop() || "根目录";
        const crumbs = [{ name: rootName, path: rootPath }];
        let acc = rootPath;
        for (const part of parts) { acc = acc.replace(/\/+$/, "") + "/" + part + "/"; crumbs.push({ name: part, path: acc }); }
        return crumbs;
      });

      const loadDirectory = async (path) => {
        const lib = currentLibrary.value;
        if (!lib) return;
        loading.value = true; error.value = ""; entries.value = [];
        try {
          const dirPath = normalizeDir(path);
          const results = await propfind(ctx, lib, dirPath);
          const selfName = dirPath.slice(0, -1).split("/").filter(Boolean).pop() || "";
          const dirs = results.filter((e) => e.isCollection && e.name && e.name !== selfName).sort((a, b) => a.name.localeCompare(b.name));
          const files = results.filter((e) => !e.isCollection && isAudioFile(e.name)).sort((a, b) => a.name.localeCompare(b.name));
          const coverFiles = results.filter((e) => !e.isCollection && isCoverFile(e.name));
          if (coverFiles.length > 0) {
            const coverUrl = joinUrl(lib.serverUrl, dirPath + coverFiles[0].name);
            const authHeader = buildAuthHeader(lib);
            try {
              const res = await fetch(coverUrl, authHeader ? { headers: { Authorization: authHeader } } : {});
              if (res.ok) {
                const blob = await res.blob();
                coverCache.value[dirPath] = URL.createObjectURL(blob);
              }
            } catch {}
          }
          entries.value = [...dirs, ...files];
          librarySongCounts.value[lib.id] = files.length;
        } catch (err) { error.value = "加载目录失败: " + (err.message || "未知错误"); }
        finally { loading.value = false; }
      };

      const navigateTo = (path) => {
        const lib = currentLibrary.value;
        if (lib) libraryPaths.value[lib.id] = normalizeDir(path);
        currentPath.value = normalizeDir(path);
        loadDirectory(currentPath.value);
      };

      const navigateUp = () => {
        const lib = currentLibrary.value;
        if (!lib) return;
        const rootPath = normalizeDir(lib.rootPath || "/");
        const cleaned = normalizeDir(currentPath.value).replace(/\/$/, "");
        if (cleaned === rootPath.replace(/\/$/, "") || cleaned === "") { navigateTo(rootPath); return; }
        const parent = cleaned.slice(0, cleaned.lastIndexOf("/")) + "/";
        navigateTo(parent.startsWith(rootPath) ? parent : rootPath);
      };

      const refresh = () => loadDirectory(currentPath.value);

      const switchLibrary = (libId) => {
        activeLibraryId.value = libId;
        state.settings.activeLibraryId = libId;
        const lib = state.settings.libraries.find((l) => l.id === libId);
        if (lib) {
          const savedPath = libraryPaths.value[libId];
          const rootPath = normalizeDir(lib.rootPath || "/");
          currentPath.value = savedPath || rootPath;
          loadDirectory(currentPath.value);
        }
      };

      const createSong = (entry, dirPath) => {
        const lib = currentLibrary.value;
        if (!lib) return null;
        const normDir = normalizeDir(dirPath);
        const album = currentPath.value.split("/").filter(Boolean).pop() || "WebDAV";
        return createSongObject(entry.name, normDir + entry.name, { album, coverUrl: coverCache.value[normDir] || "", libraryId: lib.id });
      };

      const enrichSong = async (song) => { if (!song._filePath) return song; return enrichTrack(ctx, state, song); };
      const getSongs = () => sortedEntries.value.filter((e) => !e.isCollection).map((e) => createSong(e, currentPath.value)).filter(Boolean);

      const playSong = async (entry) => {
        let song = createSong(entry, currentPath.value);
        if (!song) return;
        enrichSong(song).catch(() => {});
        try {
          await ctx.player.replaceQueueAndPlay([song]);
        } catch (err) { ctx.toast.danger("播放失败"); }
      };

      const handleDoubleTapPlay = async (entry) => {
        let song = createSong(entry, currentPath.value);
        if (!song) return;
        enrichSong(song).catch(() => {});
        const replace = ctx.stores.settings?.replacePlaylist;
        try {
          if (replace) {
            await ctx.player.replaceQueueAndPlay(getSongs(), { requestedSong: song });
          } else {
            const activeQueue = ctx.playlist.activeQueue;
            let queueSongs = activeQueue?.songs?.length > 0 ? [...activeQueue.songs] : [];
            if (!queueSongs.some((s) => String(s.id) === String(song.id))) queueSongs.push(song);
            await ctx.player.replaceQueueAndPlay(queueSongs, { requestedSong: song });
          }
        } catch (err) { ctx.toast.danger("播放失败"); }
      };

      const playAll = async () => {
        const songs = getSongs();
        if (songs.length === 0) return;
        enrichSong(songs[0]).catch(() => {});
        try {
          await ctx.player.replaceQueueAndPlay(songs);
        } catch (err) { ctx.toast.danger("播放失败"); }
      };

      const playFolder = async (folderPath) => {
        const lib = currentLibrary.value;
        if (!lib) return;
        const normDir = normalizeDir(folderPath);
        const folderName = normDir.slice(0, -1).split("/").filter(Boolean).pop() || "WebDAV";
        let results;
        try { results = await propfind(ctx, lib, normDir); }
        catch (err) { ctx.toast.danger("无法读取文件夹"); return; }
        const files = results.filter((e) => !e.isCollection && isAudioFile(e.name)).sort((a, b) => a.name.localeCompare(b.name));
        if (files.length === 0) { ctx.toast.info("文件夹内没有音乐文件"); return; }
        const coverFiles = results.filter((e) => !e.isCollection && isCoverFile(e.name));
        let coverUrl = "";
        if (coverFiles.length > 0) {
          try {
            const coverRes = await fetch(joinUrl(lib.serverUrl, normDir + coverFiles[0].name), buildAuthHeader(lib) ? { headers: { Authorization: buildAuthHeader(lib) } } : {});
            if (coverRes.ok) coverUrl = URL.createObjectURL(await coverRes.blob());
          } catch {}
        }
        const songs = files.map((entry) => createSongObject(entry.name, normDir + entry.name, { album: folderName, coverUrl, libraryId: lib.id }));
        enrichSong(songs[0]).catch(() => {});
        try {
          await ctx.player.replaceQueueAndPlay(songs);
        } catch (err) { ctx.toast.danger("播放失败"); }
      };

      onMounted(() => {
        if (currentLibrary.value) {
          activeLibraryId.value = currentLibrary.value.id;
          const rootPath = normalizeDir(currentLibrary.value.rootPath || "/");
          currentPath.value = libraryPaths.value[currentLibrary.value.id] || rootPath;
          loadDirectory(currentPath.value);
        }
      });

      const hasLibraries = computed(() => state.settings.libraries && state.settings.libraries.length > 0);

      return () => {
        if (!hasLibraries.value) {
          return h("div", { class: "webdav-page" }, [
            h("div", { class: "webdav-empty" }, [
              h("p", { class: "webdav-empty-title" }, "未配置 WebDAV 库"),
              h("p", { class: "webdav-empty-desc" }, "请在插件设置中添加 WebDAV 库后使用。"),
            ]),
          ]);
        }

        const songCount = entries.value.filter((e) => !e.isCollection).length;

        return h("div", { class: "webdav-page" }, [
          // === SliverHeader 风格头部（展开状态） ===
          h("div", { class: "flex items-start gap-5 px-6 flex-shrink-0", style: "background: var(--color-bg-main); padding-top: 10px;" }, [
            // 左侧大图标 (150x150)
            h("div", { class: "flex items-center justify-center flex-shrink-0 overflow-hidden", style: "width: 150px; height: 150px; background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 50%, white)); border-radius: 21px;" }, [
              h(Icon, { icon: "tabler:server", width: 80, height: 80, color: "white" }),
            ]),
            // 右侧信息列（与封面等高，flex-1 可正确撑开）
            h("div", { class: "flex-1 min-w-0 flex flex-col", style: "height: 150px;" }, [
              // 标题行（顶部，shrink-0）
              h("div", { class: "flex items-center justify-between gap-3 shrink-0" }, [
                h("h1", { class: "flex-1 min-w-0 text-[24px] font-bold text-text-main leading-tight truncate m-0" }, "WebDAV"),
                h("div", { class: "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[1.2px] uppercase", style: "background: color-mix(in srgb, var(--color-primary) 8%, transparent); color: var(--color-primary); border: 0.5px solid color-mix(in srgb, var(--color-primary) 20%, transparent);" }, "WEBDAV"),
              ]),
              // 详情区域（flex-1 撑满中间，justify-center 垂直居中，8px 上下间距）
              h("div", { class: "flex-1 min-h-0 flex flex-col justify-center", style: "padding-top: 8px; padding-bottom: 8px;" }, [
                h("div", { class: "flex flex-col gap-2" }, [
                  h("div", { class: "text-[13px] font-semibold text-text-secondary" }, "连接WebDAV 服务器，浏览和播放云端音乐文件"),
                  h("div", { class: "inline-flex items-center gap-1.5 text-[11px] font-semibold", style: "color: var(--color-text-secondary); opacity: 0.8;" }, [
                    h(Icon, { icon: "tabler:server", width: 12, height: 12 }),
                    h("span", {}, `${songCount} 首歌曲`),
                  ]),
                ]),
              ]),
              // 操作按钮行（贴底，shrink-0）
              h("div", { class: "shrink-0 flex flex-wrap gap-2" }, [
                h("button", {
                  class: "inline-flex items-center gap-2 px-3 h-9 rounded-lg text-[12px] font-semibold transition-all active:scale-95 select-none bg-primary text-white border-none cursor-pointer",
                  onClick: playAll,
                }, [
                  h(Icon, { icon: ctx.icons.iconPlay, width: 16, height: 16 }),
                  h("span", {}, "播放"),
                ]),
                h("button", {
                  class: "inline-flex items-center gap-2 px-3 h-9 rounded-lg text-[12px] font-semibold transition-all active:scale-95 select-none border-none cursor-pointer",
                  style: { background: "var(--bg-info-card)", color: "var(--color-text-main)" },
                  onClick: () => ctx.toast.info("批量操作功能开发中"),
                }, [
                  h(Icon, { icon: ctx.icons.iconList, width: 16, height: 16 }),
                  h("span", {}, "批量"),
                ]),
              ]),
            ]),
          ]),

          // === 间距（仿主应用 SliverHeader expandedHeight 中图标底部16px剩余空间） ===
          h("div", { style: "height: 16px;" }),

          // === 库标签栏（仿主应用 Tabs 吸顶效果） ===
          h("div", { class: "sticky z-110", style: "background: var(--color-bg-main);" }, [
            h("div", { class: "px-6", style: "border-bottom: 1px solid var(--border-subtle);" }, [
              h("div", { class: "flex items-center justify-between h-14" }, [
                h("div", { class: "flex items-center gap-8" },
                  state.settings.libraries.map((library) => {
                    const isActive = library.id === activeLibraryId.value;
                    const displayName = library.name || "未命名库";
                    const count = librarySongCounts.value[library.id] || 0;
                    return h("button", {
                      class: "relative h-full flex items-end pb-1 text-[15px] font-bold text-text-main bg-none border-none cursor-pointer whitespace-nowrap select-none",
                      style: {
                        opacity: isActive ? "1" : "0.6",
                        transition: "opacity 0.2s",
                      },
                      onClick: () => switchLibrary(library.id),
                    }, [
                      h("span", { class: "relative" }, [
                        h("span", {}, displayName),
                        count >= 0
                          ? h("span", {
                              class: "absolute -top-1.5 -right-5 inline-flex min-w-[16px] h-4 items-center justify-center px-1 rounded-full text-[9px] font-bold tabular-nums shadow-sm select-none pointer-events-none",
                              style: { background: "light-dark(#000, #fff)", color: "light-dark(#fff, #000)" },
                            }, count)
                          : null,
                      ]),
                      h("div", {
                        class: ["absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 bg-primary rounded-full transition-all duration-300", isActive ? "w-6" : "w-0"],
                      }),
                    ]);
                  }),
                ),
                h("div", { class: "flex items-center gap-2 flex-shrink-0" }, [
                  // 搜索框（仿主应用 song-search-input 样式）
                  h("div", { class: "relative" }, [
                    h(Icon, { icon: ctx.icons.iconSearch, width: 14, height: 14, class: "absolute left-2.5 top-1/2 -translate-y-1/2", style: { color: "var(--color-text-main)", opacity: "0.6", pointerEvents: "none" } }),
                    h("input", {
                      class: "w-52 h-9 pl-8 pr-3 rounded-lg text-text-main placeholder:text-text-main/50 outline-none text-[12px] transition-all",
                      style: { background: "var(--color-bg-elevated)" },
                      type: "text",
                      placeholder: "搜索歌曲...",
                      value: searchQuery.value,
                      onInput: (e) => { searchQuery.value = e.target.value; },
                    }),
                  ]),
                  // 定位按钮（仿主应用 song-locate-btn 样式）
                  h(Button, {
                    variant: "unstyled",
                    size: "none",
                    class: "song-locate-btn p-2 rounded-lg",
                    title: "定位当前播放",
                    onClick: () => ctx.toast.info("定位功能开发中"),
                  }, { default: () => h(Icon, { icon: ctx.icons.iconCurrentLocation, width: 18, height: 18 }) }),
                ]),
              ]),
            ]),
          ]),

          // === 面包屑 + 导航按钮 ===
          h("div", { class: "flex items-center justify-between flex-shrink-0 px-6 py-1" }, [
            h("div", { class: "flex items-center flex-wrap gap-0.5" },
              breadcrumbs.value.map((crumb, index) => {
                const items = [];
                if (index > 0) items.push(h("span", { class: "text-[var(--color-text-disabled)] mx-0.5 select-none" }, "/"));
                items.push(h("button", {
                  class: "bg-none border-none px-1.5 py-0.5 rounded text-[13px] cursor-pointer transition-all",
                  style: {
                    color: index === breadcrumbs.value.length - 1 ? "var(--color-text-main)" : "var(--color-text-subtle)",
                    fontWeight: index === breadcrumbs.value.length - 1 ? "600" : "400",
                  },
                  onClick: () => navigateTo(crumb.path),
                }, crumb.name));
                return items;
              }).flat(),
            ),
            h("div", { class: "flex items-center gap-1" }, [
              h("button", { class: "webdav-nav-btn", title: "返回上级", onClick: navigateUp }, [
                h(Icon, { icon: ctx.icons.iconArrowLeft, width: 18, height: 18 }),
              ]),
              h("button", { class: "webdav-nav-btn", title: "刷新", onClick: refresh }, [
                h(Icon, { icon: ctx.icons.iconRefreshCw, width: 18, height: 18 })
              ]),
            ]),
          ]),

          // === 分割线（与面包屑之间的分隔） ===
          h("hr", { class: "m-0 border-none flex-shrink-0", style: "border-top: 1px solid var(--border-subtle); height: 0;" }),
          // === 列表表头（固定，不随内容滚动） ===
          h("div", { class: "webdav-list-header flex-shrink-0" }, [
            h("div", { class: ["webdav-col-index", _sortField === 'name' ? 'is-sorted' : ''], onClick: () => handleSort('name') }, [
              "#",
              h(Icon, { class: "sort-icon", icon: _sortField === 'name' ? (_sortOrder === 'asc' ? ctx.icons.iconSortUp : ctx.icons.iconSortDown) : ctx.icons.iconChevronUpDown, width: 14, height: 14 }),
            ]),
            h("div", { class: ["webdav-col-song", _sortField === 'title' ? 'is-sorted' : ''], onClick: () => handleSort('title') }, [
              "歌曲",
              h(Icon, { class: "sort-icon", icon: _sortField === 'title' ? (_sortOrder === 'asc' ? ctx.icons.iconSortUp : ctx.icons.iconSortDown) : ctx.icons.iconChevronUpDown, width: 14, height: 14 }),
            ]),
            h("div", { class: ["webdav-col-size", _sortField === 'size' ? 'is-sorted' : ''], onClick: () => handleSort('size') }, [
              "大小",
              h(Icon, { class: "sort-icon", icon: _sortField === 'size' ? (_sortOrder === 'asc' ? ctx.icons.iconSortUp : ctx.icons.iconSortDown) : ctx.icons.iconChevronUpDown, width: 14, height: 14 }),
            ]),
          ]),
          // === 可滚动内容区域（仅歌曲行） ===
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
                  : h("div", { class: "webdav-list" },
                        sortedEntries.value.map((entry, idx) => {
                          const isDir = entry.isCollection;
                          const fileIdx = isDir ? null : sortedEntries.value.filter((e, i) => i <= idx && !e.isCollection).length;
                          const filePath = normalizeDir(currentPath.value) + entry.name;
                          const songId = generateSongId(filePath);
                          const isActive = !isDir && String(ctx.stores.player.currentTrackId) === String(songId);
                          const { artist, title } = isDir ? { artist: "", title: "" } : parseTitleArtist(entry.name);
                          return h("div", {
                            class: ["webdav-row", isDir ? "webdav-row-dir" : "", isActive ? "is-active" : ""],
                            onDblclick: isDir ? () => navigateTo(filePath + "/") : () => handleDoubleTapPlay(entry),
                            onContextmenu: (e) => showContextMenu(e, entry, isDir),
                          }, [
                            // 索引列
                            h("div", { class: "webdav-col-index" }, [
                              !isDir ? [
                                isActive
                                  ? h("div", { class: "webdav-index-active" }, [h(Icon, { icon: ctx.icons.iconPlayerPlay, width: 14, height: 14 })])
                                  : [
                                      h("span", { class: "webdav-index-num" }, fileIdx),
                                      h("div", { class: "webdav-index-play", onClick: (e) => { e.stopPropagation(); playSong(entry); } }, [h(Icon, { icon: ctx.icons.iconPlayerPlay, width: 14, height: 14 })]),
                                    ],
                              ] : [
                                h("div", { class: "webdav-index-folder-play", onClick: (e) => { e.stopPropagation(); playFolder(filePath + "/"); }, title: "播放此文件夹" }, [h(Icon, { icon: ctx.icons.iconPlayerPlay, width: 14, height: 14 })]),
                              ],
                            ]),
                            // 歌曲列（封面 + 信息）
                            h("div", { class: "webdav-col-song" }, [
                              h("div", { class: ["webdav-cover", isDir ? "webdav-cover-dir" : ""] }, [
                                isDir
                                  ? h("svg", { viewBox: "0 0 1024 1024", width: 22, height: 22, class: "webdav-folder-icon", innerHTML: '<path d="M947.2 969.728h-870.4c-42.496 0-76.8-34.304-76.8-76.8V131.072c0-42.496 34.304-76.8 76.8-76.8h449.024c42.496 0 76.8 34.304 76.8 76.8v68.608c0 14.336 11.264 25.6 25.6 25.6H947.2c42.496 0 76.8 34.304 76.8 76.8v590.848c0 42.496-34.304 76.8-76.8 76.8z m-870.4-864.256c-14.336 0-25.6 11.264-25.6 25.6v762.368c0 14.336 11.264 25.6 25.6 25.6h870.4c14.336 0 25.6-11.264 25.6-25.6V302.08c0-14.336-11.264-25.6-25.6-25.6h-318.976c-42.496 0-76.8-34.304-76.8-76.8v-68.608c0-14.336-11.264-25.6-25.6-25.6H76.8z" fill="#ffffff"/><path d="M948.224 155.136h-263.68c-14.336 0-25.6-11.264-25.6-25.6s11.264-25.6 25.6-25.6h263.68c14.336 0 25.6 11.264 25.6 25.6s-11.776 25.6-25.6 25.6z" fill="#ffffff"/>' })
                                  : h("img", { src: _fallbackCoverUrlRef.value, class: "webdav-cover-img", alt: "cover" }),
                              ]),
                              h("div", { class: "webdav-song-info" }, [
                                h("span", { class: "webdav-song-title" }, isDir ? entry.name : (title || entry.name)),
                                !isDir ? h("span", { class: "webdav-song-artist" }, artist || "未知歌手") : null,
                              ]),
                            ]),
                            // 大小列
                            h("div", { class: "webdav-col-size" }, isDir ? "" : formatSize(entry.contentLength)),
                          ]);
                        }),
                      ),
          ]),
          // 右键菜单（Teleport 到 body，与主应用一致，避免 position:fixed 受父级影响）
          contextMenu.value ? [
            h("div", { class: "webdav-context-overlay", onMousedown: closeContextMenu }),
            h(Teleport, { to: "body" }, [
              h("div", { ref: contextMenuRef, class: "webdav-context-menu", style: { left: contextMenuPosition.value.x + "px", top: contextMenuPosition.value.y + "px" } }, [
                h("div", { class: "webdav-context-item", onClick: handleCtxPlayNow }, "立即播放"),
                h("div", { class: "webdav-context-item", onClick: handleCtxPlayNext }, "下一首播放"),
              ]),
            ]),
          ] : null,
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
  const _unhandledHandler = (event) => {
    console.error("[webdav-music] Unhandled rejection:", event.reason);
  };
  window.addEventListener("unhandledrejection", _unhandledHandler);
  ctx.dispose(() => window.removeEventListener("unhandledrejection", _unhandledHandler));
  const saved = await ctx.storage.get(STORAGE_KEY);
  state = ctx.vue.reactive({ settings: normalizeSettings(saved) });

  ctx.player.audioSource.register({
    id: "webdav",
    match: (context) => context.track.source === "webdav" && !!context.track._filePath,
    resolve: async (context) => {
      const settings = state?.settings;
      if (!settings) return null;
      const track = context.track;
      const filePath = track._filePath;
      let lib = null;
      if (track._libraryId) lib = settings.libraries?.find((l) => l.id === track._libraryId);
      if (!lib && settings.libraries?.length > 0) lib = settings.libraries[0];
      if (!lib) return null;
      const url = buildAuthUrl(lib, filePath);
      const quality = await detectAudioQuality(lib, filePath);
      if (quality) return { url, quality };
      return url;
    },
  });

  ctx.vue.watch(
    () => ctx.stores.player.currentTrackId,
    (trackId) => {
      if (!trackId) return;
      const track = ctx.stores.player.currentTrackSnapshot;
      if (!track || track.source !== "webdav" || !track._filePath) return;
      const sid = String(trackId);
      if (_pendingEnrichment.has(sid)) return;
      const promise = enrichTrack(ctx, state, track).catch(() => {});
      _pendingEnrichment.set(sid, promise);
      promise.finally(() => _pendingEnrichment.delete(sid));
    },
    { immediate: true },
  );

  ctx.lyrics.registerResolver({
    id: "webdav-embedded",
    match: (context) => {
      const track = context.track;
      return track?.source === "webdav" && !!track?._filePath;
    },
    resolve: async (context) => {
      const hash = context.hash;
      const cached = _enrichedLyrics.get(hash);
      if (cached) return { decodeContent: cached };
      const pending = _pendingEnrichment.get(hash);
      if (pending) {
        await Promise.race([pending, new Promise((r) => setTimeout(r, 3000))]);
        const result = _enrichedLyrics.get(hash);
        if (result) return { decodeContent: result };
      }
      return null;
    },
  });

  _fallbackCoverUrlRef = ctx.vue.ref(DEFAULT_COVER_URL);

  if (typeof BroadcastChannel === "function") {
    _bcChannel = new BroadcastChannel("echo-plugin:cover-fallback:settings");
    _bcChannel.onmessage = (event) => {
      const payload = event.data;
      if (payload && payload.type === "settings" && payload.settings) {
        _fallbackCoverUrlRef.value = computeFallbackCoverUrl(payload.settings);
      }
    };
    ctx.dispose(() => { _bcChannel?.close(); _bcChannel = null; });
  }

  ctx.ui.settings.define({
    title: "WebDAV 音乐",
    description: "连接 WebDAV 服务器，浏览和播放云端音乐文件。",
    component: createSettingsPanel(ctx, state),
  });

  const BrowserPage = createBrowserPage(ctx, state);
  ctx.ui.addPage({
    id: "browser",
    title: "WebDAV",
    icon: "tabler:server",
    component: BrowserPage,
    sidebar: true,
  });

  ctx.dispose(() => { state = null; });
  ctx.toast.success(`${ctx.manifest.name} 已启用`);
}

export function deactivate(_ctx) {
  state = null;
}
