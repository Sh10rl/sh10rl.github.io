import { reducedMotion, SNAPPY, Spring } from './motion';

let dismissActive: (() => void) | undefined;
const icon = (path: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;

function largestSource(img: HTMLImageElement) {
  let best = img.currentSrc || img.src;
  let bestWidth = 0;
  for (const candidate of img.srcset.split(',')) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    const width = parseInt(descriptor, 10);
    if (url && width > bestWidth) {
      best = new URL(url, location.href).href;
      bestWidth = width;
    }
  }
  return best;
}

export function zoom(initial: HTMLImageElement, images: HTMLImageElement[]) {
  if (!initial.getBoundingClientRect().width) return;
  dismissActive?.();
  const previousFocus = document.activeElement as HTMLElement | null;
  let index = images.indexOf(initial);
  let img = initial;
  let rect = img.getBoundingClientRect();
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let p = 0;
  let dx = 0;
  let dy = 0;
  let closing = false;
  let disposed = false;
  let closeFrom = rect;
  let closeOpacity = 1;
  let switchAnimation: Animation | undefined;
  let imageRequest = 0;

  const gallery = document.createElement('div');
  gallery.className = 'zoom-gallery';
  gallery.setAttribute('role', 'dialog');
  gallery.setAttribute('aria-modal', 'true');
  gallery.setAttribute('aria-label', 'Image viewer');
  gallery.tabIndex = -1;
  const overlay = document.createElement('div');
  overlay.className = 'zoom-overlay';
  const clone = document.createElement('img');
  clone.className = 'zoom-image';
  clone.draggable = false;
  const controls = document.createElement('div');
  controls.className = 'zoom-controls';
  const footer = document.createElement('div');
  footer.className = 'zoom-footer';
  const button = (name: string, label: string, path: string) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `zoom-${name}`;
    el.setAttribute('aria-label', label);
    el.innerHTML = icon(path);
    controls.append(el);
    return el;
  };
  const previous = button('previous', 'Previous image', 'm14 6-6 6 6 6');
  const next = button('next', 'Next image', 'm10 6 6 6-6 6');
  const closeButton = button('close', 'Close image viewer', 'm6 6 12 12M18 6 6 18');
  const counter = document.createElement('div');
  counter.className = 'zoom-counter';
  const number = document.createElement('input');
  number.className = 'zoom-number';
  number.type = 'text';
  number.inputMode = 'numeric';
  number.pattern = '[0-9]*';
  number.autocomplete = 'off';
  number.setAttribute('aria-label', `Image number, ${images.length} images`);
  number.style.width = `${Math.max(2, String(images.length).length)}ch`;
  const total = document.createElement('span');
  total.textContent = `/ ${images.length}`;
  counter.append(number, total);
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  controls.append(status);
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'zoom-location';
  jump.textContent = 'Jump to location';
  footer.append(counter, jump);
  controls.append(footer);
  gallery.append(overlay, clone, controls);
  document.body.append(gallery);

  const fit = () => {
    rect = img.getBoundingClientRect();
    const margin = innerWidth < 640 ? 16 : 72;
    const naturalWidth = Number(img.getAttribute('width')) || img.naturalWidth || rect.width;
    scale = Math.min((document.documentElement.clientWidth - margin * 2) / rect.width, (innerHeight - 128) / rect.height, Math.max(1, naturalWidth / rect.width * 1.5));
    tx = (document.documentElement.clientWidth - rect.width * scale) / 2 - rect.left;
    ty = (innerHeight - rect.height * scale) / 2 - rect.top - 8;
    Object.assign(clone.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const source = () => {
    const request = ++imageRequest;
    clone.alt = img.alt;
    clone.src = img.currentSrc || img.src;
    const hiRes = largestSource(img);
    if (hiRes !== clone.src) {
      const loader = new Image();
      loader.src = hiRes;
      loader.decode().then(() => {
        if (!disposed && request === imageRequest) clone.src = hiRes;
      }, () => {});
    }
    img.style.visibility = 'hidden';
    previous.disabled = index === 0;
    next.disabled = index === images.length - 1;
    previous.hidden = next.hidden = counter.hidden = images.length < 2;
    number.value = String(index + 1);
    status.textContent = `Image ${index + 1} of ${images.length}`;
    gallery.dataset.index = String(index);
  };
  const render = () => {
    if (closing) {
      // Follow the source while the page continues scrolling underneath.
      const target = img.getBoundingClientRect();
      const x = target.left + (closeFrom.left - target.left) * p;
      const y = target.top + (closeFrom.top - target.top) * p;
      const w = target.width + (closeFrom.width - target.width) * p;
      const h = target.height + (closeFrom.height - target.height) * p;
      clone.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px) scale(${w / rect.width}, ${h / rect.height})`;
      overlay.style.opacity = String(closeOpacity * Math.max(0, Math.min(1, p)));
      return;
    }
    const s = 1 + (scale - 1) * p;
    clone.style.transform = `translate(${tx * p + dx}px, ${ty * p + dy}px) scale(${s})`;
    overlay.style.opacity = String(Math.max(0, Math.min(1, p) * (1 - Math.min(1, Math.hypot(dx, dy) / 420))));
  };
  const open = new Spring(0, value => { p = value; render(); }, { stiffness: 320, damping: 32, precision: 0.001 });
  const sx = new Spring(0, value => { dx = value; render(); }, SNAPPY);
  const sy = new Spring(0, value => { dy = value; render(); }, SNAPPY);
  let start: { x: number; y: number } | null = null;
  let moved = false;
  let vx = 0;
  let vy = 0;
  let lx = 0;
  let ly = 0;
  let lt = 0;

  const step = (direction: number) => {
    const target = index + direction;
    if (closing || target < 0 || target >= images.length || !images[target].getBoundingClientRect().width) return;
    switchAnimation?.cancel();
    img.style.visibility = '';
    index = target;
    img = images[index];
    start = null;
    clone.classList.remove('dragging');
    fit();
    source();
    sx.set(0);
    sy.set(0);
    open.set(1);
    if (!reducedMotion.matches) switchAnimation = clone.animate([
      { opacity: 0.6, translate: `${Math.sign(direction) * 12}px 0` },
      { opacity: 1, translate: '0 0' },
    ], { duration: 160, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    if (document.activeElement === previous && previous.disabled) next.focus({ preventScroll: true });
    if (document.activeElement === next && next.disabled) previous.focus({ preventScroll: true });
  };

  const detach = () => {
    removeEventListener('keydown', onKey);
    removeEventListener('wheel', close);
    removeEventListener('scroll', close);
    removeEventListener('resize', close);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    detach();
    open.stop();
    sx.stop();
    sy.stop();
    switchAnimation?.cancel();
    gallery.remove();
    img.style.visibility = '';
    if (dismissActive === dispose) dismissActive = undefined;
  };
  const close = () => {
    if (closing) return;
    closeFrom = clone.getBoundingClientRect();
    switchAnimation?.cancel();
    closeOpacity = Number(overlay.style.opacity);
    closing = true;
    gallery.classList.add('closing');
    detach();
    sx.stop();
    sy.stop();
    open.config = { stiffness: 380, damping: 36, precision: 0.002 };
    open.set(1);
    open.to(0);
    previousFocus?.focus({ preventScroll: true });
    const done = () => {
      if (disposed) return;
      if (open.moving) return requestAnimationFrame(done);
      dispose();
    };
    requestAnimationFrame(done);
  };
  const commitNumber = () => {
    const value = number.value.trim();
    if (/^-?\d+$/.test(value)) {
      const target = Math.max(1, Math.min(images.length, Number(value))) - 1;
      if (target !== index) step(target - index);
    }
    number.value = String(index + 1);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.target === number && event.key !== 'Tab') {
      if (event.key === 'Enter') { event.preventDefault(); commitNumber(); number.select(); }
      if (event.key === 'Escape') { event.preventDefault(); number.value = String(index + 1); gallery.focus({ preventScroll: true }); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const items = [previous, number, jump, next, closeButton].filter(el => !el.disabled && !el.hidden && (el !== number || !counter.hidden));
      const at = items.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
      items[(at + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus({ preventScroll: true });
    }
  };
  const down = (event: PointerEvent) => {
    if (closing || event.button !== 0) return;
    switchAnimation?.cancel();
    sx.stop();
    sy.stop();
    start = { x: event.clientX - dx, y: event.clientY - dy };
    lx = event.clientX;
    ly = event.clientY;
    lt = event.timeStamp;
    vx = vy = 0;
    moved = false;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!start || closing) return;
    const nx = event.clientX - start.x;
    const ny = event.clientY - start.y;
    if (!moved && Math.hypot(nx, ny) < 6) return;
    moved = true;
    clone.classList.add('dragging');
    const dt = Math.max(1, event.timeStamp - lt);
    vx = (event.clientX - lx) / dt * 1000;
    vy = (event.clientY - ly) / dt * 1000;
    lx = event.clientX;
    ly = event.clientY;
    lt = event.timeStamp;
    sx.set(nx);
    sy.set(ny);
  };
  const up = (event: PointerEvent) => {
    if (!start) return;
    start = null;
    clone.classList.remove('dragging');
    if (!moved) return close();
    if (event.timeStamp - lt >= 100) vx = vy = 0;
    if (images.length > 1 && Math.abs(dx) > Math.abs(dy) * 1.25 && (Math.abs(dx) > 60 || Math.abs(vx) > 700)) {
      const direction = dx < 0 ? 1 : -1;
      if (index + direction >= 0 && index + direction < images.length) return step(direction);
    } else if (Math.hypot(dx, dy) > 110 || Math.hypot(vx, vy) > 900) return close();
    sx.velocity = vx;
    sy.velocity = vy;
    sx.to(0);
    sy.to(0);
  };
  for (const element of [overlay, clone]) {
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', () => { start = null; clone.classList.remove('dragging'); sx.to(0); sy.to(0); });
  }
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  closeButton.addEventListener('click', close);
  counter.addEventListener('click', () => number.focus());
  number.addEventListener('focus', () => number.select());
  number.addEventListener('blur', commitNumber);
  jump.addEventListener('click', () => {
    if (closing) return;
    const source = img.getBoundingClientRect();
    const inset = Math.max(72, (innerHeight - source.height) / 2);
    scrollTo({ top: scrollY + source.top - inset, behavior: 'instant' });
    close();
  });
  addEventListener('keydown', onKey);
  addEventListener('wheel', close, { passive: true });
  addEventListener('scroll', close, { passive: true });
  addEventListener('resize', close);
  dismissActive = dispose;
  fit();
  source();
  open.to(1);
  gallery.focus({ preventScroll: true });
}
