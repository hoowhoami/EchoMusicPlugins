const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const asNumber = (value) => {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : 0;
};

const asString = (value) => String(value ?? "").trim();

// ctx.dom.observe 是新宿主提供的便利封装；旧宿主缺少时，用文档级观察器保留基础兼容性。
const observeSelectorFallback = (selector, onMatch) => {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const mounted = new Map();
  const reconcile = () => {
    const matches = new Set([...document.querySelectorAll(selector)]);
    for (const [node, dispose] of mounted) {
      if (matches.has(node)) continue;
      dispose?.();
      mounted.delete(node);
    }
    for (const node of matches) {
      if (mounted.has(node)) continue;
      let dispose = () => {};
      try {
        const cleanup = onMatch(node);
        if (typeof cleanup === "function") dispose = cleanup;
      } catch {
        // 旧宿主的 MV 结构可能不完整，忽略该节点而不阻断插件启动。
      }
      mounted.set(node, dispose);
    }
  };
  const observer = new MutationObserver(reconcile);
  observer.observe(document.documentElement || document, { childList: true, subtree: true });
  reconcile();
  return () => {
    observer.disconnect();
    for (const dispose of mounted.values()) dispose?.();
    mounted.clear();
  };
};

const observeSelectorCompat = (ctx, selector, onMatch) =>
  typeof ctx?.dom?.observe === "function"
    ? ctx.dom.observe(selector, onMatch)
    : observeSelectorFallback(selector, onMatch);

export const normalizeCoverUrl = (value, size = 400) => {
  const rawUrl = asString(value);
  if (!rawUrl) return "";
  return rawUrl
    .replace(/^http:\/\//i, "https://")
    .replace("{size}", String(size))
    .replace("c1.kgimg.com", "imge.kugou.com");
};

const normalizeBitrate = (value) => {
  const number = asNumber(value);
  if (number <= 0) return 0;
  return number < 10000 ? number * 1000 : number;
};

export const formatBitrate = (value) => {
  const bitrate = normalizeBitrate(value);
  return bitrate > 0 ? `${Math.round(bitrate / 1000)} kbps` : "未知码率";
};

export const formatResolution = (source) => {
  const width = asNumber(source?.width);
  const height = asNumber(source?.height);
  if (width > 0 && height > 0) return `${width}×${height}`;
  return asString(source?.label) || "未知分辨率";
};

const formatCount = (value) => {
  const number = asNumber(value);
  return number > 0 ? number.toLocaleString("zh-CN") : "--";
};

const formatDuration = (value) => {
  let seconds = asNumber(value);
  if (seconds > 1000) seconds = Math.floor(seconds / 1000);
  if (seconds <= 0) return "--";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const QUALITY_META = {
  fhd: { label: "1080P", width: 1920, height: 1080 },
  hd: { label: "720P", width: 1280, height: 720 },
  qhd: { label: "540P", width: 960, height: 540 },
  sd: { label: "432P", width: 768, height: 432 },
  ld: { label: "270P", width: 480, height: 270 },
};

const CODECS = [
  ["h265", "H.265"],
  ["h264", "H.264"],
  ["mkv", "MKV"],
];

const resolveRecords = (payload) => {
  const root = asRecord(payload);
  const data = root.data;
  if (!Array.isArray(data)) return [];
  const records = Array.isArray(data[0]) ? data[0] : data;
  return records.filter((item) => item && typeof item === "object" && !Array.isArray(item));
};

const sourceKey = (source) => asString(source?.hash).toLowerCase();

const mergeSources = (groups) => {
  const merged = new Map();
  for (const source of groups.flat()) {
    const key = sourceKey(source);
    if (!key) continue;
    const previous = merged.get(key) ?? {};
    merged.set(key, {
      ...previous,
      ...source,
      hash: asString(source.hash) || previous.hash,
      label: asString(source.label) || previous.label || "默认",
      codec: asString(source.codec) || previous.codec || "",
      bitrate: normalizeBitrate(source.bitrate || previous.bitrate),
      width: asNumber(source.width) || previous.width || 0,
      height: asNumber(source.height) || previous.height || 0,
      size: asNumber(source.size) || previous.size || 0,
    });
  }
  return [...merged.values()].sort((left, right) => {
    const leftPixels = (left.width || 0) * (left.height || 0);
    const rightPixels = (right.width || 0) * (right.height || 0);
    if (leftPixels !== rightPixels) return rightPixels - leftPixels;
    return (right.bitrate || 0) - (left.bitrate || 0);
  });
};

const mapCodecSources = (record) => {
  const groups = [];
  for (const [codecKey, codecLabel] of CODECS) {
    const codec = asRecord(record[codecKey]);
    const sources = [];
    for (const quality of Object.keys(QUALITY_META)) {
      const hash = asString(codec[`${quality}_hash`]);
      if (!hash) continue;
      const meta = QUALITY_META[quality];
      sources.push({
        hash,
        label: asString(codec[`${quality}_name`]) || meta.label,
        codec: codecLabel,
        bitrate: normalizeBitrate(codec[`${quality}_bitrate`]),
        width: asNumber(codec[`${quality}_width`]) || meta.width,
        height: asNumber(codec[`${quality}_height`]) || meta.height,
        size: asNumber(codec[`${quality}_filesize`]),
      });
    }
    groups.push(sources);
  }
  return mergeSources(groups);
};

const mapDirectSources = (record) => {
  if (!Array.isArray(record.sources)) return [];
  return record.sources
    .map((source) => asRecord(source))
    .map((source) => ({
      hash: asString(source.hash),
      label: asString(source.label || source.name),
      codec: asString(source.codec),
      bitrate: normalizeBitrate(source.bitrate),
      width: asNumber(source.width),
      height: asNumber(source.height),
      size: asNumber(source.size || source.filesize),
    }))
    .filter((source) => source.hash);
};

const mapTags = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return item;
      const record = asRecord(item);
      return record.tag_name || record.name;
    })
    .map(asString)
    .filter(Boolean);
};

