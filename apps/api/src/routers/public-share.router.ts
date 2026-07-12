import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as publicShareController from "../controllers/public-share.controller.js";

const router: RouterType = Router();

router.get(
  `${API_PATHS.PUBLIC.SHARE}/:token`,
  publicShareController.getByToken,
);

export default router;
