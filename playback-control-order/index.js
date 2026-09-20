const STORAGE_KEY = "settings";

export const CONTROL_LABELS = Object.freeze({
  favorite: "收藏",
  add: "添加到",
  comments: "评论",
  mv: "播放 MV",
  barrage: "弹幕",
  sleepTimer: "定时关闭",
  playMode: "播放模式",
  volume: "音量",
  speed: "倍速播放",
  share: "分享",
  skin: "换肤",
  quality: "音质",
  effect: "歌曲音效",
  desktopLyric: "桌面歌词",
  queue: "播放队列",
});

const PAGE_IDS = ["home", "player"];
const ZONE_IDS = ["left", "before", "after", "right"];

export const SIDEBAR_GROUPS = Object.freeze({
  discover: {
    title: "发现音乐",
    description: "只在“发现音乐”分类内调整顺序。",
    items: [
      ["home", "为您推荐"],
      ["explore", "探索发现"],
    ],
  },
  library: {
    title: "我的乐库",
    description: "只在“我的乐库”分类内调整顺序。",
    items: [
      ["favorites", "我最喜爱"],
      ["personal-fm", "私人 FM"],
      ["cloud", "音乐云盘"],
      ["history", "播放历史"],
      ["purchased", "已购音乐"],
    ],
  },
  playlists: {
    title: "歌单",
    description: "单独控制歌单类；固定歌单项仍可分别隐藏，用户歌单仍由主程序管理。",
    items: [
      ["defaultFavorite", "默认收藏"],
      ["likedPlaylist", "我喜欢"],
    ],
  },
});

const SIDEBAR_GROUP_IDS = Object.keys(SIDEBAR_GROUPS);
const SIDEBAR_ITEM_IDS = Object.fromEntries(
  SIDEBAR_GROUP_IDS.map((groupId) => [groupId, SIDEBAR_GROUPS[groupId].items.map(([id]) => id)]),
);

const DEFAULT_PAGE_LAYOUT = {
  home: {
    left: ["favorite", "add", "comments", "mv"],
    before: ["sleepTimer", "playMode"],
    after: ["volume", "speed"],
    right: ["share", "quality", "effect", "desktopLyric", "queue"],
    hidden: [],
  },
  player: {
    left: ["favorite", "add", "comments", "barrage"],
    before: ["sleepTimer", "playMode"],
    after: ["volume", "speed"],
    right: ["skin", "share", "quality", "effect", "desktopLyric", "queue"],
    hidden: [],
  },
};

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  sidebar: {
    discover: { visible: true, items: ["home", "explore"], hidden: [] },
    library: {
      visible: true,
      items: ["favorites", "personal-fm", "cloud", "history", "purchased"],
      hidden: [],
    },
    playlists: { visible: true, items: ["defaultFavorite", "likedPlaylist"], hidden: [] },
  },
  home: DEFAULT_PAGE_LAYOUT.home,
  player: DEFAULT_PAGE_LAYOUT.player,
});

const PAGE_CONTROL_IDS = {
  home: [
    "favorite",
    "add",
    "comments",
    "mv",
    "sleepTimer",
    "playMode",
    "volume",
    "speed",
    "share",
    "quality",
    "effect",
    "desktopLyric",
    "queue",
  ],
  player: [
    "favorite",
    "add",
    "comments",
    "barrage",
    "sleepTimer",
    "playMode",
    "volume",
    "speed",
    "skin",
    "share",
    "quality",
    "effect",
    "desktopLyric",
    "queue",
  ],
};

const FIXED_CONTROL_LABELS = Object.freeze({
  previous: "上一首",
  play: "播放",
  next: "下一首",
});

const ZONE_LABELS = {
  left: "左区 · 歌曲名下方",
  before: "中区 · 播放键之前",
  after: "中区 · 播放键之后",
  right: "右区",
};

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asBoolean = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const unique = (values) => [...new Set(values)];

const requestFrame = (callback) => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16);
};

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
        // 旧宿主的页面结构可能不完整，忽略该节点而不阻断插件启动。
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

export const normalizeLayout = (layout, fallback, availableIds) => {
  const source = asRecord(layout);
  const available = new Set(availableIds);
  const result = {};
  const used = new Set();
  for (const zone of ZONE_IDS) {
    const requested = Array.isArray(source[zone]) ? source[zone] : [];
    result[zone] = unique(requested.filter((id) => available.has(id) && !used.has(id)));
    for (const id of result[zone]) used.add(id);
  }
  for (const zone of ZONE_IDS) {
    for (const id of fallback[zone] || []) {
      if (available.has(id) && !used.has(id)) {
        result[zone].push(id);
        used.add(id);
      }
    }
  }
  return result;
};

// targetIndex is measured against the list before the source item is removed.
// Keeping this operation in one place avoids the common off-by-one error when
// dropping an item after another item in the same zone.
export const moveItem = (items, fromIndex, targetIndex) => {
  if (!Array.isArray(items)) return items;
  if (!Number.isInteger(fromIndex) || !Number.isInteger(targetIndex)) return items;
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  const [item] = items.splice(fromIndex, 1);
  if (item === undefined) return items;
  const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  items.splice(Math.max(0, Math.min(adjustedIndex, items.length)), 0, item);
  return items;
};

const normalizeHidden = (value, availableIds) => {
  const available = new Set(availableIds);
  return unique(Array.isArray(value) ? value.filter((id) => available.has(id)) : []);
};

const normalizeOrderedIds = (requested, fallback, availableIds) => {
  const available = new Set(availableIds);
  const result = [];
  const used = new Set();
  for (const id of requested || []) {
    if (available.has(id) && !used.has(id)) {
      result.push(id);
      used.add(id);
    }
  }
  for (const id of fallback || []) {
    if (available.has(id) && !used.has(id)) {
      result.push(id);
      used.add(id);
    }
  }
  return result;
};

const normalizeSidebarGroup = (value, fallback, availableIds) => {
  const source = asRecord(value);
  const order = Array.isArray(source.items)
    ? source.items
    : Array.isArray(source.order)
      ? source.order
      : undefined;
  return {
    visible: asBoolean(source.visible, fallback.visible),
    items: normalizeOrderedIds(order, fallback.items, availableIds),
    hidden: normalizeHidden(source.hidden, availableIds),
  };
};

export const normalizeSettings = (value) => {
  const source = asRecord(value);
  const sidebarSource = asRecord(source.sidebar);
  const result = {
    enabled: asBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    sidebar: {},
  };
  for (const groupId of SIDEBAR_GROUP_IDS) {
    result.sidebar[groupId] = normalizeSidebarGroup(
      sidebarSource[groupId],
      DEFAULT_SETTINGS.sidebar[groupId],
      SIDEBAR_ITEM_IDS[groupId],
    );
  }
  for (const pageId of PAGE_IDS) {
    const layout = normalizeLayout(source[pageId], DEFAULT_PAGE_LAYOUT[pageId], PAGE_CONTROL_IDS[pageId]);
    result[pageId] = {
      ...layout,
      hidden: normalizeHidden(asRecord(source[pageId]).hidden, PAGE_CONTROL_IDS[pageId]),
    };
  }
  return result;
};

const elementHas = (node, selector) =>
  Boolean(node?.matches?.(selector) || node?.querySelector?.(selector));

const elementHasLabel = (node, predicate) => {
  if (!node) return false;
  const candidates = [];
  if (node.matches?.("[aria-label]")) candidates.push(node);
  candidates.push(...(node.querySelectorAll?.("[aria-label]") || []));
  return candidates.some((candidate) => predicate(String(candidate.getAttribute("aria-label") || "")));
};

const directChildren = (node) => (node ? [...node.children] : []);

