import { useEffect, useState, type DragEvent } from "react";
import { GlossaryEntrySchema, SessionSchema, type GlossaryEntry, type Session } from "@bafft/shared";

// Session creation + upload screen (bafft-wg1.7): title + date, drag-drop
// the session audio, and a read-only preview of the glossary snapshot that
// will be compiled into ASR keyterms. Editing it happens on the Glossary
// screen (GlossaryScreen.tsx), not here.
export function SessionUpload({ onOpen }: { onOpen?: (sessionId: number) => void }) {
  const [entities, setEntities] = useState<GlossaryEntry[] | null>(null);
  const skippedNames = new Set((entities ?? []).flatMap((e) => e.skipped.map((t) => `${e.id}:${t}`)));
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [title, setTitle] = useState("");
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [speakersExpected, setSpeakersExpected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "uploading" | "error" | "done"; message?: string }>({
    kind: "idle",
  });

  function loadEntities() {
    fetch("/api/entities/glossary")
      .then((r) => r.json())
      .then((j) => setEntities(GlossaryEntrySchema.array().parse(j)))
      .catch((e) => console.error("failed to load glossary snapshot", e));
  }

  function loadSessions() {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((j) => setSessions(SessionSchema.array().parse(j)))
      .catch((e) => console.error("failed to load sessions", e));
  }

  useEffect(() => {
    loadEntities();
    loadSessions();
  }, []);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setStatus({ kind: "error", message: "Drag an audio file in first." });
      return;
    }
    setStatus({ kind: "uploading" });
    const form = new FormData();
    form.set("title", title);
    form.set("sessionDate", sessionDate);
    form.set("speakersExpected", speakersExpected);
    form.set("audio", file);

    try {
      const res = await fetch("/api/sessions", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `upload failed (${res.status})`);
      }
      SessionSchema.parse(await res.json());
      setStatus({ kind: "done" });
      setTitle("");
      setFile(null);
      loadSessions();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
      <section style={{ flex: "1 1 320px", minWidth: 280 }}>
        <h2>New session</h2>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{ display: "block", width: "100%" }}
            />
          </label>
          <label>
            Session date
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              required
              style={{ display: "block" }}
            />
          </label>
          <label>
            People at the table (GM included)
            <input
              type="number"
              min={1}
              max={20}
              value={speakersExpected}
              onChange={(e) => setSpeakersExpected(e.target.value)}
              style={{ display: "block", width: "6em" }}
            />
            <small style={{ color: "#666" }}>Optional. Helps transcription tell voices apart.</small>
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            style={{
              border: `2px dashed ${dragActive ? "#4a90d9" : "#999"}`,
              borderRadius: 8,
              padding: "1.5rem",
              textAlign: "center",
              background: dragActive ? "#eef6ff" : "transparent",
            }}
          >
            {file ? (
              <p>
                {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
              </p>
            ) : (
              <p>Drag the session audio file here, or click to browse.</p>
            )}
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: "block", margin: "0.5rem auto 0" }}
            />
          </div>
          <button type="submit" disabled={status.kind === "uploading"}>
            {status.kind === "uploading" ? "Uploading…" : "Create session"}
          </button>
          {status.kind === "error" && <p style={{ color: "crimson" }}>{status.message}</p>}
          {status.kind === "done" && <p style={{ color: "green" }}>Session created.</p>}
        </form>

        <h3>Sessions</h3>
        {sessions === null && <p>Loading…</p>}
        {sessions?.length === 0 && <p>No sessions yet.</p>}
        <ul>
          {sessions?.map((s) => (
            <li key={s.id}>
              {onOpen ? (
                <button className="link" onClick={() => onOpen(s.id)}>
                  {s.title}
                </button>
              ) : (
                s.title
              )}{" "}
              — {s.sessionDate} — <em>{s.status}</em>
              {s.transcriptionError && (
                <div style={{ color: "crimson", fontSize: "0.9em" }}>Transcription failed: {s.transcriptionError}</div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ flex: "1 1 280px", minWidth: 240 }}>
        <h2>Glossary snapshot (read-only)</h2>
        <p style={{ color: "#666", fontSize: "0.9em" }}>
          The names sent to transcription. Struck-through names are everyday words and are left out. Edit them on the
          Glossary screen.
        </p>
        {entities === null && <p>Loading…</p>}
        {entities?.length === 0 && <p>No entities yet.</p>}
        <ul>
          {entities?.map((e) => (
            <li key={e.id}>
              <strong>{skippedNames.has(`${e.id}:${e.name}`) ? <s>{e.name}</s> : e.name}</strong> ({e.type})
              {e.aliases.length > 0 && (
                <>
                  {" "}
                  — aka{" "}
                  {e.aliases.map((a, i) => (
                    <span key={a}>
                      {i > 0 && ", "}
                      {skippedNames.has(`${e.id}:${a}`) ? <s>{a}</s> : a}
                    </span>
                  ))}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
