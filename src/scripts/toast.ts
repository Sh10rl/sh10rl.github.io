let timer: ReturnType<typeof setTimeout> | undefined;

/** A glass pill rises from the bottom, its tick draws in, and it leaves on its own. */
export function toast(message: string, error = false) {
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
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 2000);
}

export async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
    return true;
  } catch {
    toast('Couldn’t copy', true);
    return false;
  }
}
