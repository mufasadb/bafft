import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entity, Session, Speaker, TranscriptWord } from "@bafft/shared";
import { SessionReview } from "./SessionReview.js";
import { api, ApiError } from "../api.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ApiError: actual.ApiError,
    api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])),
  };
});

const mocked = vi.mocked(api);

function session(extra: Partial<Session> = {}): Session {
  return {
    id: 7, campaignId: 1, title: "The Mighty Nein, ep 23", sessionDate: "2026-09-20", audioPath: "audio/7/s.m4a",
    status: "transcribed", speakersExpected: 8, transcriptionProvider: "assemblyai", transcriptionError: null,
    createdAt: new Date(0), ...extra,
  };
}

function word(id: number, speakerLabel: string, text: string, startMs: number, isUncertain = false): TranscriptWord {
  return { id, sessionId: 7, speakerLabel, text, startMs, endMs: startMs + 300, confidence: isUncertain ? 0.4 : 0.95, isUncertain, corrected: false, heardText: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.listNameMatches.mockResolvedValue([]);
  mocked.listSpeakers.mockResolvedValue([]);
});

test("renders speaker turns and marks unsure words", async () => {
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([
    word(1, "Speaker A", "What", 9_494_000),
    word(2, "Speaker A", "is", 9_494_300),
    word(3, "Speaker A", "Fjord", 9_494_600, true),
    word(4, "Speaker B", "Bored.", 9_495_200),
  ]);
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  expect(await screen.findByText("Speaker A")).toBeInTheDocument();
  expect(screen.getByText("Speaker B")).toBeInTheDocument();
  expect(screen.getByText("2:38:14")).toBeInTheDocument();

  const fjord = screen.getByText("Fjord", { exact: false });
  expect(fjord).toHaveClass("uncertain");
  expect(fjord).toHaveAttribute("data-start-ms", "9494600");
  expect(fjord).toHaveAttribute("data-end-ms", "9494900");
  expect(screen.getByText("What", { exact: false })).not.toHaveClass("uncertain");
});

test("marks possible misheard names with the suggested spelling, and counts them", async () => {
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([
    word(1, "Speaker A", "through", 0),
    word(2, "Speaker A", "Hooper", 300),
    word(3, "Speaker A", "Duke.", 600),
    word(4, "Speaker A", "Barelbin", 900, true),
  ]);
  mocked.listNameMatches.mockResolvedValue([
    { wordIds: [2, 3], heard: "Hooper Duke.", entityId: 1, suggestion: "Hupperdook", via: "sound" },
    { wordIds: [4], heard: "Barelbin", entityId: 2, suggestion: "Berleben", via: "sound" },
  ]);
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  expect(await screen.findByRole("button", { name: "Check names (2)" })).toBeInTheDocument();
  for (const text of ["Hooper", "Duke."]) {
    const w = screen.getByText(text, { exact: false });
    expect(w).toHaveClass("possible-name");
    expect(w).toHaveAttribute("title", expect.stringContaining('"Hupperdook"'));
  }
  // A possible name outranks plain low confidence.
  expect(screen.getByText("Barelbin", { exact: false })).toHaveClass("possible-name");
  expect(screen.getByText("through", { exact: false })).not.toHaveClass("possible-name");
});

test("Check names lists possible names, then very low confidence words, and jumps to one", async () => {
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([
    word(1, "Speaker A", "around", 1000),
    word(2, "Speaker A", "Hupperduke", 2000),
    word(3, "Speaker A", "umm", 3000, true),
  ]);
  mocked.listNameMatches.mockResolvedValue([
    { wordIds: [2], heard: "Hupperduke", entityId: 1, suggestion: "Hupperdook", via: "sound" },
  ]);
  const scrolled: Element[] = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Check names (1)" }));
  const names = screen.getByRole("tab", { name: "Possible names (1)" });
  expect(names).toHaveAttribute("aria-selected", "true");
  const row = screen.getByRole("button", { name: /Hupperdook/ });

  await userEvent.click(row);
  expect(scrolled).toEqual([screen.getAllByText("Hupperduke", { exact: false }).find((el) => el.classList.contains("word"))]);
  expect(scrolled[0]).toHaveClass("flash");
  expect(play).toHaveBeenCalled();

  await userEvent.click(screen.getByRole("tab", { name: "Very low confidence (1)" }));
  expect(screen.getByRole("button", { name: /umm/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Hupperdook/ })).not.toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Places to check" })).not.toBeInTheDocument();
});

