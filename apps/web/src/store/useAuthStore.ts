import { create } from "zustand";
import type { AuthUserDto } from "@shared/core/types";

export interface AuthState {
  accessToken: string | null;
  user: AuthUserDto | null;
  setSession: (session: { accessToken: string; user: AuthUserDto }) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ accessToken, user }),
  reset: () => set({ accessToken: null, user: null }),
}));
