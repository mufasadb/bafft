import { negotiationStart, type Entity } from "@bafft/shared";
import { Picture } from "../Picture.js";
import { Relationships } from "../Relationships.js";
import { Icon } from "../theme/Icon.js";
import { Pips } from "../theme/Pips.js";

// The at-the-table read view of an NPC (bafft-vm8.4): framed portrait, who
// they are in one line, scannable bullets, negotiation at a glance.
export function NpcCard({
  npc,
  entities,
  onEdit,
  onDelete,
  onOpen,
  onChanged,
  onError,
}: {
  npc: Entity;
  entities: Entity[];
  onEdit: () => void;
  onDelete: () => void;
  onOpen: (e: Entity) => void;
  onChanged: (updated?: Entity) => void;
  onError: (err: unknown) => void;
}) {
  const p = npc.profile ?? {};
  const n = p.negotiation;
  const start = negotiationStart(n?.attitude);
  const who = [p.ancestry, p.occupation].filter(Boolean).join(" · ");
  const atTable = [
    ["Look", p.look],
    ["Voice", p.voice],
    ["Behaviour", p.behaviour],
    ["Flaw", p.flaw],
  ].filter(([, v]) => v);
  const drives = [
    ["Wants", p.wants],
    ["Can", p.can],
    ["Plan", p.plan],
    ["If it goes sideways", p.sideways],
  ].filter(([, v]) => v);

  return (
    <article className="npc-card panel ornate">
      <div className="card-head">
        <Picture key={npc.id} entity={npc} framed onSaved={onChanged} onError={onError} />
        <div className="card-title">
          <h2 className="npc-name">{npc.name}</h2>
          {who && <div className="who">{who}</div>}
          {npc.aliases.length > 0 && <p className="hint">Also called {npc.aliases.join(", ")}</p>}
          {npc.soundsLike.length > 0 && <p className="hint">Said like “{npc.soundsLike.join("”, “")}”</p>}
          <div className="row">
            <button onClick={onEdit}>
              <Icon name="quill" />
              Edit
            </button>
            <button className="ghost danger" onClick={onDelete}>
              <Icon name="trash" size={16} />
              Delete
            </button>
          </div>
        </div>
      </div>

      <hr className="divider" />

      <div className="card-body">
        <div>
          {(atTable.length > 0 || npc.quirks.length > 0) && (
            <>
              <h3>At the table</h3>
              <ul className="bullets">
                {atTable.map(([label, value]) => (
                  <li key={label}>
                    <strong>{label}:</strong> {value}
                  </li>
                ))}
                {npc.quirks.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          )}
          {drives.length > 0 && (
            <>
              <h3>What drives them</h3>
              <ul className="bullets">
                {drives.map(([label, value]) => (
                  <li key={label}>
                    <strong>{label}:</strong> {value}
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.story && (
            <>
              <h3>Story</h3>
              <p className="prose story">{p.story}</p>
            </>
          )}
          {npc.notes && (
            <>
              <h3>
                Notes <span className="gm-only">GM only</span>
              </h3>
              <p className="prose">{npc.notes}</p>
            </>
          )}
        </div>

        {n && (
          <aside className="negotiation">
            <h3 style={{ marginTop: 0 }}>Negotiation</h3>
            <dl>
              {n.attitude && (
                <>
                  <dt>Attitude</dt>
                  <dd>{n.attitude}</dd>
                </>
              )}
              {start && (
                <>
                  <dt>Interest</dt>
                  <dd>
                    <Pips value={start.interest} label="Interest" />
                  </dd>
                  <dt>Patience</dt>
                  <dd>
                    <Pips value={start.patience} label="Patience" />
                  </dd>
                </>
              )}
              {n.impression && (
                <>
                  <dt>Impression</dt>
                  <dd>{n.impression}</dd>
                </>
              )}
              {n.language && (
                <>
                  <dt>Language</dt>
                  <dd>{n.language}</dd>
                </>
              )}
            </dl>
            {n.motivations.length > 0 && <strong>Motivations</strong>}
            {n.motivations.map((m) => (
              <p key={m.kind} className="pick-line">
                <span className="chip motivation">{m.kind}</span> {m.reason}
              </p>
            ))}
            {n.pitfalls.length > 0 && <strong>Pitfalls</strong>}
            {n.pitfalls.map((m) => (
              <p key={m.kind} className="pick-line">
                <span className="chip pitfall">{m.kind}</span> {m.reason}
              </p>
            ))}
            {n.offers && n.offers.length > 0 && (
              <>
                <strong>Offers</strong>
                <table className="offers-table">
                  <tbody>
                    {n.offers.map((o) => (
                      <tr key={o.interest}>
                        <th scope="row">{o.interest}</th>
                        <td>{o.offer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </aside>
        )}
      </div>

      <h3>Relationships</h3>
      <Relationships entity={npc} entities={entities} onOpen={onOpen} onChanged={() => onChanged()} onError={onError} />
    </article>
  );
}
