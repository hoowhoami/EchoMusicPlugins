import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = await readFile(
  new URL("../app-theme-example/index.js", import.meta.url),
  "utf8",
);
const activate = new Function(
  source.replace("export function activate", "return function activate"),
)();
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const selected = (fileId) => ({ kind: "selected-file", fileId });
function fixture(overrides = {}) {
  let entry, scope;
  const components = [],
    releases = [],
    disposables = [],
    opened = [],
    updates = [];
  const theme = {
    settings: { value: null },
    motionEnabled: { value: true },
    updateSettings(patch) {
      updates.push(patch);
      this.settings.value = { ...this.settings.value, ...patch };
    },
  };
  const element = {
    plays: 0,
    pauses: 0,
    loads: 0,
    async play() {
      this.plays++;
    },
    pause() {
      this.pauses++;
    },
    removeAttribute() {},
    load() {
      this.loads++;
    },
  };
  const ctx = {
    dispose: (fn) => disposables.push(fn),
    vue: {
      defineComponent: (value) => value,
      defineAsyncComponent: (value) => value,
      ref: (value) => ({ value }),
      shallowRef: (value) => ({ value }),
      nextTick: async () => {
        scope?.render?.();
      },
      onBeforeUnmount: (fn) => scope.cleanup.push(fn),
      watch: (getter, callback, options = {}) => {
        const get = typeof getter === "function" ? getter : () => getter.value;
        const watcher = { get, callback, last: get() };
        scope.watchers.push(watcher);
        if (options.immediate) void callback(watcher.last);
      },
      h: (tag, props, children) => {
        if (tag === "video") props.ref.value = element;
        return {
          tag,
          props: props ?? {},
          children: typeof children === "function" ? children() : children,
        };
      },
    },
    ui: {
      components: { Button: "Button", Input: "Input", Slider: "Slider" },
      sidebar: { shortcuts: { register() {} } },
    },
    theme: {
      register(value) {
        entry = value;
        theme.settings.value = value.settings.defaults;
      },
      useTheme: () => theme,
      openThemes() {},
    },
    fs: {
      requestFiles: async () => ({
        ok: true,
        canceled: false,
        files: [selected("local")],
      }),
      stat: async () => ({ name: "local.mp4", size: 20_000_000 }),
      getPrivateDirectory: async () => ({ id: "private-data" }),
      openMedia: async (file) => {
        opened.push(file);
        return {
          url: `media:${file.fileId}`,
          release() {
            releases.push(file.fileId);
          },
        };
      },
      ...overrides.fs,
    },
    net: {
      download:
        overrides.download ??
        (async () => {
          throw new Error("unexpected network");
        }),
    },
  };
  activate(ctx);
  const mount = (component) => {
    const state = { cleanup: [], watchers: [], render: null };
    scope = state;
    state.render = component.setup();
    state.tree = () => {
      scope = state;
      return state.render();
    };
    state.flush = async () => {
      scope = state;
      for (const watcher of state.watchers) {
        const value = watcher.get();
        if (value !== watcher.last) {
          watcher.last = value;
          void watcher.callback(value);
        }
      }
      state.tree();
      await settle();
      state.tree();
    };
    state.unmount = () => state.cleanup.forEach((fn) => fn());
    state.tree();
    components.push(state);
    return state;
  };
  return {
    ctx,
    get entry() {
      return entry;
    },
    theme,
    mount,
    releases,
    opened,
    updates,
    element,
    dispose: () => disposables.forEach((fn) => fn()),
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (predicate(tree)) return tree;
  for (const child of Array.isArray(tree.children)
    ? tree.children
    : [tree.children]) {
    const value = find(child, predicate);
    if (value) return value;
  }
}
const button = (component, text) =>
  find(
    component.tree(),
    (node) => node.tag === "Button" && node.children === text,
  );

test("video demo registers a dynamic theme and validates persisted JSON references", async () => {
  const f = fixture();
  assert.equal(f.entry.type, "dynamic");
  assert.equal(f.entry.id, "video");
  const defaults = f.entry.settings.defaults;
  assert.equal(f.entry.settings.validate(defaults), true);
  assert.equal(
    f.entry.settings.validate({ ...defaults, file: selected("x") }),
    true,
  );
  assert.equal(
    f.entry.settings.validate({ ...defaults, file: { url: "temporary" } }),
    false,
  );
  assert.equal(f.entry.settings.validate({ ...defaults, shade: 81 }), false);
  const manifest = JSON.parse(
    await readFile(
      new URL("../app-theme-example/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.capabilities, {
    theme: true,
    localFiles: true,
    downloads: true,
  });
});

test("local selection uses system file API and saves the file reference without copying", async () => {
  let options;
  const f = fixture({
    fs: {
      requestFiles: async (request) => {
        options = request;
        return { ok: true, canceled: false, files: [selected("local")] };
      },
    },
  });
  const settings = f.mount(f.entry.settings.component);
  await button(settings, "选择本地视频").props.onClick();
  assert.equal(options.persist, true);
  assert.equal(options.multiple, false);
  assert.deepEqual(f.theme.settings.value.file, selected("local"));
  assert.equal(f.theme.settings.value.label, "local.mp4");
  f.ctx.fs.requestFiles = async () => ({ ok: true, canceled: true });
  await button(settings, "选择本地视频").props.onClick();
  assert.deepEqual(f.theme.settings.value.file, selected("local"));
});

test("closing settings rejects a late local selection", async () => {
  const pending = deferred();
  const f = fixture({ fs: { requestFiles: () => pending.promise } });
  const settings = f.mount(f.entry.settings.component);
  const selection = button(settings, "选择本地视频").props.onClick();
  settings.unmount();
  pending.resolve({ ok: true, canceled: false, files: [selected("late")] });
  await selection;
  assert.equal(f.updates.length, 0);
});

test("stale media leases are released and the active lease is closed on unmount", async () => {
  const first = deferred(),
    second = deferred();
  const f = fixture({
    fs: {
      openMedia: (file) =>
        file.fileId === "first" ? first.promise : second.promise,
    },
  });
  f.theme.settings.value = {
    ...f.theme.settings.value,
    file: selected("first"),
  };
  const background = f.mount(f.entry.decorations.background);
  f.theme.updateSettings({ file: selected("second") });
  await background.flush();
  second.resolve({
    url: "media:second",
    release: () => f.releases.push("second"),
  });
  await settle();
  first.resolve({
    url: "media:first",
    release: () => f.releases.push("first"),
  });
  await settle();
  assert.deepEqual(f.releases, ["first"]);
  assert.equal(
    find(background.tree(), (node) => node.tag === "video").props.src,
    "media:second",
  );
  background.unmount();
  assert.deepEqual(f.releases, ["first", "second"]);
  assert.ok(f.element.pauses > 0 && f.element.loads > 0);
});

test("motion pauses and resumes while shade changes preserve the media and playback position", async () => {
  const f = fixture();
  f.theme.settings.value = {
    ...f.theme.settings.value,
    file: selected("offline"),
  };
  const background = f.mount(f.entry.decorations.background);
  await settle();
  assert.equal(f.opened.length, 1);
  const loads = f.element.loads;
  f.theme.updateSettings({
    shade: 60,
    fit: "contain",
    file: selected("offline"),
  });
  await background.flush();
  assert.equal(f.opened.length, 1);
  assert.equal(f.element.loads, loads);
  assert.equal(
    find(background.tree(), (node) => node.tag === "video").props.style
      .objectFit,
    "contain",
  );
  f.theme.motionEnabled.value = false;
  await background.flush();
  const plays = f.element.plays;
  f.theme.motionEnabled.value = true;
  await background.flush();
  assert.ok(f.element.plays > plays);
  assert.equal(f.element.muted, true);
  background.unmount();
});

test("download uses a private external file and closing settings prevents late application", async () => {
  const completion = deferred();
  let options,
    stopCount = 0;
  const file = {
    kind: "directory-file",
    directoryId: "private-data",
    relativePath: "videos/final.webm",
  };
  const f = fixture({
    download: async (request) => {
      options = request;
      return {
        subscribe(callback) {
          callback({ state: "downloading", receivedBytes: 20_000_000 });
          return () => stopCount++;
        },
        wait: () => completion.promise,
      };
    },
  });
  const settings = f.mount(f.entry.settings.component);
  find(settings.tree(), (node) => node.tag === "Input").props[
    "onUpdate:modelValue"
  ]("https://example.com/demo.webm");
  const transfer = button(settings, "下载并使用").props.onClick();
  await settle();
  assert.equal(options.url, "https://example.com/demo.webm");
  assert.equal(options.target.directoryId, "private-data");
  assert.match(options.target.relativePath, /^videos\/[^/]+\.webm$/);
  assert.equal(options.expectedBytes, undefined);
  assert.equal(options.checksum, undefined);
  settings.unmount();
  completion.resolve({ file, bytes: 20_000_000 });
  await transfer;
  assert.equal(f.updates.length, 0);
  assert.equal(stopCount, 1);
  const reopened = f.mount(f.entry.settings.component);
  button(reopened, "使用已下载视频").props.onClick();
  assert.deepEqual(f.theme.settings.value.file, file);
  assert.equal(f.theme.settings.value.label, "demo.webm");
});