const classifyNode = (pageId, node, center) => {
  if (elementHas(node, ".sleep-timer-trigger")) return "sleepTimer";
  if (elementHas(node, '[aria-label="倍速播放"]')) return "speed";
  if (elementHas(node, '[aria-label="静音"], [aria-label="取消静音"]')) return "volume";
  if (elementHasLabel(node, (value) => value === "收藏")) return "favorite";
  if (elementHasLabel(node, (value) => value === "添加到")) return "add";
  if (elementHasLabel(node, (value) => value === "弹幕设置与发送")) return pageId === "player" ? "barrage" : null;
  if (
    elementHasLabel(node, (value) =>
      pageId === "home" ? value === "详情及评论" : value === "评论",
    )
  )
    return "comments";
  if (pageId === "home" && elementHasLabel(node, (value) => value === "播放 MV")) return "mv";
  if (elementHasLabel(node, (value) => value === "分享")) return "share";
  if (pageId === "player" && elementHasLabel(node, (value) => value === "换肤")) return "skin";
  if (
    elementHasLabel(node, (value) =>
      value === "音质" || value.startsWith("当前使用") || value.startsWith("正在切换至"),
    )
  )
    return "quality";
  if (elementHasLabel(node, (value) => value === "音效与均衡器")) return "effect";
  if (elementHasLabel(node, (value) => value.includes("桌面歌词"))) return "desktopLyric";
  if (elementHasLabel(node, (value) => value === "播放队列" || value === "播放列表")) return "queue";
  // 播放模式按钮由外层 Tooltip 提供文字，按钮本身可能没有 aria-label。
  if (center && (node.matches?.("button") || elementHas(node, "button"))) return "playMode";
  return null;
};

const identifyActionNodes = (pageId, root, knownIds = new Map()) => {
  const isHome = pageId === "home";
  const playButton = root.querySelector(isHome ? "button.player-toggle" : "button.bar-play-btn");
  const center = playButton?.parentElement || null;
  const centerChildren = directChildren(center);
  const playIndex = playButton ? centerChildren.indexOf(playButton) : -1;
  const fixed = {
    previous: playIndex > 0 ? centerChildren[playIndex - 1] : null,
    play: playButton,
    next: playIndex >= 0 ? centerChildren[playIndex + 1] : null,
  };
  const movable = new Map();
  const add = (id, node) => {
    if (id && node && !movable.has(id) && !Object.values(fixed).includes(node)) movable.set(id, node);
  };

  const songInfo = isHome ? root.querySelector(".player-song-info") : null;
  const left = isHome
    ? songInfo?.parentElement?.nextElementSibling || null
    : root.querySelector(".bar-song-actions");
  const right = isHome ? root.querySelector(".player-actions") : root.querySelector(".bar-right");
  const containers = [left, center, right].filter(Boolean);
  const candidates = [...new Set(containers.flatMap(directChildren))];
  for (const node of candidates) {
    if (Object.values(fixed).includes(node)) continue;
    add(knownIds.get(node) || classifyNode(pageId, node, node.parentElement === center), node);
  }

  return { containers: { left, center, right }, fixed, movable };
};

const sameChildren = (parent, children) => {
  const current = [...parent.children];
  return current.length === children.length && current.every((child, index) => child === children[index]);
};

const reconcileChildren = (parent, children) => {
  if (!parent || sameChildren(parent, children)) return;
  const fragment = parent.ownerDocument?.createDocumentFragment?.();
  if (fragment) {
    for (const child of children) fragment.append(child);
    parent.append(fragment);
    return;
  }
  for (const child of children) parent.append(child);
};

const clearControlDecoration = (node) => {
  if (!node?.classList) return;
  node.classList.remove(
    "echo-control-order-slot-small",
    "echo-control-order-slot-large",
    "echo-control-order-hidden",
    "echo-control-order-fixed-slot",
  );
  delete node.dataset.echoControlOrderId;
  delete node.dataset.echoControlOrderZone;
  delete node.dataset.echoControlOrderDisabled;
  for (const child of node.querySelectorAll?.("button") || []) {
    child.classList.remove(
      "echo-control-order-slot-small",
      "echo-control-order-slot-large",
      "echo-control-order-hidden",
      "echo-control-order-fixed-slot",
    );
  }
};

const decorateControl = (node, id, zone, hidden, fixed = false) => {
  if (!node?.classList) return;
  const slotClass = zone === "left" ? "echo-control-order-slot-small" : "echo-control-order-slot-large";
  node.classList.remove("echo-control-order-slot-small", "echo-control-order-slot-large");
  node.classList.add(slotClass);
  node.classList.toggle("echo-control-order-hidden", hidden);
  node.classList.toggle("echo-control-order-fixed-slot", fixed);
  node.dataset.echoControlOrderId = id;
  node.dataset.echoControlOrderZone = zone;
  node.dataset.echoControlOrderDisabled = String(hidden);
  for (const child of node.querySelectorAll?.("button") || []) {
    child.classList.remove("echo-control-order-slot-small", "echo-control-order-slot-large");
    child.classList.add(slotClass);
    child.classList.toggle("echo-control-order-hidden", hidden);
    child.classList.toggle("echo-control-order-fixed-slot", fixed);
  }
};

const captureOriginalChildren = (discovered) =>
  [...new Set(Object.values(discovered.containers).filter(Boolean))].map((parent) => ({
    parent,
    children: [...parent.children],
  }));

const restorePage = (page) => {
  page.timer = null;
  for (const snapshot of page.originalChildren) {
    if (!snapshot.parent?.isConnected) continue;
    for (const child of snapshot.children) if (child?.isConnected) snapshot.parent.append(child);
  }
  for (const [node, parent] of page.originalParents) {
    if (node?.isConnected && parent?.isConnected && node.parentElement !== parent) parent.append(node);
  }
  for (const node of new Set([...page.nodeIds.keys(), ...Object.values(page.discovered?.fixed || {})]))
    clearControlDecoration(node);
  for (const container of Object.values(page.discovered?.containers || {}))
    container?.classList.remove("echo-control-order-container");
};

const rememberOriginalNodes = (page, discovered) => {
  const parents = new Set(Object.values(discovered.containers).filter(Boolean));
  for (const parent of parents) {
    let snapshot = page.originalChildren.find((item) => item.parent === parent);
    if (!snapshot) {
      snapshot = { parent, children: [...parent.children] };
      page.originalChildren.push(snapshot);
    }
    for (const node of discovered.movable.values()) {
      if (node.parentElement === parent && !page.originalParents.has(node)) {
        page.originalParents.set(node, parent);
        if (!snapshot.children.includes(node)) snapshot.children.push(node);
      }
    }
  }
};

