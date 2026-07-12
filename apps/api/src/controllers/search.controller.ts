import type { Request, Response } from "express";
import { searchNotesSchema } from "@shared/core/schemas";
import * as searchService from "../services/search.service.js";

export async function search(req: Request, res: Response): Promise<void> {
  const query = searchNotesSchema.parse(req.query);
  const data = await searchService.searchNotes(req.user!.userId, query);
  res.status(200).json({ success: true, data });
}
