export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const root = document.documentElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const THEME_COLOR: Record<Theme, string> = { light: '#f3f0e8', dark: '#161311' };

export const currentTheme = (): Theme => (root.dataset.theme as Theme) ?? (darkQuery.matches ? 'dark' : 'light');
export const themePreference = (): ThemePreference => (root.dataset.theme as Theme) ?? 'system';

function syncThemeColor() {
  const override = root.dataset.theme as Theme | undefined;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = THEME_COLOR[override ?? (meta.media.includes('dark') ? 'dark' : 'light')];
  });
}

function store(pref: ThemePreference) {
  try {
    if (pref === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', pref);
  } catch {}
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncThemeColor();
  dispatchEvent(new Event('themechange'));
}

/** Apply immediately; CSS transitions keep the live page interactive. */
export function setTheme(pref: ThemePreference) {
  store(pref);
}

/** The header toggle flips the look; choosing what the system already shows clears the override. */
export function toggleTheme() {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next === (darkQuery.matches ? 'dark' : 'light') ? 'system' : next);
}

darkQuery.addEventListener('change', () => {
  if (!root.dataset.theme) dispatchEvent(new Event('themechange'));
});

syncThemeColor();
