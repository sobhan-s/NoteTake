import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";

describe("useAuthStore ([FRS-1.3.5])", () => {
  let localStorageSpy: ReturnType<typeof vi.spyOn>;
  let sessionStorageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAuthStore.getState().reset();
    localStorageSpy = vi.spyOn(window.localStorage, "setItem");
    sessionStorageSpy = vi.spyOn(window.sessionStorage, "setItem");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with null accessToken and user", () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it("should update state on setSession and never write to localStorage or sessionStorage", () => {
    const mockUser = {
      id: "usr-123",
      email: "test@example.com",
      isVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    useAuthStore.getState().setSession({
      accessToken: "mock.jwt.token",
      user: mockUser,
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe("mock.jwt.token");
    expect(state.user).toEqual(mockUser);
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });

  it("should clear accessToken and user on reset without touching localStorage or sessionStorage", () => {
    useAuthStore.getState().setSession({
      accessToken: "mock.jwt.token",
      user: {
        id: "usr-123",
        email: "test@example.com",
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    useAuthStore.getState().reset();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });
});
