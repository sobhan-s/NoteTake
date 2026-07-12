import { useNavigate } from "react-router-dom";
import { FileText, LogOut, Trash2 } from "lucide-react";
import { useLogout } from "@/hooks/useLogout";
import { useAuthStore } from "@/store/useAuthStore";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { NotesTab } from "@/components/notes/NotesTabs";

export interface SidebarNavProps {
  activeTab: NotesTab;
  onTabChange: (tab: NotesTab) => void;
}

export function SidebarNav({ activeTab, onTabChange }: SidebarNavProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const reset = useAuthStore((state) => state.reset);
  const logoutMutation = useLogout();

  function handleLogout(): void {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        reset();
        navigate("/login", { replace: true });
      },
    });
  }

  return (
    <div className="flex h-full w-full flex-col justify-between">
      <div className="flex flex-col gap-1">
        <p className="mb-4 truncate px-2 text-sm font-medium text-zinc-500">
          {user?.email}
        </p>
        <button
          type="button"
          onClick={() => onTabChange("active")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium",
            activeTab === "active"
              ? "bg-zinc-900 text-zinc-50"
              : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Active Notes
        </button>
        <button
          type="button"
          onClick={() => onTabChange("trash")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium",
            activeTab === "trash"
              ? "bg-zinc-900 text-zinc-50"
              : "text-zinc-700 hover:bg-zinc-100",
          )}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Trash
        </button>
      </div>
      <Button
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={handleLogout}
        disabled={logoutMutation.isPending}
        isLoading={logoutMutation.isPending}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Logout
      </Button>
    </div>
  );
}