test("an untranscribed session offers to run transcription, then shows the result", async () => {
  mocked.getSession.mockResolvedValueOnce(session({ status: "uploaded" }));
  mocked.listWords.mockResolvedValueOnce([]);
  mocked.transcribe.mockResolvedValue(session());
  mocked.getSession.mockResolvedValueOnce(session());
  mocked.listWords.mockResolvedValueOnce([word(1, "Speaker A", "Hello", 0)]);
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  expect(await screen.findByText("Not transcribed yet.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Run transcription" }));
  expect(mocked.transcribe).toHaveBeenCalledWith(7);
  expect(await screen.findByText("Speaker A")).toBeInTheDocument();
});

test("a failed run shows its error and offers a retry", async () => {
  mocked.getSession.mockResolvedValue(session({ status: "uploaded", transcriptionError: "AssemblyAI POST failed (401)" }));
  mocked.listWords.mockResolvedValue([]);
  mocked.transcribe.mockRejectedValue(new ApiError("AssemblyAI POST failed (401)", 422));
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  expect(await screen.findByText(/Last attempt failed: AssemblyAI POST failed \(401\)/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("a transcribed session with no words says so", async () => {
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([]);
  render(<SessionReview sessionId={7} onBack={() => {}} />);
  expect(await screen.findByText(/found no speech/)).toBeInTheDocument();
});

test("clicking a word plays a clip from just before it; Space replays it", async () => {
  const play = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  let currentTime = 0;
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation((t: number) => {
    currentTime = t;
  });
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([word(1, "Speaker A", "Hello", 1000), word(2, "Speaker A", "Fjord", 9_494_600, true)]);
  const { container } = render(<SessionReview sessionId={7} onBack={() => {}} />);

  const audio = await vi.waitFor(() => {
    const el = container.querySelector("audio");
    if (!el) throw new Error("no audio yet");
    return el;
  });
  expect(audio.getAttribute("src")).toBe("/api/sessions/7/audio");

  await userEvent.click(screen.getByText("Fjord", { exact: false }));
  expect(currentTime).toBe(9494.1);
  expect(play).toHaveBeenCalledTimes(1);

  currentTime = 0;
  fireEvent.keyDown(document.body, { key: " " });
  expect(currentTime).toBe(9494.1);
  expect(play).toHaveBeenCalledTimes(2);
});

test("a session without audio shows the transcript but no player", async () => {
  mocked.getSession.mockResolvedValue(session({ audioPath: null }));
  mocked.listWords.mockResolvedValue([word(1, "Speaker A", "Hello", 0)]);
  const { container } = render(<SessionReview sessionId={7} onBack={() => {}} />);
  expect(await screen.findByText("Speaker A")).toBeInTheDocument();
  expect(container.querySelector("audio")).toBeNull();
});

// bafft-wg1.11: fixing words.
function corrected(w: TranscriptWord, text: string, extra: Partial<TranscriptWord> = {}): TranscriptWord {
  return { ...w, text, corrected: true, heardText: w.text, ...extra };
}

test("double-clicking a word opens it for fixing, and Enter saves that one fix at once", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const words = [word(1, "Speaker A", "we", 0), word(2, "Speaker A", "sail", 300), word(3, "Speaker A", "tomorow", 600)];
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue(words);
  mocked.correctWords.mockResolvedValue({ word: corrected(words[2]!, "tomorrow"), removedIds: [], glossary: { kind: "none" } });
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  await userEvent.dblClick(await screen.findByText("tomorow", { exact: false }));
  const input = screen.getByRole("textbox", { name: "Correct text" });
  expect(input).toHaveValue("tomorow");
  await userEvent.clear(input);
  await userEvent.type(input, "tomorrow{Enter}");

  expect(mocked.correctWords).toHaveBeenCalledWith(7, { wordIds: [3], text: "tomorrow" });
  const fixed = await screen.findByText("tomorrow", { exact: false });
  expect(fixed).toHaveClass("corrected");
  expect(fixed).toHaveAttribute("title", 'Corrected (heard "tomorow")');
  expect(screen.queryByRole("dialog", { name: "Fix word" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  expect(screen.queryByRole("button", { name: /save all/i })).not.toBeInTheDocument();
});

test("a possible name opens from Check names with its suggestion, and merges the words it spans", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  Element.prototype.scrollIntoView = () => {};
  const words = [word(1, "Speaker A", "to", 0), word(2, "Speaker A", "Hooper", 300), word(3, "Speaker A", "Duke", 600)];
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue(words);
  mocked.listNameMatches.mockResolvedValueOnce([
    { wordIds: [2, 3], heard: "Hooper Duke", entityId: 4, suggestion: "Hupperdook", via: "sound" },
  ]);
  mocked.correctWords.mockResolvedValue({
    word: corrected(words[1]!, "Hupperdook", { endMs: 900, heardText: "Hooper Duke" }),
    removedIds: [3],
    glossary: { kind: "known", entityId: 4, name: "Hupperdook", heard: "Hooper Duke", hint: "added" },
  });
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Check names (1)" }));
  await userEvent.click(screen.getByRole("button", { name: /Hupperdook/ }));
  const fix = screen.getByRole("dialog", { name: "Fix word" });
  expect(fix).toHaveTextContent("Heard Hooper Duke"); // <q> draws its own quotes
  expect(screen.getByRole("textbox", { name: "Correct text" })).toHaveValue("Hupperdook");

  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(mocked.correctWords).toHaveBeenCalledWith(7, { wordIds: [2, 3], text: "Hupperdook" });
  await vi.waitFor(() => expect(document.querySelector('.word[data-word-id="2"]')).toHaveTextContent("Hupperdook"));
  expect(document.querySelector('.word[data-word-id="2"]')).toHaveClass("corrected");
  expect(document.querySelector('.word[data-word-id="3"]')).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent('"Hooper Duke" now flags as Hupperdook in other sessions');
  expect(screen.getByRole("button", { name: "Check names (0)" })).toBeInTheDocument();
});

test("fixing to a name nobody has entered asks whether to add it, and as what", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const words = [word(1, "Speaker A", "zarro", 0, true)];
  const tower = { id: 9, type: "location", name: "Ravenloft", aliases: [], soundsLike: [] } as unknown as Entity;
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue(words);
  mocked.listEntities.mockResolvedValue([tower]);
  mocked.correctWords.mockResolvedValue({
    word: corrected(words[0]!, "Zarovich"),
    removedIds: [],
    glossary: { kind: "unknown", name: "Zarovich", heard: "zarro", heardIsPlain: false },
  });
  mocked.saveEntity.mockResolvedValue({ ...tower, id: 10, name: "Zarovich" });
  mocked.setLocationInside.mockResolvedValue();
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  // A single click opens a word that's marked unsure.
  await userEvent.click(await screen.findByText("zarro", { exact: false }));
  const input = screen.getByRole("textbox", { name: "Correct text" });
  await userEvent.clear(input);
  await userEvent.type(input, "Zarovich{Enter}");

  expect(await screen.findByText(/isn't in the glossary yet/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "As" }), "location");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Inside" }), "9");
  expect(screen.getByRole("checkbox", { name: /Flag\W*zarro\W*as Zarovich/ })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Add to glossary" }));

  expect(mocked.saveEntity).toHaveBeenCalledWith(null, { type: "location", name: "Zarovich", soundsLike: ["zarro"] });
  expect(mocked.setLocationInside).toHaveBeenCalledWith(10, 9);
  expect(await screen.findByRole("status")).toHaveTextContent("Added Zarovich to the glossary (Location).");
  expect(screen.queryByRole("dialog", { name: "Fix word" })).not.toBeInTheDocument();
});

test("an everyday heard word isn't flagged as the name unless the owner asks", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const words = [word(1, "Speaker A", "acid", 0)];
  const yasha = { id: 3, type: "npc", name: "Yasha", aliases: [], soundsLike: ["yah-sha"] } as unknown as Entity;
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue(words);
  mocked.listEntities.mockResolvedValue([yasha]);
  mocked.saveEntity.mockResolvedValue(yasha);
  mocked.correctWords.mockResolvedValue({
    word: corrected(words[0]!, "Yasha"),
    removedIds: [],
    glossary: { kind: "known", entityId: 3, name: "Yasha", heard: "acid", hint: "everyday" },
  });
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  await userEvent.dblClick(await screen.findByText("acid", { exact: false }));
  await userEvent.type(screen.getByRole("textbox", { name: "Correct text" }), "Yasha{Enter}");
  expect(await screen.findByRole("status")).toHaveTextContent(/everyday word/);
  expect(mocked.saveEntity).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: 'Flag every "acid" anyway' }));
  expect(mocked.saveEntity).toHaveBeenCalledWith(3, { soundsLike: ["yah-sha", "acid"] });
});

// bafft-wg1.12: who's talking.
function speaker(speakerLabel: string, extra: Partial<Speaker> = {}): Speaker {
  return { speakerLabel, wordCount: 2, name: null, entityId: null, hero: null, ...extra };
}

test("clicking a speaker's name asks who it is; picking a player names every turn, with their hero", async () => {
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([
    word(1, "Speaker A", "I", 0),
    word(2, "Speaker A", "draw", 300),
    word(3, "Speaker B", "Roll", 9_000),
    word(4, "Speaker A", "Again", 20_000),
  ]);
  mocked.listSpeakers.mockResolvedValue([speaker("Speaker A", { wordCount: 3 }), speaker("Speaker B", { wordCount: 1 })]);
  const ava = { id: 9, type: "player", name: "Ava", aliases: [], soundsLike: [] } as unknown as Entity;
  mocked.listEntities.mockResolvedValue([ava, { ...ava, id: 3, type: "npc", name: "Zelvik" }]);
  mocked.setSpeaker.mockResolvedValue(
    speaker("Speaker A", { wordCount: 3, name: "Ava", entityId: 9, hero: { id: 7, name: "Neris", imagePath: "images/neris.png", updatedAt: new Date(5) } }),
  );
  const { container } = render(<SessionReview sessionId={7} onBack={() => {}} />);

  await screen.findAllByRole("button", { name: "Speaker B" });
  await userEvent.click(screen.getAllByRole("button", { name: "Speaker A" })[1]!); // [0] is the strip
  const picker = screen.getByRole("dialog", { name: "Who is Speaker A?" });
  expect(picker).toHaveTextContent("guessed from voices");
  // Players only (and the GM), not every name in the world.
  expect(await screen.findByRole("button", { name: "Ava" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Zelvik" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Ava" }));

  expect(mocked.setSpeaker).toHaveBeenCalledWith(7, { speakerLabel: "Speaker A", name: "Ava", entityId: 9 });
  await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "Ava · Neris" })).toHaveLength(3)); // strip + 2 turns
  expect(screen.getAllByRole("button", { name: "Speaker B" })).toHaveLength(2);
  expect(container.querySelector('img.speaker-badge[data-speaker-label="Speaker A"]')).toHaveAttribute("src", "/data/images/neris.png?v=5");
  expect(screen.queryByRole("dialog", { name: "Who is Speaker A?" })).not.toBeInTheDocument();
});

