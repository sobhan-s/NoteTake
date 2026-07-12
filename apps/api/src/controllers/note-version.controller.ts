import type { Request, Response } from "express";
import * as noteVersionService from "../services/note-version.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  const data = await noteVersionService.listVersions(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await noteVersionService.getVersion(
    req.user!.userId,
    req.params.id as string,
    req.params.versionId as string,
  );
  res.status(200).json({ success: true, data });
}

export async function restore(req: Request, res: Response): Promise<void> {
  const data = await noteVersionService.restoreVersion(
    req.user!.userId,
    req.params.id as string,
    req.params.versionId as string,
  );
  res.status(200).json({ success: true, data });
}