const applyPageLayout = (page) => {
  if (!page || page.disposed) return;
  if (!state?.settings?.enabled) {
    restorePage(page);
    return;
  }
  const discovered = identifyActionNodes(page.pageId, page.root, page.nodeIds);
  if (!discovered.containers.center || !discovered.fixed.play) return;
  page.discovered = discovered;
  for (const [id, node] of discovered.movable) page.nodeIds.set(node, id);
  rememberOriginalNodes(page, discovered);
  const availableIds = [...discovered.movable.keys()];
  const pageSettings = state.settings[page.pageId];
  const layout = normalizeLayout(pageSettings, DEFAULT_PAGE_LAYOUT[page.pageId], availableIds);
  const hidden = new Set(pageSettings.hidden || []);
  const movableNodes = new Set(discovered.movable.values());

  for (const zone of ["left", "right"]) {
    const target = discovered.containers[zone];
    if (!target) continue;
    target.classList.add("echo-control-order-container");
    const fixedChildren = [...target.children].filter((child) => !movableNodes.has(child));
    const movableChildren = layout[zone].map((id) => discovered.movable.get(id)).filter(Boolean);
    for (const id of layout[zone]) decorateControl(discovered.movable.get(id), id, zone, hidden.has(id));
    reconcileChildren(target, [...fixedChildren, ...movableChildren]);
  }

  const center = discovered.containers.center;
  center.classList.add("echo-control-order-container");
  const fixedNodes = new Set(
    [discovered.fixed.previous, discovered.fixed.play, discovered.fixed.next].filter(Boolean),
  );
  const centerUnknownChildren = [...center.children].filter(
    (child) => !movableNodes.has(child) && !fixedNodes.has(child),
  );
  const centerChildren = [
    ...centerUnknownChildren,
    ...layout.before.map((id) => discovered.movable.get(id)).filter(Boolean),
    ...[discovered.fixed.previous, discovered.fixed.play, discovered.fixed.next].filter(Boolean),
    ...layout.after.map((id) => discovered.movable.get(id)).filter(Boolean),
  ];
  for (const id of layout.before) decorateControl(discovered.movable.get(id), id, "before", hidden.has(id));
  for (const id of layout.after) decorateControl(discovered.movable.get(id), id, "after", hidden.has(id));
  decorateControl(discovered.fixed.previous, "previous", "before", false, true);
  decorateControl(discovered.fixed.play, "play", "after", false, true);
  decorateControl(discovered.fixed.next, "next", "after", false, true);
  reconcileChildren(center, centerChildren);
};

const schedulePageApply = (page) => {
  if (!page || page.disposed || page.timer) return;
  const token = {};
  page.timer = token;
  requestFrame(() => {
    if (page.timer !== token) return;
    page.timer = null;
    if (!page.disposed) applyPageLayout(page);
  });
};

const sidebarLabel = (row) => {
  const spans = [...(row?.querySelectorAll?.("span") || [])]
    .map((span) => String(span.textContent || "").trim())
    .filter(Boolean);
  return spans.at(-1) || String(row?.textContent || "").trim();
};

const sidebarFullGroup = (root, groupId) => {
  const meta = SIDEBAR_GROUPS[groupId];
  const header = [...root.querySelectorAll(".sidebar-section-header")].find(
    (node) => String(node.textContent || "").trim().startsWith(meta.title),
  );
  const body = header?.nextElementSibling;
  if (!header || !body) return null;
  const rows = [...body.querySelectorAll(".sidebar-nav-item")].filter(
    (row) => row.closest(".sidebar-section-body") === body,
  );
  const items = new Map();
  for (const [id, label] of meta.items) {
    const row = rows.find((candidate) => sidebarLabel(candidate) === label);
    if (row) items.set(id, row);
  }
  return { header, body, rows, items };
};

const sidebarPlaylistRows = (root) =>
  [...root.querySelectorAll(".sidebar-library-item")].filter(
    (row) => row.closest(".sidebar-scroll-inner") || row.closest(".sidebar-rail-cover-list"),
  );

// 折叠侧栏的固定歌单使用封面按钮渲染，不会出现在展开态的 .sidebar-library-item 列表中。
const sidebarPlaylistRailRows = (root) =>
  [...root.querySelectorAll(".sidebar-rail-cover-list .sidebar-rail-cover-btn[aria-label]")];

const rememberSidebarParent = (record, parent) => {
  if (!parent || record.snapshots.has(parent)) return;
  record.snapshots.set(parent, [...parent.children]);
};

const applySidebarGroup = (record, groupId) => {
  const root = record.root;
  const settings = state.settings.sidebar[groupId];
  const meta = SIDEBAR_GROUPS[groupId];
  const full = sidebarFullGroup(root, groupId);
  if (full) {
    const rows = [...full.items.values()];
    const firstRow = rows[0];
    rememberSidebarParent(record, firstRow?.parentElement);
    const hasUnknownRows = full.rows.some((row) => !rows.includes(row));
    if (firstRow?.parentElement) {
      const parent = firstRow.parentElement;
      // 只用 flex order 排序，不搬动 Vue 管理的节点，保留主程序原有的点击事件。
      parent.classList.add("echo-control-order-sidebar-sort-container");
      for (const [index, row] of full.rows.entries()) row.style.order = String(1000 + index);
      for (const [index, id] of settings.items.entries()) {
        const row = full.items.get(id);
        if (row) row.style.order = String(index);
      }
    }
    for (const [id, row] of full.items) {
      row.dataset.echoControlOrderSidebarId = id;
      row.classList.toggle("echo-control-order-sidebar-hidden", !settings.visible || settings.hidden.includes(id));
      row.dataset.echoControlOrderSidebarDisabled = String(!settings.visible || settings.hidden.includes(id));
    }
    const knownVisible = meta.items.some(([id]) => full.items.has(id) && !settings.hidden.includes(id));
    const hideGroup = !settings.visible || (!knownVisible && !hasUnknownRows);
    full.header.parentElement?.classList.toggle("echo-control-order-sidebar-group-hidden", hideGroup);
    full.body.classList.toggle("echo-control-order-sidebar-group-hidden", hideGroup);
  }

  // 折叠侧栏没有 section 标题，仍按同一组设置隐藏对应图标。
  for (const [id, label] of meta.items) {
    const buttons = [...root.querySelectorAll(".sidebar-rail-item[aria-label]")].filter(
      (button) => button.getAttribute("aria-label") === label && button.closest(".sidebar-rail-nav"),
    );
    for (const button of buttons) {
      button.dataset.echoControlOrderSidebarId = id;
      button.classList.toggle("echo-control-order-sidebar-hidden", !settings.visible || settings.hidden.includes(id));
    }
  }
};

const applyPlaylistSidebarGroup = (record) => {
  const root = record.root;
  const settings = state.settings.sidebar.playlists;
  const rows = sidebarPlaylistRows(root);
  const railRows = sidebarPlaylistRailRows(root);
  const items = new Map();
  const railItems = new Map();
  for (const [id, label] of SIDEBAR_GROUPS.playlists.items) {
    const row = rows.find((candidate) => sidebarLabel(candidate) === label);
    if (row) items.set(id, row);
    const railRow = railRows.find((candidate) => candidate.getAttribute("aria-label") === label);
    if (railRow) railItems.set(id, railRow);
  }
  const knownRows = [...items.values()];
  const first = knownRows[0];
  rememberSidebarParent(record, first?.parentElement);
  if (first?.parentElement) {
    const parent = first.parentElement;
    // 同上：视觉排序不改变 Vue 节点的实际归属，避免歌单点击失效。
    parent.classList.add("echo-control-order-sidebar-sort-container");
    for (const [index, row] of rows.entries()) row.style.order = String(1000 + index);
    for (const [index, id] of settings.items.entries()) {
      const row = items.get(id);
      if (row) row.style.order = String(index);
    }
  }
  for (const [id, row] of items) {
    const hidden = !settings.visible || settings.hidden.includes(id);
    row.dataset.echoControlOrderSidebarId = id;
    row.classList.toggle("echo-control-order-sidebar-hidden", hidden);
    row.dataset.echoControlOrderSidebarDisabled = String(hidden);
  }
  for (const [id, row] of railItems) {
    const hidden = !settings.visible || settings.hidden.includes(id);
    row.dataset.echoControlOrderSidebarId = id;
    row.classList.toggle("echo-control-order-sidebar-hidden", hidden);
    row.dataset.echoControlOrderSidebarDisabled = String(hidden);
  }
  const header = root.querySelector(".sidebar-playlist-header");
  const playlistList = root.querySelector(".sidebar-scroll-inner");
  const railGroup = root.querySelector(".sidebar-rail-playlists");
  header?.classList.toggle("echo-control-order-sidebar-group-hidden", !settings.visible);
  playlistList?.classList.toggle("echo-control-order-sidebar-group-hidden", !settings.visible);
  railGroup?.classList.toggle("echo-control-order-sidebar-group-hidden", !settings.visible);
};

