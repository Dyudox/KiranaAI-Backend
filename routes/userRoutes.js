import express from "express";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/userController.js";
import { MENU } from "../constants/menuKeys.js";
import { checkPermission } from "../middlewares/checkPermission.js";
import { authenticateToken } from "../middlewares/auth.js"; // Pastikan diimpor

const router = express.Router();

// Semua rute di bawah ini wajib login
router.use(authenticateToken);

// Proteksi dengan checkPermission
router.get("/", checkPermission(MENU.USERS, "can_read"), getUsers);
router.post("/", checkPermission(MENU.USERS, "can_create"), createUser);
router.put("/:id", checkPermission(MENU.USERS, "can_update"), updateUser);
router.delete("/:id", checkPermission(MENU.USERS, "can_delete"), deleteUser);

export default router;
