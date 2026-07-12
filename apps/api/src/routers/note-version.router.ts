import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as noteVersionController from "../controllers/note-version.controller.js";

const router: RouterType = Router({ mergeParams: true });

router.get("/", noteVersionController.list);
router.get("/:versionId", noteVersionController.getById);
router.post(
  `/:versionId${API_PATHS.NOTES.RESTORE}`,
  noteVersionController.restore,
);

export default router;
