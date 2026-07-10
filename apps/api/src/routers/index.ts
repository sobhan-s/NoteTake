import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import authRouter from "./auth.router.js";

const router: RouterType = Router();

router.use(API_PATHS.BASE + API_PATHS.AUTH.ROOT, authRouter);

export default router;
