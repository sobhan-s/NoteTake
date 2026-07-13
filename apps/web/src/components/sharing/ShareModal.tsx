import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { isAxiosError, type AxiosError } from "axios";
import { X } from "lucide-react";
import { toast } from "sonner";
import { APP_LIMITS, UI_COPY } from "@shared/core/constants";
import type { ApiErrorResponse } from "@shared/core/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorFallback } from "@/components/ui/ErrorFallback";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatUpdatedAt } from "@/components/notes/NoteCard";
import { useShareLink } from "@/hooks/useShareLink";
import { useGenerateShareLink } from "@/hooks/useGenerateShareLink";
import { useRevokeShareLink } from "@/hooks/useRevokeShareLink";
import { useMinLoadingTime } from "@/hooks/useMinLoadingTime";
import { mapApiError } from "@/lib/errorMessages";

export interface ShareModalProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareModal({ noteId, open, onOpenChange }: ShareModalProps) {
  const [isRevokeConfirmOpen, setIsRevokeConfirmOpen] = useState(false);
  const [expiryDaysInput, setExpiryDaysInput] = useState(() =>
    String(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS),
  );

  const shareLinkQuery = useShareLink(noteId, open);
  const generateMutation = useGenerateShareLink(noteId);
  const revokeMutation = useRevokeShareLink(noteId);

  const isMinLoading = useMinLoadingTime(shareLinkQuery.isFetching);
  const is404 =
    isAxiosError(shareLinkQuery.error) &&
    shareLinkQuery.error.response?.status === 404;

  useEffect(() => {
    if (open) {
      setExpiryDaysInput(String(APP_LIMITS.SHARE_LINK_DEFAULT_EXPIRY_DAYS));
      setIsRevokeConfirmOpen(false);
    }
  }, [open]);

  const expiryDays = Number(expiryDaysInput);
  const isExpiryOutOfRange =
    expiryDaysInput.trim() === "" ||
    !Number.isInteger(expiryDays) ||
    expiryDays < APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS ||
    expiryDays > APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS;

  function handleCopyLink(shareUrl: string): void {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        toast.success(UI_COPY.SHARE_LINK_COPIED_SUCCESS, { duration: 3000 });
      })
      .catch(() => {
        toast.error(mapApiError(), { duration: 5000 });
      });
  }

  function handleGenerateSubmit(): void {
    if (isExpiryOutOfRange) return;
    generateMutation.mutate(
      { expiresInDays: expiryDays },
      {
        onError: (error) => {
          const axiosError = error as AxiosError<ApiErrorResponse>;
          toast.error(mapApiError(axiosError.response?.data.error.code), {
            duration: 5000,
          });
        },
      },
    );
  }

  function handleConfirmRevoke(): void {
    revokeMutation.mutate(undefined, {
      onSettled: () => setIsRevokeConfirmOpen(false),
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-zinc-900">
              Share Note
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                className="h-8 min-w-0 px-2"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Generate, view, copy, or revoke a public share link for this note.
          </Dialog.Description>

          <div className="mt-4">
            {isMinLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : shareLinkQuery.isError && !is404 ? (
              <ErrorFallback
                message="Couldn't load this note's share link status."
                onRetry={() => shareLinkQuery.refetch()}
              />
            ) : !is404 && shareLinkQuery.data ? (
              (() => {
                const shareUrl = `${window.location.origin}/share/${shareLinkQuery.data.token}`;
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="share-link-url"
                        className="text-sm font-medium text-zinc-700"
                      >
                        Shareable link
                      </label>
                      <Input
                        id="share-link-url"
                        readOnly
                        value={shareUrl}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm text-zinc-500">
                      <span>
                        Expires {formatUpdatedAt(shareLinkQuery.data.expiresAt)}
                      </span>
                      <span>{shareLinkQuery.data.viewCount} views</span>
                    </div>
                    <div className="flex justify-end gap-3">
                      <Button
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => setIsRevokeConfirmOpen(true)}
                      >
                        Revoke
                      </Button>
                      <Button onClick={() => handleCopyLink(shareUrl)}>
                        Copy Link
                      </Button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="share-expiry-days"
                    className="text-sm font-medium text-zinc-700"
                  >
                    Expires in (days)
                  </label>
                  <Input
                    id="share-expiry-days"
                    type="number"
                    min={APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS}
                    max={APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS}
                    value={expiryDaysInput}
                    hasError={isExpiryOutOfRange}
                    onChange={(event) => setExpiryDaysInput(event.target.value)}
                  />
                  {isExpiryOutOfRange ? (
                    <p className="text-xs text-red-600">
                      Enter a whole number between{" "}
                      {APP_LIMITS.SHARE_LINK_MIN_EXPIRY_DAYS} and{" "}
                      {APP_LIMITS.SHARE_LINK_MAX_EXPIRY_DAYS}.
                    </p>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleGenerateSubmit}
                    disabled={isExpiryOutOfRange || generateMutation.isPending}
                    isLoading={generateMutation.isPending}
                  >
                    Create Link
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <ConfirmModal
        open={isRevokeConfirmOpen}
        onOpenChange={setIsRevokeConfirmOpen}
        heading="Revoke Public Share Link"
        body={UI_COPY.CONFIRM_REVOKE_SHARE_LINK}
        confirmLabel="Revoke"
        isConfirming={revokeMutation.isPending}
        onConfirm={handleConfirmRevoke}
      />
    </Dialog.Root>
  );
}
