import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  subtext: string;
  action?: EmptyStateAction;
}

export function EmptyState({
  icon: Icon,
  heading,
  subtext,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-200 px-6 py-16 text-center">
      <Icon className="h-10 w-10 text-zinc-400" aria-hidden="true" />
      <h2 className="text-base font-semibold text-zinc-900">{heading}</h2>
      <p className="max-w-sm text-sm text-zinc-500">{subtext}</p>
      {action ? <Button onClick={action.onClick}>{action.label}</Button> : null}
    </div>
  );
}
