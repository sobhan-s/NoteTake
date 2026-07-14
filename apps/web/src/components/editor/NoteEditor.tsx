import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Share2,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import { APP_LIMITS, UI_COPY } from "@shared/core/constants";
import type { NoteResponseDto } from "@shared/core/types";
import { Badge } from "@/components/ui/Badge";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Input } from "@/components/ui/Input";
import { AutosaveIndicator } from "@/components/editor/AutosaveIndicator";
import { TagCombobox } from "@/components/editor/TagCombobox";
import { ShareModal } from "@/components/sharing/ShareModal";
import { VersionHistoryDrawer } from "@/components/versions/VersionHistoryDrawer";
import { useDeleteNote } from "@/hooks/useDeleteNote";
import { useNoteAutosave } from "@/hooks/useNoteAutosave";
import { useTags } from "@/hooks/useTags";
import { useUiStore } from "@/store/useUiStore";

export interface NoteEditorProps {
  noteId: string | null;
  note?: NoteResponseDto;
  onCreated: (newId: string) => void;
  onDeleted?: () => void;
}

export function NoteEditor({
  noteId,
  note,
  onCreated,
  onDeleted,
}: NoteEditorProps) {
  const deleteNoteMutation = useDeleteNote();
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const draftKey = noteId ?? "new";
  const drafts = useUiStore((state) => state.drafts);
  const setDraft = useUiStore((state) => state.setDraft);
  const clearDraft = useUiStore((state) => state.clearDraft);

  const draft = drafts[draftKey];
  const hasNewerDraft = Boolean(
    draft && (!note || draft.savedAt > new Date(note.updatedAt).getTime()),
  );

  const [title, setTitle] = useState(() =>
    hasNewerDraft ? (draft?.title ?? "") : (note?.title ?? ""),
  );
  const [tagIds, setTagIds] = useState<string[]>(
    () => note?.tags.map((tag) => tag.id) ?? [],
  );
  const lastSavedTitleRef = useRef(title);
  const hasQueuedDraftRestoreRef = useRef(false);

  const { data: tagsData } = useTags();
  const allTags = tagsData?.tags ?? note?.tags ?? [];
  const attachedTags = tagIds
    .map(
      (id) =>
        note?.tags.find((t) => t.id === id) ?? allTags.find((t) => t.id === id),
    )
    .filter((t): t is { id: string; name: string; color: string } =>
      Boolean(t),
    );

  useEffect(() => {
    if (note?.tags) {
      setTagIds(note.tags.map((tag) => tag.id));
    }
  }, [note?.tags]);

  function handleSaved(
    updatedAt: string,
    savedPatch?: { title?: string; body?: string; tagIds?: string[] },
    savedTags?: Array<{ id: string; name: string; color: string }>,
  ): void {
    const currentDraft = useUiStore.getState().drafts[draftKey];
    if (currentDraft && new Date(updatedAt).getTime() >= currentDraft.savedAt) {
      clearDraft(draftKey);
    }
    if (savedPatch?.title !== undefined) {
      lastSavedTitleRef.current = savedPatch.title;
    }
    if (savedTags) {
      setTagIds(savedTags.map((t) => t.id));
    }
  }

  const autosave = useNoteAutosave({
    noteId,
    onCreated: (newId, updatedAt, savedTags) => {
      lastSavedTitleRef.current = title;
      handleSaved(updatedAt, { title }, savedTags);
      clearDraft("new");
      onCreated(newId);
    },
    onSaved: handleSaved,
  });

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing..." }),
    ],
    content: hasNewerDraft ? (draft?.body ?? "") : (note?.body ?? ""),
    editorProps: {
      attributes: {
        class:
          "prose prose-zinc max-w-none focus:outline-none min-h-[320px] text-[15px] sm:text-base leading-[1.8] text-zinc-700",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const html = updatedEditor.getHTML();
      setDraft(draftKey, { title, body: html, savedAt: Date.now() });
      autosave.triggerAutosave({ body: html });
    },
  });

  useEffect(() => {
    if (hasNewerDraft && !hasQueuedDraftRestoreRef.current && editor) {
      hasQueuedDraftRestoreRef.current = true;
      autosave.triggerAutosave({ title, body: editor.getHTML() });
    }
    // Runs once, when the editor instance first becomes available.
  }, [editor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isSaveShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (!isSaveShortcut) return;
      event.preventDefault();
      lastSavedTitleRef.current = title;
      autosave.triggerExplicitSave({ title, body: editor?.getHTML() ?? "" });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [autosave, title, editor]);

  function handleTitleChange(value: string): void {
    setTitle(value);
    setDraft(draftKey, {
      title: value,
      body: editor?.getHTML() ?? "",
      savedAt: Date.now(),
    });
    if (noteId === null) {
      autosave.triggerAutosave({ title: value });
    }
  }

  function handleTitleBlur(): void {
    if (title === lastSavedTitleRef.current) return;
    lastSavedTitleRef.current = title;
    autosave.triggerExplicitSave({ title });
  }

  function handleAttachTag(tagId: string): void {
    const nextTagIds = [...tagIds, tagId];
    autosave.triggerExplicitSave({ tagIds: nextTagIds }, false);
  }

  function handleDetachTag(tagId: string): void {
    const nextTagIds = tagIds.filter((id) => id !== tagId);
    setTagIds(nextTagIds);
    autosave.triggerExplicitSave({ tagIds: nextTagIds }, false);
  }

  const bodyCharCount = editor?.getText().length ?? 0;
  const wordCount = editor?.getText().trim()
    ? editor.getText().trim().split(/\s+/).length
    : 0;
  const isOverBodyLimit = bodyCharCount > APP_LIMITS.NOTE_BODY_MAX_CHARS;

  return (
    <div className="flex flex-1 flex-col" aria-keyshortcuts="Control+S">
      {/* ────── Centered document column ────── */}
      <div className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-6 pb-16 pt-6 sm:px-12">
        {/* ── Title ── */}
        <Input
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Untitled note"
          aria-label="Note title"
          className="mb-3 w-full border-none bg-transparent px-0 text-2xl font-bold leading-snug tracking-tight text-zinc-900 shadow-none placeholder:text-zinc-300 focus-visible:ring-0 sm:text-3xl"
        />

        {/* ── Tags ── */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          {attachedTags.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              aria-label="Attached tags"
            >
              {attachedTags.map((tag) => (
                <span
                  key={tag.id}
                  className="group inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    color: tag.color,
                    borderColor: `${tag.color}30`,
                    backgroundColor: `${tag.color}08`,
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <button
                    type="button"
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-50 transition-opacity hover:opacity-100"
                    style={{ color: tag.color }}
                    aria-label={`Remove tag ${tag.name}`}
                    onClick={() => handleDetachTag(tag.id)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="min-w-[140px] max-w-[220px]">
            <TagCombobox attachedTagIds={tagIds} onAttach={handleAttachTag} />
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="mb-4 flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 shadow-sm">
          {/* Text formatting */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Bold"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Italic"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Underline"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Strikethrough"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Inline code"
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            <Code className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Link"
            onClick={() => {
              const url = window.prompt("URL");
              if (url) editor?.chain().focus().setLink({ href: url }).run();
            }}
          >
            <LinkIcon className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-200" />

          {/* Headings */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Heading 1"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 1 }).run()
            }
          >
            <Heading1 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Heading 2"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Heading 3"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            <Heading3 className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-200" />

          {/* Lists & blocks */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Bullet list"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Ordered list"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Blockquote"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Horizontal rule"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-200" />

          {/* Undo / Redo */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Undo"
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Redo"
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Char/word count */}
          <span className="hidden text-[11px] tabular-nums text-zinc-400 sm:inline">
            {bodyCharCount.toLocaleString()} /{" "}
            {APP_LIMITS.NOTE_BODY_MAX_CHARS.toLocaleString()}
            {wordCount > 0 ? (
              <>
                {" "}
                · {wordCount} {wordCount === 1 ? "word" : "words"}
              </>
            ) : null}
          </span>

          <div className="mx-1.5 h-4 w-px bg-zinc-200" />

          {/* Autosave + actions */}
          <AutosaveIndicator
            status={autosave.status}
            onRetry={autosave.retry}
          />
          {note?.hasActiveShareLink ? (
            <Badge
              aria-label="This note has an active share link"
              className="border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 shadow-none"
            >
              <Share2 className="mr-1 h-3 w-3" aria-hidden="true" />
              Shared
            </Badge>
          ) : null}
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="Share note"
            disabled={noteId === null}
            aria-disabled={noteId === null}
            onClick={() => setIsShareModalOpen(true)}
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="Version history"
            disabled={noteId === null}
            aria-disabled={noteId === null}
            onClick={() => setIsVersionHistoryOpen(true)}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">History</span>
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500"
            aria-label="Delete note"
            disabled={noteId === null}
            aria-disabled={noteId === null}
            onClick={() => setIsDeleteConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* ── Editor body ── */}
        <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <EditorContent
            editor={editor}
            className="min-h-[360px] focus:outline-none"
          />
        </div>

        {isOverBodyLimit ? (
          <p className="mt-3 text-xs font-medium text-red-600">
            This note exceeds the{" "}
            {APP_LIMITS.NOTE_BODY_MAX_CHARS.toLocaleString()}-character limit.
          </p>
        ) : null}
      </div>

      {/* ── Modals ── */}
      {noteId !== null ? (
        <ShareModal
          noteId={noteId}
          open={isShareModalOpen}
          onOpenChange={setIsShareModalOpen}
        />
      ) : null}

      {noteId !== null ? (
        <VersionHistoryDrawer
          noteId={noteId}
          open={isVersionHistoryOpen}
          onOpenChange={setIsVersionHistoryOpen}
          onRestored={(restoredNote) => {
            clearDraft(draftKey);
            setTitle(restoredNote.title);
            lastSavedTitleRef.current = restoredNote.title;
            editor?.commands.setContent(restoredNote.body);
            setTagIds(restoredNote.tags.map((tag) => tag.id));
          }}
        />
      ) : null}

      {noteId !== null ? (
        <ConfirmModal
          open={isDeleteConfirmOpen}
          onOpenChange={setIsDeleteConfirmOpen}
          heading="Move Note to Trash"
          body={UI_COPY.NOTE_TRASHED_CONFIRM}
          confirmLabel="Move to Trash"
          isConfirming={deleteNoteMutation.isPending}
          onConfirm={() => {
            if (!noteId) return;
            deleteNoteMutation.mutate(noteId, {
              onSuccess: () => {
                setIsDeleteConfirmOpen(false);
                onDeleted?.();
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}
