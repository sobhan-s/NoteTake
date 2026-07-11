import type { Request, Response } from "express";
import {
  createNoteSchema,
  listNotesSchema,
  listTrashSchema,
  permanentDeleteSchema,
  updateNoteSchema,
} from "@shared/core/schemas";
import * as noteService from "../services/note.service.js";

export async function create(req: Request, res: Response): Promise<void> {
  const input = createNoteSchema.parse(req.body);
  const data = await noteService.createNote(req.user!.userId, input);
  res.status(201).json({ success: true, data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await noteService.getNoteById(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = updateNoteSchema.parse(req.body);
  const data = await noteService.updateNote(
    req.user!.userId,
    req.params.id as string,
    input,
  );
  res.status(200).json({ success: true, data });
}

export async function softDelete(req: Request, res: Response): Promise<void> {
  const data = await noteService.softDeleteNote(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function restore(req: Request, res: Response): Promise<void> {
  const data = await noteService.restoreNote(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function permanentDelete(
  req: Request,
  res: Response,
): Promise<void> {
  permanentDeleteSchema.parse(req.body);
  const data = await noteService.permanentDeleteNote(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = listNotesSchema.parse(req.query);
  const data = await noteService.listNotes(req.user!.userId, query);
  res.status(200).json({ success: true, data });
}

export async function listTrash(req: Request, res: Response): Promise<void> {
  const query = listTrashSchema.parse(req.query);
  const data = await noteService.listTrash(req.user!.userId, query);
  res.status(200).json({ success: true, data });
}
