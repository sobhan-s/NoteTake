import { describe, it, expect, vi } from "vitest";
import {
  searchNotesForUser,
  countSearchNotesForUser,
} from "../../src/repositories/note.repository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TAG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type SearchDb = Parameters<typeof searchNotesForUser>[1];
type CountDb = Parameters<typeof countSearchNotesForUser>[1];

function fakeDb(returnValue: unknown[] = []): (SearchDb | CountDb) & {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
} {
  const $queryRawUnsafe = vi.fn().mockResolvedValue(returnValue);
  return { $queryRawUnsafe } as unknown as (SearchDb | CountDb) & {
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
}

describe("[SDS §7, FRS-4.1, FRS-4.4] note.repository.searchNotesForUser — raw SQL shape & placeholder wiring", () => {
  it("[FRS-4.4, FRS-8.1] SHALL scope the WHERE clause to user_id = $1 and deleted_at IS NULL", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      { userId: USER_ID, query: "hello", page: 1, limit: 20, tagMode: "ALL" },
      db,
    );

    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql] = db.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("n.user_id = $1");
    expect(sql).toContain("n.deleted_at IS NULL");
  });

  it("[FRS-4.5] SHALL order by ts_rank(...) DESC, n.updated_at DESC", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      { userId: USER_ID, query: "hello", page: 1, limit: 20, tagMode: "ALL" },
      db,
    );

    const [sql] = db.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain(
      "ORDER BY ts_rank(n.search_vector, plainto_tsquery('english', $2)) DESC, n.updated_at DESC",
    );
  });

  it("[FRS-4.3] SHALL pass positional args [userId, query, limit, offset] with offset computed as (page-1)*limit, when tagIds is omitted", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      { userId: USER_ID, query: "hello", page: 3, limit: 10, tagMode: "ALL" },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("LIMIT $3 OFFSET $4");
    expect(args).toEqual([USER_ID, "hello", 10, 20]);
  });

  it("[FRS-2.3.3] SHALL append tagIds as the exact 5th positional parameter ($5), with an ALL-mode NOT-EXISTS/unnest SQL fragment, when tagIds is supplied under tagMode=ALL", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      {
        userId: USER_ID,
        query: "hello",
        page: 1,
        limit: 20,
        tagIds: [TAG_A, TAG_B],
        tagMode: "ALL",
      },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("unnest($5::uuid[])");
    expect(sql).toContain("NOT EXISTS");
    expect(args).toEqual([USER_ID, "hello", 20, 0, [TAG_A, TAG_B]]);
  });

  it("[FRS-2.3.3] SHALL append tagIds as the exact 5th positional parameter ($5), with an ANY-mode EXISTS/=ANY SQL fragment, when tagMode=ANY", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      {
        userId: USER_ID,
        query: "hello",
        page: 1,
        limit: 20,
        tagIds: [TAG_A],
        tagMode: "ANY",
      },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("nt.tag_id = ANY($5::uuid[])");
    expect(sql).not.toContain("NOT EXISTS");
    expect(args).toEqual([USER_ID, "hello", 20, 0, [TAG_A]]);
  });

  it("[FRS-2.3.3] SHALL omit any tag SQL fragment and the 5th positional argument entirely when tagIds is undefined", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      { userId: USER_ID, query: "hello", page: 1, limit: 20, tagMode: "ALL" },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).not.toContain("$5");
    expect(sql).not.toContain("unnest");
    expect(args).toHaveLength(4);
  });

  it("[FRS-2.3.3] SHALL omit any tag SQL fragment and the 5th positional argument entirely when tagIds is an empty array", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      {
        userId: USER_ID,
        query: "hello",
        page: 1,
        limit: 20,
        tagIds: [],
        tagMode: "ALL",
      },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).not.toContain("$5");
    expect(args).toHaveLength(4);
  });

  it("[FRS-4.2, FRS-4.2.1] SHALL invoke ts_headline with the exact [[[MARK]]]/[[[MARK_END]]] sentinel config, never a raw HTML tag pair", async () => {
    const db = fakeDb();

    await searchNotesForUser(
      { userId: USER_ID, query: "hello", page: 1, limit: 20, tagMode: "ALL" },
      db,
    );

    const [sql] = db.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain(
      "StartSel=[[[MARK]]], StopSel=[[[MARK_END]]], MaxWords=35, MinWords=15",
    );
    expect(sql).not.toMatch(/<mark>|<b>/i);
  });

  it("SHALL return exactly the row array resolved by the underlying $queryRawUnsafe call, unmodified", async () => {
    const rows = [
      { id: "note-1", title: "T", updated_at: new Date(), snippet: "s" },
    ];
    const db = fakeDb(rows);

    const result = await searchNotesForUser(
      { userId: USER_ID, query: "hello", page: 1, limit: 20, tagMode: "ALL" },
      db,
    );

    expect(result).toBe(rows);
  });
});

