# Plugin Window Resize

Plugin floating-window contexts expose resize handles through the same session-safe lifecycle as
window dragging:

```ts
const dispose = ctx.window.resize.bind(handle, {
  direction: 'se',
  minWidth: 240,
  minHeight: 120,
});

const disposeOther = ctx.windows.resize.bind('panel', handle, { direction: 'e' });
```

Use `ctx.window.resize` from a plugin window entry. Use `ctx.windows.resize` from the main plugin
entry when targeting one of the plugin's declared windows. `direction` accepts `n`, `ne`, `e`,
`se`, `s`, `sw`, `w`, or `nw`. Bounds are clamped by both the binding options and the window
descriptor. A descriptor with `resizable: false` rejects resize sessions. The low-level
`startResize`, `resize`, `endResize`, and `cancelResize` APIs remain available for host
integrations.
