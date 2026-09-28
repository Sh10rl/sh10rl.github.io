export {};
interface Article { path: string; markdown: string; version: string; url: string; title: string }
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const editor = get<HTMLTextAreaElement>('MarkdownEditor');
const picker = get<HTMLSelectElement>('ArticlePicker');
const category = get<HTMLSelectElement>('ArticleCategory');
const frame = get<HTMLIFrameElement>('MarkdownPreview');
const status = get('EditorStatus');
const saveButton = get<HTMLButtonElement>('SaveArticle');
const openLink = get<HTMLAnchorElement>('OpenArticle');
let current: Article | null = null;
let saved = '';
let previewTimer: ReturnType<typeof setTimeout>;
let previewRequest = 0;
let saving = false;
let saveFinished = Promise.resolve();
let editorRevision = 0;
let loadSequence = 0;

// Content updates reload the dev page; retain the returned path and version first.
import.meta.hot?.on('vite:beforeFullReload', () => saveFinished);

const message = (text: string, error = false) => { status.textContent = text; status.toggleAttribute('data-error', error); };
const remember = () => {
  try { sessionStorage.setItem('article-editor', JSON.stringify({ current, saved, markdown: editor.value, category: category.value })); } catch {}
};
const request = async <T>(url: string, data?: unknown): Promise<T> => {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
};
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!);

async function preview() {
  const serial = ++previewRequest;
  try {
    const result = await request<{ html: string; title: string }>('/__editor/preview', { markdown: editor.value, path: current?.path });
    if (serial !== previewRequest) return;
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map(el => el.outerHTML).join('');
    frame.srcdoc = `<!doctype html><html data-theme="${escape(document.documentElement.dataset.theme || '')}" data-font="${escape(document.documentElement.dataset.font || '')}"><head><meta charset="utf-8"><base target="_blank">${styles}<style>body{display:block;padding:1.25rem;background:var(--raised)}.prose{max-width:48rem;margin:auto}.prose>h1{font:var(--type-title);margin:0 0 1rem}.code-copy{display:none}</style></head><body><article class="prose">${result.title ? '<h1>'+escape(result.title)+'</h1>' : ''}${result.html}</article></body></html>`;
  } catch (error) { if (serial === previewRequest) message((error as Error).message, true); }
}

async function list() {
  const articles = await request<{ path: string; title: string }[]>('/__editor/posts');
  picker.replaceChildren(new Option('New article', ''), ...articles.map(article => new Option(article.title, article.path)));
  picker.value = current?.path ?? '';
}

function show(article: Article | null) {
  editorRevision++;
  loadSequence++;
  current = article;
  editor.value = saved = article?.markdown ?? '';
  get('EditorPath').textContent = article ? `posts/${article.path}` : 'New article';
  get('CategoryField').hidden = !!article;
  openLink.hidden = !article;
  if (article) openLink.href = article.url;
  picker.value = article?.path ?? '';
  remember();
  void preview();
}

async function load(path: string) {
  const sequence = ++loadSequence;
  try {
    const article = path ? await request<Article>(`/__editor/post?path=${encodeURIComponent(path)}`) : null;
    if (sequence !== loadSequence) return;
    show(article);
    message(path ? 'Loaded from disk.' : 'Start with a # title. The date and file name are automatic.');
  }
  catch (error) { message((error as Error).message, true); }
}

function canLeave() { return editor.value === saved || confirm('Discard the unsaved changes in this editor?'); }
picker.addEventListener('change', () => { if (canLeave()) void load(picker.value); else picker.value = current?.path ?? ''; });
get('NewArticle').addEventListener('click', () => { if (canLeave()) { show(null); message('Start with a # title. The date and file name are automatic.'); editor.focus(); } });
editor.addEventListener('input', () => {
  remember();
  message(editor.value === saved ? 'Saved.' : 'Unsaved changes');
  clearTimeout(previewTimer);
  previewTimer = setTimeout(preview, 220);
});
category.addEventListener('change', remember);

async function save() {
  if (saving) return;
  saving = true;
  let finishSave!: () => void;
  saveFinished = new Promise<void>(resolve => { finishSave = resolve; });
  saveButton.disabled = true;
  const text = editor.value;
  const revision = editorRevision;
  try {
    const article = await request<Article>('/__editor/save', { path: current?.path, version: current?.version, category: category.value, markdown: text });
    if (revision !== editorRevision) { await list(); return; }
    current = article;
    saved = article.markdown;
    if (editor.value === text) editor.value = saved;
    get('EditorPath').textContent = `posts/${article.path}`;
    get('CategoryField').hidden = true;
    openLink.hidden = false;
    openLink.href = article.url;
    remember();
    await list();
    message(editor.value === saved ? 'Saved locally.' : 'Saved. Newer changes are still unsaved.');
  } catch (error) { message((error as Error).message, true); }
  finally { saving = false; saveButton.disabled = false; finishSave(); }
}

saveButton.addEventListener('click', save);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
});
addEventListener('beforeunload', event => {
  remember();
  if (editor.value !== saved) { event.preventDefault(); event.returnValue = ''; }
});
addEventListener('themechange', () => { if (frame.contentDocument) frame.contentDocument.documentElement.dataset.theme = document.documentElement.dataset.theme ?? ''; });
addEventListener('fontchange', () => { if (frame.contentDocument) frame.contentDocument.documentElement.dataset.font = document.documentElement.dataset.font ?? ''; });

void (async () => {
  await list();
  try {
    const draft = JSON.parse(sessionStorage.getItem('article-editor') || 'null');
    if (draft) {
      const restored = draft.current as Article | null;
      show(restored);
      saved = draft.saved;
      editor.value = draft.markdown;
      category.value = draft.category;
      if (editor.value === saved && restored) await load(restored.path);
      else { remember(); void preview(); message('Restored your unsaved text.'); }
    } else void preview();
  } catch { void preview(); }
})().catch(error => message(error.message, true));
