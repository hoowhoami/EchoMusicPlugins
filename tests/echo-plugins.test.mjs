import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = JSON.parse(
  await readFile(new URL("../echo-plugins.json", import.meta.url), "utf8"),
);

test("MV plugin entry uses its upstream repository and directory homepage", () => {
  const plugin = source.plugins.find((entry) => entry.id === "mv-enhancer");
  assert.ok(plugin, "missing plugin source entry: mv-enhancer");
  assert.equal(plugin.repo, "https://github.com/hoowhoami/EchoMusicPlugins");
  assert.equal(
    plugin.homepage,
    `https://github.com/hoowhoami/EchoMusicPlugins/tree/main/${plugin.path}`,
  );
});
