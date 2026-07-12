import type { Request, Response } from "express";
import { createShareLinkSchema } from "@shared/core/schemas";
import * as shareService from "../services/share.service.js";

export async function create(req: Request, res: Response): Promise<void> {
  const input = createShareLinkSchema.parse(req.body);
  const { dto, created } = await shareService.getOrCreateShareLink(
    req.user!.userId,
    req.params.id as string,
    input,
  );
  res.status(created ? 201 : 200).json({ success: true, data: dto });
}

export async function getActive(req: Request, res: Response): Promise<void> {
  const data = await shareService.getActiveShareLink(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const data = await shareService.revokeShareLink(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}