const restoreSidebar = (record) => {
  record.timer && window.clearTimeout(record.timer);
  for (const [parent, children] of record.snapshots) {
    if (!parent?.isConnected) continue;
    for (const child of children) if (child?.isConnected) parent.append(child);
  }
  for (const element of record.root.querySelectorAll(
    ".echo-control-order-sidebar-hidden, .echo-control-order-sidebar-group-hidden",
  )) {
    element.classList.remove("echo-control-order-sidebar-hidden", "echo-control-order-sidebar-group-hidden");
    delete element.dataset.echoControlOrderSidebarId;
    delete element.dataset.echoControlOrderSidebarDisabled;
  }
  for (const element of record.root.querySelectorAll(".echo-control-order-sidebar-sort-container")) {
    element.classList.remove("echo-control-order-sidebar-sort-container");
  }
  for (const element of record.root.querySelectorAll(".sidebar-nav-item, .sidebar-library-item")) {
    element.style.removeProperty("order");
  }
};

const applySidebarLayout = (record) => {
  if (!record || record.disposed || !state?.settings) return;
  if (!state.settings.enabled) {
    restoreSidebar(record);
    return;
  }
  for (const groupId of ["discover", "library"]) applySidebarGroup(record, groupId);
  applyPlaylistSidebarGroup(record);
};

const scheduleSidebarApply = (record) => {
  if (!record || record.disposed || record.timer) return;
  record.timer = window.setTimeout(() => {
    record.timer = null;
    applySidebarLayout(record);
  }, 0);
};

const applyAllLayouts = () => {
  for (const page of pages) schedulePageApply(page);
  for (const record of sidebarRecords) scheduleSidebarApply(record);
};

const updateStoredSettings = (next) => {
  const normalized = normalizeSettings(next);
  state.settings = normalized;
  if (typeof runtimeCtx?.storage?.set === "function") {
    void runtimeCtx.storage.set(STORAGE_KEY, normalized);
  }
  applyAllLayouts();
};

const observePage = (pageId, root) => {
  const page = {
    pageId,
    root,
    disposed: false,
    timer: null,
    discovered: null,
    originalChildren: [],
    originalParents: new Map(),
    nodeIds: new Map(),
  };
  const discovered = identifyActionNodes(pageId, root);
  page.discovered = discovered;
  page.nodeIds = new Map(discovered.movable ? [...discovered.movable].map(([id, node]) => [node, id]) : []);
  page.originalChildren = captureOriginalChildren(discovered);
  for (const node of discovered.movable.values()) page.originalParents.set(node, node.parentElement);
  pages.add(page);
  schedulePageApply(page);
  return () => {
    page.disposed = true;
    restorePage(page);
    pages.delete(page);
  };
};

const observeSidebar = (root) => {
  const record = { root, disposed: false, timer: null, observer: null, snapshots: new Map() };
  sidebarRecords.add(record);
  record.observer = new MutationObserver(() => scheduleSidebarApply(record));
  record.observer.observe(root, { childList: true, subtree: true });
  scheduleSidebarApply(record);
  return () => {
    record.disposed = true;
    record.observer?.disconnect();
    restoreSidebar(record);
    sidebarRecords.delete(record);
  };
};

const FALLBACK_ICONS = Object.freeze({
  favorite: "♡",
  add: "+",
  comments: "◌",
  mv: "▶",
  barrage: "▤",
  sleepTimer: "◷",
  playMode: "↻",
  skin: "◉",
  volume: "◖",
  speed: "◔",
  share: "⌯",
  quality: "◈",
  effect: "≋",
  desktopLyric: "A",
  queue: "☷",
  previous: "|◀",
  play: "▶",
  next: "▶|",
});

const FALLBACK_SVG_ICONS = Object.freeze({
  // EchoMusic beta.5 的“换肤”按钮使用 inputBehaviorGuard 的同一枚图标。
  skin: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 4l6 2v5h-3v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8H3V6l6-2a3 3 0 0 0 6 0"/></svg>',
});

const iconSvgFor = (node) => {
  const svg = node?.matches?.("svg") ? node : node?.querySelector?.("svg");
  return svg?.outerHTML || "";
};

const controlIconMarkup = (id, pageId) => {
  if (typeof document !== "undefined") {
    const selectors = pageId === "home" ? [".player-bar"] : [".lyric-bar", ".player-bar"];
    for (const selector of selectors) {
      const root = document.querySelector(selector);
      if (!root) continue;
      const sourcePageId = root.matches?.(".lyric-bar") ? "player" : "home";
      const action = identifyActionNodes(sourcePageId, root);
      const node = action?.movable.get(id) || action?.fixed?.[id];
      const actual = iconSvgFor(node);
      if (actual) return actual;
    }
  }
  if (FALLBACK_SVG_ICONS[id]) return FALLBACK_SVG_ICONS[id];
  return `<span class="echo-control-order-fallback-icon">${FALLBACK_ICONS[id] || "•"}</span>`;
};

const sidebarIconMarkup = (label) => {
  if (typeof document !== "undefined") {
    const row = [...document.querySelectorAll(".sidebar-nav-item")].find(
      (candidate) => sidebarLabel(candidate) === label,
    );
    const actual = iconSvgFor(row);
    if (actual) return actual;
  }
  return `<span class="echo-control-order-fallback-icon">•</span>`;
};

