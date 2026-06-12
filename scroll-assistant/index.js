const STORAGE_KEY = "scroll-assistant-settings";

const DEFAULT_SETTINGS = {
  enabled: true,
  bottomThreshold: 300,
  avoidBackToTop: true,
};

const STYLE = `
.echo-scroll-assistant-button {
  --echo-scroll-assistant-stack-y: 0px;
  --echo-scroll-assistant-hover-y: 0px;
  --echo-scroll-assistant-appear-y: 0px;
  --echo-scroll-assistant-active-scale: 1;
  position: fixed;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--control-border);
  border-radius: 999px;
  color: var(--color-text-main);
  background: var(--color-bg-elevated);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
  -webkit-backdrop-filter: var(--surface-backdrop-filter);
  backdrop-filter: var(--surface-backdrop-filter);
  cursor: pointer;
  z-index: 1050;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.16s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.3s ease,
    right 0.16s cubic-bezier(0.2, 0, 0, 1),
    bottom 0.16s cubic-bezier(0.2, 0, 0, 1);
  transform: translateY(
      calc(
        var(--echo-scroll-assistant-stack-y) +
        var(--echo-scroll-assistant-hover-y) +
        var(--echo-scroll-assistant-appear-y)
      )
    )
    scale(var(--echo-scroll-assistant-active-scale));
}

.echo-scroll-assistant-button:hover {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 60%, var(--control-border));
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.18);
  --echo-scroll-assistant-hover-y: -1px;
}

.echo-scroll-assistant-button:active {
  --echo-scroll-assistant-active-scale: 0.96;
}

.echo-scroll-assistant-button-icon {
  transition: transform 0.18s ease;
}

.echo-scroll-assistant-button:hover .echo-scroll-assistant-button-icon {
  transform: translateY(2px);
}

.dark .echo-scroll-assistant-button {
  border-color: rgba(255, 255, 255, 0.26);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
}

.dark .echo-scroll-assistant-button:hover {
  border-color: color-mix(in srgb, var(--color-primary) 58%, rgba(255, 255, 255, 0.26));
}

.echo-scroll-assistant-fade-enter-active,
.echo-scroll-assistant-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.echo-scroll-assistant-fade-enter-from,
.echo-scroll-assistant-fade-leave-to {
  opacity: 0;
  --echo-scroll-assistant-appear-y: 10px;
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
  if (!element) return false;
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
  return [...mutation.addedNodes, ...mutation.removedNodes].some(isBackToTopNode);
};

const isUsableContainer = (ctx, element) => {
  if (!element || !document.contains(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return ctx.scroll.getState(element).canScroll;
};

const pickContainer = (ctx) => {
  const containers = ctx.scroll.queryContainers({ visible: true });
  return (
    containers.find((element) => isUsableContainer(ctx, element)) ||
    containers[0] ||
    null
  );
};

const createFloatingButton = (ctx) => {
  const {
    computed,
    defineComponent,
    h,
    onBeforeUnmount,
    onMounted,
    ref,
    resolveComponent,
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

      const updateMetrics = () => {
        const target = container.value;
        if (!target || !isUsableContainer(ctx, target)) {
          container.value = pickContainer(ctx);
        }

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
        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          updateMetrics();
        });
      };

      const bindContainer = () => {
        container.value?.removeEventListener("scroll", scheduleUpdate);
        container.value = pickContainer(ctx);
        container.value?.addEventListener("scroll", scheduleUpdate, {
          passive: true,
        });
        scheduleUpdate();
      };

      const visible = computed(
        () =>
          state.settings.enabled &&
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
        ctx.scroll.scrollToBottom(container.value, { behavior: "auto" });
      };

      onMounted(() => {
        bindContainer();
        window.addEventListener("resize", scheduleUpdate);
        unwatchRoute = ctx.router.afterEach(() => {
          window.setTimeout(bindContainer, 80);
        });
        unwatchContainers = ctx.scroll.observeContainers(() => {
          window.setTimeout(bindContainer, 80);
        });
        backToTopObserver = new MutationObserver((mutations) => {
          if (mutations.some(shouldHandleBackToTopMutation)) scheduleUpdate();
        });
        backToTopObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });

      onBeforeUnmount(() => {
        if (frame) window.cancelAnimationFrame(frame);
        container.value?.removeEventListener("scroll", scheduleUpdate);
        window.removeEventListener("resize", scheduleUpdate);
        unwatchRoute?.();
        unwatchContainers?.();
        backToTopObserver?.disconnect();
      });

      return () =>
        h(
          ctx.vue.Transition,
          { name: "echo-scroll-assistant-fade" },
          {
            default: () =>
              visible.value
                ? h(
                    "button",
                    {
                      type: "button",
                      class: "echo-scroll-assistant-button",
                      style: buttonStyle.value,
                      title: "到底部",
                      "aria-label": "到底部",
                      onClick: scrollToBottom,
                    },
                    [
                      h(Icon, {
                        class: "echo-scroll-assistant-button-icon",
                        icon: ctx.icons.iconArrowDown,
                        width: 20,
                        height: 20,
                      }),
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
