import { Link, useParams } from "react-router-dom";
import { useNoteById } from "@/hooks/useNoteById";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { getPlainTextPreview } from "@/lib/textPreview";

export function NoteDetailStubPage() {
  const { id } = useParams<{ id: string }>();
  const noteId = id ?? "new";
  const noteQuery = useNoteById(noteId);

  if (noteId === "new") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <Link to="/notes" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Back to notes
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900">New note</h1>
        <p className="text-sm text-zinc-500">
          The note editor ships in AB-1012.
        </p>
      </div>
    );
  }

  if (noteQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (noteQuery.isError || !noteQuery.data) {
    return (
      <ErrorFallback
        message="This note is no longer available."
        onRetry={() => noteQuery.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link to="/notes" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Back to notes
      </Link>
      <h1 className="text-xl font-semibold text-zinc-900">
        {noteQuery.data.title}
      </h1>
      <p className="whitespace-pre-wrap text-sm text-zinc-700">
        {getPlainTextPreview(noteQuery.data.body, Number.MAX_SAFE_INTEGER)}
      </p>
    </div>
  );
}
