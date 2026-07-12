import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { NoteResponseDto } from "@shared/core/types";
import * as notesApi from "@/api/notes.api";
import { useNoteAutosave } from "@/hooks/useNoteAutosave";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_RETRY_DELAYS_MS,
} from "@/constants/ui.constant";

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function buildNote(overrides: Partial<NoteResponseDto> = {}): NoteResponseDto {
  return {
    id: "note-1",
    title: "Title",
    body: "<p>Body</p>",
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasActiveShareLink: false,
    tags: [],
    ...overrides,
  };
}

// [FRS-7.1, FRS-7.2, FRS-6.1] `useNoteAutosave` debounce/explicit-save/retry state machine
describe("useNoteAutosave ([FRS-7.1] background autosave, [FRS-7.2] save-status indicator, [FRS-6.1] explicit-save-always-snapshots contract)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("[FRS-7.1] SHALL NOT call updateNote before AUTOSAVE_DEBOUNCE_MS - 1ms has elapsed since triggerAutosave", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.triggerAutosave({ body: "<p>Hello</p>" });
    });

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("[FRS-7.1] SHALL call updateNote at exactly AUTOSAVE_DEBOUNCE_MS after triggerAutosave with no further edits", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.triggerAutosave({ body: "<p>Hello</p>" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith("note-1", {
      body: "<p>Hello</p>",
      isExplicitSave: false,
    });
  });

  it("[FRS-6.1, Decision D5] triggerExplicitSave SHALL bypass the debounce entirely, firing the PATCH before any timer advance", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.triggerExplicitSave({ title: "New Title" });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith("note-1", {
      title: "New Title",
      isExplicitSave: true,
    });
  });

  it("[Decision D7] first PATCH failure SHALL schedule a retry at AUTOSAVE_RETRY_DELAYS_MS[0] (1000ms), not sooner", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(buildNote());

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.triggerExplicitSave({ title: "Retry me" });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0] - 1);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it("[Decision D7] second consecutive failure SHALL schedule the next retry at AUTOSAVE_RETRY_DELAYS_MS[1] (3000ms)", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValue(buildNote());

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.triggerExplicitSave({ title: "Retry me" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // first auto-retry fires at 1000ms and fails again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0]);
    });
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("error");

    // the second retry must NOT fire before the 3000ms delay elapses
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[1] - 1);
    });
    expect(updateSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(updateSpy).toHaveBeenCalledTimes(3);
  });

  it("[Decision D7] a third consecutive failure SHALL stop auto-retrying and leave status 'error' with the patch retrievable only via manual retry()", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockRejectedValueOnce(new Error("third failure"))
      .mockResolvedValue(buildNote({ updatedAt: "2026-01-01T00:00:00.000Z" }));
    const onSaved = vi.fn();

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.triggerExplicitSave({ title: "Retry me" });
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[1]);
    });

    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("error");

    // No further auto-retry, however long we wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(updateSpy).toHaveBeenCalledTimes(3);

    // Manual retry() resends the last failed patch and can now succeed.
    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateSpy).toHaveBeenCalledTimes(4);
    expect(updateSpy).toHaveBeenNthCalledWith(4, "note-1", {
      title: "Retry me",
      isExplicitSave: true,
    });
    expect(result.current.status).toBe("saved");
    expect(onSaved).toHaveBeenCalledWith(
      "2026-01-01T00:00:00.000Z",
      { title: "Retry me" },
      [],
    );
  });

  it("[Decision D4] when noteId is null, the first performSave SHALL call createNote (never updateNote) and invoke onCreated with the returned id/updatedAt", async () => {
    const createSpy = vi.spyOn(notesApi, "createNote").mockResolvedValue(
      buildNote({
        id: "new-note-id",
        updatedAt: "2026-02-02T00:00:00.000Z",
      }),
    );
    const updateSpy = vi.spyOn(notesApi, "updateNote");
    const onCreated = vi.fn();

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: null,
          onCreated,
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.triggerAutosave({ title: "First keystroke" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(createSpy.mock.calls[0]![0]).toEqual({
      title: "First keystroke",
      body: "",
      tagIds: undefined,
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(
      "new-note-id",
      "2026-02-02T00:00:00.000Z",
      [],
    );
  });

  it("[FRS-2.1.3] when noteId is non-null, performSave SHALL call updateNote (never createNote) and invoke onSaved with the returned updatedAt", async () => {
    const createSpy = vi.spyOn(notesApi, "createNote");
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote({ updatedAt: "2026-03-03T00:00:00.000Z" }));
    const onSaved = vi.fn();

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.triggerAutosave({ body: "<p>Edited</p>" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(updateSpy).toHaveBeenCalledWith("note-1", {
      body: "<p>Edited</p>",
      isExplicitSave: false,
    });
    expect(createSpy).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(
      "2026-03-03T00:00:00.000Z",
      { body: "<p>Edited</p>" },
      [],
    );
  });

  it("[SDS §4.4, Backend Additions] tag-attach path: triggerExplicitSave({ tagIds }, false) SHALL send isExplicitSave: false so the update does not force a version snapshot", async () => {
    const updateSpy = vi
      .spyOn(notesApi, "updateNote")
      .mockResolvedValue(buildNote());

    const { result } = renderHook(
      () =>
        useNoteAutosave({
          noteId: "note-1",
          onCreated: vi.fn(),
          onSaved: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.triggerExplicitSave({ tagIds: ["tag-1", "tag-2"] }, false);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(updateSpy).toHaveBeenCalledWith("note-1", {
      tagIds: ["tag-1", "tag-2"],
      isExplicitSave: false,
    });
  });
});
