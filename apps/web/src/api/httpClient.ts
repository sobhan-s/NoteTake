import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { API_PATHS } from "@shared/core/constants";
import type { ApiSuccessResponse, LoginResponseDto } from "@shared/core/types";
import { useAuthStore } from "@/store/useAuthStore";

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const httpClient = axios.create({
  baseURL: API_PATHS.BASE,
  withCredentials: true,
});

httpClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const response = await axios.post<ApiSuccessResponse<LoginResponseDto>>(
        `${API_PATHS.BASE}${API_PATHS.AUTH.ROOT}${API_PATHS.AUTH.REFRESH}`,
        undefined,
        { withCredentials: true },
      );
      const { accessToken, user } = response.data.data;
      useAuthStore.getState().setSession({ accessToken, user });
      return httpClient(originalRequest);
    } catch (refreshError) {
      useAuthStore.getState().reset();
      window.location.assign("/login");
      return Promise.reject(refreshError);
    }
  },
);
