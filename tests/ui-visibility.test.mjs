import assert from "node:assert/strict";
import test from "node:test";

const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      await (await import("node:fs/promises")).readFile(
        new URL("../ui-visibility/index.js", import.meta.url),
      ),
    ).toString("base64"),
);

test("ui visibility normalizes settings and keeps bottom-bar attributes across routes", () => {
  const settings = api.normalizeSettings({
    enabled: true,
    hideHomeComments: true,
    hidePlayerComments: true,
  });
  assert.equal(api.isHomeRoute({ name: "home", path: "/main/home" }), true);
  assert.equal(api.isHomeRoute({ name: "favorites", path: "/main/favorites" }), false);
  assert.equal(api.getVisibilityAttributes(settings, true).homeComments, true);
  assert.equal(api.getVisibilityAttributes(settings, false).homeComments, true);
  assert.equal(api.getVisibilityAttributes(settings, false).playerComments, true);
});

test("ui visibility accepts only the exact default-favorite label", () => {
  const span = (text) => ({ textContent: text });
  const element = {
    querySelectorAll: () => [span("我喜欢"), span("默认收藏")],
  };
  assert.equal(api.isDefaultFavoriteItem(element), true);
  assert.equal(
    api.isDefaultFavoriteItem({ querySelectorAll: () => [span("我的默认收藏副本")] }),
    false,
  );
});
