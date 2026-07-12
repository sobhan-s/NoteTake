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
import type { VerifyOtpInput } from "@shared/core/types";
import * as useVerifyOtpModule from "@/hooks/useVerifyOtp";
import * as useResendOtpModule from "@/hooks/useResendOtp";
import { VerifyOtpPage } from "@/pages/VerifyOtpPage";

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

describe("VerifyOtpPage ([FRS-1.2.1–1.2.5, Verify OTP page scenario])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should redirect to /register if location state lacks userId and email", () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/verify-otp"]}>
          <Routes>
            <Route path="/verify-otp" element={<VerifyOtpPage />} />
            <Route path="/register" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("location").textContent).toBe("/register");
  });

  it("should navigate to /login on successful OTP verification", async () => {
    vi.spyOn(useVerifyOtpModule, "useVerifyOtp").mockReturnValue({
      mutate: (
        variables: VerifyOtpInput,
        options?: { onSuccess?: (data: { message: string }) => void },
      ) => {
        options?.onSuccess?.({ message: "OTP verified" });
      },
      isPending: false,
    } as UseMutationResult<
      { message: string },
      AxiosError,
      VerifyOtpInput,
      unknown
    >);

    vi.spyOn(useResendOtpModule, "useResendOtp").mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as UseMutationResult<
      { message: string },
      AxiosError,
      { email: string; type: string },
      unknown
    >);

    const queryClient = createTestQueryClient();
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/verify-otp",
              state: { userId: validUuid, email: "test@example.com" },
            },
          ]}
        >
          <Routes>
            <Route path="/verify-otp" element={<VerifyOtpPage />} />
            <Route path="/login" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const codeInput = screen.getByLabelText(/Verification code/i);
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.blur(codeInput);

    const submitButton = screen.getByRole("button", { name: "Verify" });
    await waitFor(() =>
      expect((submitButton as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/login");
    });
  });
});