test("a speaker can be the GM, someone typed in, or put back to its label", async () => {
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue([word(1, "Speaker A", "Welcome", 0)]);
  mocked.listSpeakers.mockResolvedValue([speaker("Speaker A", { name: "GM" })]);
  mocked.listEntities.mockResolvedValue([]);
  mocked.setSpeaker.mockImplementation(async (_id, u) => speaker(u.speakerLabel, { name: u.name || null }));
  render(<SessionReview sessionId={7} onBack={() => {}} />);

  await userEvent.click((await screen.findAllByRole("button", { name: "GM" }))[0]!);
  expect(screen.getByRole("button", { name: "GM", pressed: true })).toBeInTheDocument();
  expect(screen.getByText(/No players yet/)).toBeInTheDocument();
  await userEvent.type(screen.getByRole("textbox", { name: "Someone else" }), "Guest Tom{Enter}");
  expect(mocked.setSpeaker).toHaveBeenLastCalledWith(7, { speakerLabel: "Speaker A", name: "Guest Tom", entityId: null });

  await userEvent.click((await screen.findAllByRole("button", { name: "Guest Tom" }))[0]!);
  await userEvent.click(screen.getByRole("button", { name: /Back to .Speaker A./ }));
  expect(mocked.setSpeaker).toHaveBeenLastCalledWith(7, { speakerLabel: "Speaker A", name: null, entityId: null });
  await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "Speaker A" })).toHaveLength(2));
});

