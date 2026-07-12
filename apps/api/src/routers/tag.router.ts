import { Router, type Router as RouterType } from "express";
import * as tagController from "../controllers/tag.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";

const router: RouterType = Router();

router.use(requireAuth);

router.post("/", tagController.create);
router.get("/", tagController.list);
router.patch("/:id", tagController.update);
router.delete("/:id", tagController.remove);

export default router;
