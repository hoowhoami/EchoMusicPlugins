import assert from "node:assert/strict";
import test from "node:test";

const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      await (await import("node:fs/promises")).readFile(
        new URL("../playback-control-order/index.js", import.meta.url),
      ),
    ).toString("base64"),
);

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
