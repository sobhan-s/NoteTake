import cron from "node-cron";
import { APP_LIMITS } from "@shared/core/constants";
import { CRON_CLEANUP_SCHEDULE } from "../constants/api.constants.js";
import * as noteRepository from "../repositories/note.repository.js";

function computeStage2Cutoff(): Date {
  const totalDays =
    APP_LIMITS.TRASH_STAGE_1_DAYS + APP_LIMITS.TRASH_STAGE_2_DAYS;
  return new Date(Date.now() - totalDays * 24 * 60 * 60 * 1000);
}

export async function runNotesPurgePass(): Promise<void> {
  await noteRepository.purgeStage2Notes(computeStage2Cutoff());
}

export function startCleanupJob(): void {
  cron.schedule(CRON_CLEANUP_SCHEDULE, () => {
    void runNotesPurgePass();
  });
}
