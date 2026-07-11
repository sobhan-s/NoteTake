export const API_PATHS = {
  BASE: "/api/v1",
  AUTH: {
    ROOT: "/auth",
    REGISTER: "/register",
    VERIFY_OTP: "/verify-otp",
    RESEND_OTP: "/resend-otp",
    FORGOT_PASSWORD: "/forgot-password",
    RESET_PASSWORD: "/reset-password",
    LOGIN: "/login",
    REFRESH: "/refresh",
    LOGOUT: "/logout",
    ME: "/me",
  },
  NOTES: {
    ROOT: "/notes",
    RESTORE: "/restore",
    PERMANENT: "/permanent",
  },
} as const;
