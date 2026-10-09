const STORAGE_KEY = "scroll-assistant-settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  bottomThreshold: 300,
  avoidBackToTop: true,
};

const STYLE = `
.echo-scroll-assistant-position {
  --echo-scroll-assistant-stack-y: 0px;
  position: fixed;
  width: var(--scroll-action-size, 32px);
  height: var(--scroll-action-size, 32px);
  z-index: 1050;
  transform: translateY(var(--echo-scroll-assistant-stack-y));
  transition:
    transform var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease),
    right var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease),
    bottom var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease);
}

.echo-scroll-assistant-button {
  --echo-scroll-assistant-hover-y: 0px;
  --echo-scroll-assistant-active-scale: 1;
  width: 100%;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--scroll-action-border, color-mix(in srgb, var(--color-text-main) 22%, transparent));
  border-radius: var(--radius-control, 6px);
  color: var(--scroll-action-text, var(--icon-main, var(--color-text-main)));
  background: var(--scroll-action-bg, var(--control-muted-bg, transparent));
  box-shadow: var(--control-neutral-action-shadow, none);
  -webkit-backdrop-filter: var(--surface-backdrop-filter);
  backdrop-filter: var(--surface-backdrop-filter);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease),
    color var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease),
    border-color var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease),
    box-shadow var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease),
    transform var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease);
  transform: translateY(var(--echo-scroll-assistant-hover-y))
    scale(var(--echo-scroll-assistant-active-scale));
}

.echo-scroll-assistant-button:is(:hover, :focus-visible) {
  color: var(--scroll-action-hover-text, var(--color-text-main));
  background: var(--scroll-action-hover-bg, var(--control-hover-bg, transparent));
  border-color: var(--scroll-action-hover-border, color-mix(in srgb, var(--color-text-main) 36%, transparent));
  --echo-scroll-assistant-hover-y: -1px;
}

/* A page-owned button must not show through a transparent lyric overlay,
   including its enter/leave animation. */
body:has(.lyric-page) .echo-scroll-assistant-position {
  display: none;
}

.echo-scroll-assistant-button:active {
  background: var(--scroll-action-pressed-bg, var(--control-neutral-pressed-bg, transparent));
  --echo-scroll-assistant-active-scale: 0.96;
}

.echo-scroll-assistant-button-icon {
  transition: transform var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease);
}

.echo-scroll-assistant-button:hover .echo-scroll-assistant-button-icon {
  transform: translateY(2px);
}

.echo-scroll-assistant-fade-enter-active,
.echo-scroll-assistant-fade-leave-active {
  transition: opacity var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease);
}

.echo-scroll-assistant-fade-enter-from,
.echo-scroll-assistant-fade-leave-to {
  opacity: 0;
}

.echo-scroll-assistant-fade-leave-active {
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .echo-scroll-assistant-position,
  .echo-scroll-assistant-button,
  .echo-scroll-assistant-button-icon {
    transition: none;
  }

  .echo-scroll-assistant-button,
  .echo-scroll-assistant-button:hover .echo-scroll-assistant-button-icon {
    transform: none;
  }
}

.echo-scroll-assistant-settings {
  display: grid;
  gap: 14px;
  min-width: 280px;
}

.echo-scroll-assistant-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.echo-scroll-assistant-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.echo-scroll-assistant-label {
  color: var(--color-text-main);
  font-size: 13px;
  font-weight: 750;
}

.echo-scroll-assistant-description {
  color: color-mix(in srgb, var(--color-text-main) 56%, transparent);
  font-size: 12px;
  line-height: 1.45;
}

.echo-scroll-assistant-number {
  width: 92px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--control-border);
  border-radius: 8px;
  color: var(--color-text-main);
  background: var(--control-bg);
  font-size: 12px;
  font-weight: 650;
  outline: none;
}

.echo-scroll-assistant-number:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 14%, transparent);
}
`;

let runtimeCtx = null;
let state = null;
let styleDispose = null;
let floatingDispose = null;
let settingsDispose = null;

const normalizeSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_SETTINGS.enabled,
    bottomThreshold: Math.max(
      40,
      Math.min(
        2000,
        Math.floor(
          Number(source.bottomThreshold) || DEFAULT_SETTINGS.bottomThreshold,
        ),
      ),
    ),
    avoidBackToTop:
      typeof source.avoidBackToTop === "boolean"
        ? source.avoidBackToTop
        : DEFAULT_SETTINGS.avoidBackToTop,
  };
};

const saveSettings = () => {
  if (!runtimeCtx || !state) return;
  void runtimeCtx.storage.set(STORAGE_KEY, {
    enabled: state.settings.enabled,
    bottomThreshold: state.settings.bottomThreshold,
    avoidBackToTop: state.settings.avoidBackToTop,
  });
};

const isVisibleElement = (element) => {
  if (!element || !document.contains(element)) return false;
  if (
    element.checkVisibility &&
    !element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
  )
    return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
};

const getHostBackToTopElement = () =>
  [".back-to-top-btn", ".settings-back-to-top.visible"]
    .map((selector) => document.querySelector(selector))
    .find(isVisibleElement) || null;

const getStableElementBounds = (element) => {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const bottom = Number.parseFloat(style.bottom);
  const right = Number.parseFloat(style.right);
  const parent =
    element.offsetParent instanceof HTMLElement ? element.offsetParent : null;
  const parentRect = parent?.getBoundingClientRect();

  if (
    parentRect &&
    Number.isFinite(bottom) &&
    Number.isFinite(right) &&
    style.position === "absolute"
  ) {
    return {
      right: parentRect.right - right,
      bottom: parentRect.bottom - bottom,
      height: element.offsetHeight || rect.height,
    };
  }

  return {
    right: rect.right,
    bottom: rect.bottom,
    height: element.offsetHeight || rect.height,
  };
};

const isBackToTopNode = (node) => {
  if (!(node instanceof Element)) return false;
  return (
    node.matches(".back-to-top-btn, .settings-back-to-top") ||
    Boolean(node.querySelector(".back-to-top-btn, .settings-back-to-top"))
  );
};

const shouldHandleBackToTopMutation = (mutation) => {
  if (mutation.type === "attributes") {
    return isBackToTopNode(mutation.target);
  }
  return [...mutation.addedNodes, ...mutation.removedNodes].some(
    isBackToTopNode,
  );
};

const isUsableContainer = (ctx, element) => {
  if (!isVisibleElement(element)) return false;
  return ctx.scroll.getState(element).canScroll;
};

const pickContainer = (ctx) => {
  if (
    ctx.stores.player.isLyricViewOpen ||
    document.querySelector(".lyric-page")
  )
    return null;
  const containers = ctx.scroll.queryContainers({ visible: true });
  return containers.find((element) => isUsableContainer(ctx, element)) || null;
};

