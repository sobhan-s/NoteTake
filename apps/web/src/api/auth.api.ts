import { API_PATHS } from "@shared/core/constants";
import type {
  ApiSuccessResponse,
  ForgotPasswordInput,
  LoginInput,
  LoginResponseDto,
  MeResponseDto,
  RegisterInput,
  RegisterResponseDto,
  ResendOtpInput,
  ResetPasswordInput,
  VerifyOtpInput,
} from "@shared/core/types";
import { httpClient } from "./httpClient";

const AUTH_ROOT = API_PATHS.AUTH.ROOT;

export async function register(
  input: RegisterInput,
): Promise<RegisterResponseDto> {
  const response = await httpClient.post<
    ApiSuccessResponse<RegisterResponseDto>
  >(`${AUTH_ROOT}${API_PATHS.AUTH.REGISTER}`, input);
  return response.data.data;
}

export async function verifyOtp(
  input: VerifyOtpInput,
): Promise<{ message: string }> {
  const response = await httpClient.post<
    ApiSuccessResponse<{ message: string }>
  >(`${AUTH_ROOT}${API_PATHS.AUTH.VERIFY_OTP}`, input);
  return response.data.data;
}

export async function resendOtp(
  input: ResendOtpInput,
): Promise<{ message: string }> {
  const response = await httpClient.post<
    ApiSuccessResponse<{ message: string }>
  >(`${AUTH_ROOT}${API_PATHS.AUTH.RESEND_OTP}`, input);
  return response.data.data;
}

export async function login(input: LoginInput): Promise<LoginResponseDto> {
  const response = await httpClient.post<ApiSuccessResponse<LoginResponseDto>>(
    `${AUTH_ROOT}${API_PATHS.AUTH.LOGIN}`,
    input,
  );
  return response.data.data;
}

export async function forgotPassword(
  input: ForgotPasswordInput,
): Promise<{ message: string }> {
  const response = await httpClient.post<
    ApiSuccessResponse<{ message: string }>
  >(`${AUTH_ROOT}${API_PATHS.AUTH.FORGOT_PASSWORD}`, input);
  return response.data.data;
}

export async function resetPassword(
  input: ResetPasswordInput,
): Promise<{ message: string }> {
  const response = await httpClient.post<
    ApiSuccessResponse<{ message: string }>
  >(`${AUTH_ROOT}${API_PATHS.AUTH.RESET_PASSWORD}`, input);
  return response.data.data;
}

export async function logout(): Promise<{ message: string }> {
  const response = await httpClient.post<
    ApiSuccessResponse<{ message: string }>
  >(`${AUTH_ROOT}${API_PATHS.AUTH.LOGOUT}`);
  return response.data.data;
}

export async function me(): Promise<MeResponseDto> {
  const response = await httpClient.get<ApiSuccessResponse<MeResponseDto>>(
    `${AUTH_ROOT}${API_PATHS.AUTH.ME}`,
  );
  return response.data.data;
}
