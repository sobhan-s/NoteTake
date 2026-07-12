import type { Request, Response } from "express";
import * as shareService from "../services/share.service.js";

export async function getByToken(req: Request, res: Response): Promise<void> {
  const data = await shareService.getPublicNoteByToken(
    req.params.token as string,
  );
  res.status(200).json({ success: true, data });
}