const mapVersion = (record, index) => {
  const raw = asRecord(record);
  const hash = asString(raw.hash || raw.mv_hash || raw.video_hash);
  const id = asString(raw.video_id || raw.id || hash || `version-${index}`);
  const sources = mergeSources([mapCodecSources(raw), mapDirectSources(raw)]);
  const fallbackSource = hash
    ? [{ hash, label: "默认", codec: "", bitrate: 0, width: 0, height: 0, size: 0 }]
    : [];
  return {
    id,
    hash,
    title: asString(raw.mv_name || raw.name || raw.video_name) || `视频版本 ${index + 1}`,
    author: asString(raw.singer || raw.singer_name),
    cover: normalizeCoverUrl(
      raw.hdpic ||
        raw.thumb ||
        raw.img ||
        raw.image ||
        raw.mvpic ||
        raw.mv_pic ||
        raw.mv_pic_url ||
        raw.mv_cover ||
        raw.cover ||
        raw.cover_url ||
        raw.coverUrl,
      400,
    ),
    publishTime: asString(raw.publish_time || raw.publish_date),
    duration: asNumber(raw.duration),
    playCount: asNumber(raw.play_times || raw.hit || raw.play_count || raw.hot),
    collectionCount: asNumber(raw.collection_total),
    downloadCount: asNumber(raw.download_total),
    tags: mapTags(raw.tags),
    description: asString(raw.desc || raw.description || raw.remark),
    sources: sources.length ? sources : fallbackSource,
    raw,
  };
};

export const parseMvVersions = (payload) =>
  resolveRecords(payload).map(mapVersion).filter((version) => version.hash || version.sources.length);

const mapPrivilegeSources = (payload) => {
  const root = asRecord(payload);
  const data = root.data;
  const records = Array.isArray(data)
    ? data
    : Object.entries(asRecord(data)).map(([hash, value]) => ({ hash, ...asRecord(value) }));
  return records
    .map((item) => {
      const record = asRecord(item);
      const info = asRecord(record.info);
      const level = asNumber(record.level);
      const quality =
        level === 5
          ? QUALITY_META.fhd
          : level === 4
            ? QUALITY_META.hd
            : level === 3
              ? QUALITY_META.qhd
              : level === 2
                ? QUALITY_META.sd
                : level === 1
                  ? QUALITY_META.ld
                  : null;
      return {
        hash: asString(record.hash),
        label: quality?.label || (level ? `等级 ${level}` : "默认"),
        codec: "MP4",
        bitrate: normalizeBitrate(info.bitrate || record.bitrate),
        width: quality?.width || 0,
        height: quality?.height || 0,
        size: asNumber(info.filesize || record.filesize),
      };
    })
    .filter((source) => source.hash);
};