const SETTINGS_CSS = `
.echo-control-order-settings { display: grid; gap: 16px; container: echo-control-order-settings / inline-size; }
.echo-control-order-settings .echo-control-order-header { display: grid; gap: 5px; }
.echo-control-order-settings .echo-control-order-title { color: var(--color-text-main); font-size: 16px; font-weight: 850; }
.echo-control-order-settings .echo-control-order-hint,
.echo-control-order-settings .echo-control-order-description { color: color-mix(in srgb, var(--color-text-main) 56%, transparent); font-size: 11px; line-height: 1.5; }
.echo-control-order-settings .echo-control-order-section { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border-subtle); border-radius: 16px; background: var(--control-muted-bg); }
.echo-control-order-settings .echo-control-order-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.echo-control-order-settings .echo-control-order-section-title { color: var(--color-text-main); font-size: 14px; font-weight: 850; }
.echo-control-order-settings .echo-control-order-sidebar-groups { display: grid; gap: 10px; }
.echo-control-order-settings .echo-control-order-sidebar-group { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: 12px; background: color-mix(in srgb, var(--color-bg-elevated) 58%, transparent); }
.echo-control-order-settings .echo-control-order-sidebar-group-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.echo-control-order-settings .echo-control-order-sidebar-group-title { color: color-mix(in srgb, var(--color-text-main) 76%, transparent); font-size: 11px; font-weight: 850; }
.echo-control-order-settings .echo-control-order-sidebar-group-switch { display: flex; align-items: center; gap: 7px; color: color-mix(in srgb, var(--color-text-main) 62%, transparent); font-size: 10px; font-weight: 700; }
.echo-control-order-settings .echo-control-order-sidebar-list { display: grid; gap: 4px; }
.echo-control-order-settings .echo-control-order-sidebar-item { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 38px; padding: 7px 10px; border: 1px solid transparent; border-radius: 11px; color: var(--color-text-main); background: color-mix(in srgb, var(--color-bg-elevated) 65%, transparent); cursor: grab; text-align: left; }
.echo-control-order-settings .echo-control-order-sidebar-item:hover { border-color: var(--control-border); }
.echo-control-order-settings .echo-control-order-sidebar-item.is-disabled { opacity: .28; filter: grayscale(1); }
.echo-control-order-settings .echo-control-order-sidebar-item .echo-control-order-icon { width: 20px; height: 20px; display: grid; place-items: center; flex: 0 0 20px; color: var(--color-primary-text); }
.echo-control-order-settings .echo-control-order-sidebar-item .echo-control-order-icon svg { width: 18px; height: 18px; }
.echo-control-order-settings .echo-control-order-sidebar-state { margin-left: auto; color: color-mix(in srgb, var(--color-text-main) 48%, transparent); font-size: 10px; }
.echo-control-order-settings .echo-control-order-page { display: grid; gap: 10px; }
.echo-control-order-settings .echo-control-order-page-title { color: var(--color-text-main); font-size: 13px; font-weight: 850; }
.plugin-settings-dialog:has(.echo-control-order-settings) { left: var(--echo-settings-left, 2vw) !important; top: var(--echo-settings-top, 3vh) !important; right: auto !important; bottom: auto !important; width: var(--echo-settings-width, 96vw) !important; max-width: none !important; height: var(--echo-settings-height, 94vh) !important; max-height: none !important; margin: 0 !important; transform: none !important; box-sizing: border-box !important; }
.plugin-settings-dialog:has(.echo-control-order-settings) .plugin-settings-dialog-body { box-sizing: border-box !important; height: auto !important; max-height: none !important; overflow-y: auto !important; padding: 18px 22px 26px !important; }
.plugin-settings-dialog:has(.echo-control-order-settings) .plugin-settings-content.is-custom { min-height: 100%; }
.echo-control-order-settings .echo-control-order-control-preview { min-width: 0; overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }
.echo-control-order-settings .echo-control-order-track { display: grid; grid-template-columns: max-content max-content max-content; width: max-content; min-width: 100%; gap: 8px; align-items: stretch; justify-content: center; }
.echo-control-order-settings .echo-control-order-column { display: grid; align-content: start; gap: 7px; min-width: 0; padding: 9px; border: 1px dashed var(--control-border); border-radius: 12px; background: color-mix(in srgb, var(--color-bg-elevated) 58%, transparent); overflow: hidden; }
.echo-control-order-settings .echo-control-order-column-left,
.echo-control-order-settings .echo-control-order-column-center,
.echo-control-order-settings .echo-control-order-column-right { min-width: 0; width: max-content; max-width: 100%; }
.echo-control-order-settings .echo-control-order-column-center { width: max-content; max-width: 100%; }
.echo-control-order-settings .echo-control-order-column-title { color: color-mix(in srgb, var(--color-text-main) 72%, transparent); font-size: 10px; font-weight: 850; }
.echo-control-order-settings .echo-control-order-center-track { display: grid; grid-template-columns: max-content max-content max-content; align-items: stretch; justify-content: start; gap: 4px; width: max-content; max-width: 100%; min-width: 0; }
.echo-control-order-settings .echo-control-order-zone { position: relative; display: flex; flex: 0 1 auto; flex-wrap: nowrap; align-items: flex-end; box-sizing: border-box; gap: 3px; width: auto; max-width: 100%; min-width: 0; height: 76px; min-height: 76px; padding: 20px 5px 4px; border-radius: 9px; background: color-mix(in srgb, var(--color-text-main) 4%, transparent); overflow: hidden; }
.echo-control-order-settings .echo-control-order-zone-before,
.echo-control-order-settings .echo-control-order-zone-after { min-width: 0; }
.echo-control-order-settings .echo-control-order-zone-right { min-width: 0; overflow: hidden; }
.echo-control-order-settings .echo-control-order-zone-right .echo-control-order-item { flex: 1 1 0; max-width: 48px; }
.echo-control-order-settings .echo-control-order-zone-title { position: absolute; top: 4px; left: 5px; width: auto; color: color-mix(in srgb, var(--color-text-main) 50%, transparent); font-size: 9px; white-space: nowrap; }
.echo-control-order-settings .echo-control-order-item,
.echo-control-order-settings .echo-control-order-fixed { display: grid; place-items: center; gap: 2px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: 9px; color: var(--color-primary-text); background: var(--color-bg-elevated); cursor: grab; text-align: center; }
.echo-control-order-settings .echo-control-order-item { width: 48px; height: 52px; min-width: 0; min-height: 52px; max-width: 48px; padding: 4px 2px; flex: 0 1 48px; align-self: flex-end; grid-template-rows: 24px minmax(0, 1fr); touch-action: none; user-select: none; }
.echo-control-order-settings .echo-control-order-zone-left .echo-control-order-item { width: 42px; max-width: 42px; flex-basis: 42px; }
.echo-control-order-settings .echo-control-order-item.is-small { width: 42px; min-height: 46px; max-width: 42px; flex-basis: 42px; }
.echo-control-order-settings .echo-control-order-item.is-disabled { opacity: .25; filter: grayscale(1); }
.echo-control-order-settings .echo-control-order-item .echo-control-order-icon,
.echo-control-order-settings .echo-control-order-fixed .echo-control-order-icon { width: 24px; height: 24px; display: grid; place-items: center; }
.echo-control-order-settings .echo-control-order-icon svg { width: 21px; height: 21px; }
.echo-control-order-settings .echo-control-order-item-label { max-width: 100%; overflow: hidden; color: color-mix(in srgb, var(--color-text-main) 70%, transparent); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.echo-control-order-settings .echo-control-order-empty-slot { width: 48px; height: 52px; min-width: 48px; flex: 0 0 48px; align-self: flex-end; box-sizing: border-box; border: 1px dashed color-mix(in srgb, var(--color-text-main) 22%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--color-text-main) 2%, transparent); }
.echo-control-order-settings .echo-control-order-zone-left .echo-control-order-empty-slot { width: 42px; min-width: 42px; flex-basis: 42px; }
.echo-control-order-settings .echo-control-order-column-center { border-style: solid; border-color: var(--border-subtle); }
.echo-control-order-settings .echo-control-order-column-center .echo-control-order-zone { background: color-mix(in srgb, var(--color-primary) 5%, transparent); }
.echo-control-order-settings .echo-control-order-fixed-strip { position: relative; display: flex; flex: 0 0 auto; align-items: flex-end; justify-content: center; box-sizing: border-box; width: max-content; height: 76px; gap: 3px; padding: 20px 5px 4px; border: 0 solid transparent; border-radius: 9px; background: color-mix(in srgb, var(--color-primary) 8%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, var(--border-subtle)); }
.echo-control-order-settings .echo-control-order-fixed-strip-title { position: absolute; top: 4px; left: 5px; color: color-mix(in srgb, var(--color-text-main) 50%, transparent); font-size: 9px; white-space: nowrap; }
.echo-control-order-settings .echo-control-order-fixed { width: 48px; height: 52px; min-width: 0; min-height: 52px; max-height: 52px; max-width: none; padding: 4px 2px; opacity: .68; cursor: not-allowed; flex: 0 1 48px; align-self: flex-end; grid-template-rows: 24px minmax(0, 1fr); overflow: hidden; user-select: none; }
.echo-control-order-settings .echo-control-order-item.is-dragging,
.echo-control-order-settings .echo-control-order-sidebar-item.is-dragging { opacity: .45; cursor: grabbing; }
.echo-control-order-drag-ghost { position: fixed; z-index: 2147483647; pointer-events: none !important; margin: 0 !important; opacity: .92 !important; transform: translate3d(-50%, -50%, 0) rotate(2deg); transform-origin: center; box-shadow: 0 8px 20px color-mix(in srgb, var(--color-text-main) 18%, transparent); cursor: grabbing !important; }
.echo-control-order-drag-ghost * { pointer-events: none !important; }
.echo-control-order-settings .echo-control-order-item.is-drag-target,
.echo-control-order-settings .echo-control-order-sidebar-item.is-drag-target,
.echo-control-order-settings .echo-control-order-zone.is-drag-target { border-color: var(--color-primary) !important; box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent); }
.echo-control-order-settings .echo-control-order-sidebar-item { touch-action: none; user-select: none; }
.echo-control-order-settings:has(.is-dragging) { user-select: none; }
.echo-control-order-settings .echo-control-order-fallback-icon { display: grid; place-items: center; width: 100%; height: 100%; font-size: 18px; line-height: 1; }
.echo-control-order-settings .echo-control-order-reset { justify-self: start; padding: 7px 11px; border-radius: 9px; color: var(--color-text-main); background: var(--color-bg-elevated); font-size: 11px; font-weight: 750; }
.echo-control-order-settings .echo-control-order-reset:hover { background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-elevated)); }
.echo-control-order-sidebar-group-hidden { display: none !important; }
.echo-control-order-sidebar-hidden { display: none !important; }
.echo-control-order-sidebar-sort-container { display: flex !important; flex-direction: column !important; gap: 2px !important; }
.echo-control-order-slot-small,
.echo-control-order-slot-large { box-sizing: border-box !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex: 0 0 auto !important; margin: 0 !important; padding: 0 !important; }
.echo-control-order-slot-small { width: 32px !important; min-width: 32px !important; height: 30px !important; }
.echo-control-order-slot-large { width: 40px !important; min-width: 40px !important; height: 36px !important; }
.echo-control-order-slot-small > button,
.echo-control-order-slot-large > button { box-sizing: border-box !important; width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; }
.echo-control-order-slot-small svg,
.echo-control-order-slot-large svg { transform: none !important; }
.echo-control-order-container { gap: 4px !important; }
.echo-control-order-container { flex-wrap: nowrap !important; white-space: nowrap !important; }
.player-actions.echo-control-order-container,
.bar-right.echo-control-order-container,
.bar-song-actions.echo-control-order-container { min-width: 0 !important; max-width: 320px !important; overflow: visible !important; }
.player-actions.echo-control-order-container,
.bar-right.echo-control-order-container { justify-content: flex-end !important; }
.bar-right.echo-control-order-container { justify-self: end !important; }
.bar-song-actions.echo-control-order-container { justify-content: flex-start !important; }
.echo-control-order-hidden { display: none !important; }
.echo-control-order-fixed-slot { cursor: default !important; }
@media (max-width: 720px) {
  .plugin-settings-dialog:has(.echo-control-order-settings) { width: 98vw !important; max-width: 98vw !important; }
  .echo-control-order-settings .echo-control-order-track { grid-template-columns: max-content max-content max-content; }
}
`;

