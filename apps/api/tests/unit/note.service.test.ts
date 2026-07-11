import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Note } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import { AppError } from "../../src/errors/app-error.js";

vi.mock("../../src/repositories/note.repository.js", () => ({
  createNote: vi.fn(),
  findActiveNoteByIdForUser: vi.fn(),
  findTrashedNoteByIdForUser: vi.fn(),
  updateNoteContent: vi.fn(),
  softDeleteNote: vi.fn(),
  restoreNote: vi.fn(),
  permanentlyDeleteNote: vi.fn(),
  purgeStage2Notes: vi.fn(),
}));

import * as noteRepository from "../../src/repositories/note.repository.js";
import * as noteService from "../../src/services/note.service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    userId: USER_ID,
    title: "Fixture Title",
    body: "Fixture Body",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as unknown as Note;
}

describe("[FRS-2.2.2, FRS-2.2.5] note.service — Stage-1 boundary classification (isWithinStage1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-2.2.2] SHALL treat a note trashed exactly `now - (30 days - 1 second)` as still within Stage 1 and restore it", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS - 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );
    vi.mocked(noteRepository.restoreNote).mockResolvedValue(
      buildNote({ deletedAt: null }),
    );

    const result = await noteService.restoreNote(USER_ID, NOTE_ID);

    expect(result.deletedAt).toBeNull();
    expect(noteRepository.restoreNote).toHaveBeenCalledWith(NOTE_ID);
  });

  it("[FRS-2.2.5, FRS-2.2.6] SHALL treat a note trashed exactly `now - (30 days + 1 second)` as Stage 2 (outside the restorable window) and reject restore with 404 NOTE_NOT_FOUND", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS + 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );

    await expect(
      noteService.restoreNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.restoreNote).not.toHaveBeenCalled();
  });

  it("[FRS-2.2.5, FRS-2.2.8] SHALL apply the identical Stage-1 boundary to permanentDeleteNote: `30 days - 1 second` succeeds", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS - 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );
    vi.mocked(noteRepository.permanentlyDeleteNote).mockResolvedValue(
      trashedNote,
    );

    const result = await noteService.permanentDeleteNote(USER_ID, NOTE_ID);

    expect(result).toEqual({ id: NOTE_ID });
    expect(noteRepository.permanentlyDeleteNote).toHaveBeenCalledWith(NOTE_ID);
  });

  it("[FRS-2.2.5, FRS-2.2.8] SHALL apply the identical Stage-1 boundary to permanentDeleteNote: `30 days + 1 second` rejects with 404 NOTE_NOT_FOUND", async () => {
    const deletedAt = new Date(Date.now() - (THIRTY_DAYS_MS + 1000));
    const trashedNote = buildNote({ deletedAt });
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      trashedNote,
    );

    await expect(
      noteService.permanentDeleteNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.permanentlyDeleteNote).not.toHaveBeenCalled();
  });

  it("[Resolved Decision #4] SHALL reject restore with 404 NOTE_NOT_FOUND when the repository finds no trashed row at all (never trashed / cross-user)", async () => {
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockResolvedValue(
      null,
    );

    await expect(
      noteService.restoreNote(USER_ID, NOTE_ID),
    ).rejects.toBeInstanceOf(AppError);
    expect(noteRepository.restoreNote).not.toHaveBeenCalled();
  });
});

describe("[SDS §4.1] note.service — find-then-act repository call sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[FRS-2.2.2] restoreNote SHALL call findTrashedNoteByIdForUser(id, userId) before restoreNote(id), never the reverse order", async () => {
    const callOrder: string[] = [];
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockImplementation(
      async () => {
        callOrder.push("find");
        return buildNote({ deletedAt: new Date(Date.now() - 1000) });
      },
    );
    vi.mocked(noteRepository.restoreNote).mockImplementation(async () => {
      callOrder.push("restore");
      return buildNote({ deletedAt: null });
    });

    await noteService.restoreNote(USER_ID, NOTE_ID);

    expect(callOrder).toEqual(["find", "restore"]);
    expect(noteRepository.findTrashedNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
    expect(noteRepository.findTrashedNoteByIdForUser).toHaveBeenCalledTimes(1);
    expect(noteRepository.restoreNote).toHaveBeenCalledTimes(1);
  });

  it("[FRS-2.2.8] permanentDeleteNote SHALL call findTrashedNoteByIdForUser(id, userId) before permanentlyDeleteNote(id), never the reverse order", async () => {
    const callOrder: string[] = [];
    vi.mocked(noteRepository.findTrashedNoteByIdForUser).mockImplementation(
      async () => {
        callOrder.push("find");
        return buildNote({ deletedAt: new Date(Date.now() - 1000) });
      },
    );
    vi.mocked(noteRepository.permanentlyDeleteNote).mockImplementation(
      async () => {
        callOrder.push("delete");
        return buildNote();
      },
    );

    await noteService.permanentDeleteNote(USER_ID, NOTE_ID);

    expect(callOrder).toEqual(["find", "delete"]);
    expect(noteRepository.findTrashedNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
    expect(noteRepository.permanentlyDeleteNote).toHaveBeenCalledWith(NOTE_ID);
  });

  it("[FRS-2.1.2] getNoteById SHALL call findActiveNoteByIdForUser(id, userId) scoped to the caller, and reject 404 NOTE_NOT_FOUND when it resolves null", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.getNoteById(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.findActiveNoteByIdForUser).toHaveBeenCalledWith(
      NOTE_ID,
      USER_ID,
    );
  });

  it("[Resolved Decision #2] updateNote SHALL call findActiveNoteByIdForUser before updateNoteContent, and SHALL NOT call updateNoteContent when the note is not found active", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.updateNote(USER_ID, NOTE_ID, { title: "New Title" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.updateNoteContent).not.toHaveBeenCalled();
  });

  it("[FRS-2.1.3] updateNote SHALL pass through only the provided title/body fields to updateNoteContent", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(
      buildNote(),
    );
    vi.mocked(noteRepository.updateNoteContent).mockResolvedValue(
      buildNote({ title: "New Title" }),
    );

    await noteService.updateNote(USER_ID, NOTE_ID, { title: "New Title" });

    expect(noteRepository.updateNoteContent).toHaveBeenCalledWith(NOTE_ID, {
      title: "New Title",
      body: undefined,
    });
  });

  it("[FRS-2.2.1] softDeleteNote SHALL call findActiveNoteByIdForUser before softDeleteNote(id), and SHALL NOT soft-delete when not found active", async () => {
    vi.mocked(noteRepository.findActiveNoteByIdForUser).mockResolvedValue(null);

    await expect(
      noteService.softDeleteNote(USER_ID, NOTE_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: API_ERROR_CODES.NOTE_NOT_FOUND,
    });
    expect(noteRepository.softDeleteNote).not.toHaveBeenCalled();
  });
});
