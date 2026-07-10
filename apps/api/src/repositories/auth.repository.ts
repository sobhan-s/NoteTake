import type {
  OtpCode,
  OtpStatus,
  OtpType,
  Prisma,
  RefreshSession,
  User,
} from "@prisma/client";
import { prisma } from "../lib/prisma-client.js";

type Db = Pick<
  Prisma.TransactionClient,
  "user" | "otpCode" | "loginAttempt" | "refreshSession" | "$queryRaw"
>;

export function findUserByEmail(
  email: string,
  db: Db = prisma,
): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export function findUserById(
  userId: string,
  db: Db = prisma,
): Promise<User | null> {
  return db.user.findUnique({ where: { id: userId } });
}

export function createUser(
  data: { email: string; passwordHash: string },
  db: Db = prisma,
): Promise<User> {
  return db.user.create({ data });
}

export function updateUserPasswordHash(
  userId: string,
  passwordHash: string,
  db: Db = prisma,
): Promise<User> {
  return db.user.update({ where: { id: userId }, data: { passwordHash } });
}

export function markUserVerified(
  userId: string,
  db: Db = prisma,
): Promise<User> {
  return db.user.update({ where: { id: userId }, data: { isVerified: true } });
}

export function findLatestOtp(
  userId: string,
  type: OtpType,
  db: Db = prisma,
): Promise<OtpCode | null> {
  return db.otpCode.findFirst({
    where: { userId, type },
    orderBy: { createdAt: "desc" },
  });
}

export function findOtpById(
  otpId: string,
  db: Db = prisma,
): Promise<OtpCode | null> {
  return db.otpCode.findUnique({ where: { id: otpId } });
}

export function createOtp(
  data: { userId: string; type: OtpType; codeHash: string; expiresAt: Date },
  db: Db = prisma,
): Promise<OtpCode> {
  return db.otpCode.create({ data });
}

export function invalidatePendingOtp(
  userId: string,
  type: OtpType,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.otpCode.updateMany({
    where: { userId, type, status: "PENDING" },
    data: { status: "INVALIDATED" },
  });
}

export async function lockOtpRowForUpdate(
  tx: Prisma.TransactionClient,
  otpId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM otp_codes WHERE id = ${otpId}::uuid FOR UPDATE`;
}

export function updateOtpAttempts(
  otpId: string,
  data: { attempts: number; status?: OtpStatus },
  db: Db = prisma,
): Promise<OtpCode> {
  return db.otpCode.update({ where: { id: otpId }, data });
}

export function markOtpConsumed(
  otpId: string,
  db: Db = prisma,
): Promise<OtpCode> {
  return db.otpCode.update({
    where: { id: otpId },
    data: { status: "CONSUMED" },
  });
}

export function countRecentLoginAttempts(
  email: string,
  sinceDate: Date,
  db: Db = prisma,
): Promise<number> {
  return db.loginAttempt.count({
    where: { email, attemptedAt: { gte: sinceDate } },
  });
}

export function createLoginAttempt(
  data: { email: string; ipAddress: string },
  db: Db = prisma,
) {
  return db.loginAttempt.create({ data });
}

export function deleteLoginAttemptsByEmail(
  email: string,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.loginAttempt.deleteMany({ where: { email } });
}

export function createRefreshSession(
  data: {
    userId: string;
    tokenHash: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresAt: Date;
  },
  db: Db = prisma,
): Promise<RefreshSession> {
  return db.refreshSession.create({ data });
}

export function findRefreshSessionByHash(
  tokenHash: string,
  db: Db = prisma,
): Promise<RefreshSession | null> {
  return db.refreshSession.findUnique({ where: { tokenHash } });
}

export function revokeRefreshSession(
  sessionId: string,
  db: Db = prisma,
): Promise<RefreshSession> {
  return db.refreshSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

export function revokeActiveSessionsForDevice(
  userId: string,
  userAgent: string | null | undefined,
  db: Db = prisma,
): Promise<Prisma.BatchPayload> {
  return db.refreshSession.updateMany({
    where: { userId, userAgent: userAgent ?? null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
