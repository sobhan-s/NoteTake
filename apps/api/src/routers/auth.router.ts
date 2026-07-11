import { Router, type Router as RouterType } from "express";
import { API_PATHS } from "@shared/core/constants";
import * as authController from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/require-auth.middleware.js";
import { checkLoginRateLimit } from "../middlewares/check-login-rate-limit.middleware.js";

const router: RouterType = Router();

router.post(API_PATHS.AUTH.REGISTER, authController.register);
router.post(API_PATHS.AUTH.VERIFY_OTP, authController.verifyOtp);
router.post(API_PATHS.AUTH.RESEND_OTP, authController.resendOtp);
router.post(API_PATHS.AUTH.FORGOT_PASSWORD, authController.forgotPassword);
router.post(API_PATHS.AUTH.RESET_PASSWORD, authController.resetPassword);
router.post(API_PATHS.AUTH.LOGIN, checkLoginRateLimit, authController.login);
router.post(API_PATHS.AUTH.REFRESH, authController.refresh);
router.post(API_PATHS.AUTH.LOGOUT, requireAuth, authController.logout);
router.get(API_PATHS.AUTH.ME, requireAuth, authController.me);

export default router;
