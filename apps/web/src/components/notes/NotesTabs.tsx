import { cn } from "@/lib/cn";

export type NotesTab = "active" | "trash";

export interface NotesTabsProps {
  activeTab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
}

const TABS: Array<{ id: NotesTab; label: string }> = [
  { id: "active", label: "Active" },
  { id: "trash", label: "Trash" },
];

export function NotesTabs({ activeTab, onTabChange }: NotesTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Notes view"
      className="flex gap-1 rounded-md border border-zinc-200 bg-zinc-100 p-1"
    >
      {TABS.map((tab) => {
        const isSelected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium transition-colors",
              isSelected
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-900",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
