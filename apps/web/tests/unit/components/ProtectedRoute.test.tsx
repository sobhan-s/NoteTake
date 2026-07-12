import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/useAuthStore";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

describe("ProtectedRoute ([Protected route guard & navigation scenario, docs/ux.md §6])", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().reset();
  });

  it("should redirect to /login?next=<path> when accessToken is null", () => {
    render(
      <MemoryRouter initialEntries={["/notes"]}>
        <Routes>
          <Route
            path="/notes"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Protected Content")).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe(
      "/login?next=%2Fnotes",
    );
  });

  it("should render children when accessToken is present", () => {
    useAuthStore.getState().setSession({
      accessToken: "mock.jwt.token",
      user: {
        id: "usr-1",
        email: "test@example.com",
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    render(
      <MemoryRouter initialEntries={["/notes"]}>
        <Routes>
          <Route
            path="/notes"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Protected Content")).toBeDefined();
    expect(screen.queryByTestId("location")).toBeNull();
  });
});
