import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as authApi from "@/api/auth.api";
import { useAuthStore } from "@/store/useAuthStore";
import {
  SidebarNav,
  type SidebarNavProps,
} from "@/components/layout/SidebarNav";

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSidebarNav(props: SidebarNavProps, initialEntry = "/notes") {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/notes" element={<SidebarNav {...props} />} />
          <Route
            path="/search"
            element={
              <>
                <SidebarNav {...props} />
                <LocationDisplay />
              </>
            }
          />
          <Route path="/login" element={<div>Login Page Stub</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SidebarNav ([Decision D4] active-state resolution via useLocation + optional activeTab/onTabChange)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("SHALL render the Search button in an active/highlighted state only when location.pathname === '/search'", () => {
    renderSidebarNav({ activeTab: "active", onTabChange: vi.fn() }, "/search");

    const searchButton = screen.getByRole("button", { name: "Search" });
    expect(searchButton.className).toContain("bg-zinc-900");
  });

  it("SHALL NOT render the Search button as active when location.pathname is '/notes'", () => {
    renderSidebarNav({ activeTab: "active", onTabChange: vi.fn() }, "/notes");

    const searchButton = screen.getByRole("button", { name: "Search" });
    expect(searchButton.className).not.toContain("bg-zinc-900");
  });

  it("SHALL navigate to /search when the Search button is clicked", async () => {
    const user = userEvent.setup();
    renderSidebarNav({ activeTab: "active", onTabChange: vi.fn() }, "/notes");

    await user.click(screen.getByRole("button", { name: "Search" }));

    const location = await screen.findByTestId("location");
    expect(location.textContent).toBe("/search");
  });

  it("SHALL navigate to /notes and then invoke onTabChange('active') when the Active Notes button is clicked from /search", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    renderSidebarNav({ activeTab: "active", onTabChange }, "/search");

    await user.click(screen.getByRole("button", { name: "Active Notes" }));

    expect(onTabChange).toHaveBeenCalledWith("active");
  });

  it("SHALL navigate to /notes and then invoke onTabChange('trash') when the Trash button is clicked from /search", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    renderSidebarNav({ activeTab: "active", onTabChange }, "/search");

    await user.click(screen.getByRole("button", { name: "Trash" }));

    expect(onTabChange).toHaveBeenCalledWith("trash");
  });

  it("SHALL render without throwing when activeTab and onTabChange are both omitted (standalone SearchPage usage)", () => {
    expect(() => renderSidebarNav({}, "/search")).not.toThrow();
    expect(screen.getByRole("button", { name: "Search" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Active Notes" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Trash" })).toBeDefined();
  });

  it("SHALL NOT throw when the Active Notes/Trash buttons are clicked with onTabChange omitted (optional-callback contract)", async () => {
    const user = userEvent.setup();
    renderSidebarNav({}, "/search");

    await expect(
      user.click(screen.getByRole("button", { name: "Active Notes" })),
    ).resolves.not.toThrow();
  });

  it("SHALL reset the auth session and navigate to /login once the logout mutation settles", async () => {
    const logoutSpy = vi
      .spyOn(authApi, "logout")
      .mockResolvedValue({ message: "Logged out" });
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
    const user = userEvent.setup();
    renderSidebarNav({}, "/notes");

    await user.click(screen.getByRole("button", { name: "Logout" }));

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Login Page Stub")).toBeDefined();
    expect(useAuthStore.getState().accessToken).toBeNull();
    useAuthStore.getState().reset();
  });
});
