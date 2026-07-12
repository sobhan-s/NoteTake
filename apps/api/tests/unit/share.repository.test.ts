import { describe, it, expect, vi } from "vitest";
import {
  findActiveShareLinkForNote,
  createShareLink,
  revokeShareLinkById,
  revokeActiveShareLinksForNote,
  consumePublicShareView,
} from "../../src/repositories/share.repository.js";

const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const LINK_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

type ShareLinkDb = Parameters<typeof findActiveShareLinkForNote>[1];
type RawShareDb = Parameters<typeof consumePublicShareView>[1];

function fakePrismaDb(): ShareLinkDb & {
  shareLink: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
} {
  return {
    shareLink: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as ShareLinkDb & {
    shareLink: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
}

function fakeRawDb(returnValue: unknown[] = []): RawShareDb & {
  $queryRaw: ReturnType<typeof vi.fn>;
} {
  const $queryRaw = vi.fn().mockResolvedValue(returnValue);
  return { $queryRaw } as unknown as RawShareDb & {
    $queryRaw: ReturnType<typeof vi.fn>;
  };
}

describe("[FRS-2.2.4, FRS-5.6] share.repository.findActiveShareLinkForNote — active-link predicate shape", () => {
  it("[FRS-2.2.4] SHALL query shareLink.findFirst scoped to noteId with revokedAt: null and expiresAt.gt as a Date near the current time", async () => {
    const db = fakePrismaDb();
    const before = Date.now();

    await findActiveShareLinkForNote(NOTE_ID, db);

    const after = Date.now();
    expect(db.shareLink.findFirst).toHaveBeenCalledTimes(1);
    const [{ where }] = db.shareLink.findFirst.mock.calls[0] as [
      { where: { noteId: string; revokedAt: null; expiresAt: { gt: Date } } },
    ];
    expect(where.noteId).toBe(NOTE_ID);
    expect(where.revokedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.expiresAt.gt.getTime()).toBeLessThanOrEqual(after);
  });

  it("[FRS-2.2.4] SHALL return the resolved row unmodified, or null when no active link exists", async () => {
    const activeLink = { id: LINK_ID, noteId: NOTE_ID } as unknown;
    const db = fakePrismaDb();
    db.shareLink.findFirst.mockResolvedValueOnce(activeLink);

    const result = await findActiveShareLinkForNote(NOTE_ID, db);

    expect(result).toBe(activeLink);
  });

  it("[FRS-2.2.4, FRS-5.6] SHALL resolve null when the underlying findFirst resolves null (no active, non-revoked, non-expired link)", async () => {
    const db = fakePrismaDb();

    const result = await findActiveShareLinkForNote(NOTE_ID, db);

    expect(result).toBeNull();
  });
});

describe("[FRS-5.1, FRS-5.2] share.repository.createShareLink — link creation data shape", () => {
  it("[FRS-5.1, FRS-5.2] SHALL call shareLink.create with the exact { noteId, token, expiresAt } fields passed through unmodified, with no extra fields injected", async () => {
    const db = fakePrismaDb();
    const expiresAt = new Date("2026-07-19T00:00:00.000Z");

    await createShareLink({ noteId: NOTE_ID, token: TOKEN, expiresAt }, db);

    expect(db.shareLink.create).toHaveBeenCalledTimes(1);
    const [{ data }] = db.shareLink.create.mock.calls[0] as [
      { data: { noteId: string; token: string; expiresAt: Date } },
    ];
    expect(data).toEqual({ noteId: NOTE_ID, token: TOKEN, expiresAt });
    expect(Object.keys(data)).toEqual(["noteId", "token", "expiresAt"]);
  });

  it("[FRS-5.1] SHALL return the created row exactly as resolved by shareLink.create", async () => {
    const created = { id: LINK_ID, noteId: NOTE_ID, token: TOKEN } as unknown;
    const db = fakePrismaDb();
    db.shareLink.create.mockResolvedValueOnce(created);

    const result = await createShareLink(
      { noteId: NOTE_ID, token: TOKEN, expiresAt: new Date() },
      db,
    );

    expect(result).toBe(created);
  });
});

describe("[FRS-5.3] share.repository.revokeShareLinkById — manual revoke by id", () => {
  it("[FRS-5.3] SHALL call shareLink.update scoped to { where: { id }, data: { revokedAt } } with a freshly generated Date, not a passed-in value", async () => {
    const db = fakePrismaDb();
    const before = Date.now();

    await revokeShareLinkById(LINK_ID, db);

    const after = Date.now();
    expect(db.shareLink.update).toHaveBeenCalledTimes(1);
    const [{ where, data }] = db.shareLink.update.mock.calls[0] as [
      { where: { id: string }; data: { revokedAt: Date } },
    ];
    expect(where).toEqual({ id: LINK_ID });
    expect(data.revokedAt).toBeInstanceOf(Date);
    expect(data.revokedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.revokedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("[FRS-5.3] SHALL return the updated row exactly as resolved by shareLink.update", async () => {
    const updated = { id: LINK_ID, revokedAt: new Date() } as unknown;
    const db = fakePrismaDb();
    db.shareLink.update.mockResolvedValueOnce(updated);

    const result = await revokeShareLinkById(LINK_ID, db);

    expect(result).toBe(updated);
  });
});

describe("[FRS-2.2.4] share.repository.revokeActiveShareLinksForNote — trash-time bulk revoke, reusing the active-link predicate", () => {
  it("[FRS-2.2.4] SHALL call shareLink.updateMany scoped to the identical active predicate used by findActiveShareLinkForNote (noteId, revokedAt: null, expiresAt.gt as a near-now Date)", async () => {
    const db = fakePrismaDb();
    const before = Date.now();

    await revokeActiveShareLinksForNote(NOTE_ID, db);

    const after = Date.now();
    expect(db.shareLink.updateMany).toHaveBeenCalledTimes(1);
    const [{ where, data }] = db.shareLink.updateMany.mock.calls[0] as [
      {
        where: { noteId: string; revokedAt: null; expiresAt: { gt: Date } };
        data: { revokedAt: Date };
      },
    ];
    expect(where.noteId).toBe(NOTE_ID);
    expect(where.revokedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.expiresAt.gt.getTime()).toBeLessThanOrEqual(after);
    expect(data.revokedAt).toBeInstanceOf(Date);
  });

  it("[FRS-2.2.4] SHALL return the BatchPayload exactly as resolved by shareLink.updateMany", async () => {
    const db = fakePrismaDb();
    db.shareLink.updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await revokeActiveShareLinksForNote(NOTE_ID, db);

    expect(result).toEqual({ count: 2 });
  });
});

describe("[FRS-5.4, FRS-2.2.4, FRS-5.6] share.repository.consumePublicShareView — atomic parameterized view-count increment", () => {
  it("[FRS-5.4] SHALL invoke $queryRaw as a tagged template (a template-strings array with a .raw property), never as a plain-string call", async () => {
    const db = fakeRawDb([]);

    await consumePublicShareView(TOKEN, db);

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings] = db.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(Array.isArray(strings)).toBe(true);
    expect(strings).toHaveProperty("raw");
  });

  it("[FRS-5.4, SDS §2.2] SHALL build SQL text containing the atomic UPDATE ... SET view_count = view_count + 1 statement joined with the notes table", async () => {
    const db = fakeRawDb([]);

    await consumePublicShareView(TOKEN, db);

    const [strings] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    const sql = strings.join("");
    expect(sql).toContain("UPDATE share_links");
    expect(sql).toContain("SET view_count = view_count + 1");
    expect(sql).toContain("FROM notes");
  });

  it("[FRS-2.2.4, FRS-8.1] SHALL enforce sl.revoked_at IS NULL, sl.expires_at > NOW(), and n.deleted_at IS NULL as a single combined predicate", async () => {
    const db = fakeRawDb([]);

    await consumePublicShareView(TOKEN, db);

    const [strings] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    const sql = strings.join("");
    expect(sql).toContain("sl.revoked_at IS NULL");
    expect(sql).toContain("sl.expires_at > NOW()");
    expect(sql).toContain("n.deleted_at IS NULL");
  });

  it("[FRS-5.4] SHALL RETURNING view_count, expires_at, note_id, title, body, and updated_at in the same atomic statement", async () => {
    const db = fakeRawDb([]);

    await consumePublicShareView(TOKEN, db);

    const [strings] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    const sql = strings.join("");
    expect(sql).toContain("RETURNING");
    expect(sql).toContain("view_count");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("note_id");
    expect(sql).toContain("title");
    expect(sql).toContain("body");
    expect(sql).toContain("updated_at");
  });

  it("[SDS §2.2] SHALL pass the token as a separate interpolated parameter, never concatenated literally into any strings-array segment (parameterized, injection-safe)", async () => {
    const db = fakeRawDb([]);

    await consumePublicShareView(TOKEN, db);

    const [strings, tokenArg] = db.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      unknown,
    ];
    expect(tokenArg).toBe(TOKEN);
    for (const segment of strings) {
      expect(segment).not.toContain(TOKEN);
    }
  });

  it("[FRS-5.6, FRS-2.2.4] SHALL return null when the query resolves an empty array (expired, revoked, trashed, or nonexistent link)", async () => {
    const db = fakeRawDb([]);

    const result = await consumePublicShareView(TOKEN, db);

    expect(result).toBeNull();
  });

  it("[FRS-5.4] SHALL return the first resolved row unmodified when the atomic update matches exactly one active link", async () => {
    const row = {
      view_count: 4,
      expires_at: new Date("2026-07-19T00:00:00.000Z"),
      note_id: NOTE_ID,
      title: "Shared Note",
      body: "<p>content</p>",
      updated_at: new Date("2026-07-12T00:00:00.000Z"),
    };
    const db = fakeRawDb([row]);

    const result = await consumePublicShareView(TOKEN, db);

    expect(result).toBe(row);
  });
});
