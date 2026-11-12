/**
 * The sketch behind the index. Each load shows one at random, never the one shown last, so a
 * reload always brings another. `?sketch=<name>` shows a given one. A reader can put the
 * sketches away with the button by the credit: nothing is fetched after that, and a note in the
 * credit's place brings them back. Both choices are kept in localStorage.
 */

interface Sketch {
  name: string;
  url: string;
}

const SHOWN = 'sketch';
const HIDDEN = 'sketch-hidden';

/** localStorage, which a browser may close to the page. */
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** A random index below `count`, other than `last` whenever there is another. */
export function pickSketch(count: number, last: number, random = Math.random) {
  if (count < 2 || last < 0 || last >= count) return Math.floor(random() * count);
  const pick = Math.floor(random() * (count - 1));
  return pick < last ? pick : pick + 1;
}

export function initSketch() {
  const layer = document.querySelector<HTMLElement>('[data-sketches]');
  // With more contrast or forced colours the layer is not shown, so there is nothing to fetch.
  if (!layer || getComputedStyle(layer).display === 'none') return;
  const corner = document.querySelector<HTMLElement>('[data-sketch-corner]')!;
  const hide = corner.querySelector<HTMLButtonElement>('[data-sketch-hide]')!;
  const note = corner.querySelector<HTMLElement>('[data-sketch-note]')!;
  const bring = corner.querySelector<HTMLButtonElement>('[data-sketch-show]')!;
  const credits = [...corner.querySelectorAll<HTMLElement>('[data-sketch-credit]')];
  const sketches: Sketch[] = JSON.parse(layer.dataset.sketches!);
  const asked = new URLSearchParams(location.search).get('sketch');
  // Goes up each time a sketch is asked for or put away, so one that arrives late is dropped.
  let turn = 0;
  // Here rather than from motion.ts, so that Node can load this file to test the pick.
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  // The page comes first: a sketch, and the code that shows it, are fetched once everything the
  // page itself needs has loaded, so they neither hold up its load nor slow its fonts.
  const loaded = new Promise((resolve) => {
    if (document.readyState === 'complete') resolve(undefined);
    else addEventListener('load', resolve, { once: true });
  });

  /** Fetches a sketch and starts drawing it (src/scripts/sketch-ink.ts). Settles once it is in the page. */
  const show = async ({ name, url }: Sketch) => {
    const mine = ++turn;
    await loaded;
    const art = import('./sketch-ink');
    const response = await fetch(url, { priority: 'low' });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const source = await response.text();
    const { show: put } = await art;
    if (mine !== turn) return;
    await put(layer, source, {
      draw: !still.matches,
      alive: () => mine === turn,
      begin: (done) => {
        corner.style.setProperty('--sketch-done', String(done));
        note.hidden = true;
        for (const credit of credits) credit.hidden = credit.dataset.sketchCredit !== name;
        hide.hidden = false;
        corner.hidden = false;
      },
    });
  };

  const draw = () => {
    const last = sketches.findIndex(({ name }) => name === stored(SHOWN));
    const sketch = sketches.find(({ name }) => name === asked) ?? sketches[pickSketch(sketches.length, last)];
    store(SHOWN, sketch.name);
    return show(sketch);
  };

  const putAway = () => {
    hide.hidden = true;
    for (const credit of credits) credit.hidden = true;
    note.hidden = false;
    corner.hidden = false;
  };

  hide.addEventListener('click', async () => {
    const mine = ++turn;
    store(HIDDEN, '1');
    putAway();
    bring.focus({ preventScroll: true });
    // The drawing fades with the layer's own transition, and is taken away when that is over.
    layer.classList.add('is-leaving');
    void getComputedStyle(layer).opacity;
    await Promise.allSettled(layer.getAnimations().map((animation) => animation.finished));
    if (mine !== turn) return;
    layer.replaceChildren();
    layer.classList.remove('is-leaving');
  });

  bring.addEventListener('click', async () => {
    store(HIDDEN, null);
    await draw();
    // The button that hides it again is there once the sketch has arrived.
    if (!hide.hidden) hide.focus({ preventScroll: true });
  });

  // A sketch asked for by name is shown even while they are put away.
  if (stored(HIDDEN) && !asked) putAway();
  else void draw();
}
