import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { isAxiosError } from "axios";
import { UI_COPY } from "@shared/core/constants";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { formatUpdatedAt } from "@/components/notes/NoteCard";
import { usePublicShareNote } from "@/hooks/usePublicShareNote";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>();
  const query = usePublicShareNote(token!);
  const isMinLoading = useMinLoadingTime(query.isLoading);
  const is404 =
    isAxiosError(query.error) && query.error.response?.status === 404;

  const editor = useEditor({
    editable: false,
    extensions: [StarterKit],
    content: "",
  });

  useEffect(() => {
    if (editor && query.data) {
      editor.commands.setContent(query.data.body);
    }
  }, [editor, query.data]);

  return (
    <div className="flex min-h-screen justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-2xl">
        {isMinLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : query.isError && !is404 ? (
          <ErrorFallback
            message="Couldn't load this shared note."
            onRetry={() => query.refetch()}
          />
        ) : is404 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
            <h1 className="text-lg font-semibold text-zinc-900">
              Link unavailable
            </h1>
            <p className="max-w-sm text-sm text-zinc-500">
              {UI_COPY.SHARE_LINK_UNAVAILABLE}
            </p>
          </div>
        ) : query.data ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold text-zinc-900">
              {query.data.title}
            </h1>
            <p className="text-xs text-zinc-400">
              Updated {formatUpdatedAt(query.data.updatedAt)}
            </p>
            <EditorContent editor={editor} className="text-sm text-zinc-800" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
