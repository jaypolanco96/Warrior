// A tiny message bus so the scanner, the auto-trader and the comfort bar can talk without importing each other.
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, handler) => bus.addEventListener(type, (e) => handler(e.detail));
