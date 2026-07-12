import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { UseMutationResult } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useAuthStore } from "@/store/useAuthStore";
import * as useLogoutModule from "@/hooks/useLogout";
import { NotesStubPage } from "@/pages/NotesStubPage";

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("NotesStubPage ([FRS-1.4.1, D1, Protected /notes stub page & logout scenario])", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("should display user email and clear session even when logout mutation fails", async () => {
    useAuthStore.getState().setSession({
      accessToken: "mock.jwt.token",
      user: {
        id: "usr-1",
        email: "testuser@example.com",
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    vi.spyOn(useLogoutModule, "useLogout").mockReturnValue({
      mutate: (variables: void, options?: { onSettled?: () => void }) => {
        // Trigger onSettled directly regardless of network failure per FRS-1.4.1
        options?.onSettled?.();
      },
      isPending: false,
    } as UseMutationResult<{ message: string }, AxiosError, void, unknown>);

    render(
      <MemoryRouter initialEntries={["/notes"]}>
        <Routes>
          <Route path="/notes" element={<NotesStubPage />} />
          <Route path="/login" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Welcome, testuser@example.com")).toBeDefined();

    const logoutButton = screen.getByRole("button", { name: "Logout" });
    fireEvent.click(logoutButton);

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("/login");
  });
});
