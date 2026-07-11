import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import {
  app,
  createAuthedUser,
  createNoteDirect,
  daysAgo,
  ROUTES,
} from "../helpers/notes.js";
import { resetTestDatabase } from "../helpers/db.js";

describe("[FRS-2.3.6, Resolved Decision #6] GET /api/v1/notes/trash route registration order", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL?.includes("notes_app_test")) {
      throw new Error(
        "FATAL SAFETY BREAK: Truncation attempted outside notes_app_test instance!",
      );
    }
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("[FRS-2.3.6] SHALL return the trash list (200 OK), never a 404 from getById misrouting the literal segment 'trash' as an :id param", async () => {
    const { userId, accessToken } = await createAuthedUser(
      "route-order@example.com",
    );
    const trashed = await createNoteDirect(userId, {
      title: "Trashed Note",
      deletedAt: daysAgo(1),
    });

    const res = await request(app)
      .get(ROUTES.TRASH)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(404);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("notes");
    expect(res.body.data).toHaveProperty("pagination");
    const ids = (res.body.data.notes as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toEqual([trashed.id]);
  });

  it("[FRS-2.3.6] SHALL return 200 OK with an empty trash list (never a 404) when the caller has no trashed notes at all", async () => {
    const { accessToken } = await createAuthedUser(
      "route-order-empty@example.com",
    );

    const res = await request(app)
      .get(ROUTES.TRASH)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });
});
