import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  Share2,
  Underline as UnderlineIcon,
} from "lucide-react";
import { APP_LIMITS } from "@shared/core/constants";
import type { NoteResponseDto } from "@shared/core/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AutosaveIndicator } from "@/components/editor/AutosaveIndicator";
import { TagCombobox } from "@/components/editor/TagCombobox";
import { useNoteAutosave } from "@/hooks/useNoteAutosave";
import { useTags } from "@/hooks/useTags";
import { useUiStore } from "@/store/useUiStore";

export interface NoteEditorProps {
  noteId: string | null;
  note?: NoteResponseDto;
  onCreated: (newId: string) => void;
}

export function NoteEditor({ noteId, note, onCreated }: NoteEditorProps) {
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

  const bodyCharCount = editor?.getText().length ?? 0;
  const isOverBodyLimit = bodyCharCount > APP_LIMITS.NOTE_BODY_MAX_CHARS;

  return (
    <div className="flex flex-1 flex-col gap-4" aria-keyshortcuts="Control+S">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Untitled"
          aria-label="Note title"
          className="border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-3">
          {note?.hasActiveShareLink ? (
            <Badge aria-label="This note has an active share link">
              <Share2 className="h-3 w-3" aria-hidden="true" />
              Shared
            </Badge>
          ) : null}
          <AutosaveIndicator
            status={autosave.status}
            onRetry={autosave.retry}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 pb-2">
        <Button
          type="button"
          variant="ghost"
          className="h-8 min-w-0 px-2"
          aria-label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 min-w-0 px-2"
          aria-label="Italic"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 min-w-0 px-2"
          aria-label="Underline"
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 min-w-0 px-2"
          aria-label="Link"
          onClick={() => {
            const url = window.prompt("URL");
            if (url) editor?.chain().focus().setLink({ href: url }).run();
          }}
        >
          <LinkIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <EditorContent
        editor={editor}
        className="min-h-[300px] flex-1 text-sm text-zinc-800"
      />

      {isOverBodyLimit ? (
        <p className="text-xs text-red-600">
          This note exceeds the{" "}
          {APP_LIMITS.NOTE_BODY_MAX_CHARS.toLocaleString()}-character limit.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 pt-2">
        {attachedTags.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-1.5"
            aria-label="Attached tags"
          >
            {attachedTags.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                style={{ borderColor: tag.color, color: tag.color }}
                className="flex items-center gap-1 font-medium bg-white shadow-xs"
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        ) : null}
        <TagCombobox attachedTagIds={tagIds} onAttach={handleAttachTag} />
      </div>
    </div>
  );
}
