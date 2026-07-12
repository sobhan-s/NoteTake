import { Router, type Router as RouterType } from "express";
import * as searchController from "../controllers/search.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";

const router: RouterType = Router();

router.use(requireAuth);
router.get("/", searchController.search);

export default router;
