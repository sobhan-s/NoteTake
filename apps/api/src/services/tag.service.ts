import { Prisma } from "@prisma/client";
import { API_ERROR_CODES } from "@shared/core/constants";
import type {
  CreateTagInput,
  TagListResponseDto,
  TagResponseDto,
  UpdateTagInput,
} from "@shared/core/types";
import { AppError } from "../errors/app-error.js";
import * as tagRepository from "../repositories/tag.repository.js";
import type { TagWithNoteCount } from "../repositories/tag.repository.js";

function notFound(): never {
  throw new AppError(404, API_ERROR_CODES.TAG_NOT_FOUND, "Tag not found");
}

function nameConflict(): never {
  throw new AppError(
    409,
    API_ERROR_CODES.TAG_NAME_CONFLICT,
    "A tag with this name already exists",
  );
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function toTagResponseDto(tag: TagWithNoteCount): TagResponseDto {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    noteCount: tag._count.noteTags,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

export async function createTag(
  userId: string,
  input: CreateTagInput,
): Promise<TagResponseDto> {
  const existing = await tagRepository.findTagByNameForUser(input.name, userId);
  if (existing) nameConflict();

  try {
    const tag = await tagRepository.createTag({
      userId,
      name: input.name,
      color: input.color,
    });
    return toTagResponseDto(tag);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) nameConflict();
    throw error;
  }
}

export async function listTags(userId: string): Promise<TagListResponseDto> {
  const tags = await tagRepository.listTagsForUser(userId);
  return { tags: tags.map(toTagResponseDto) };
}

export async function updateTag(
  userId: string,
  tagId: string,
  input: UpdateTagInput,
): Promise<TagResponseDto> {
  const existing = await tagRepository.findTagByIdForUser(tagId, userId);
  if (!existing) notFound();

  if (input.name !== undefined) {
    const conflicting = await tagRepository.findTagByNameForUser(
      input.name,
      userId,
    );
    if (conflicting && conflicting.id !== tagId) nameConflict();
  }

  try {
    const updated = await tagRepository.updateTag(tagId, {
      name: input.name,
      color: input.color,
    });
    return toTagResponseDto(updated);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) nameConflict();
    throw error;
  }
}

export async function deleteTag(
  userId: string,
  tagId: string,
): Promise<{ id: string }> {
  const existing = await tagRepository.findTagByIdForUser(tagId, userId);
  if (!existing) notFound();
  await tagRepository.deleteTag(tagId);
  return { id: tagId };
}
