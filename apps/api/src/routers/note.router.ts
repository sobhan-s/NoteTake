import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as noteController from "../controllers/note.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";
import noteVersionRouter from "./note-version.router.js";
import shareRouter from "./share.router.js";

const router: RouterType = Router();

router.use(requireAuth);

router.post("/", noteController.create);
router.get(API_PATHS.NOTES.TRASH, noteController.listTrash);
router.get("/", noteController.list);
router.get("/:id", noteController.getById);
router.patch("/:id", noteController.update);
router.delete("/:id", noteController.softDelete);
router.post(`/:id${API_PATHS.NOTES.RESTORE}`, noteController.restore);
router.delete(
  `/:id${API_PATHS.NOTES.PERMANENT}`,
  noteController.permanentDelete,
);
router.use(`/:id${API_PATHS.NOTES.SHARE}`, shareRouter);
router.use(`/:id${API_PATHS.NOTES.VERSIONS}`, noteVersionRouter);

export default router;