describe("[SDS §7, FRS-4.1, FRS-4.4] note.repository.countSearchNotesForUser — raw SQL shape & placeholder wiring", () => {
  it("[FRS-4.4, FRS-8.1] SHALL scope the WHERE clause to user_id = $1 and deleted_at IS NULL, with no LIMIT/OFFSET clause", async () => {
    const db = fakeDb([{ count: 0 }]);

    await countSearchNotesForUser(
      { userId: USER_ID, query: "hello", tagMode: "ALL" },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("n.user_id = $1");
    expect(sql).toContain("n.deleted_at IS NULL");
    expect(sql).not.toContain("LIMIT");
    expect(sql).not.toContain("OFFSET");
    expect(args).toEqual([USER_ID, "hello"]);
  });

  it("[FRS-2.3.3] SHALL append tagIds as the exact 3rd positional parameter ($3) — a lower index than the search query call site's $5 — with an ALL-mode fragment", async () => {
    const db = fakeDb([{ count: 1 }]);

    await countSearchNotesForUser(
      {
        userId: USER_ID,
        query: "hello",
        tagIds: [TAG_A, TAG_B],
        tagMode: "ALL",
      },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("unnest($3::uuid[])");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).not.toContain("$5");
    expect(args).toEqual([USER_ID, "hello", [TAG_A, TAG_B]]);
  });

  it("[FRS-2.3.3] SHALL append tagIds as the exact 3rd positional parameter ($3) with an ANY-mode fragment when tagMode=ANY", async () => {
    const db = fakeDb([{ count: 1 }]);

    await countSearchNotesForUser(
      { userId: USER_ID, query: "hello", tagIds: [TAG_A], tagMode: "ANY" },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("nt.tag_id = ANY($3::uuid[])");
    expect(args).toEqual([USER_ID, "hello", [TAG_A]]);
  });

  it("[FRS-2.3.3] SHALL omit the tag SQL fragment and 3rd positional argument entirely when tagIds is undefined", async () => {
    const db = fakeDb([{ count: 2 }]);

    await countSearchNotesForUser(
      { userId: USER_ID, query: "hello", tagMode: "ALL" },
      db,
    );

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).not.toContain("$3");
    expect(args).toHaveLength(2);
  });

  it("SHALL return 0 when the underlying query resolves an empty row array", async () => {
    const db = fakeDb([]);

    const result = await countSearchNotesForUser(
      { userId: USER_ID, query: "hello", tagMode: "ALL" },
      db,
    );

    expect(result).toBe(0);
  });

  it("SHALL return the resolved row's count field, unmodified, when a row is present", async () => {
    const db = fakeDb([{ count: 7 }]);

    const result = await countSearchNotesForUser(
      { userId: USER_ID, query: "hello", tagMode: "ALL" },
      db,
    );

    expect(result).toBe(7);
  });
});
