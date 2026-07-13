import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  side?: "left" | "right";
  widthClassName?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = "left",
  widthClassName = "w-[260px]",
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 z-50 flex h-full flex-col overflow-y-auto bg-white p-4 shadow-lg outline-none",
            side === "left"
              ? "left-0 border-r border-zinc-200"
              : "right-0 border-l border-zinc-200",
            widthClassName,
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
