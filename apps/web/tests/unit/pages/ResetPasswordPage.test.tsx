import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import type { ResetPasswordInput } from "@shared/core/types";
import * as useResetPasswordModule from "@/hooks/useResetPassword";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";

function createTestQueryClient() {
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

describe("ResetPasswordPage ([FRS-1.5.4–1.5.6, Reset password page scenario])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should block submit when confirmPassword does not match newPassword", async () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/reset-password"]}>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const emailInput = screen.getByLabelText(/Email/i);
    const codeInput = screen.getByLabelText(/Reset code/i);
    const newPasswordInput = screen.getByLabelText(/^New password/i);
    const confirmPasswordInput = screen.getByLabelText(/Confirm password/i);

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.blur(emailInput);
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.blur(codeInput);
    fireEvent.change(newPasswordInput, { target: { value: "SecurePass123!" } });
    fireEvent.blur(newPasswordInput);
    fireEvent.change(confirmPasswordInput, {
      target: { value: "DifferentPass456!" },
    });
    fireEvent.blur(confirmPasswordInput);

    const submitButton = screen.getByRole("button", { name: "Reset password" });
    await waitFor(() =>
      expect((submitButton as HTMLButtonElement).disabled).toBe(true),
    );

    expect(screen.getByText("Passwords do not match")).toBeDefined();
  });

  it("should navigate to /login on successful password reset", async () => {
    vi.spyOn(useResetPasswordModule, "useResetPassword").mockReturnValue({
      mutate: (
        variables: ResetPasswordInput,
        options?: { onSuccess?: (data: { message: string }) => void },
      ) => {
        options?.onSuccess?.({ message: "Password reset successful" });
      },
      isPending: false,
    } as UseMutationResult<
      { message: string },
      AxiosError,
      ResetPasswordInput,
      unknown
    >);

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/reset-password",
              state: { email: "test@example.com" },
            },
          ]}
        >
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/login" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const codeInput = screen.getByLabelText(/Reset code/i);
    const newPasswordInput = screen.getByLabelText(/^New password/i);
    const confirmPasswordInput = screen.getByLabelText(/Confirm password/i);

    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.blur(codeInput);
    fireEvent.change(newPasswordInput, { target: { value: "SecurePass123!" } });
    fireEvent.blur(newPasswordInput);
    fireEvent.change(confirmPasswordInput, {
      target: { value: "SecurePass123!" },
    });
    fireEvent.blur(confirmPasswordInput);

    const submitButton = screen.getByRole("button", { name: "Reset password" });
    await waitFor(() =>
      expect((submitButton as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/login");
    });
  });
});
