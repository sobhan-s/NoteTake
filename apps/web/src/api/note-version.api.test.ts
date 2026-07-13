import { describe, it, expect, vi, beforeEach } from "vitest";
import { API_PATHS } from "@shared/core/constants";
import type {
  NoteResponseDto,
  NoteVersionResponseDto,
  NoteVersionSummaryDto,
} from "@shared/core/types";
import { httpClient } from "@/api/httpClient";
import {
  listNoteVersions,
  getNoteVersion,
  restoreNoteVersion,
} from "@/api/note-version.api";

vi.mock("@/api/httpClient", () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function buildVersionSummary(
  overrides: Partial<NoteVersionSummaryDto> = {},
): NoteVersionSummaryDto {
  return {
    id: "version-1",
    titleSnapshot: "Title Snapshot",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildVersionResponse(
  overrides: Partial<NoteVersionResponseDto> = {},
): NoteVersionResponseDto {
  return {
    id: "version-1",
    noteId: "note-1",
    titleSnapshot: "Title Snapshot",
    bodySnapshot: "<p>Body Snapshot</p>",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildNoteResponse(
  overrides: Partial<NoteResponseDto> = {},
): NoteResponseDto {
  return {
    id: "note-1",
    title: "Restored Title",
    body: "<p>Restored body</p>",
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    hasActiveShareLink: false,
    tags: [],
    ...overrides,
  };
}

// [FRS-6.2, FRS-6.3, FRS-6.4] `note-version.api` thin httpClient wrapper behavior.
describe("note-version.api ([FRS-6.2, FRS-6.3, FRS-6.4] request-path construction and envelope-unwrap)", () => {
  beforeEach(() => {
    vi.mocked(httpClient.get).mockReset();
    vi.mocked(httpClient.post).mockReset();
  });

  it("[FRS-6.2] listNoteVersions SHALL GET the exact /notes/:id/versions path and unwrap the { versions: [...] } envelope into a bare array", async () => {
    const versions = [
      buildVersionSummary({ id: "v-1" }),
      buildVersionSummary({ id: "v-2" }),
    ];
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { success: true, data: { versions } },
    });

    const result = await listNoteVersions("note-1");

    expect(httpClient.get).toHaveBeenCalledWith(
      `${API_PATHS.NOTES.ROOT}/note-1${API_PATHS.NOTES.VERSIONS}`,
    );
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(versions);
  });

  it("[FRS-6.2] listNoteVersions SHALL preserve the exact array order returned by the envelope, performing no client-side re-sort", async () => {
    const versions = [
      buildVersionSummary({
        id: "newest",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      buildVersionSummary({
        id: "middle",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      buildVersionSummary({
        id: "oldest",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { success: true, data: { versions } },
    });

    const result = await listNoteVersions("note-1");

    expect(result.map((v) => v.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("[FRS-6.3] getNoteVersion SHALL GET the exact /notes/:id/versions/:vId path and return the unwrapped NoteVersionResponseDto", async () => {
    const version = buildVersionResponse({ id: "v-9", noteId: "note-1" });
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { success: true, data: version },
    });

    const result = await getNoteVersion("note-1", "v-9");

    expect(httpClient.get).toHaveBeenCalledWith(
      `${API_PATHS.NOTES.ROOT}/note-1${API_PATHS.NOTES.VERSIONS}/v-9`,
    );
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(result).toEqual(version);
  });

  it("[FRS-6.4] restoreNoteVersion SHALL POST the exact /notes/:id/versions/:vId/restore path and return the unwrapped NoteResponseDto", async () => {
    const restoredNote = buildNoteResponse({
      id: "note-1",
      title: "Restored via API",
    });
    vi.mocked(httpClient.post).mockResolvedValue({
      data: { success: true, data: restoredNote },
    });

    const result = await restoreNoteVersion("note-1", "v-9");

    expect(httpClient.post).toHaveBeenCalledWith(
      `${API_PATHS.NOTES.ROOT}/note-1${API_PATHS.NOTES.VERSIONS}/v-9${API_PATHS.NOTES.RESTORE}`,
    );
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(result).toEqual(restoredNote);
  });
});
