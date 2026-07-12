import { describe, it, expect, vi } from "vitest";
import { findTagsByIdsForUser } from "../../src/repositories/tag.repository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const TAG_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAG_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type FakeDb = {
  tag: { findMany: ReturnType<typeof vi.fn> };
};

function fakeDb(returnValue: unknown = []): FakeDb {
  return {
    tag: { findMany: vi.fn().mockResolvedValue(returnValue) },
  };
}

describe("[FRS-3.4, SDS §4.1] tag.repository.findTagsByIdsForUser — ownership-scoped lookup used by verifyTagOwnership", () => {
  it("[SDS §4.1] SHALL query tag.findMany scoped to both `id: { in: ids }` and the caller's `userId` in a single where clause", async () => {
    const db = fakeDb([]);

    await findTagsByIdsForUser([TAG_A_ID, TAG_B_ID], USER_ID, db);

    expect(db.tag.findMany).toHaveBeenCalledTimes(1);
    expect(db.tag.findMany).toHaveBeenCalledWith({
      where: { id: { in: [TAG_A_ID, TAG_B_ID] }, userId: USER_ID },
    });
  });

  it("[FRS-3.4] SHALL resolve exactly the rows the fake DB returns (pass-through, no client-side re-filtering)", async () => {
    const owned = [
      { id: TAG_A_ID, userId: USER_ID, name: "Work", color: "#3B82F6" },
      { id: TAG_B_ID, userId: USER_ID, name: "Ideas", color: "#EF4444" },
    ];
    const db = fakeDb(owned);

    const result = await findTagsByIdsForUser(
      [TAG_A_ID, TAG_B_ID],
      USER_ID,
      db,
    );

    expect(result).toBe(owned);
    expect(result).toHaveLength(2);
  });

  it("[FRS-3.4] SHALL resolve a shorter array than the requested ids when one id belongs to another user (the caller's `verifyTagOwnership` uses this length mismatch to reject 403)", async () => {
    const db = fakeDb([{ id: TAG_A_ID, userId: USER_ID }]);

    const result = await findTagsByIdsForUser(
      [TAG_A_ID, TAG_B_ID],
      USER_ID,
      db,
    );

    expect(result).toHaveLength(1);
  });

  it("[FRS-3.4] SHALL resolve an empty array when none of the requested ids belong to the caller (cross-user IDOR attempt)", async () => {
    const db = fakeDb([]);

    const result = await findTagsByIdsForUser([TAG_A_ID], OTHER_USER_ID, db);

    expect(result).toEqual([]);
  });
});
