import { useEffect, useState } from "react";
import { GAME_SYSTEM_LABELS, HealthSchema, type Campaign, type Entity, type EntityType } from "@bafft/shared";
import { SessionUpload } from "./SessionUpload.js";
import { SessionReview } from "./labelling/SessionReview.js";
import { Glossary } from "./Glossary.js";
import { GlossaryScreen } from "./GlossaryScreen.js";
import { RunSheets } from "./RunSheets.js";
import { CampaignSettings } from "./CampaignSettings.js";
import { NpcSection } from "./npc/NpcSection.js";
import { SoundboardSection } from "./soundboard/SoundboardSection.js";
import { api } from "./api.js";
import { Icon, type IconName } from "./theme/Icon.js";

// App shell (warm tabletop theme, bafft-vm8.4/a41): leather sidebar for the
// world's sections, a top bar with the campaign, parchment main area.
type Section = EntityType | "campaign" | "sessions" | "soundboard" | "glossary" | "run-sheet";

const WORLD: { id: EntityType; label: string; icon: IconName }[] = [
  { id: "npc", label: "NPCs", icon: "scroll" },
  { id: "location", label: "Locations", icon: "castle" },
  { id: "faction", label: "Factions", icon: "banner" },
  { id: "item", label: "Items", icon: "gem" },
  { id: "character", label: "Characters", icon: "helm" },
  { id: "player", label: "Players", icon: "crown" },
];

const TABLE: { id: Section; label: string; icon: IconName }[] = [
  { id: "run-sheet", label: "Run sheet", icon: "scroll" },
  { id: "sessions", label: "Sessions", icon: "mic" },
  { id: "glossary", label: "Glossary", icon: "words" },
  { id: "soundboard", label: "Soundboard", icon: "speaker" },
  { id: "campaign", label: "Campaign", icon: "book" },
];

export function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("npc");
  const [runSheetDirty, setRunSheetDirty] = useState(false);
  const [campaignDirty, setCampaignDirty] = useState(false);
  const [openId, setOpenId] = useState<number | undefined>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  // Once opened, the soundboard stays mounted (hidden) so its sounds keep
  // playing while the GM looks something up elsewhere mid-session.
  const [soundboardOpened, setSoundboardOpened] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setHealthy(HealthSchema.safeParse(j).success))
      .catch((e) => setError(String(e)));
    api.getCampaign(1).then(setCampaign).catch(() => {});
  }, []);

  function go(to: Section) {
    if (to === section) return;
    if (section === "campaign" && campaignDirty && !window.confirm("Leave campaign settings and discard unsaved changes?")) return;
    if (section === "run-sheet" && runSheetDirty && !window.confirm("Leave run sheet and discard unsaved changes?")) return;
    setRunSheetDirty(false);
    setCampaignDirty(false);
    if (to === "soundboard") setSoundboardOpened(true);
    setSection(to);
    setOpenId(undefined);
  }

  function openEntity(e: Entity) {
    setSection(e.type);
    setOpenId(e.id);
  }

  const navButton = (item: { id: Section; label: string; icon: IconName }) => (
    <button key={item.id} onClick={() => go(item.id)} aria-current={section === item.id ? "page" : undefined}>
      <Icon name={item.icon} />
      {item.label}
    </button>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <img className="seal" src="/icon.png" alt="" />
        <span className="campaign">{campaign?.name ?? "bafft"}</span>
        {campaign && <span className="system">· {GAME_SYSTEM_LABELS[campaign.gameSystem]}</span>}
      </header>
      <nav className="sidebar" aria-label="Sections">
        <div className="group">World</div>
        {WORLD.map(navButton)}
        <div className="group">Table</div>
        {TABLE.map(navButton)}
      </nav>
      <main className="main">
        {error && <p className="error">Server unreachable: {error}</p>}
        {healthy === null && !error && <p>Checking server…</p>}
        {healthy && (
          <>
            {section === "npc" && (
              <NpcSection drawSteel={campaign?.gameSystem === "draw-steel"} onOpenOther={openEntity} />
            )}
            {section !== "npc" && section !== "campaign" && section !== "sessions" && section !== "soundboard" && section !== "glossary" && section !== "run-sheet" && (
              <Glossary type={section} openId={openId} />
            )}
            {section === "run-sheet" && <RunSheets campaignId={campaign?.id ?? 1} onDirtyChange={setRunSheetDirty} />}
            {section === "campaign" && <CampaignSettings onSaved={setCampaign} onDirtyChange={setCampaignDirty} />}
            {section === "glossary" && <GlossaryScreen />}
            {soundboardOpened && (
              <div hidden={section !== "soundboard"}>
                <SoundboardSection />
              </div>
            )}
            {section === "sessions" &&
              (openId === undefined ? (
                <SessionUpload onOpen={setOpenId} />
              ) : (
                <SessionReview sessionId={openId} onBack={() => setOpenId(undefined)} />
              ))}
          </>
        )}
      </main>
    </div>
  );
}
