import { Router, type Router as RouterType } from "express";
import * as shareController from "../controllers/share.controller.js";

const router: RouterType = Router({ mergeParams: true });

router.post("/", shareController.create);
router.get("/", shareController.getActive);
router.delete("/", shareController.revoke);

export default router;
