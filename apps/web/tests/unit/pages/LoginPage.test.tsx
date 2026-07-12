import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { UseMutationResult } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import type { LoginInput, LoginResponseDto } from "@shared/core/types";
import { useAuthStore } from "@/store/useAuthStore";
import * as useLoginModule from "@/hooks/useLogin";
import * as useResendOtpModule from "@/hooks/useResendOtp";
import { LoginPage } from "@/pages/LoginPage";

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("LoginPage ([FRS-1.3.1–1.3.5, Login page scenario])", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("should setSession and redirect to /notes on successful login", async () => {
    const mockUser = {
      id: "usr-1",
      email: "test@example.com",
      isVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(useLoginModule, "useLogin").mockReturnValue({
      mutate: (
        variables: LoginInput,
        options?: { onSuccess?: (data: LoginResponseDto) => void },
      ) => {
        options?.onSuccess?.({ accessToken: "mock.jwt.token", user: mockUser });
      },
      isPending: false,
    } as UseMutationResult<LoginResponseDto, AxiosError, LoginInput, unknown>);

    vi.spyOn(useResendOtpModule, "useResendOtp").mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as UseMutationResult<
      { message: string },
      AxiosError,
      { email: string; type: string },
      unknown
    >);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/notes" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Password/i);

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.blur(emailInput);
    fireEvent.change(passwordInput, { target: { value: "SecurePass123!" } });
    fireEvent.blur(passwordInput);

    const submitButton = screen.getByRole("button", { name: "Log in" });
    await waitFor(() =>
      expect((submitButton as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe("mock.jwt.token");
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(screen.getByTestId("location").textContent).toBe("/notes");
    });
  });
});
