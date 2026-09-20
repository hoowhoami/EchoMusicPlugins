import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = JSON.parse(
  await readFile(new URL("../echo-plugins.json", import.meta.url), "utf8"),
);

test("MV and playback plugin entries use the repository containing this PR", () => {
  for (const id of ["mv-enhancer", "playback-control-order"]) {
    const plugin = source.plugins.find((entry) => entry.id === id);
    assert.ok(plugin, `missing plugin source entry: ${id}`);
    assert.equal(plugin.repo, "https://github.com/hoowhoami/EchoMusicPlugins");
    assert.equal(
      plugin.homepage,
      `https://github.com/hoowhoami/EchoMusicPlugins/tree/main/${plugin.path}`,
    );
  }
});
