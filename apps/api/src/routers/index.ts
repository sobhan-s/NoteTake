import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import authRouter from "./auth.router.js";
import noteRouter from "./note.router.js";
import tagRouter from "./tag.router.js";

const router: RouterType = Router();

router.use(API_PATHS.BASE + API_PATHS.AUTH.ROOT, authRouter);
router.use(API_PATHS.BASE + API_PATHS.NOTES.ROOT, noteRouter);
router.use(API_PATHS.BASE + API_PATHS.TAGS.ROOT, tagRouter);

export default router;
