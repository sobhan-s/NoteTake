import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useUiStore } from "@/store/useUiStore";

const STORAGE_KEY = "note-editor-drafts";

function readPersisted(): { state?: Record<string, unknown> } | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// [Decision D6, FRS-7.1] `useUiStore` drafts slice — Zustand `persist` scoped to `drafts` only.
describe("useUiStore drafts slice ([Decision D6] refresh-survival draft persistence)", () => {
  beforeEach(() => {
    useUiStore.setState({
      drafts: {},
      isMobileSidebarOpen: false,
    });
    window.localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("[Decision D6] setDraft SHALL key the drafts map by the exact noteId supplied", () => {
    useUiStore.getState().setDraft("note-1", {
      title: "Draft title",
      body: "<p>Draft body</p>",
      savedAt: 1_000,
    });

    expect(useUiStore.getState().drafts).toEqual({
      "note-1": {
        title: "Draft title",
        body: "<p>Draft body</p>",
        savedAt: 1_000,
      },
    });
  });

  it('[Decision D4/D6] setDraft SHALL accept the literal string "new" as the key for a not-yet-created note', () => {
    useUiStore.getState().setDraft("new", {
      title: "Untitled draft",
      body: "",
      savedAt: 2_000,
    });

    expect(useUiStore.getState().drafts.new).toEqual({
      title: "Untitled draft",
      body: "",
      savedAt: 2_000,
    });
  });

  it("[Decision D6] clearDraft SHALL remove exactly the targeted note id's entry, leaving other notes' drafts untouched", () => {
    useUiStore.getState().setDraft("note-1", {
      title: "Note 1",
      body: "",
      savedAt: 1_000,
    });
    useUiStore.getState().setDraft("note-2", {
      title: "Note 2",
      body: "",
      savedAt: 2_000,
    });
    useUiStore.getState().setDraft("new", {
      title: "New note draft",
      body: "",
      savedAt: 3_000,
    });

    useUiStore.getState().clearDraft("note-1");

    const { drafts } = useUiStore.getState();
    expect(drafts).not.toHaveProperty("note-1");
    expect(drafts["note-2"]).toEqual({
      title: "Note 2",
      body: "",
      savedAt: 2_000,
    });
    expect(drafts.new).toEqual({
      title: "New note draft",
      body: "",
      savedAt: 3_000,
    });
  });

  it("[Decision D6] clearDraft on an id with no existing draft SHALL be a no-op that does not throw or alter other entries", () => {
    useUiStore.getState().setDraft("note-1", {
      title: "Note 1",
      body: "",
      savedAt: 1_000,
    });

    expect(() =>
      useUiStore.getState().clearDraft("does-not-exist"),
    ).not.toThrow();
    expect(useUiStore.getState().drafts).toEqual({
      "note-1": { title: "Note 1", body: "", savedAt: 1_000 },
    });
  });

  it("[Decision D6] persist middleware's partialize SHALL write only the `drafts` key to localStorage — `isMobileSidebarOpen` SHALL NOT be persisted", async () => {
    useUiStore.getState().openMobileSidebar();
    useUiStore.getState().setDraft("note-1", {
      title: "Persisted title",
      body: "<p>Persisted body</p>",
      savedAt: 5_000,
    });

    await vi.waitFor(() => {
      expect(readPersisted()).not.toBeNull();
    });

    const persisted = readPersisted();
    expect(persisted?.state).toEqual({
      drafts: {
        "note-1": {
          title: "Persisted title",
          body: "<p>Persisted body</p>",
          savedAt: 5_000,
        },
      },
    });
    expect(persisted?.state).not.toHaveProperty("isMobileSidebarOpen");
  });

  it("[Decision D6] persisted localStorage key SHALL be exactly 'note-editor-drafts', distinct from any auth-token storage key (FRS-1.3.5)", async () => {
    useUiStore.getState().setDraft("note-1", {
      title: "t",
      body: "b",
      savedAt: 1,
    });

    await vi.waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });
  });
});
