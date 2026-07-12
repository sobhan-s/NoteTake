import type { TagResponseDto } from "@shared/core/types";
import { cn } from "@/lib/cn";

export interface TagFilterControlProps {
  tags: TagResponseDto[];
  selectedTagIds: string[];
  tagMode: "ALL" | "ANY";
  onToggleTag: (tagId: string) => void;
  onTagModeChange: (mode: "ALL" | "ANY") => void;
}

export function TagFilterControl({
  tags,
  selectedTagIds,
  tagMode,
  onToggleTag,
  onTagModeChange,
}: TagFilterControlProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => {
        const isSelected = selectedTagIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggleTag(tag.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isSelected
                ? "border-zinc-900 bg-zinc-900 text-zinc-50"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100",
            )}
          >
            {tag.name}
          </button>
        );
      })}
      {selectedTagIds.length > 1 ? (
        <div className="ml-2 flex items-center gap-1 text-xs text-zinc-500">
          <button
            type="button"
            aria-pressed={tagMode === "ALL"}
            onClick={() => onTagModeChange("ALL")}
            className={cn(
              "rounded-md px-2 py-1 font-medium",
              tagMode === "ALL"
                ? "bg-zinc-900 text-zinc-50"
                : "hover:bg-zinc-100",
            )}
          >
            Match all
          </button>
          <button
            type="button"
            aria-pressed={tagMode === "ANY"}
            onClick={() => onTagModeChange("ANY")}
            className={cn(
              "rounded-md px-2 py-1 font-medium",
              tagMode === "ANY"
                ? "bg-zinc-900 text-zinc-50"
                : "hover:bg-zinc-100",
            )}
          >
            Match any
          </button>
        </div>
      ) : null}
    </div>
  );
}
