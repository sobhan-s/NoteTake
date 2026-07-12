import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}

export function Sheet({ open, onOpenChange, title, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex h-full w-[260px] flex-col overflow-y-auto border-r border-zinc-200 bg-white p-4 shadow-lg outline-none",
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