export const pickDefaultSource = (sources) => {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return null;
  const best = (items) => [...items].sort((left, right) =>
    (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0) ||
    (right.bitrate || 0) - (left.bitrate || 0),
  )[0];
  return best(list.filter((source) => source.codec === "H.265")) ||
    best(list.filter((source) => source.codec === "H.264")) || best(list);
};

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const routeIsMv = (ctx) => String(ctx?.router?.currentRoute?.value?.name ?? "") === "mv-detail";

const readRouteKey = (ctx) => {
  const route = ctx?.router?.currentRoute?.value ?? {};
  const query = route.query ?? {};
  return {
    albumAudioId: asString(query.albumAudioId || query.mixSongId),
    hash: asString(query.hash),
    videoId: asString(query.videoId || (!query.albumAudioId && !query.mixSongId ? route.params?.id : "")),
    cover: asString(query.cover),
  };
};

const validSongId = (value) => /^\d+$/.test(asString(value)) && Number(value) > 0;

export const matchSongIdForMv = (detail, versionsPayload, routeKey) => {
  const data = asRecord(detail).data;
  const record = Array.isArray(data) ? asRecord(data[0]) : {};
  const songId = asString(record.album_audio_id || record.audio_id);
  if (!validSongId(songId)) return "";
  const versions = parseMvVersions(versionsPayload);
  const hash = asString(routeKey.hash).toLowerCase();
  const videoId = asString(routeKey.videoId);
  return versions.some((version) =>
    (hash && (version.hash.toLowerCase() === hash || version.sources.some((source) => source.hash.toLowerCase() === hash))) ||
    (videoId && version.id === videoId),
  ) ? songId : "";
};

const readHostVersionIndex = (wrap) => {
  const text = wrap.querySelector(".mv-version-index")?.textContent || "";
  const match = text.match(/(\d+)\s*\/\s*\d+/);
  return match ? Math.max(0, Number(match[1]) - 1) : null;
};

const findHostVersionButton = (wrap, direction) => {
  const expected = direction < 0 ? "上一版" : "下一版";
  return [...wrap.querySelectorAll(".mv-version-switcher button")].find(
    (button) => button.textContent?.trim() === expected,
  );
};

const sourceMatches = (card, source) => {
  if (!card || !source) return false;
  const text = card.textContent || "";
  const values = [
    source.label,
    source.codec,
    formatResolution(source),
    formatBitrate(source.bitrate),
  ].filter((value) => value && !value.startsWith("未知"));
  return values.every((value) => text.includes(value));
};

const findActiveHostSource = (page) =>
  [...page.wrap.querySelectorAll(".mv-source-card")].find((card) =>
    card.classList.contains("is-active"),
  ) || null;

