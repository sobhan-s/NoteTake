import { useState } from "react";
import type { AxiosError } from "axios";
import { toast } from "sonner";
import { API_ERROR_CODES, APP_LIMITS } from "@shared/core/constants";
import type { ApiErrorResponse } from "@shared/core/types";
import { Input } from "@/components/ui/Input";
import { useTags } from "@/hooks/useTags";
import { useCreateTag } from "@/hooks/useCreateTag";
import { mapApiError } from "@/lib/errorMessages";

export interface TagComboboxProps {
  attachedTagIds: string[];
  onAttach: (tagId: string) => void;
}

export function TagCombobox({ attachedTagIds, onAttach }: TagComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const tagsQuery = useTags();
  const createTagMutation = useCreateTag();

  const allTags = tagsQuery.data?.tags ?? [];
  const trimmedQuery = query.trim();
  const availableTags = allTags.filter(
    (tag) => !attachedTagIds.includes(tag.id),
  );
  const matches = trimmedQuery
    ? availableTags.filter((tag) =>
        tag.name.toLowerCase().includes(trimmedQuery.toLowerCase()),
      )
    : availableTags;
  const hasExactMatch = allTags.some(
    (tag) => tag.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  function selectExisting(tagId: string): void {
    onAttach(tagId);
    setQuery("");
    setIsOpen(false);
  }

  async function createAndAttach(): Promise<void> {
    if (!trimmedQuery) return;
    try {
      const created = await createTagMutation.mutateAsync({
        name: trimmedQuery,
        color: APP_LIMITS.TAG_DEFAULT_COLOR,
      });
      selectExisting(created.id);
    } catch (error) {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      const code = axiosError.response?.data.error.code;
      if (code === API_ERROR_CODES.TAG_NAME_CONFLICT) {
        let existing = allTags.find(
          (tag) => tag.name.toLowerCase() === trimmedQuery.toLowerCase(),
        );
        if (!existing) {
          const refetched = await tagsQuery.refetch();
          existing = (refetched.data?.tags ?? []).find(
            (tag) => tag.name.toLowerCase() === trimmedQuery.toLowerCase(),
          );
        }
        if (existing) {
          selectExisting(existing.id);
          return;
        }
      }
      toast.error(mapApiError(code), { duration: 5000 });
    }
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        placeholder="Add a tag..."
        aria-label="Add a tag"
      />
      {isOpen && (matches.length > 0 || trimmedQuery) ? (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-200 bg-white shadow-lg">
          {matches.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100"
              onMouseDown={(event) => {
                event.preventDefault();
                selectExisting(tag.id);
              }}
            >
              {tag.name}
            </button>
          ))}
          {trimmedQuery && !hasExactMatch ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              disabled={createTagMutation.isPending}
              onMouseDown={(event) => {
                event.preventDefault();
                void createAndAttach();
              }}
            >
              Create new tag: &apos;{trimmedQuery}&apos;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
