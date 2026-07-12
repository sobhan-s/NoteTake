import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/repositories/note.repository.js", () => ({
  searchNotesForUser: vi.fn(),
  countSearchNotesForUser: vi.fn(),
}));

import * as noteRepository from "../../src/repositories/note.repository.js";
import * as searchService from "../../src/services/search.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function buildQuery(
  overrides: Partial<Parameters<typeof searchService.searchNotes>[1]> = {},
): Parameters<typeof searchService.searchNotes>[1] {
  return {
    q: "notes",
    page: 1,
    limit: 20,
    tagMode: "ALL",
    ...overrides,
  } as Parameters<typeof searchService.searchNotes>[1];
}

describe("[FRS-4.3, FRS-2.3.1] search.service.searchNotes — pagination math", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.searchNotesForUser).mockResolvedValue([]);
  });

  it("SHALL compute totalPages as 0 (never NaN/Infinity) when total is 0", async () => {
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(0);

    const result = await searchService.searchNotes(
      USER_ID,
      buildQuery({ page: 1, limit: 20 }),
    );

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("SHALL compute totalPages via exact division when total is an exact multiple of limit", async () => {
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(40);

    const result = await searchService.searchNotes(
      USER_ID,
      buildQuery({ page: 1, limit: 20 }),
    );

    expect(result.pagination.totalPages).toBe(2);
  });

  it("SHALL round totalPages up (ceil) when total is one more than an exact multiple of limit", async () => {
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(41);

    const result = await searchService.searchNotes(
      USER_ID,
      buildQuery({ page: 1, limit: 20 }),
    );

    expect(result.pagination.totalPages).toBe(3);
  });

  it("SHALL echo back the requested page/limit in the pagination envelope regardless of result-set size", async () => {
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(5);

    const result = await searchService.searchNotes(
      USER_ID,
      buildQuery({ page: 3, limit: 7 }),
    );

    expect(result.pagination.page).toBe(3);
    expect(result.pagination.limit).toBe(7);
  });
});

describe("[FRS-2.3.5, FRS-2.3.3] search.service.searchNotes — tagIds CSV-to-array parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.searchNotesForUser).mockResolvedValue([]);
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(0);
  });

  it("SHALL split a comma-separated tagIds string into an array before calling the repository", async () => {
    const tagA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tagB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await searchService.searchNotes(
      USER_ID,
      buildQuery({ tagIds: `${tagA},${tagB}`, tagMode: "ALL" }),
    );

    expect(noteRepository.searchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: [tagA, tagB], tagMode: "ALL" }),
    );
    expect(noteRepository.countSearchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: [tagA, tagB], tagMode: "ALL" }),
    );
  });

  it("SHALL pass tagIds as undefined to the repository when the query omits it entirely", async () => {
    await searchService.searchNotes(USER_ID, buildQuery());

    expect(noteRepository.searchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: undefined }),
    );
    expect(noteRepository.countSearchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: undefined }),
    );
  });

  it("SHALL pass a single tagId as a one-element array (no split artifact) when tagIds has no comma", async () => {
    const tagA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await searchService.searchNotes(
      USER_ID,
      buildQuery({ tagIds: tagA, tagMode: "ANY" }),
    );

    expect(noteRepository.searchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: [tagA], tagMode: "ANY" }),
    );
  });

  it("SHALL forward the same userId and trimmed query string (q) to both the search and count repository calls", async () => {
    await searchService.searchNotes(USER_ID, buildQuery({ q: "architecture" }));

    expect(noteRepository.searchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, query: "architecture" }),
    );
    expect(noteRepository.countSearchNotesForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, query: "architecture" }),
    );
  });
});

describe("[SDS §7] search.service.searchNotes — row-to-DTO mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(1);
  });

  it("[FRS-2.1.1] SHALL map updated_at (Date) to updatedAt (ISO string) and pass through id/title/snippet verbatim", async () => {
    const updatedAt = new Date("2026-07-01T10:30:00.000Z");
    vi.mocked(noteRepository.searchNotesForUser).mockResolvedValue([
      {
        id: "note-1",
        title: "Architecture Review",
        updated_at: updatedAt,
        snippet: "The [[[MARK]]]architecture[[[MARK_END]]] review notes",
      },
    ]);

    const result = await searchService.searchNotes(USER_ID, buildQuery());

    expect(result.results).toEqual([
      {
        id: "note-1",
        title: "Architecture Review",
        snippet: "The [[[MARK]]]architecture[[[MARK_END]]] review notes",
        updatedAt: "2026-07-01T10:30:00.000Z",
      },
    ]);
  });

  it("SHALL map every row in a multi-row result set independently and preserve order", async () => {
    const rowA = {
      id: "note-a",
      title: "A",
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
      snippet: "snippet-a",
    };
    const rowB = {
      id: "note-b",
      title: "B",
      updated_at: new Date("2026-02-01T00:00:00.000Z"),
      snippet: "snippet-b",
    };
    vi.mocked(noteRepository.searchNotesForUser).mockResolvedValue([
      rowA,
      rowB,
    ]);
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(2);

    const result = await searchService.searchNotes(USER_ID, buildQuery());

    expect(result.results.map((r) => r.id)).toEqual(["note-a", "note-b"]);
    expect(result.results[0]?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.results[1]?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("SHALL return an empty results array (never null/undefined) when the repository resolves zero rows", async () => {
    vi.mocked(noteRepository.searchNotesForUser).mockResolvedValue([]);
    vi.mocked(noteRepository.countSearchNotesForUser).mockResolvedValue(0);

    const result = await searchService.searchNotes(USER_ID, buildQuery());

    expect(result.results).toEqual([]);
  });
});
