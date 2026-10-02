import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GAME_SYSTEMS, GAME_SYSTEM_LABELS, type Campaign, type GameSystem } from "@bafft/shared";
import Markdown from "react-markdown";
import { api } from "./api.js";

// Campaign settings (bafft-n0q): the game system shapes AI drafting, and the
// image style is added to every "picture this" prompt. Single campaign for
// now, so this always edits campaign 1.
const CAMPAIGN_ID = 1;

type FormState = { name: string; gameSystem: GameSystem; styleAnchor: string; settingNotes: string };

function toForm(c: Campaign): FormState {
  return { name: c.name, gameSystem: c.gameSystem, styleAnchor: c.styleAnchor ?? "", settingNotes: c.settingNotes ?? "" };
}

export function CampaignSettings({ onSaved, onDirtyChange }: {
  onSaved?: (campaign: Campaign) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [savedForm, setSavedForm] = useState<FormState | null>(null);
  const [preview, setPreview] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(savedForm);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "error" | "done"; message?: string }>({
    kind: "idle",
  });

  function showError(err: unknown) {
    setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }

  useEffect(() => {
    api.getCampaign(CAMPAIGN_ID).then((c) => {
      setForm(toForm(c));
      setSavedForm(toForm(c));
    }).catch(showError);
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    function warn(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useLayoutEffect(() => {
    const textarea = notesRef.current;
    if (!textarea) return;
    function resize() {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [form?.settingNotes, preview]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setStatus({ kind: "saving" });
    try {
      const saved = await api.saveCampaign(CAMPAIGN_ID, {
        name: form.name,
        gameSystem: form.gameSystem,
        styleAnchor: form.styleAnchor.trim() || null,
        settingNotes: form.settingNotes.trim() || null,
      });
      setForm(toForm(saved));
      setSavedForm(toForm(saved));
      setStatus({ kind: "done" });
      onSaved?.(saved);
    } catch (err) {
      showError(err);
    }
  }

  if (!form) {
    return status.kind === "error" ? <p style={{ color: "crimson" }}>{status.message}</p> : <p>Loading…</p>;
  }

  const set = (patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setStatus({ kind: "idle" });
  };

  return (
    <section>
      <h2>Campaign</h2>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label style={{ maxWidth: 560 }}>
          Name
          <input
            type="text"
            required
            disabled={status.kind === "saving"}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          Game system
          <select
            disabled={status.kind === "saving"}
            value={form.gameSystem}
            onChange={(e) => set({ gameSystem: e.target.value as GameSystem })}
            style={{ display: "block" }}
          >
            {GAME_SYSTEMS.map((g) => (
              <option key={g} value={g}>
                {GAME_SYSTEM_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ maxWidth: 560 }}>
          Image style
          <input
            type="text"
            placeholder="e.g. muted watercolour, ink outlines"
            disabled={status.kind === "saving"}
            value={form.styleAnchor}
            onChange={(e) => set({ styleAnchor: e.target.value })}
            style={{ display: "block", width: "100%" }}
          />
          <small style={{ color: "#666" }}>Added to every "Picture this" so the campaign's images match.</small>
        </label>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
            <label htmlFor="setting-notes">Setting notes</label>
            <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit notes" : "Preview Markdown"}
            </button>
          </div>
          {preview ? (
            <div role="region" aria-label="Setting notes preview" style={{ minHeight: "18rem", overflowWrap: "anywhere" }}>
              {form.settingNotes.trim() ? <Markdown>{form.settingNotes}</Markdown> : <p>No setting notes yet.</p>}
            </div>
          ) : (
            <textarea
              id="setting-notes"
              ref={notesRef}
              rows={14}
              placeholder="Tone, themes, big facts about the world…"
              disabled={status.kind === "saving"}
              value={form.settingNotes}
              onChange={(e) => set({ settingNotes: e.target.value })}
              aria-describedby="setting-notes-help"
              style={{ display: "block", width: "100%", minHeight: "18rem", overflowY: "hidden" }}
            />
          )}
          <small id="setting-notes-help">Markdown supported. Given to "Draft with AI" as background.</small>
        </div>
        <div>
          <button type="submit" disabled={status.kind === "saving"}>
            {status.kind === "saving" ? "Saving…" : "Save"}
          </button>
          {dirty && <span style={{ marginLeft: "0.5rem" }}>Unsaved changes</span>}
          {status.kind === "done" && <span style={{ marginLeft: "0.5rem", color: "green" }}>Saved</span>}
          {status.kind === "error" && <span style={{ marginLeft: "0.5rem", color: "crimson" }}>{status.message}</span>}
        </div>
      </form>
    </section>
  );
}
