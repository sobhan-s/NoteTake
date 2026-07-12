import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_RETRY_DELAYS_MS,
  AUTOSAVE_SAVED_FADE_MS,
} from "@/constants/ui.constant";
import { useCreateNote } from "@/hooks/useCreateNote";
import { useUpdateNote } from "@/hooks/useUpdateNote";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export interface NoteSavePatch {
  title?: string;
  body?: string;
  tagIds?: string[];
}

interface PendingSave {
  patch: NoteSavePatch;
  isExplicitSave: boolean;
}

export interface UseNoteAutosaveOptions {
  noteId: string | null;
  onCreated: (
    newId: string,
    updatedAt: string,
    tags?: Array<{ id: string; name: string; color: string }>,
  ) => void;
  onSaved: (
    updatedAt: string,
    patch?: NoteSavePatch,
    tags?: Array<{ id: string; name: string; color: string }>,
  ) => void;
}

export interface UseNoteAutosaveResult {
  status: AutosaveStatus;
  triggerAutosave: (patch: NoteSavePatch) => void;
  triggerExplicitSave: (patch: NoteSavePatch, isExplicitSave?: boolean) => void;
  retry: () => void;
}

export function useNoteAutosave({
  noteId,
  onCreated,
  onSaved,
}: UseNoteAutosaveOptions): UseNoteAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const noteIdRef = useRef(noteId);
  const lastKnownRef = useRef<NoteSavePatch>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const pendingSaveRef = useRef<PendingSave | null>(null);

  const createNoteMutation = useCreateNote();
  const updateNoteMutation = useUpdateNote();

  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  function scheduleRetry(): void {
    if (retryCountRef.current >= AUTOSAVE_RETRY_DELAYS_MS.length) {
      return;
    }
    const delay = AUTOSAVE_RETRY_DELAYS_MS[retryCountRef.current];
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      const pending = pendingSaveRef.current;
      if (pending) {
        void performSave(pending.patch, pending.isExplicitSave);
      }
    }, delay);
  }

  async function performSave(
    patch: NoteSavePatch,
    isExplicitSave: boolean,
  ): Promise<void> {
    setStatus("saving");
    try {
      let updatedAt: string;
      let returnedTags:
        Array<{ id: string; name: string; color: string }> | undefined;
      if (noteIdRef.current === null) {
        const created = await createNoteMutation.mutateAsync({
          title: lastKnownRef.current.title ?? "",
          body: lastKnownRef.current.body ?? "",
          tagIds: lastKnownRef.current.tagIds,
        });
        noteIdRef.current = created.id;
        updatedAt = created.updatedAt;
        returnedTags = created.tags;
        onCreated(created.id, updatedAt, returnedTags);
      } else {
        const updated = await updateNoteMutation.mutateAsync({
          id: noteIdRef.current,
          input: { ...patch, isExplicitSave },
        });
        updatedAt = updated.updatedAt;
        returnedTags = updated.tags;
      }

      retryCountRef.current = 0;
      pendingSaveRef.current = null;
      setStatus("saved");
      onSaved(updatedAt, patch, returnedTags);

      if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
      savedFadeTimerRef.current = setTimeout(() => {
        setStatus((current) => (current === "saved" ? "idle" : current));
      }, AUTOSAVE_SAVED_FADE_MS);
    } catch {
      pendingSaveRef.current = { patch, isExplicitSave };
      setStatus("error");
      scheduleRetry();
    }
  }

  const triggerAutosave = useCallback(
    (patch: NoteSavePatch) => {
      lastKnownRef.current = { ...lastKnownRef.current, ...patch };
      clearDebounce();
      clearRetry();
      retryCountRef.current = 0;
      debounceTimerRef.current = setTimeout(() => {
        void performSave(patch, false);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [clearDebounce, clearRetry, performSave],
  );

  const triggerExplicitSave = useCallback(
    (patch: NoteSavePatch, isExplicitSave = true) => {
      lastKnownRef.current = { ...lastKnownRef.current, ...patch };
      clearDebounce();
      clearRetry();
      retryCountRef.current = 0;
      void performSave(patch, isExplicitSave);
    },
    [clearDebounce, clearRetry, performSave],
  );

  const retry = useCallback(() => {
    clearRetry();
    retryCountRef.current = 0;
    const pending = pendingSaveRef.current;
    if (pending) {
      void performSave(pending.patch, pending.isExplicitSave);
    }
  }, [clearRetry, performSave]);

  useEffect(
    () => () => {
      clearDebounce();
      clearRetry();
      if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
    },
    [clearDebounce, clearRetry],
  );

  return { status, triggerAutosave, triggerExplicitSave, retry };
}
