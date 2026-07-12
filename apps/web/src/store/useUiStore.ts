import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface NoteDraft {
  title: string;
  body: string;
  savedAt: number;
}

export interface UiState {
  isMobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  drafts: Record<string, NoteDraft>;
  setDraft: (noteId: string, draft: NoteDraft) => void;
  clearDraft: (noteId: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      isMobileSidebarOpen: false,
      openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
      drafts: {},
      setDraft: (noteId, draft) =>
        set((state) => ({ drafts: { ...state.drafts, [noteId]: draft } })),
      clearDraft: (noteId) =>
        set((state) => {
          const nextDrafts = { ...state.drafts };
          delete nextDrafts[noteId];
          return { drafts: nextDrafts };
        }),
    }),
    {
      name: "note-editor-drafts",
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);
