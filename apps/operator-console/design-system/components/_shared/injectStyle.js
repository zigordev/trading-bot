const injected = new Set();

/** Injects a <style> tag once per id. Used by design-system components to
 * define hover/focus/pseudo-state rules that inline style objects can't
 * express, without pulling in a CSS-in-JS library. */
export function injectOnce(id, css) {
  if (typeof document === 'undefined') return;
  if (injected.has(id) || document.getElementById(id)) return;
  injected.add(id);
  const tag = document.createElement('style');
  tag.id = id;
  tag.textContent = css;
  document.head.appendChild(tag);
}