const createElement = (tag, className, text = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const QUALITY_STYLE = `
.echo-mv-enhancer-active .mv-version-switcher,
.echo-mv-enhancer-hide-host-detail .card-block--hero,
.echo-mv-enhancer-active .echo-mv-enhancer-source-hidden {
  display: none !important;
}

.echo-mv-enhancer-panel {
  display: grid;
  gap: 16px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-heading-copy {
  display: grid;
  gap: 4px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-heading-title {
  color: var(--color-text-main);
  font-size: 15px;
  font-weight: 800;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-heading-hint {
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 11px;
  line-height: 1.45;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-version-list {
  display: flex;
  gap: 12px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 2px 10px;
  touch-action: pan-x;
  user-select: none;
  cursor: grab;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-version-list.is-dragging {
  cursor: grabbing;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-card {
  display: grid;
  flex: 0 0 clamp(240px, 26vw, 280px);
  align-content: start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--content-panel-border, var(--border-subtle));
  border-radius: 16px;
  background: var(--control-muted-bg);
  cursor: inherit;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-card.is-active {
  border-color: color-mix(in srgb, var(--color-primary) 60%, var(--content-panel-border, var(--border-subtle)));
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-header {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-cover-wrap {
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--color-bg-elevated);
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-cover,
.echo-mv-enhancer-panel .echo-mv-enhancer-detail-cover-placeholder {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-cover-placeholder {
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 18px;
  font-weight: 900;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-title {
  overflow: hidden;
  color: var(--color-text-main);
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-meta {
  overflow: hidden;
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-status {
  grid-column: 2;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-stats {
  display: grid;
  gap: 4px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-text-main) 5%, transparent);
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-stat-label {
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 11px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-stat-value {
  overflow: hidden;
  color: var(--color-text-main);
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  color: var(--color-primary-text);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  font-size: 10px;
  font-weight: 700;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-detail-description {
  color: color-mix(in srgb, var(--color-text-main) 66%, transparent);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.echo-mv-enhancer-panel .echo-mv-enhancer-empty,
.echo-mv-enhancer-panel .echo-mv-enhancer-loading {
  padding: 16px;
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 12px;
  text-align: center;
}

@media (max-width: 640px) {
  .echo-mv-enhancer-panel .echo-mv-enhancer-detail-card {
    flex-basis: min(80vw, 280px);
  }
}
`;

let runtimeCtx = null;
let styleDispose = null;
let routeDispose = null;
let observeDispose = null;
let active = null;
let generation = 0;
const validatedSearchPages = new WeakSet();

const getCurrentSources = (page) => page.versions[page.currentIndex]?.sources || [];

const renderVersions = (page) => {
  const list = page.panel.querySelector(".echo-mv-enhancer-version-list");
  if (!list) return;
  const previousScrollLeft = list.scrollLeft;
  list.replaceChildren();
  if (!page.versions.length) {
    list.append(createElement("div", "echo-mv-enhancer-empty", page.error || "未读取到 MV 详情"));
    return;
  }
  page.versions.forEach((version, index) => {
    const group = createElement("article", "echo-mv-enhancer-detail-card");
    const header = createElement("div", "echo-mv-enhancer-detail-header");
    const coverWrap = createElement("div", "echo-mv-enhancer-detail-cover-wrap");
    const coverUrl = version.cover || page.fallbackCover;
    if (coverUrl) {
      const cover = createElement("img", "echo-mv-enhancer-detail-cover");
      cover.src = coverUrl;
      cover.alt = version.title;
      cover.loading = "lazy";
      cover.draggable = false;
      cover.addEventListener("error", () => {
        if (page.fallbackCover && cover.src !== page.fallbackCover) {
          cover.src = page.fallbackCover;
          return;
        }
        cover.replaceWith(createElement("div", "echo-mv-enhancer-detail-cover-placeholder", "MV"));
      });
      coverWrap.append(cover);
    } else {
      coverWrap.append(createElement("div", "echo-mv-enhancer-detail-cover-placeholder", "MV"));
    }
    const detailCopy = createElement("div", "echo-mv-enhancer-detail-copy");
    detailCopy.append(createElement("div", "echo-mv-enhancer-detail-title", version.title));
    const authorLine = [version.author, version.publishTime ? `发布于 ${version.publishTime}` : ""]
      .filter(Boolean)
      .join(" · ");
    detailCopy.append(
      createElement("div", "echo-mv-enhancer-detail-meta", authorLine || "未知歌手 · 发布时间未知"),
    );
    detailCopy.append(createElement("div", "echo-mv-enhancer-detail-meta", `时长 ${formatDuration(version.duration)}`));
    const status = createElement(
      "span",
      "echo-mv-enhancer-detail-status",
      index === page.currentIndex ? "当前播放" : "选择此版本",
    );
    header.append(coverWrap, detailCopy, status);
    group.append(header);

    const stats = createElement("div", "echo-mv-enhancer-detail-stats");
    for (const [label, value] of [
      ["播放量", formatCount(version.playCount)],
      ["收藏", formatCount(version.collectionCount)],
      ["下载", formatCount(version.downloadCount)],
    ]) {
      const stat = createElement("div", "echo-mv-enhancer-detail-stat");
      stat.append(
        createElement("div", "echo-mv-enhancer-detail-stat-label", label),
        createElement("div", "echo-mv-enhancer-detail-stat-value", value),
      );
      stats.append(stat);
    }
    group.append(stats);

    if (version.tags.length) {
      const tags = createElement("div", "echo-mv-enhancer-detail-tags");
      for (const tag of version.tags)
        tags.append(createElement("span", "echo-mv-enhancer-detail-tag", tag));
      group.append(tags);
    }
    if (version.description) {
      group.append(createElement("div", "echo-mv-enhancer-detail-description", version.description));
    }

    group.addEventListener("click", (event) => {
      if (event.target?.closest?.("button")) return;
      void selectVersion(page, index);
    });
    group.classList.toggle("is-active", index === page.currentIndex);

    list.append(group);
  });
  list.scrollLeft = previousScrollLeft;
};

const enableVersionDragScroll = (list) => {
  let start = null;
  let suppressClick = false;
  list.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || list.scrollWidth <= list.clientWidth) return;
    start = { id: event.pointerId, x: event.clientX, scrollLeft: list.scrollLeft, moved: false };
  });
  list.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.id) return;
    const distance = event.clientX - start.x;
    if (!start.moved && Math.abs(distance) < 5) return;
    if (!start.moved) {
      start.moved = true;
      list.setPointerCapture(event.pointerId);
      list.classList.add("is-dragging");
    }
    list.scrollLeft = start.scrollLeft - distance;
    event.preventDefault();
  });
  const finish = (event) => {
    if (!start || event.pointerId !== start.id) return;
    if (start.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    start = null;
    list.classList.remove("is-dragging");
    if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
  };
  list.addEventListener("pointerup", finish);
  list.addEventListener("pointercancel", finish);
  list.addEventListener("pointerleave", () => {
    if (start && !start.moved) start = null;
  });
  list.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }, true);
  list.addEventListener("dragstart", (event) => event.preventDefault());
};