const createFloatingButton = (ctx) => {
  const Tooltip = ctx.vue.defineAsyncComponent(ctx.ui.components.Tooltip);
  const {
    computed,
    defineComponent,
    h,
    onBeforeUnmount,
    onMounted,
    ref,
    resolveComponent,
    nextTick,
    watch,
  } = ctx.vue;

  return defineComponent({
    name: "EchoScrollAssistantButton",
    setup() {
      const Icon = resolveComponent("Icon");
      const container = ref(null);
      const metrics = ref({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        distanceToBottom: 0,
        canScroll: false,
        atTop: true,
        atBottom: true,
      });
      const bounds = ref({
        right: window.innerWidth,
        bottom: window.innerHeight,
        backToTop: null,
      });
      let frame = 0;
      let unwatchRoute = null;
      let unwatchContainers = null;
      let backToTopObserver = null;
      let unwatchLyric = null;
      let stopped = false;

      const setContainer = (target) => {
        if (target === container.value) return;
        container.value?.removeEventListener("scroll", scheduleUpdate);
        container.value = target;
        target?.addEventListener("scroll", scheduleUpdate, { passive: true });
      };

      const updateMetrics = () => {
        if (stopped) return;
        setContainer(pickContainer(ctx));

        if (!container.value) {
          metrics.value = {
            ...metrics.value,
            canScroll: false,
            distanceToBottom: 0,
          };
          return;
        }

        metrics.value = ctx.scroll.getState(container.value);
        const rect = container.value.getBoundingClientRect();
        const backToTopElement = getHostBackToTopElement();
        bounds.value = {
          right: rect.right,
          bottom: rect.bottom,
          backToTop: backToTopElement
            ? getStableElementBounds(backToTopElement)
            : null,
        };
      };

      const scheduleUpdate = () => {
        if (stopped || frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          updateMetrics();
        });
      };

      const bindContainer = () => {
        setContainer(null);
        metrics.value = {
          ...metrics.value,
          canScroll: false,
          distanceToBottom: 0,
        };
        // Wait for Vue to replace/reactivate the route DOM, not a fixed timeout.
        void nextTick(scheduleUpdate);
      };

      const visible = computed(
        () =>
          state.settings.enabled &&
          !ctx.stores.player.isLyricViewOpen &&
          metrics.value.canScroll &&
          metrics.value.distanceToBottom > state.settings.bottomThreshold,
      );

      const buttonStyle = computed(() => {
        const horizontalInset = Math.max(
          16,
          bounds.value.backToTop
            ? window.innerWidth - bounds.value.backToTop.right
            : window.innerWidth - bounds.value.right + 24,
        );
        const verticalInset = Math.max(
          16,
          bounds.value.backToTop
            ? window.innerHeight - bounds.value.backToTop.bottom
            : window.innerHeight - bounds.value.bottom + 16,
        );
        const stackOffset =
          state.settings.avoidBackToTop && bounds.value.backToTop
            ? -(bounds.value.backToTop.height + 12)
            : 0;
        return {
          right: `${horizontalInset}px`,
          bottom: `${verticalInset}px`,
          "--echo-scroll-assistant-stack-y": `${stackOffset}px`,
        };
      });

      const scrollToBottom = () => {
        if (stopped) return;
        updateMetrics();
        if (!container.value) return;
        ctx.scroll.scrollToBottom(container.value, { behavior: "auto" });
      };

      onMounted(() => {
        bindContainer();
        window.addEventListener("resize", scheduleUpdate);
        unwatchRoute = ctx.router.afterEach(bindContainer);
        unwatchContainers = ctx.scroll.observeContainers(bindContainer);
        unwatchLyric = watch(
          () => ctx.stores.player.isLyricViewOpen,
          bindContainer,
          { flush: "sync" },
        );
        backToTopObserver = new MutationObserver((mutations) => {
          if (
            mutations.some(
              (mutation) =>
                shouldHandleBackToTopMutation(mutation) ||
                // Changes within the active page can change scrollHeight without
                // adding a new container (pagination, expanded sections, etc.).
                Boolean(container.value?.contains(mutation.target)) ||
                // For childList inspect changed branches, not their ancestor:
                // a tooltip appended to body must not rescan every page below it.
                (mutation.type === "attributes"
                  ? [mutation.target]
                  : [...mutation.addedNodes, ...mutation.removedNodes]
                ).some(
                  (node) =>
                    node instanceof Element &&
                    (node.matches(
                      ".lyric-page, [data-echo-scroll-container]",
                    ) ||
                      node.querySelector(
                        ".lyric-page, [data-echo-scroll-container]",
                      )),
                ),
            )
          )
            scheduleUpdate();
        });
        backToTopObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });

      onBeforeUnmount(() => {
        stopped = true;
        if (frame) window.cancelAnimationFrame(frame);
        setContainer(null);
        window.removeEventListener("resize", scheduleUpdate);
        unwatchRoute?.();
        unwatchContainers?.();
        unwatchLyric?.();
        backToTopObserver?.disconnect();
      });

      return () =>
        h(
          ctx.vue.Transition,
          {
            name: "echo-scroll-assistant-fade",
            // A route switch must discard the outgoing button, not fade it over the next page.
            key: ctx.router.currentRoute?.value?.fullPath,
          },
          {
            default: () =>
              visible.value
                ? h(
                    "div",
                    {
                      class: "echo-scroll-assistant-position",
                      style: buttonStyle.value,
                    },
                    [
                      h(
                        Tooltip,
                        { content: "回到底部", side: "left" },
                        {
                          trigger: () =>
                            h(
                              "button",
                              {
                                type: "button",
                                class:
                                  "echo-scroll-assistant-button app-focus-ring-soft",
                                "aria-label": "回到底部",
                                onClick: scrollToBottom,
                              },
                              [
                                h(Icon, {
                                  class: "echo-scroll-assistant-button-icon",
                                  icon: ctx.icons.iconArrowDown,
                                  width: 16,
                                  height: 16,
                                }),
                              ],
                            ),
                        },
                      ),
                    ],
                  )
                : null,
          },
        );
    },
  });
};

