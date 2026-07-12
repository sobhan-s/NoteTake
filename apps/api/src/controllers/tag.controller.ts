import type { Request, Response } from "express";
import { createTagSchema, updateTagSchema } from "@shared/core/schemas";
import * as tagService from "../services/tag.service.js";

export async function create(req: Request, res: Response): Promise<void> {
  const input = createTagSchema.parse(req.body);
  const data = await tagService.createTag(req.user!.userId, input);
  res.status(201).json({ success: true, data });
}

export async function list(req: Request, res: Response): Promise<void> {
  const data = await tagService.listTags(req.user!.userId);
  res.status(200).json({ success: true, data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = updateTagSchema.parse(req.body);
  const data = await tagService.updateTag(
    req.user!.userId,
    req.params.id as string,
    input,
  );
  res.status(200).json({ success: true, data });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const data = await tagService.deleteTag(
    req.user!.userId,
    req.params.id as string,
  );
  res.status(200).json({ success: true, data });
}