const renderPanel = (page) => {
  page.panel.replaceChildren();
  const heading = createElement("div", "echo-mv-enhancer-heading");
  const headingCopy = createElement("div", "echo-mv-enhancer-heading-copy");
  headingCopy.append(
    createElement("div", "echo-mv-enhancer-heading-title", "MV 详情"),
    createElement("div", "echo-mv-enhancer-heading-hint", "横向拖动浏览版本，点击卡片即可切换。"),
  );
  heading.append(headingCopy);

  const versions = createElement("div", "echo-mv-enhancer-version-list");
  versions.append(createElement("div", "echo-mv-enhancer-loading", "正在读取 MV 详情…"));
  enableVersionDragScroll(versions);
  page.panel.append(heading, versions);
};

const clickHostSource = async (page, source) => {
  let target = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const cards = [...page.wrap.querySelectorAll(".mv-source-card")];
    target = cards.find((card) => sourceMatches(card, source)) ||
      cards.find((card) => card.textContent?.includes(source.codec) &&
        card.textContent?.includes(formatResolution(source)));
    if (target || page.disposed) break;
    await wait(50);
  }
  if (!target || typeof target.click !== "function") return false;
  if (target.classList.contains("is-active") || sourceMatches(findActiveHostSource(page), source)) {
    return true;
  }
  target.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (target.classList.contains("is-active")) return true;
    await wait(25);
  }
  return true;
};

const waitForHostVersionIndex = async (wrap, expected) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = readHostVersionIndex(wrap);
    if (current === expected) return current;
    await wait(35);
  }
  return readHostVersionIndex(wrap);
};

const selectHostVersion = async (page, index) => {
  let hostIndex = readHostVersionIndex(page.wrap);
  if (hostIndex === null) {
    for (let attempt = 0; attempt < 20 && hostIndex === null; attempt += 1) {
      await wait(50);
      hostIndex = readHostVersionIndex(page.wrap);
    }
  }
  if (hostIndex === null) hostIndex = 0;
  while (hostIndex < index) {
    const button = findHostVersionButton(page.wrap, 1);
    if (!button) break;
    button.click();
    const nextIndex = await waitForHostVersionIndex(page.wrap, hostIndex + 1);
    hostIndex = nextIndex === null ? hostIndex + 1 : nextIndex;
  }
  while (hostIndex > index) {
    const button = findHostVersionButton(page.wrap, -1);
    if (!button) break;
    button.click();
    const nextIndex = await waitForHostVersionIndex(page.wrap, hostIndex - 1);
    hostIndex = nextIndex === null ? hostIndex - 1 : nextIndex;
  }
  await waitForHostVersionIndex(page.wrap, index);
};

