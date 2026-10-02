import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunSheet } from "@bafft/shared";
import { RunSheets } from "./RunSheets.js";
import { api } from "./api.js";
vi.mock("./api.js", () => ({ api: { listRunSheets: vi.fn(), saveRunSheet: vi.fn(), deleteRunSheet: vi.fn() } }));
const mocked = vi.mocked(api);
const sheet: RunSheet = { id: 1, campaignId: 1, title: "Opening night", markdown: "# **Opening**\n\n## Opening\n\n### Finale\n\n- [x] Ready\n\n| Who | Where |\n| --- | --- |\n| Tavia | Hall |\n\n> Whisper\n\n```\n# Not a heading\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))", createdAt: new Date(0), updatedAt: new Date(0) };
beforeEach(() => { vi.resetAllMocks(); mocked.listRunSheets.mockResolvedValue([sheet]); });

test("safe Markdown, tables, tasks and duplicate heading anchors share the jump list", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  render(<RunSheets />);
  await screen.findByRole("heading", { name: "Opening night" });
  const jumps = screen.getByRole("navigation", { name: "Jump to" });
  const links = jumps.querySelectorAll("a");
  expect(links).toHaveLength(3);
  expect(links[0].getAttribute("href")).toBe("#run-sheet-heading-0");
  expect(links[1].getAttribute("href")).toBe("#run-sheet-heading-1");
  fireEvent.click(links[1]);
  expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  expect(document.activeElement?.id).toBe("run-sheet-heading-1");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText("bad").getAttribute("href")).not.toMatch(/javascript:/);
});

test("preview preserves draft, failed save keeps guards, successful save clears them", async () => {
  mocked.saveRunSheet.mockRejectedValueOnce(new Error("Save failed"));
  mocked.saveRunSheet.mockImplementationOnce(async (_id, body) => ({ ...sheet, ...body }));
  const dirty = vi.fn();
  const user = userEvent.setup();
  const { unmount } = render(<RunSheets onDirtyChange={dirty} />);
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "# A new scene" } });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  const leave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave); expect(leave.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByRole("heading", { name: "A new scene" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Markdown")).toHaveValue("# A new scene");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(dirty).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  expect(mocked.saveRunSheet).toHaveBeenLastCalledWith(1, { title: sheet.title, markdown: "# A new scene", campaignId: 1 });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  unmount();
  const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
});

test("new sheet and selection require confirmation before discarding edits", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const user = userEvent.setup();
  render(<RunSheets />);
  await user.click(await screen.findByRole("button", { name: /New run sheet/ }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  await user.click(screen.getByRole("button", { name: sheet.title }));
  expect(screen.getByLabelText("Title")).toHaveValue("Draft");
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: sheet.title }));
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  confirm.mockRestore();
});
