import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as noteController from "../controllers/note.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";

const router: RouterType = Router();

router.use(requireAuth);

router.post("/", noteController.create);
router.get("/:id", noteController.getById);
router.patch("/:id", noteController.update);
router.delete("/:id", noteController.softDelete);
router.post(`/:id${API_PATHS.NOTES.RESTORE}`, noteController.restore);
router.delete(
  `/:id${API_PATHS.NOTES.PERMANENT}`,
  noteController.permanentDelete,
);

export default router;