const ensureSources = async (page, version) => {
  if (version.sources.some((source) => source.bitrate || source.width || source.height)) return;
  if (!version.hash) return;
  if (typeof runtimeCtx?.kugou?.video?.getVideoPrivilege !== "function") return;
  try {
    const payload = await runtimeCtx.kugou.video.getVideoPrivilege(version.hash);
    version.sources = mergeSources([version.sources, mapPrivilegeSources(payload)]);
  } catch {
    // 主程序仍会显示其自己的加载错误；插件保留已有版本卡片。
  }
};

const applySelectedSource = async (page) => {
  if (!page || page.disposed || page.busy) return;
  const version = page.versions[page.currentIndex];
  if (!version) return;
  page.busy = true;
  try {
    await ensureSources(page, version);
    const hostIndex = readHostVersionIndex(page.wrap);
    if (hostIndex !== page.currentIndex && (hostIndex !== null || page.currentIndex > 0))
      await selectHostVersion(page, page.currentIndex);
    const source = pickDefaultSource(version.sources);
    if (source && !sourceMatches(findActiveHostSource(page), source)) {
      await clickHostSource(page, source);
    }
    renderVersions(page);
  } finally {
    page.busy = false;
  }
};

const selectVersion = async (page, index) => {
  if (page.busy || index < 0 || index >= page.versions.length || index === page.currentIndex) return;
  page.currentIndex = index;
  renderVersions(page);
  await applySelectedSource(page);
};

