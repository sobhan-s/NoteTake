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
import type { RegisterInput, RegisterResponseDto } from "@shared/core/types";
import * as useRegisterModule from "@/hooks/useRegister";
import { RegisterPage } from "@/pages/RegisterPage";

function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}__state__{JSON.stringify(location.state)}
    </div>
  );
}

describe("RegisterPage ([FRS-1.1.1–1.1.5, Register page scenario])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should navigate to /verify-otp with userId on successful registration", async () => {
    vi.spyOn(useRegisterModule, "useRegister").mockReturnValue({
      mutate: (
        variables: RegisterInput,
        options?: { onSuccess?: (data: RegisterResponseDto) => void },
      ) => {
        options?.onSuccess?.({
          userId: "new-user-id-123",
          email: "test@example.com",
          isReTriggered: false,
        });
      },
      isPending: false,
    } as UseMutationResult<
      RegisterResponseDto,
      AxiosError,
      RegisterInput,
      unknown
    >);

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-otp" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Password/i);

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.blur(emailInput);
    fireEvent.change(passwordInput, { target: { value: "SecurePass123!" } });
    fireEvent.blur(passwordInput);

    const submitButton = screen.getByRole("button", { name: "Create account" });
    await waitFor(() =>
      expect((submitButton as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(submitButton);

    await waitFor(() => {
      const locationEl = screen.getByTestId("location");
      expect(locationEl.textContent).toContain("/verify-otp");
      expect(locationEl.textContent).toContain("new-user-id-123");
    });
  });
});