let runtimeCtx = null;
let state = null;
let styleDispose = null;
let settingsDispose = null;
let settingsDialogBoundsDispose = null;
let routeDispose = null;
let sidebarObserveDispose = null;
let pageObserveDisposes = [];
const pages = new Set();
const sidebarRecords = new Set();

const observeSettingsDialogBounds = () => {
  if (typeof document === "undefined") return () => {};
  let frame = 0;
  let observedMainContent = null;
  let resizeObserver = null;
  const sync = () => {
    frame = 0;
    const dialog = document.querySelector(".plugin-settings-dialog");
    const settings = dialog?.querySelector(".echo-control-order-settings");
    const mainContent = document.querySelector(".main-content");
    if (!dialog || !settings || !mainContent) return;
    if (resizeObserver && observedMainContent !== mainContent) {
      if (observedMainContent) resizeObserver.unobserve(observedMainContent);
      resizeObserver.observe(mainContent);
      observedMainContent = mainContent;
    }
    const rect = mainContent.getBoundingClientRect();
    const width = Math.max(0, rect.width);
    const height = Math.max(0, rect.height);
    dialog.style.setProperty("--echo-settings-left", `${Math.max(0, rect.left)}px`);
    dialog.style.setProperty("--echo-settings-top", `${Math.max(0, rect.top)}px`);
    dialog.style.setProperty("--echo-settings-width", `${width}px`);
    dialog.style.setProperty("--echo-settings-height", `${height}px`);
  };
  const schedule = () => {
    if (frame) return;
    frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(sync) : setTimeout(sync, 0);
  };
  resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  const mutationObserver = typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
  mutationObserver?.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  schedule();
  return () => {
    if (frame) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      else clearTimeout(frame);
    }
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    window.removeEventListener("resize", schedule);
  };
};