const createSettingsPanel = (ctx) => {
  const { defineComponent, h } = ctx.vue;
  const Switch = ctx.vue.defineAsyncComponent(ctx.ui.components.Switch);

  return defineComponent({
    name: "EchoScrollAssistantSettings",
    setup() {
      const setBoolean = (key, value) => {
        state.settings[key] = Boolean(value);
        saveSettings();
      };

      const setThreshold = (event) => {
        const next = normalizeSettings({
          ...state.settings,
          bottomThreshold: event.target.value,
        });
        state.settings.bottomThreshold = next.bottomThreshold;
        saveSettings();
      };

      const field = (label, description, control) =>
        h("label", { class: "echo-scroll-assistant-field" }, [
          h("span", { class: "echo-scroll-assistant-copy" }, [
            h("span", { class: "echo-scroll-assistant-label" }, label),
            h(
              "span",
              { class: "echo-scroll-assistant-description" },
              description,
            ),
          ]),
          control,
        ]);

      return () =>
        h("div", { class: "echo-scroll-assistant-settings" }, [
          field(
            "显示到底部按钮",
            "长页面未滚到底时，在右下角提供快捷滚动。",
            h(Switch, {
              modelValue: state.settings.enabled,
              "onUpdate:modelValue": (value) => setBoolean("enabled", value),
            }),
          ),
          field(
            "避让回到顶部",
            "回到顶部按钮可见时，自动把到底部按钮上移。",
            h(Switch, {
              modelValue: state.settings.avoidBackToTop,
              "onUpdate:modelValue": (value) =>
                setBoolean("avoidBackToTop", value),
            }),
          ),
          field(
            "底部隐藏阈值",
            "距离底部小于该像素值时隐藏按钮。",
            h("input", {
              class: "echo-scroll-assistant-number",
              type: "number",
              min: 40,
              max: 2000,
              step: 20,
              value: state.settings.bottomThreshold,
              onChange: setThreshold,
            }),
          ),
        ]);
    },
  });
};

export async function activate(ctx) {
  runtimeCtx = ctx;
  state = ctx.vue.reactive({
    settings: { ...DEFAULT_SETTINGS },
  });

  const saved = await ctx.storage.get(STORAGE_KEY);
  Object.assign(state.settings, normalizeSettings(saved));

  styleDispose = ctx.css.inject(STYLE, { id: "scroll-assistant" });
  floatingDispose = ctx.ui.teleport(createFloatingButton(ctx), {
    id: "scroll-assistant-floating",
  });
  settingsDispose = ctx.ui.settings.define({
    title: "滚动助手",
    component: createSettingsPanel(ctx),
  });
}

export function deactivate() {
  settingsDispose?.();
  settingsDispose = null;
  floatingDispose?.();
  floatingDispose = null;
  styleDispose?.();
  styleDispose = null;
  state = null;
  runtimeCtx = null;
}
