import { useEffect, useMemo, useState } from "react";
import type { EntityType, GlossaryEntry } from "@bafft/shared";
import { api } from "./api.js";
import { TYPE_SINGULAR } from "./labels.js";

// Glossary screen (bafft-w8f.1): every name in the world in one table, so the
// spellings transcription needs can be fixed without opening each card.
// Other names go to transcription as spellings; Sounds like is a pronunciation
// guide only. Names made of everyday words are shown struck through: the
// server leaves them out of the transcription vocabulary.

const splitCsv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

type Draft = { aliases: string; soundsLike: string };
type RowState = "saving" | "saved" | { error: string };

export function GlossaryScreen() {
  const [rows, setRows] = useState<GlossaryEntry[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [state, setState] = useState<Record<number, RowState>>({});
  const [filter, setFilter] = useState("");
  const [type, setType] = useState<EntityType | "">("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .getGlossary()
      .then((r) => {
        setRows(r);
        setDrafts(Object.fromEntries(r.map((e) => [e.id, { aliases: e.aliases.join(", "), soundsLike: e.soundsLike.join(", ") }])));
      })
      .catch((e) => setError(String(e)));
  }
  useEffect(load, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (rows ?? [])
      .filter((e) => !type || e.type === type)
      .filter((e) => !q || [e.name, ...e.aliases, ...e.soundsLike].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, filter, type]);

  async function save(e: GlossaryEntry) {
    const d = drafts[e.id];
    if (!d || (d.aliases === e.aliases.join(", ") && d.soundsLike === e.soundsLike.join(", "))) return;
    setState((s) => ({ ...s, [e.id]: "saving" }));
    try {
      await api.saveEntity(e.id, { aliases: splitCsv(d.aliases), soundsLike: splitCsv(d.soundsLike) });
      // Re-read so the struck-through names reflect the new aliases.
      const fresh = await api.getGlossary();
      setRows(fresh);
      setState((s) => ({ ...s, [e.id]: "saved" }));
    } catch (err) {
      setState((s) => ({ ...s, [e.id]: { error: err instanceof Error ? err.message : String(err) } }));
    }
  }

  const edit = (id: number, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));

  return (
    <section className="glossary-screen panel">
      <h2>Glossary</h2>
      <p className="hint">
        Every name in the world. <strong>Other names</strong> are sent to transcription as spellings.{" "}
        <strong>Sounds like</strong> is how it's said at the table, a guide for you only. Names made of everyday
        words (<s>The keep</s>) are left out of transcription, because it already spells them right.
      </p>
      <div className="row">
        <input
          type="search"
          aria-label="Filter names"
          placeholder="Filter names…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as EntityType | "")}>
          <option value="">Everything</option>
          {(Object.keys(TYPE_SINGULAR) as EntityType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_SINGULAR[t]}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p>Loading…</p>}
      {rows?.length === 0 && <p>No names yet. Add NPCs, places or items and they'll appear here.</p>}
      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="glossary-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Other names</th>
                <th>Sounds like</th>
                <th>Sent to transcription</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const d = drafts[e.id] ?? { aliases: "", soundsLike: "" };
                const st = state[e.id];
                const terms = [e.name, ...e.aliases];
                return (
                  <tr key={e.id}>
                    <th scope="row">
                      {e.name}
                      <div className="sub">{TYPE_SINGULAR[e.type]}</div>
                    </th>
                    <td>
                      <input
                        type="text"
                        aria-label={`Other names for ${e.name}`}
                        value={d.aliases}
                        onChange={(ev) => edit(e.id, { aliases: ev.target.value })}
                        onBlur={() => save(e)}
                        onKeyDown={(ev) => ev.key === "Enter" && save(e)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        aria-label={`Sounds like for ${e.name}`}
                        value={d.soundsLike}
                        onChange={(ev) => edit(e.id, { soundsLike: ev.target.value })}
                        onBlur={() => save(e)}
                        onKeyDown={(ev) => ev.key === "Enter" && save(e)}
                      />
                    </td>
                    <td>
                      <div className="terms">
                        {terms.map((t) =>
                          e.skipped.includes(t) ? (
                            <s key={t} className="term skipped" title="Everyday words: left out of transcription">
                              {t}
                            </s>
                          ) : (
                            <span key={t} className="term">
                              {t}
                            </span>
                          ),
                        )}
                      </div>
                      {st === "saving" && <small>Saving…</small>}
                      {st === "saved" && <small className="ok">Saved</small>}
                      {typeof st === "object" && <small className="error">{st.error}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
