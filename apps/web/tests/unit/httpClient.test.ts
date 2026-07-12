import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, {
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from "axios";
import { API_PATHS } from "@shared/core/constants";
import { useAuthStore } from "@/store/useAuthStore";
import { httpClient } from "@/api/httpClient";

describe("httpClient ([FRS-1.3.5, SDS §3.1, Axios API client with silent rotation scenario])", () => {
  let originalAdapter: AxiosAdapter | undefined;

  beforeEach(() => {
    useAuthStore.getState().reset();
    originalAdapter = httpClient.defaults.adapter;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
    vi.restoreAllMocks();
  });

  it("should attach Authorization: Bearer header when accessToken is present in useAuthStore", async () => {
    useAuthStore.getState().setSession({
      accessToken: "mock.access.token",
      user: {
        id: "usr-1",
        email: "test@example.com",
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const config: InternalAxiosRequestConfig = {
      headers: new axios.AxiosHeaders(),
    } as InternalAxiosRequestConfig;
    const interceptor = (
      httpClient.interceptors.request as unknown as {
        handlers: {
          fulfilled: (
            config: InternalAxiosRequestConfig,
          ) => InternalAxiosRequestConfig;
        }[];
      }
    ).handlers[0].fulfilled;
    const resultConfig = await interceptor(config);

    expect(resultConfig.headers.get("Authorization")).toBe(
      "Bearer mock.access.token",
    );
  });

  it("should not attach Authorization header when accessToken is null in useAuthStore", async () => {
    const config: InternalAxiosRequestConfig = {
      headers: new axios.AxiosHeaders(),
    } as InternalAxiosRequestConfig;
    const interceptor = (
      httpClient.interceptors.request as unknown as {
        handlers: {
          fulfilled: (
            config: InternalAxiosRequestConfig,
          ) => InternalAxiosRequestConfig;
        }[];
      }
    ).handlers[0].fulfilled;
    const resultConfig = await interceptor(config);

    expect(resultConfig.headers.get("Authorization")).toBeUndefined();
  });

  it("should execute silent refresh exactly once on 401 and replay original request when _retry is false", async () => {
    // Spy on axios.post for the refresh endpoint call
    const _refreshSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          accessToken: "new.refreshed.token",
          user: {
            id: "usr-1",
            email: "test@example.com",
            isVerified: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });

    // Mock httpClient adapter to intercept the replayed request
    const mockAdapter = vi.fn().mockResolvedValue({
      data: "replayed_success",
      status: 200,
      headers: {},
      config: {},
    });
    httpClient.defaults.adapter = mockAdapter;

    const responseInterceptor = (
      httpClient.interceptors.response as unknown as {
        handlers: {
          rejected: (error: {
            config: InternalAxiosRequestConfig;
            response: { status: number };
          }) => Promise<unknown>;
        }[];
      }
    ).handlers[0].rejected;

    const originalRequestConfig: InternalAxiosRequestConfig = {
      url: "/notes",
      method: "get",
      headers: new axios.AxiosHeaders(),
    } as InternalAxiosRequestConfig;

    const mock401Error = {
      config: originalRequestConfig,
      response: { status: 401 },
    } as unknown;

    await responseInterceptor(
      mock401Error as {
        config: InternalAxiosRequestConfig;
        response: { status: number };
      },
    );

    expect(_refreshSpy).toHaveBeenCalledWith(
      `${API_PATHS.BASE}${API_PATHS.AUTH.ROOT}${API_PATHS.AUTH.REFRESH}`,
      undefined,
      { withCredentials: true },
    );
    expect(useAuthStore.getState().accessToken).toBe("new.refreshed.token");
    expect(originalRequestConfig._retry).toBe(true);
    expect(mockAdapter).toHaveBeenCalled();
  });

  it("should not loop on consecutive 401 errors if _retry flag is already set", async () => {
    const _refreshSpy = vi.spyOn(axios, "post");
    const responseInterceptor = (
      httpClient.interceptors.response as unknown as {
        handlers: {
          rejected: (error: {
            config: InternalAxiosRequestConfig & { _retry: boolean };
            response: { status: number };
          }) => Promise<unknown>;
        }[];
      }
    ).handlers[0].rejected;

    const originalRequestConfig: InternalAxiosRequestConfig & {
      _retry: boolean;
    } = {
      url: "/notes",
      method: "get",
      _retry: true,
    } as InternalAxiosRequestConfig & { _retry: boolean };

    const mock401Error = {
      config: originalRequestConfig,
      response: { status: 401 },
    } as unknown;

    await expect(
      responseInterceptor(
        mock401Error as {
          config: InternalAxiosRequestConfig & { _retry: boolean };
          response: { status: number };
        },
      ),
    ).rejects.toBe(mock401Error);
    expect(_refreshSpy).not.toHaveBeenCalled();
  });

  it("should reset store and redirect to /login when silent refresh fails", async () => {
    useAuthStore.getState().setSession({
      accessToken: "expired.token",
      user: {
        id: "usr-1",
        email: "test@example.com",
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const _refreshSpy = vi
      .spyOn(axios, "post")
      .mockRejectedValueOnce(new Error("Refresh failed"));
    const locationAssignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { assign: locationAssignSpy },
      writable: true,
    });

    const responseInterceptor = (
      httpClient.interceptors.response as unknown as {
        handlers: {
          rejected: (error: {
            config: InternalAxiosRequestConfig;
            response: { status: number };
          }) => Promise<unknown>;
        }[];
      }
    ).handlers[0].rejected;

    const originalRequestConfig: InternalAxiosRequestConfig = {
      url: "/notes",
      method: "get",
    } as InternalAxiosRequestConfig;

    const mock401Error = {
      config: originalRequestConfig,
      response: { status: 401 },
    } as unknown;

    await expect(
      responseInterceptor(
        mock401Error as {
          config: InternalAxiosRequestConfig;
          response: { status: number };
        },
      ),
    ).rejects.toThrow("Refresh failed");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(locationAssignSpy).toHaveBeenCalledWith("/login");
  });
});
