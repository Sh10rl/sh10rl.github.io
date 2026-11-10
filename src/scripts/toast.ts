let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * A glass pill rises, its tick draws in, and it leaves on its own. Given the control that
 * was pressed, it rises just above it (below it when there is no room); otherwise it rises
 * from the bottom of the window.
 */
export function toast(message: string, error = false, anchor?: Element) {
  const el = document.querySelector<HTMLElement>('.toast');
  const text = el?.querySelector('.toast-text');
  if (!el || !text) return;
  text.textContent = message;
  el.classList.toggle('error', error);
  // A second toast restarts the entrance rather than silently swapping text.
  if (el.classList.contains('show')) {
    el.classList.remove('show');
    void el.offsetWidth;
  }
  const spot = anchor?.getBoundingClientRect();
  if (spot?.width) {
    const gap = 10;
    const margin = 8;
    const half = el.offsetWidth / 2;
    const centre = Math.min(Math.max(spot.left + spot.width / 2, half + margin), innerWidth - half - margin);
    const above = spot.top - gap - el.offsetHeight >= margin;
    // Page coordinates, so the toast scrolls with the button instead of staying on screen.
    el.style.position = 'absolute';
    el.style.left = `${centre + scrollX}px`;
    el.style.top = `${(above ? spot.top - gap - el.offsetHeight : spot.bottom + gap) + scrollY}px`;
    el.style.bottom = 'auto';
  } else {
    for (const property of ['position', 'left', 'top', 'bottom']) el.style.removeProperty(property);
  }
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 1000);
}

export async function copy(text: string, message: string, anchor?: Element) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, false, anchor);
    return true;
  } catch {
    toast('Couldn’t copy', true, anchor);
    return false;
  }
}
