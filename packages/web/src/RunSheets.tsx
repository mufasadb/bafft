import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RunSheet } from "@bafft/shared";
import { api } from "./api.js";

type Heading = { id: string; title: string; level: number };

function RunSheetMarkdown({ markdown }: { markdown: string }) {
  const content = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  useLayoutEffect(() => {
    const elements = Array.from(content.current?.querySelectorAll("h1,h2,h3,h4,h5,h6") ?? []);
    const jumps: Heading[] = [];
    elements.forEach((heading, index) => {
      heading.id = `run-sheet-heading-${index}`;
      heading.setAttribute("tabindex", "-1");
      const level = Number(heading.tagName.slice(1));
      if (level <= 3) jumps.push({ id: heading.id, title: heading.textContent ?? "", level });
    });
    setHeadings(jumps);
  }, [markdown]);
  return <div className="run-sheet-reading">
    <nav className="run-sheet-jumps" aria-label="Jump to">
      <h3>Jump to</h3>
      {headings.length ? headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}
        style={{ paddingLeft: `${(heading.level - 1) * 0.75}rem` }} onClick={(event) => {
          event.preventDefault();
          const target = document.getElementById(heading.id);
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
          target?.focus({ preventScroll: true });
        }}>{heading.title}</a>) : <small>Add headings to build a jump list.</small>}
    </nav>
    <div ref={content} className="run-sheet-markdown">
      {markdown.trim() ? <Markdown remarkPlugins={[remarkGfm]} skipHtml>{markdown}</Markdown> : <p>No notes yet. Choose Edit to prepare this session.</p>}
    </div>
  </div>;
}

export function RunSheets({ campaignId = 1, onDirtyChange }: {
  campaignId?: number; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [sheets, setSheets] = useState<RunSheet[]>([]);
  const [selected, setSelected] = useState<RunSheet | null>(null);
  const [form, setForm] = useState<{ title: string; markdown: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = form !== null && (selected === null || form.title !== selected.title || form.markdown !== selected.markdown);
  const showError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  useEffect(() => {
    let active = true;
    api.listRunSheets(campaignId).then((rows) => {
      if (!active) return;
      setSheets(rows); setSelected(rows[0] ?? null);
    }).catch((err) => { if (active) showError(err); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [campaignId]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function canLeave() { return !dirty || window.confirm("Discard unsaved run sheet changes?"); }
  function open(sheet: RunSheet | null) {
    if (saving || !canLeave()) return;
    setSelected(sheet); setForm(sheet ? null : { title: "New run sheet", markdown: "" });
    setEditing(sheet === null); setPreview(false); setError(null); setSaved(false);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true); setError(null);
    try {
      const row = await api.saveRunSheet(selected?.id ?? null, { ...form, campaignId });
      setSheets((rows) => [row, ...rows.filter((item) => item.id !== row.id)].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id));
      setSelected(row); setForm(null); setEditing(false); setPreview(false); setSaved(true);
    } catch (err) { showError(err); } finally { setSaving(false); }
  }
  async function remove() {
    if (!selected || saving || !canLeave() || !window.confirm(`Delete run sheet “${selected.title}”?`)) return;
    setSaving(true); setError(null);
    try {
      await api.deleteRunSheet(selected.id);
      const remaining = sheets.filter((row) => row.id !== selected.id);
      setSheets(remaining); setSelected(remaining[0] ?? null); setForm(null); setEditing(false); setSaved(false);
    } catch (err) { showError(err); } finally { setSaving(false); }
  }
  return <section className="run-sheets">
    <h2>Run sheet</h2>
    {error && <p role="alert" className="error">{error}</p>}
    {loading ? <p>Loading…</p> : <div className="run-sheet-layout">
      <aside className="run-sheet-list" aria-label="Run sheets">
        <button disabled={saving} onClick={() => open(null)}>+ New run sheet</button>
        {sheets.map((sheet) => <button key={sheet.id} disabled={saving} aria-current={sheet.id === selected?.id ? "true" : undefined}
          onClick={() => { if (sheet.id !== selected?.id) open(sheet); }}>{sheet.title}</button>)}
        {!sheets.length && <p>Prepare a run sheet for each session.</p>}
      </aside>
      <article className="run-sheet-detail">
        {editing && form ? <form onSubmit={save}>
          <label htmlFor="run-sheet-title">Title</label><input id="run-sheet-title" required maxLength={200} disabled={saving} value={form.title}
            onChange={(e) => { setForm({ ...form, title: e.target.value }); setSaved(false); }} />
          <div className="run-sheet-actions">
            <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? "Edit" : "Preview"}</button>
            <button disabled={saving || !form.title.trim()} type="submit">{saving ? "Saving…" : "Save"}</button>
            <button disabled={saving} type="button" onClick={() => { if (canLeave()) { setForm(null); setEditing(false); } }}>Cancel</button>
            {dirty && <span>Unsaved changes</span>}
          </div>
          {preview ? <RunSheetMarkdown markdown={form.markdown} /> : <><label htmlFor="run-sheet-markdown">Markdown</label><textarea id="run-sheet-markdown" rows={24} maxLength={100000} disabled={saving}
            value={form.markdown} onChange={(e) => setForm({ ...form, markdown: e.target.value })} /></>}
        </form> : selected ? <>
          <div className="run-sheet-actions"><h3>{selected.title}</h3>
            <button disabled={saving} onClick={() => { setForm({ title: selected.title, markdown: selected.markdown }); setEditing(true); setSaved(false); }}>Edit</button>
            <button disabled={saving} onClick={remove}>Delete</button>
            {saved && <span role="status">Saved</span>}
          </div>
          <RunSheetMarkdown markdown={selected.markdown} />
        </> : <p>Select a run sheet or create one for your next session.</p>}
      </article>
    </div>}
  </section>;
}
