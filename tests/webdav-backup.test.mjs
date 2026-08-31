import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activate,
  buildWebDavDirectoryUrl,
  buildWebDavFileUrl,
  createWebDavProvider,
  deactivate,
  normalizeWebDavConfig,
  parseWebDavEntries,
  resolveWebDavConfig,
  toPersistedWebDavConfig,
} from "../webdav-backup/webdav.mjs";

const CONFIG = {
  enabled: true,
  url: "https://dav.example.com/root",
  username: "用户",
  password: "secret",
  directory: "EchoMusic/Backups",
};

test("normalizes and validates WebDAV configuration and paths", () => {
  assert.deepEqual(
    normalizeWebDavConfig({ directory: "/EchoMusic//Backups/" }),
    {
      enabled: false,
      url: "",
      username: "",
      password: "",
      directory: "EchoMusic/Backups",
      rememberPassword: false,
    },
  );
  assert.equal(
    resolveWebDavConfig(CONFIG).url,
    "https://dav.example.com/root/",
  );
  assert.equal(
    buildWebDavDirectoryUrl(CONFIG),
    "https://dav.example.com/root/EchoMusic/Backups/",
  );
  assert.equal(
    buildWebDavFileUrl(CONFIG, "EchoMusic-2026.echomusic-backup"),
    "https://dav.example.com/root/EchoMusic/Backups/EchoMusic-2026.echomusic-backup",
  );
  assert.throws(
    () =>
      resolveWebDavConfig({
        ...CONFIG,
        url: "https://user:pass@dav.example.com/",
      }),
    /不要把用户名或密码写入/,
  );
  assert.throws(
    () => normalizeWebDavConfig({ directory: "../private" }),
    /不能包含/,
  );
  assert.throws(
    () => buildWebDavFileUrl(CONFIG, "../backup.echomusic-backup"),
    /文件名无效/,
  );
  assert.equal(toPersistedWebDavConfig(CONFIG).password, "");
  assert.equal(
    toPersistedWebDavConfig({ ...CONFIG, rememberPassword: true }).password,
    "secret",
  );
});

test("parses namespaced WebDAV multistatus responses", () => {
  const xml = `<?xml version="1.0"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response><D:href>/root/EchoMusic/Backups/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
      <D:response><D:href>/root/EchoMusic/Backups/EchoMusic%202.echomusic-backup</D:href><D:propstat><D:prop><D:getlastmodified>Sun, 30 Aug 2026 12:00:00 GMT</D:getlastmodified><D:getcontentlength>2048</D:getcontentlength></D:prop></D:propstat></D:response>
      <D:response><D:href>/root/EchoMusic/Backups/readme.txt</D:href></D:response>
    </D:multistatus>`;
  assert.deepEqual(parseWebDavEntries(xml, buildWebDavDirectoryUrl(CONFIG)), [
    {
      id: "EchoMusic 2.echomusic-backup",
      name: "EchoMusic 2.echomusic-backup",
      createdAt: "2026-08-30T12:00:00.000Z",
      size: 2048,
    },
  ]);
});

test("provider creates directories and performs save, list, load and remove", async () => {
  const calls = [];
  let echoMusicExists = false;
  let backupsExists = false;
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const ctx = {
    net: {
      request: async (request) => {
        calls.push(request);
        const url = request.url;
        if (request.method === "PROPFIND" && request.headers.Depth === "0") {
          if (url.endsWith("/EchoMusic/Backups/"))
            return { status: backupsExists ? 207 : 404, data: "" };
          if (url.endsWith("/EchoMusic/"))
            return { status: echoMusicExists ? 207 : 404, data: "" };
          return { status: 207, data: "" };
        }
        if (request.method === "MKCOL") {
          if (url.endsWith("/EchoMusic/")) echoMusicExists = true;
          if (url.endsWith("/EchoMusic/Backups/")) backupsExists = true;
          return { status: 201, data: "" };
        }
        if (request.method === "PUT") return { status: 201, data: "" };
        if (request.method === "PROPFIND" && request.headers.Depth === "1") {
          return {
            status: 207,
            data: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/root/EchoMusic/Backups/backup.echomusic-backup</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>`,
          };
        }
        if (request.method === "GET") return { status: 200, data: bytes };
        if (request.method === "DELETE") return { status: 204, data: "" };
        throw new Error(`Unexpected request: ${request.method} ${url}`);
      },
    },
  };
  const provider = createWebDavProvider(ctx, CONFIG);
  const signal = new AbortController().signal;

  await provider.save({
    fileName: "backup.echomusic-backup",
    data: bytes,
    summary: {},
    signal,
  });
  assert.deepEqual(await provider.list({ signal }), [
    { id: "backup.echomusic-backup", name: "backup.echomusic-backup", size: 3 },
  ]);
  assert.equal(
    await provider.load({ id: "backup.echomusic-backup", signal }),
    bytes,
  );
  await provider.remove({ id: "backup.echomusic-backup", signal });

  assert.equal(calls.filter((call) => call.method === "MKCOL").length, 2);
  assert.equal(
    calls.some((call) => call.method === "PUT"),
    true,
  );
  assert.equal(
    calls.some((call) => call.method === "GET"),
    true,
  );
  assert.equal(
    calls.some((call) => call.method === "DELETE"),
    true,
  );
  assert.match(String(calls[0].headers.Authorization), /^Basic /);
});

test("plugin entry is self-contained and can load from a Blob-like URL", async () => {
  const code = await readFile(
    new URL("../webdav-backup/webdav.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(code, /^\s*import\s/m);
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  assert.equal(typeof module.activate, "function");
  assert.equal(typeof module.deactivate, "function");
});

test("activation registers the provider and deactivation disposes it", async () => {
  let provider = null;
  let providerDisposals = 0;
  let settingsDisposals = 0;
  let styleDisposals = 0;
  let settingsDefinition = null;
  let unmountSettings = null;
  const ctx = {
    storage: {
      get: async () => ({ ...CONFIG, rememberPassword: true }),
    },
    vue: {
      reactive: (value) => value,
      defineComponent: (value) => value,
      defineAsyncComponent: (value) => value,
      h: (type, props, children) => ({ type, props, children }),
      onUnmounted: (callback) => void (unmountSettings = callback),
      ref: (value) => ({ value }),
      watch: () => () => {},
    },
    css: {
      inject: () => () => void (styleDisposals += 1),
    },
    ui: {
      components: {
        Button: async () => {},
        Input: async () => {},
        Switch: async () => {},
      },
      settings: {
        define: (definition) => {
          settingsDefinition = definition;
          return () => void (settingsDisposals += 1);
        },
      },
    },
    backups: {
      registerProvider: (value) => {
        provider = value;
        return () => void (providerDisposals += 1);
      },
    },
  };

  await activate(ctx);
  assert.equal(provider?.id, "webdav");
  assert.equal(settingsDefinition?.title, "WebDAV 备份");
  const render = settingsDefinition.component.setup();
  assert.equal(render().props.class, "echo-webdav-backup-settings");
  unmountSettings?.();
  deactivate();
  assert.equal(providerDisposals, 1);
  assert.equal(settingsDisposals, 1);
  assert.equal(styleDisposals, 1);
});