const createSettingsComponent = (ctx) => {
  const { defineComponent, h, reactive } = ctx.vue;
  const Switch = ctx.vue.defineAsyncComponent(ctx.ui.components.Switch);

  return defineComponent({
    name: "EchoPlaybackControlOrderSettings",
    setup() {
      const draft = reactive(normalizeSettings(state.settings));
      let dragging = null;
      let suppressClickUntil = 0;

      const save = () => updateStoredSettings(draft);
      const reset = () => {
        Object.assign(draft, normalizeSettings(DEFAULT_SETTINGS));
        save();
      };
      const toggleHidden = (pageId, id) => {
        if (Date.now() < suppressClickUntil) return;
        const hidden = draft[pageId].hidden;
        const index = hidden.indexOf(id);
        if (index >= 0) hidden.splice(index, 1);
        else hidden.push(id);
        save();
      };
      const toggleSidebarHidden = (groupId, id) => {
        if (Date.now() < suppressClickUntil) return;
        const hidden = draft.sidebar[groupId].hidden;
        const index = hidden.indexOf(id);
        if (index >= 0) hidden.splice(index, 1);
        else hidden.push(id);
        save();
      };
      const toggleSidebarGroup = (groupId, value) => {
        draft.sidebar[groupId].visible = Boolean(value);
        save();
      };
      const clearDragTarget = () => {
        dragging?.targetNode?.classList.remove("is-drag-target");
        dragging.targetNode = null;
      };
      const updateDragGhost = (event) => {
        const ghost = dragging?.ghostNode;
        if (!ghost) return;
        ghost.style.left = `${Math.round(event.clientX)}px`;
        ghost.style.top = `${Math.round(event.clientY)}px`;
      };
      const createDragGhost = (event) => {
        if (!dragging?.sourceNode || typeof document === "undefined") return;
        const source = dragging.sourceNode;
        const rect = source.getBoundingClientRect?.();
        const ghost = source.cloneNode?.(true);
        if (!rect || !ghost) return;
        const layer = document.createElement("div");
        layer.className = "echo-control-order-settings echo-control-order-drag-layer";
        layer.style.position = "fixed";
        layer.style.inset = "0";
        layer.style.display = "block";
        layer.style.width = "0";
        layer.style.height = "0";
        layer.style.pointerEvents = "none";
        layer.style.zIndex = "2147483646";
        layer.style.transform = "none";
        layer.style.filter = "none";
        ghost.classList.remove("is-dragging", "is-drag-target");
        ghost.classList.add("echo-control-order-drag-ghost");
        ghost.setAttribute?.("aria-hidden", "true");
        ghost.style.width = `${Math.round(rect.width)}px`;
        ghost.style.height = `${Math.round(rect.height)}px`;
        ghost.style.minWidth = `${Math.round(rect.width)}px`;
        ghost.style.maxWidth = `${Math.round(rect.width)}px`;
        ghost.style.boxSizing = "border-box";
        layer.append(ghost);
        document.body?.append(layer);
        dragging.ghostLayer = layer;
        dragging.ghostNode = ghost;
        updateDragGhost(event);
      };
      const clearDragGhost = () => {
        const layer = dragging?.ghostLayer;
        const ghost = dragging?.ghostNode;
        layer?.remove?.();
        if (!layer) ghost?.remove?.();
        if (dragging) {
          dragging.ghostLayer = null;
          dragging.ghostNode = null;
        }
      };
      const setDragTarget = (node) => {
        if (dragging?.targetNode === node) return;
        clearDragTarget();
        if (node) {
          node.classList.add("is-drag-target");
          dragging.targetNode = node;
        }
      };
      const targetAtPoint = (event) => {
        if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return null;
        return document.elementFromPoint(event.clientX, event.clientY);
      };
      const resolveControlTarget = (pageId, event) => {
        const hit = targetAtPoint(event);
        const item = hit?.closest?.('[data-echo-control-order-kind="control-item"]');
        if (item?.dataset.echoControlOrderPage === pageId) {
          const rect = item.getBoundingClientRect();
          const index = Number(item.dataset.echoControlOrderIndex);
          return {
            node: item,
            zone: item.dataset.echoControlOrderZone,
            index: Number.isFinite(index) && event.clientX > rect.left + rect.width / 2 ? index + 1 : index,
          };
        }
        const zone = hit?.closest?.('[data-echo-control-order-kind="control-zone"]');
        if (zone?.dataset.echoControlOrderPage === pageId) {
          const zoneId = zone.dataset.echoControlOrderZone;
          return { node: zone, zone: zoneId, index: draft[pageId][zoneId]?.length || 0 };
        }
        return null;
      };
      const resolveSidebarTarget = (groupId, event) => {
        const hit = targetAtPoint(event);
        const item = hit?.closest?.('[data-echo-control-order-kind="sidebar-item"]');
        if (item?.dataset.echoControlOrderGroup === groupId) {
          const rect = item.getBoundingClientRect();
          const index = Number(item.dataset.echoControlOrderIndex);
          return {
            node: item,
            index: Number.isFinite(index) && event.clientY > rect.top + rect.height / 2 ? index + 1 : index,
          };
        }
        const zone = hit?.closest?.('[data-echo-control-order-kind="sidebar-zone"]');
        if (zone?.dataset.echoControlOrderGroup === groupId) {
          return { node: zone, index: draft.sidebar[groupId].items.length };
        }
        return null;
      };
      const dropControlAt = (pageId, zone, index) => {
        if (!dragging || dragging.kind !== "control" || dragging.owner !== pageId) return false;
        const source = draft[pageId][dragging.zone];
        const target = draft[pageId][zone];
        const id = source[dragging.index];
        if (!id || !target) return false;
        if (source === target) moveItem(source, dragging.index, index);
        else {
          source.splice(dragging.index, 1);
          target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
        }
        return true;
      };
      const dropSidebarAt = (groupId, index) => {
        if (!dragging || dragging.kind !== "sidebar" || dragging.owner !== groupId) return false;
        const list = draft.sidebar[groupId].items;
        if (!list[dragging.index]) return false;
        moveItem(list, dragging.index, index);
        return true;
      };
      const startPointerDrag = (kind, owner, zone, index, event) => {
        if (dragging) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const sourceNode = event.currentTarget;
        dragging = {
          kind,
          owner,
          zone,
          index,
          pointerId: event.pointerId,
          sourceNode,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
          targetNode: null,
        };
        sourceNode?.setPointerCapture?.(event.pointerId);
      };
      const updatePointerDrag = (event) => {
        if (!dragging || dragging.pointerId !== event.pointerId) return;
        if (!dragging.active) {
          const distance = Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY);
          if (distance < 4) return;
          dragging.active = true;
          dragging.sourceNode?.classList.add("is-dragging");
          if (typeof document !== "undefined") document.body?.classList.add("echo-control-order-dragging");
          createDragGhost(event);
        }
        event.preventDefault();
        updateDragGhost(event);
        const target =
          dragging.kind === "control"
            ? resolveControlTarget(dragging.owner, event)
            : resolveSidebarTarget(dragging.owner, event);
        setDragTarget(target?.node || null);
      };
      const finishPointerDrag = (event, cancelled = false) => {
        if (!dragging || dragging.pointerId !== event.pointerId) return;
        const current = dragging;
        let changed = false;
        if (current.active && !cancelled) {
          event.preventDefault();
          const target =
            current.kind === "control"
              ? resolveControlTarget(current.owner, event)
              : resolveSidebarTarget(current.owner, event);
          if (target) {
            changed =
              current.kind === "control"
                ? dropControlAt(current.owner, target.zone, target.index)
                : dropSidebarAt(current.owner, target.index);
          }
        }
        if (current.active || changed) suppressClickUntil = Date.now() + 160;
        current.sourceNode?.classList.remove("is-dragging");
        clearDragTarget();
        clearDragGhost();
        if (typeof document !== "undefined") document.body?.classList.remove("echo-control-order-dragging");
        if (current.sourceNode?.hasPointerCapture?.(current.pointerId)) {
          current.sourceNode.releasePointerCapture(current.pointerId);
        }
        dragging = null;
        if (changed) save();
      };

      const renderSidebarItem = (groupId, id, index) => {
        const meta = SIDEBAR_GROUPS[groupId];
        const label = meta.items.find(([itemId]) => itemId === id)?.[1] || id;
        const disabled = draft.sidebar[groupId].hidden.includes(id) || !draft.sidebar[groupId].visible;
        return h(
          "button",
          {
            key: `${groupId}-${id}`,
            type: "button",
            class: ["echo-control-order-sidebar-item", disabled ? "is-disabled" : ""],
            "data-echo-control-order-kind": "sidebar-item",
            "data-echo-control-order-group": groupId,
            "data-echo-control-order-index": String(index),
            onClick: () => toggleSidebarHidden(groupId, id),
            onPointerdown: (event) => startPointerDrag("sidebar", groupId, "items", index, event),
            onPointermove: updatePointerDrag,
            onPointerup: finishPointerDrag,
            onPointercancel: (event) => finishPointerDrag(event, true),
          },
          [
            h("span", { class: "echo-control-order-icon", "aria-hidden": "true", innerHTML: sidebarIconMarkup(label) }),
            h("span", { class: "min-w-0 flex-1 truncate" }, label),
            h("span", { class: "echo-control-order-sidebar-state" }, disabled ? "不显示" : "显示"),
          ],
        );
      };

      const renderSidebarGroup = (groupId) => {
        const meta = SIDEBAR_GROUPS[groupId];
        const group = draft.sidebar[groupId];
        return h("div", { class: "echo-control-order-sidebar-group", key: groupId }, [
          h("div", { class: "echo-control-order-sidebar-group-heading" }, [
            h("div", { class: "echo-control-order-sidebar-group-title" }, meta.title),
            groupId === "playlists"
              ? h("label", { class: "echo-control-order-sidebar-group-switch" }, [
                  h("span", "显示歌单类"),
                  h(Switch, {
                    modelValue: group.visible,
                    "onUpdate:modelValue": (value) => toggleSidebarGroup(groupId, value),
                  }),
                ])
              : null,
          ]),
          h("div", { class: "echo-control-order-description" }, meta.description),
          h(
            "div",
            {
              class: "echo-control-order-sidebar-list",
              "data-echo-control-order-kind": "sidebar-zone",
              "data-echo-control-order-group": groupId,
            },
            group.items.map((id, index) => renderSidebarItem(groupId, id, index)),
          ),
        ]);
      };

      const controlLabel = (pageId, id) =>
        id === "comments" ? (pageId === "home" ? "评论及详情" : "评论") : CONTROL_LABELS[id] || id;

      const renderControlItem = (pageId, zone, id, index) => {
        const disabled = draft[pageId].hidden.includes(id);
        return h(
          "button",
          {
            key: `${pageId}-${zone}-${id}`,
            type: "button",
            class: ["echo-control-order-item", zone === "left" ? "is-small" : "", disabled ? "is-disabled" : ""],
            "data-echo-control-order-kind": "control-item",
            "data-echo-control-order-page": pageId,
            "data-echo-control-order-zone": zone,
            "data-echo-control-order-index": String(index),
            title: disabled ? `点击启用${controlLabel(pageId, id)}` : `点击停用${controlLabel(pageId, id)}`,
            onClick: () => toggleHidden(pageId, id),
            onPointerdown: (event) => startPointerDrag("control", pageId, zone, index, event),
            onPointermove: updatePointerDrag,
            onPointerup: finishPointerDrag,
            onPointercancel: (event) => finishPointerDrag(event, true),
          },
          [
            h("span", { class: "echo-control-order-icon", "aria-hidden": "true", innerHTML: controlIconMarkup(id, pageId) }),
            h("span", { class: "echo-control-order-item-label" }, controlLabel(pageId, id)),
          ],
        );
      };

      const renderZone = (pageId, zone) =>
        h(
          "div",
          {
            class: ["echo-control-order-zone", `echo-control-order-zone-${zone}`, zone === "right" ? "echo-control-order-zone-right" : ""],
            "data-echo-control-order-kind": "control-zone",
            "data-echo-control-order-page": pageId,
            "data-echo-control-order-zone": zone,
          },
          [
            h("div", { class: "echo-control-order-zone-title" }, ZONE_LABELS[zone]),
            ...(draft[pageId][zone].length
              ? draft[pageId][zone].map((id, index) => renderControlItem(pageId, zone, id, index))
              : [h("div", { class: "echo-control-order-empty-slot", "aria-hidden": "true" })]),
          ],
        );

      const controlLayout = (pageId) => {
        return {
          track: "max-content max-content max-content",
          center: "max-content max-content max-content",
        };
      };

      const renderFixed = (pageId, id) =>
        h("div", { class: "echo-control-order-fixed", key: `${pageId}-fixed-${id}` }, [
          h("span", { class: "echo-control-order-icon", "aria-hidden": "true", innerHTML: controlIconMarkup(id, pageId) }),
          h("span", { class: "echo-control-order-item-label" }, FIXED_CONTROL_LABELS[id]),
        ]);

      const renderControlPage = (pageId) =>
        h("section", { class: "echo-control-order-page", key: pageId }, [
          h("div", { class: "echo-control-order-page-title" }, pageId === "home" ? "首页播放控件" : "播放器页控件"),
          h("div", { class: "echo-control-order-hint" }, "点击图标切换显示状态：亮色为启用，虚影为停用；拖动图标可在左、中、右区域内排序。"),
          h("div", { class: "echo-control-order-control-preview" }, [
            h("div", { class: "echo-control-order-track", style: { gridTemplateColumns: controlLayout(pageId).track } }, [
              h("div", { class: "echo-control-order-column echo-control-order-column-left" }, [
                h("div", { class: "echo-control-order-column-title" }, "左区"),
                renderZone(pageId, "left"),
              ]),
              h("div", { class: "echo-control-order-column echo-control-order-column-center" }, [
                h("div", { class: "echo-control-order-column-title" }, "中区"),
                h("div", { class: "echo-control-order-center-track", style: { gridTemplateColumns: controlLayout(pageId).center } }, [
                  renderZone(pageId, "before"),
                  h("div", { class: "echo-control-order-fixed-strip" }, [
                    h("div", { class: "echo-control-order-fixed-strip-title" }, "固定"),
                    renderFixed(pageId, "previous"),
                    renderFixed(pageId, "play"),
                    renderFixed(pageId, "next"),
                  ]),
                  renderZone(pageId, "after"),
                ]),
              ]),
              h("div", { class: "echo-control-order-column echo-control-order-column-right" }, [
                h("div", { class: "echo-control-order-column-title" }, "右区"),
                renderZone(pageId, "right"),
              ]),
            ]),
          ]),
        ]);

      return () =>
        h("div", { class: "echo-control-order-settings" }, [
          h("div", { class: "echo-control-order-header" }, [
            h("div", { class: "echo-control-order-title" }, "界面与播放控件"),
            h("div", { class: "echo-control-order-hint" }, "统一管理侧边栏、首页播放栏和播放器页控制栏。每个区域的控件槽位已统一，左区使用小规格，中区与右区使用大规格。"),
          ]),
          h("label", { class: "flex items-center justify-between gap-3 text-xs font-bold" }, [
            h("span", "启用界面与播放控件自定义"),
            h(Switch, {
              modelValue: draft.enabled,
              "onUpdate:modelValue": (value) => {
                draft.enabled = Boolean(value);
                save();
              },
            }),
          ]),
          h("section", { class: "echo-control-order-section" }, [
            h("div", { class: "echo-control-order-section-heading" }, [
              h("div", { class: "echo-control-order-section-title" }, "侧边栏"),
              h("div", { class: "echo-control-order-hint" }, "同一分类内拖动，不能跨分类。"),
            ]),
            h("div", { class: "echo-control-order-sidebar-groups" }, SIDEBAR_GROUP_IDS.map(renderSidebarGroup)),
          ]),
          h("section", { class: "echo-control-order-section" }, [renderControlPage("home")]),
          h("section", { class: "echo-control-order-section" }, [renderControlPage("player")]),
          h("button", { type: "button", class: "echo-control-order-reset", onClick: reset }, "恢复全部默认显示与顺序"),
        ]);
    },
  });
};

