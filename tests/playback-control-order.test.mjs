import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../playback-control-order/manifest.json", import.meta.url), "utf8"),
);

const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      await (await import("node:fs/promises")).readFile(
        new URL("../playback-control-order/index.js", import.meta.url),
      ),
    ).toString("base64"),
);

const source = await readFile(new URL("../playback-control-order/index.js", import.meta.url), "utf8");

test("playback control order keeps each movable control once and fills missing controls", () => {
  const layout = api.normalizeLayout(
    {
      left: ["volume", "volume", "unknown"],
      right: ["favorite"],
    },
    {
      left: ["favorite"],
      before: ["playMode"],
      after: [],
      right: ["volume"],
    },
    ["favorite", "volume", "playMode"],
  );

  assert.deepEqual(layout, {
    left: ["volume"],
    before: ["playMode"],
    after: [],
    right: ["favorite"],
  });
});

test("playback control order moves items using the pre-removal drop index", () => {
  const items = ["favorite", "add", "comments", "mv"];

  api.moveItem(items, 0, 3);
  assert.deepEqual(items, ["add", "comments", "favorite", "mv"]);

  api.moveItem(items, 2, 1);
  assert.deepEqual(items, ["add", "favorite", "comments", "mv"]);
});

test("playback control order normalizes settings independently for home and player", () => {
  const settings = api.normalizeSettings({
    enabled: false,
    home: { left: ["mv", "mv"] },
  });

  assert.equal(settings.enabled, false);
  assert.deepEqual(settings.home.left.slice(0, 2), ["mv", "favorite"]);
  assert.deepEqual(settings.player.left.slice(0, 3), ["favorite", "add", "comments"]);
});

test("merged settings default to visible sidebar items and controls", () => {
  const settings = api.normalizeSettings({});

  assert.deepEqual(settings.sidebar.discover.items, ["home", "explore"]);
  assert.deepEqual(settings.sidebar.library.items, [
    "favorites",
    "personal-fm",
    "cloud",
    "history",
    "purchased",
  ]);
  assert.deepEqual(settings.sidebar.playlists.hidden, []);
  assert.deepEqual(settings.home.hidden, []);
  assert.deepEqual(settings.player.hidden, []);
  assert.ok(settings.player.left.includes("barrage"));
});

test("merged settings keep sorting inside the selected page and sidebar group", () => {
  const settings = api.normalizeSettings({
    sidebar: { discover: { items: ["explore", "library", "explore"] } },
    home: { left: ["volume"], hidden: ["volume", "barrage"] },
  });

  assert.deepEqual(settings.sidebar.discover.items, ["explore", "home"]);
  assert.deepEqual(settings.home.left, ["volume", "favorite", "add", "comments", "mv"]);
  assert.deepEqual(settings.home.hidden, ["volume"]);
});

test("playlist category visibility is independent from fixed playlist item visibility", () => {
  const settings = api.normalizeSettings({
    sidebar: {
      playlists: { visible: true, hidden: ["defaultFavorite", "likedPlaylist"] },
    },
  });

  assert.equal(settings.sidebar.playlists.visible, true);
  assert.deepEqual(settings.sidebar.playlists.hidden, ["defaultFavorite", "likedPlaylist"]);

  const categoryHidden = api.normalizeSettings({ sidebar: { playlists: { visible: false } } });
  assert.equal(categoryHidden.sidebar.playlists.visible, false);
  assert.deepEqual(categoryHidden.sidebar.playlists.hidden, []);
});

test("playback control order requires the beta.4 plugin host", () => {
  assert.equal(manifest.requires.echoMusicVersion, ">=2.3.2-beta.4");
});

test("player defaults include the beta.5 skin control", () => {
  const settings = api.normalizeSettings({});

  assert.equal(settings.player.right[0], "skin");
});

test("playback control order does not observe the whole player subtree", () => {
  assert.doesNotMatch(source, /page\.observer\s*=\s*new MutationObserver/);
  assert.doesNotMatch(source, /page\.observer\?\.observe\(page\.root/);
});

test("playback control order uses pointer capture for reliable drag gestures", () => {
  assert.match(source, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(source, /elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.doesNotMatch(source, /draggable:\s*true/);
});

test("playback control order keeps empty zones droppable and aligns fixed controls with movable controls", () => {
  assert.match(source, /echo-control-order-empty-slot/);
  assert.match(source, /justify-content: center/);
  assert.match(source, /echo-control-order-fixed-strip-title.*固定/);
  assert.match(source, /echo-control-order-fixed.*grid-template-rows: 24px minmax\(0, 1fr\)/);
  assert.doesNotMatch(source, /echo-control-order-fixed-lock/);
});

test("playback control order centers the drag ghost on the pointer", () => {
  assert.match(source, /translate3d\(-50%, -50%, 0\)/);
  assert.match(source, /ghost\.style\.left.*event\.clientX/);
  assert.match(source, /ghost\.style\.top.*event\.clientY/);
  assert.match(source, /pointer-events: none/);
  assert.match(source, /echo-control-order-drag-layer/);
  assert.match(source, /layer\.style\.position = "fixed"/);
  assert.match(source, /createDragGhost/);
  assert.match(source, /clearDragGhost/);
});
