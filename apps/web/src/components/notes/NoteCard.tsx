import { Link } from "react-router-dom";
import { Share2, Trash2 } from "lucide-react";
import type { NoteResponseDto } from "@shared/core/types";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { getPlainTextPreview } from "@/lib/textPreview";
import { NOTE_PREVIEW_MAX_CHARS } from "@/constants/ui.constant";

export interface NoteCardProps {
  note: NoteResponseDto;
  variant: "active" | "trash";
  onRestore?: () => void;
  onDeleteForever?: () => void;
  onDelete?: () => void;
  isRestorePending?: boolean;
  isDeletePending?: boolean;
}

export function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function NoteCard({
  note,
  variant,
  onRestore,
  onDeleteForever,
  onDelete,
  isRestorePending = false,
  isDeletePending = false,
}: NoteCardProps) {
  return (
    <Card className="flex flex-col">
      <Link
        to={`/notes/${note.id}`}
        className="flex flex-1 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
      >
        <CardHeader className="flex-row items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-base font-semibold text-zinc-900">
            {note.title}
          </h3>
          {note.hasActiveShareLink ? (
            <Badge aria-label="This note has an active share link">
              <Share2 className="h-3 w-3" aria-hidden="true" />
              Shared
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="flex-1">
          <p className="line-clamp-3 text-sm text-zinc-500">
            {getPlainTextPreview(note.body, NOTE_PREVIEW_MAX_CHARS)}
          </p>
        </CardContent>
        {variant === "trash" ? (
          <CardFooter className="text-xs text-zinc-400">
            {formatUpdatedAt(note.updatedAt)}
          </CardFooter>
        ) : null}
      </Link>
      {variant === "active" ? (
        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5">
          <span className="text-xs text-zinc-400">
            {formatUpdatedAt(note.updatedAt)}
          </span>
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="h-7 min-w-0 px-2 p-0 text-zinc-400 hover:text-red-600 hover:bg-red-50"
              aria-label="Move note to trash"
              onClick={onDelete}
              disabled={isDeletePending}
              isLoading={isDeletePending}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {variant === "trash" ? (
        <div className="flex gap-2 border-t border-zinc-100 p-4 pt-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onRestore}
            disabled={isRestorePending}
            isLoading={isRestorePending}
          >
            Restore
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
            onClick={onDeleteForever}
            disabled={isDeletePending}
            isLoading={isDeletePending}
          >
            Delete forever
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
