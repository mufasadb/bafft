import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Entity, GlossaryEntry } from "@bafft/shared";
import { GlossaryScreen } from "./GlossaryScreen.js";
import { api } from "./api.js";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.js")>();
  return {
    ApiError: actual.ApiError,
    api: Object.fromEntries(Object.keys(actual.api).map((k) => [k, vi.fn()])),
  };
});

const mocked = vi.mocked(api);

const rows: GlossaryEntry[] = [
  { id: 1, type: "location", name: "The keep", aliases: [], soundsLike: [], skipped: ["The keep"] },
  { id: 2, type: "npc", name: "Tavia Kelvor", aliases: [], soundsLike: [], skipped: [] },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getGlossary.mockResolvedValue(rows);
});

test("lists every name and strikes through the ones left out of transcription (bafft-w8f.1)", async () => {
  render(<GlossaryScreen />);
  const hold = await screen.findByRole("row", { name: /The keep/ });
  expect(within(hold).getByTitle(/left out of transcription/)).toHaveTextContent("The keep");
  const tavia = screen.getByRole("row", { name: /Tavia Kelvor/ });
  expect(within(tavia).queryByTitle(/left out/)).toBeNull();
});

test("editing other names and sounds-like saves on leaving the field", async () => {
  mocked.saveEntity.mockResolvedValue({} as Entity);
  const user = userEvent.setup();
  render(<GlossaryScreen />);

  await user.type(await screen.findByLabelText("Other names for Tavia Kelvor"), "the Warden, Kelvor");
  await user.type(screen.getByLabelText("Sounds like for Tavia Kelvor"), "kel-vor");
  await user.tab();

  await waitFor(() =>
    expect(mocked.saveEntity).toHaveBeenLastCalledWith(2, { aliases: ["the Warden", "Kelvor"], soundsLike: ["kel-vor"] }),
  );
});

test("the filter narrows the table", async () => {
  const user = userEvent.setup();
  render(<GlossaryScreen />);
  await screen.findByRole("row", { name: /The keep/ });
  await user.type(screen.getByLabelText("Filter names"), "kelv");
  expect(screen.queryByRole("row", { name: /The keep/ })).toBeNull();
  expect(screen.getByRole("row", { name: /Tavia Kelvor/ })).toBeInTheDocument();
});
