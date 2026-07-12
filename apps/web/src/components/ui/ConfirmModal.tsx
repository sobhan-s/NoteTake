import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/Button";

export interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  isConfirming?: boolean;
}

export function ConfirmModal({
  open,
  onOpenChange,
  heading,
  body,
  confirmLabel,
  onConfirm,
  isConfirming = false,
}: ConfirmModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg outline-none">
          <Dialog.Title className="text-lg font-semibold text-zinc-900">
            {heading}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-zinc-500">
            {body}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="outline" autoFocus>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="default"
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={onConfirm}
              disabled={isConfirming}
              isLoading={isConfirming}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
