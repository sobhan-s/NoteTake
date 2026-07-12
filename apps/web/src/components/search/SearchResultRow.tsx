import { useNavigate } from "react-router-dom";
import type { SearchResultResponseDto } from "@shared/core/types";
import { formatUpdatedAt } from "@/components/notes/NoteCard";
import { SnippetHighlight } from "@/components/search/SnippetHighlight";

export interface SearchResultRowProps {
  result: SearchResultResponseDto;
}

export function SearchResultRow({ result }: SearchResultRowProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(`/notes/${result.id}`)}
      className="flex w-full flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
    >
      <h3 className="line-clamp-1 text-base font-semibold text-zinc-900">
        {result.title}
      </h3>
      <p className="line-clamp-2 text-sm text-zinc-600">
        <SnippetHighlight snippet={result.snippet} />
      </p>
      <span className="text-xs text-zinc-400">
        {formatUpdatedAt(result.updatedAt)}
      </span>
    </button>
  );
}