export async function activate(ctx) {
  runtimeCtx = ctx;
  const savedSettings =
    typeof ctx?.storage?.get === "function" ? await ctx.storage.get(STORAGE_KEY) : null;
  const reactive = typeof ctx?.vue?.reactive === "function" ? ctx.vue.reactive : (value) => value;
  state = reactive({ settings: normalizeSettings(savedSettings) });
  styleDispose =
    typeof ctx?.css?.inject === "function"
      ? ctx.css.inject(SETTINGS_CSS, { id: "playback-control-order" })
      : null;
  settingsDialogBoundsDispose = observeSettingsDialogBounds();
  if (
    typeof ctx?.ui?.settings?.define === "function" &&
    typeof ctx?.vue?.defineComponent === "function" &&
    typeof ctx?.vue?.defineAsyncComponent === "function" &&
    ctx?.ui?.components?.Switch
  ) {
    settingsDispose = ctx.ui.settings.define({
      title: "界面与播放控件",
      description: "统一隐藏、显示和排序侧边栏及两个播放界面的控件。",
      component: createSettingsComponent(ctx),
    });
  }
  routeDispose =
    typeof ctx?.router?.afterEach === "function" ? ctx.router.afterEach(() => applyAllLayouts()) : null;
  pageObserveDisposes = [
    observeSelectorCompat(ctx, ".player-bar", (root) => observePage("home", root)),
    observeSelectorCompat(ctx, ".lyric-bar", (root) => observePage("player", root)),
  ];
  sidebarObserveDispose = observeSelectorCompat(ctx, ".sidebar", observeSidebar);
  applyAllLayouts();
}

export function deactivate() {
  for (const page of pages) {
    page.disposed = true;
    restorePage(page);
  }
  pages.clear();
  for (const record of sidebarRecords) {
    record.disposed = true;
    record.observer?.disconnect();
    restoreSidebar(record);
  }
  sidebarRecords.clear();
  for (const dispose of pageObserveDisposes) dispose?.();
  pageObserveDisposes = [];
  sidebarObserveDispose?.();
  routeDispose?.();
  settingsDispose?.();
  settingsDialogBoundsDispose?.();
  styleDispose?.();
  sidebarObserveDispose = null;
  routeDispose = null;
  settingsDispose = null;
  settingsDialogBoundsDispose = null;
  styleDispose = null;
  runtimeCtx = null;
  state = null;
}
