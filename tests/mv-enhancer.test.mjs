import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await (await import("node:fs/promises")).readFile(
  new URL("../mv-enhancer/index.js", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  await readFile(new URL("../mv-enhancer/manifest.json", import.meta.url), "utf8"),
);
const api = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64"),
);

const payload = {
  data: [
    [
      {
        video_id: "v1",
        hash: "version-hash-1",
        mv_name: "正式版",
        hdpic: "http://c1.kgimg.com/{size}/mv-v1.jpg",
        h264: {
          fhd_hash: "h264-fhd",
          fhd_bitrate: 4136000,
          fhd_width: 1920,
          fhd_height: 1080,
          fhd_filesize: 21000000,
          hd_hash: "h264-hd",
          hd_bitrate: 2135000,
          hd_width: 1280,
          hd_height: 720,
        },
        h265: {
          fhd_hash: "h265-fhd",
          fhd_bitrate: 2380000,
          fhd_width: 1920,
          fhd_height: 1080,
        },
      },
      {
        video_id: "v2",
        hash: "version-hash-2",
        mv_name: "预告版",
        h264: { hd_hash: "trailer-hd", hd_bitrate: 1000000 },
      },
    ],
  ],
};

test("MV enhancer parses every returned video version and source", () => {
  const versions = api.parseMvVersions(payload);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].title, "正式版");
  assert.equal(versions[1].title, "预告版");
  assert.equal(versions[0].sources.length, 3);
  assert.equal(versions[0].cover, "https://imge.kugou.com/400/mv-v1.jpg");
  assert.equal(api.formatBitrate(4136000), "4136 kbps");
  assert.equal(api.formatResolution(versions[0].sources[0]), "1920×1080");
});

test("MV enhancer chooses the highest H.265 resolution then falls back to highest H.264", () => {
  const sources = api.parseMvVersions(payload)[0].sources;
  assert.equal(api.pickDefaultSource(sources).hash, "h265-fhd");
  assert.equal(api.pickDefaultSource(sources.filter((source) => source.codec !== "H.265")).hash, "h264-fhd");
  assert.equal(api.pickDefaultSource([...sources, { codec: "H.265", hash: "h265-hd", width: 1280, height: 720 }]).hash, "h265-fhd");
  assert.equal(api.pickDefaultSource([]), null);
});

test("MV search detail only resolves a song when its versions contain the current MV", () => {
  const detail = { data: [{ album_audio_id: 123456 }] };
  assert.equal(api.matchSongIdForMv(detail, payload, { videoId: "v1" }), "123456");
  assert.equal(api.matchSongIdForMv(detail, payload, { hash: "version-hash-2" }), "123456");
  assert.equal(api.matchSongIdForMv(detail, payload, { hash: "unrelated" }), "");
  assert.equal(api.matchSongIdForMv({ data: [{ album_audio_id: 0 }] }, payload, { videoId: "v1" }), "");
  assert.equal(api.matchSongIdForMv(detail, { data: [] }, { videoId: "v1" }), "");
});

test("MV enhancer does not impose a host version gate", () => {
  assert.equal(manifest.requires, undefined);
});

test("MV versions scroll horizontally, show duration under artist, and remove quality selectors", () => {
  assert.match(source, /\.echo-mv-enhancer-version-list\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/s);
  assert.match(source, /\.echo-mv-enhancer-detail-card\s*\{[^}]*flex:\s*0 0 clamp\(/s);
  assert.match(source, /list\.setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /if \(!suppressClick\) return;/);
  assert.match(source, /detailCopy\.append\(createElement\("div", "echo-mv-enhancer-detail-meta", `时长 /);
  assert.doesNotMatch(source, /echo-mv-enhancer-quality-bar|echo-mv-enhancer-select|renderQuality/);
  assert.match(source, /matchSongIdForMv\(detail, versions, routeKey\)/);
});