const loadPage = async (page, token) => {
  const routeKey = readRouteKey(runtimeCtx);
  const tasks = [];
  const videoApi = runtimeCtx?.kugou?.video;
  if (routeKey.albumAudioId && typeof videoApi?.getSongMv === "function") {
    tasks.push(videoApi.getSongMv(routeKey.albumAudioId));
  } else if (routeKey.videoId && typeof videoApi?.getVideoDetail === "function") {
    tasks.push(videoApi.getVideoDetail(routeKey.videoId));
  } else {
    page.error = "当前 EchoMusic 版本未提供酷狗 MV 接口";
    renderVersions(page);
    return;
  }
  const results = await Promise.allSettled(tasks);
  if (!active || active !== page || generation !== token || page.disposed) return;
  const versions = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => parseMvVersions(result.value));
  const used = new Set();
  page.versions = versions.filter((version) => {
    const key = `${version.id}:${version.hash}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
  page.wrap.classList.toggle("echo-mv-enhancer-hide-host-detail", page.versions.length > 0);
  page.error = page.versions.length ? "" : "当前接口没有返回可用版本";
  const requestedIndex = page.versions.findIndex((version) =>
    (routeKey.hash && (version.hash.toLowerCase() === routeKey.hash.toLowerCase() ||
      version.sources.some((source) => source.hash.toLowerCase() === routeKey.hash.toLowerCase()))) ||
    (routeKey.videoId && version.id === routeKey.videoId),
  );
  page.currentIndex = requestedIndex >= 0 ? requestedIndex :
    Math.min(readHostVersionIndex(page.wrap) ?? 0, Math.max(page.versions.length - 1, 0));
  renderVersions(page);
  if (page.versions.length) await applySelectedSource(page);
};

const attach = (wrap) => {
  if (!routeIsMv(runtimeCtx)) return () => {};
  if (active?.wrap === wrap) return () => {};
  const routeKey = readRouteKey(runtimeCtx);
  if (routeKey.videoId && validSongId(routeKey.albumAudioId) && !validatedSearchPages.has(wrap)) {
    let cancelled = false;
    let mountedCleanup = null;
    const videoApi = runtimeCtx?.kugou?.video;
    if (typeof videoApi?.getSongMv === "function") {
      void Promise.resolve(videoApi.getSongMv(routeKey.albumAudioId)).then((versions) => {
        if (cancelled || matchSongIdForMv(
          { data: [{ album_audio_id: routeKey.albumAudioId }] }, versions, routeKey,
        ) !== routeKey.albumAudioId) return;
        validatedSearchPages.add(wrap);
        mountedCleanup = attach(wrap);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      mountedCleanup?.();
      validatedSearchPages.delete(wrap);
    };
  }
  if (!validSongId(routeKey.albumAudioId)) {
    let cancelled = false;
    const videoApi = runtimeCtx?.kugou?.video;
    if (routeKey.videoId && typeof videoApi?.getVideoDetail === "function" &&
      typeof videoApi?.getSongMv === "function" && typeof runtimeCtx?.router?.replace === "function") {
      void (async () => {
        try {
          const detail = await videoApi.getVideoDetail(routeKey.videoId);
          const data = asRecord(detail).data;
          const record = Array.isArray(data) ? asRecord(data[0]) : {};
          const songId = asString(record.album_audio_id || record.audio_id);
          if (cancelled || !validSongId(songId)) return;
          const versions = await videoApi.getSongMv(songId);
          if (cancelled || matchSongIdForMv(detail, versions, routeKey) !== songId) return;
          const currentRoute = runtimeCtx.router.currentRoute.value;
          await runtimeCtx.router.replace({
            name: "mv-detail",
            params: currentRoute.params,
            query: { ...currentRoute.query, albumAudioId: songId },
          });
        } catch {
          // 关联歌曲无法核实或导航失败时保持搜索 MV 原页面。
        }
      })();
    }
    return () => { cancelled = true; };
  }
  detach();
  const page = {
    wrap,
    panel: createElement("section", "card-block echo-mv-enhancer-panel"),
    fallbackCover: (() => {
      const hostCover = wrap.querySelector(".mv-cover-img img") || wrap.querySelector(".mv-cover-img");
      const routeCover = readRouteKey(runtimeCtx).cover;
      return normalizeCoverUrl(
        hostCover?.currentSrc ||
          hostCover?.getAttribute("src") ||
          hostCover?.getAttribute("data-src") ||
          routeCover,
        400,
      );
    })(),
    versions: [],
    currentIndex: 0,
    error: "",
    busy: false,
    disposed: false,
  };
  active = page;
  const token = ++generation;
  wrap.classList.add("echo-mv-enhancer-active");
  const sourceSection = [...wrap.querySelectorAll("section.card-block")].find((section) =>
    section.querySelector(".mv-source-list"),
  );
  if (sourceSection) {
    sourceSection.classList.add("echo-mv-enhancer-source-hidden");
    sourceSection.before(page.panel);
  } else {
    const hero = wrap.querySelector("section.card-block--hero");
    if (hero) hero.after(page.panel);
    else wrap.prepend(page.panel);
  }
  renderPanel(page);
  void loadPage(page, token)
    .catch(() => {
      if (!active || active !== page || page.disposed) return;
      page.error = "读取视频版本失败";
      renderVersions(page);
    });
  return () => {
    if (active === page) detach();
  };
};

function detach() {
  const page = active;
  if (!page) return;
  page.disposed = true;
  page.wrap.classList.remove("echo-mv-enhancer-active");
  page.wrap.classList.remove("echo-mv-enhancer-hide-host-detail");
  page.wrap.querySelector(".echo-mv-enhancer-source-hidden")?.classList.remove(
    "echo-mv-enhancer-source-hidden",
  );
  page.panel.remove();
  active = null;
  generation += 1;
}

export async function activate(ctx) {
  runtimeCtx = ctx;
  styleDispose =
    typeof ctx?.css?.inject === "function"
      ? ctx.css.inject(QUALITY_STYLE, { id: "echo-mv-enhancer" })
      : null;
  routeDispose =
    typeof ctx?.router?.afterEach === "function"
      ? ctx.router.afterEach(() => {
          if (!routeIsMv(ctx)) detach();
        })
      : null;
  observeDispose = observeSelectorCompat(ctx, ".mv-detail-wrap", attach);
}

export function deactivate() {
  detach();
  observeDispose?.();
  observeDispose = null;
  routeDispose?.();
  routeDispose = null;
  styleDispose?.();
  styleDispose = null;
  runtimeCtx = null;
}