test("a saved fix offers ticked occurrences with context and applies only the selected run", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const words = [word(1, "Speaker A", "mistvale", 0), word(2, "Speaker A", "MIST", 5000),
    word(3, "Speaker A", "VALE,", 5300), word(4, "Speaker A", "mistvale", 10000)];
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue(words);
  mocked.correctWords.mockResolvedValueOnce({
    word: corrected(words[0]!, "Mistvale"), removedIds: [], glossary: { kind: "none" },
    occurrences: [
      { wordIds: [2, 3], startMs: 5000, heard: "MIST VALE,", context: "through MIST VALE, tonight" },
      { wordIds: [4], startMs: 10000, heard: "mistvale", context: "leave mistvale tomorrow" },
    ],
  }).mockResolvedValueOnce({
    word: corrected(words[1]!, "Mistvale", { endMs: 5600, heardText: "MIST VALE," }),
    removedIds: [3], glossary: { kind: "none" }, occurrences: [],
  });
  render(<SessionReview sessionId={7} onBack={() => {}} />);
  await userEvent.dblClick((await screen.findAllByText("mistvale", { exact: false }))[0]!);
  await userEvent.clear(screen.getByRole("textbox", { name: "Correct text" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Correct text" }), "Mistvale{Enter}");
  expect(await screen.findByRole("region", { name: "Other occurrences" })).toHaveTextContent("Also fix 2 others");
  expect(screen.getByRole("checkbox", { name: /0:00:05 through MIST VALE, tonight/ })).toBeChecked();
  const other = screen.getByRole("checkbox", { name: /0:00:10 leave mistvale tomorrow/ });
  expect(other).toBeChecked();
  await userEvent.click(other);
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Other occurrences" })).not.toBeInTheDocument());
  expect(mocked.correctWords).toHaveBeenCalledTimes(2);
  expect(mocked.correctWords).toHaveBeenLastCalledWith(7, { wordIds: [2, 3], text: "Mistvale" });
  expect(document.querySelector('.word[data-word-id="2"]')).toHaveClass("corrected");
  expect(document.querySelector('.word[data-word-id="3"]')).toBeNull();
  expect(document.querySelector('.word[data-word-id="4"]')).not.toHaveClass("corrected");
});

test("a failed repeated fix keeps unsaved occurrences available for retry", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const words = [word(1, "Speaker A", "tomorow", 0), word(2, "Speaker A", "tomorow", 5000), word(3, "Speaker A", "tomorow", 10000)];
  mocked.getSession.mockResolvedValue(session());
  mocked.listWords.mockResolvedValue(words);
  mocked.correctWords.mockResolvedValueOnce({ word: corrected(words[0]!, "tomorrow"), removedIds: [], glossary: { kind: "none" },
    occurrences: words.slice(1).map((w) => ({ wordIds: [w.id], startMs: w.startMs, heard: w.text, context: w.text })) })
    .mockResolvedValueOnce({ word: corrected(words[1]!, "tomorrow"), removedIds: [], glossary: { kind: "none" } })
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce({ word: corrected(words[2]!, "tomorrow"), removedIds: [], glossary: { kind: "none" } });
  render(<SessionReview sessionId={7} onBack={() => {}} />);
  await userEvent.dblClick((await screen.findAllByText("tomorow", { exact: false }))[0]!);
  await userEvent.type(screen.getByRole("textbox", { name: "Correct text" }), "tomorrow{Enter}");
  await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
  expect(await screen.findByText("Connection lost")).toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Other occurrences" })).not.toBeInTheDocument());
  expect(mocked.correctWords.mock.calls.map((call) => call[1].wordIds)).toEqual([[1], [2], [3], [3]]);
});
