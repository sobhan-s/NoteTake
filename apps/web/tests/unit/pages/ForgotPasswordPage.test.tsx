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
import type { ForgotPasswordInput } from "@shared/core/types";
import * as useForgotPasswordModule from "@/hooks/useForgotPassword";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";

function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}__state__{JSON.stringify(location.state)}
    </div>
  );
}

describe("ForgotPasswordPage ([FRS-1.5.1–1.5.3, Forgot password page scenario])", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should show identical success message and navigate to /reset-password regardless of whether account exists", async () => {
    vi.spyOn(useForgotPasswordModule, "useForgotPassword").mockReturnValue({
      mutate: (
        variables: ForgotPasswordInput,
        options?: { onSuccess?: (data: { message: string }) => void },
      ) => {
        options?.onSuccess?.({
          message:
            "If an account exists for this email, a reset code has been sent.",
        });
      },
      isPending: false,
    } as UseMutationResult<
      { message: string },
      AxiosError,
      ForgotPasswordInput,
      unknown
    >);

    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/Email/i);
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.blur(emailInput);

    const submitButton = screen.getByRole("button", {
      name: "Send reset code",
    });
    await waitFor(() =>
      expect((submitButton as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(submitButton);

    await waitFor(() => {
      const locationEl = screen.getByTestId("location");
      expect(locationEl.textContent).toContain("/reset-password");
      expect(locationEl.textContent).toContain("test@example.com");
    });
  });
});
