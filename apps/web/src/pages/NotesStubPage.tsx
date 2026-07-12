import { useNavigate } from "react-router-dom";
import { useLogout } from "@/hooks/useLogout";
import { useAuthStore } from "@/store/useAuthStore";
import { Button } from "@/components/ui/Button";

export function NotesStubPage() {
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center">
      <h1 className="text-xl font-semibold text-zinc-900">
        Welcome, {user?.email}
      </h1>
      <p className="text-sm text-zinc-500">
        Notes dashboard coming soon (AB-1011).
      </p>
      <Button
        variant="outline"
        onClick={handleLogout}
        disabled={logoutMutation.isPending}
        isLoading={logoutMutation.isPending}
      >
        Logout
      </Button>
    </div>
  );
}
