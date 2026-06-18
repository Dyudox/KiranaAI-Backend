// backend/routes/authRoutes.js
import express from "express";
import {
  register,
  login,
  getMyPermissions,
} from "../controllers/authController.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = express.Router();

// Menghubungkan ke http://localhost:5000/api/auth/register
router.post("/register", register);

// Menghubungkan ke http://localhost:5000/api/auth/login
router.post("/login", login);

router.get("/my-permissions", authenticateToken, getMyPermissions);

export default router;
