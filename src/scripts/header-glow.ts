import { finePointer } from './motion';

export function initHeaderGlow() {
  const capsule = document.querySelector<HTMLElement>('[data-capsule]');
  if (!capsule) return;

  const glow = document.createElement('span');
  glow.className = 'capsule-glow';
  glow.setAttribute('aria-hidden', 'true');
  capsule.append(glow);

  let pointer: { x: number; y: number } | undefined;
  let frame = 0;
  let visible = false;
  let transform = '';
  const show = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    glow.classList.toggle('is-active', next);
  };

  const paint = () => {
    frame = 0;
    if (!pointer) return;
    const rect = capsule.getBoundingClientRect();
    const x = pointer.x - rect.left;
    const y = pointer.y - rect.top;
    const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
    if (inside) {
      // Its center stays fixed while the reading capsule changes width.
      const next = `translate3d(${(x - rect.width / 2).toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      if (next !== transform) {
        transform = next;
        glow.style.transform = next;
      }
    }
    show(inside);
  };
  const queue = () => {
    if (pointer && !frame) frame = requestAnimationFrame(paint);
  };
  const move = (event: PointerEvent) => {
    if (!finePointer.matches || event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    queue();
  };
  const clear = () => {
    pointer = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    show(false);
  };

  capsule.addEventListener('pointerenter', move, { passive: true });
  capsule.addEventListener('pointermove', move, { passive: true });
  capsule.addEventListener('pointerleave', clear);
  capsule.addEventListener('pointercancel', clear);
  addEventListener('blur', clear);
  addEventListener('resize', queue, { passive: true });
  finePointer.addEventListener('change', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });

  // The capsule can change width while the pointer stays still.
  new ResizeObserver(queue).observe(capsule);
}
