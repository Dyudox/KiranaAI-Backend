import express from "express";
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  updateRolePermissions,
} from "../controllers/roleController.js";
import { authenticateToken } from "../middlewares/auth.js";
import { MENU } from "../constants/menuKeys.js";
import { checkPermission } from "../middlewares/checkPermission.js";

const router = express.Router();

// Middleware autentikasi
router.use(authenticateToken);

// Rute menggunakan konstanta MENU.ROLES
router.get("/", checkPermission(MENU.ROLES, "can_read"), getRoles);
router.post("/", checkPermission(MENU.ROLES, "can_create"), createRole);
router.put("/:id", checkPermission(MENU.ROLES, "can_update"), updateRole);
router.delete("/:id", checkPermission(MENU.ROLES, "can_delete"), deleteRole);

// TAMBAHKAN RUTE INI DI BAWAHNYA:
router.get(
  "/permissions/:id",
  checkPermission(MENU.ROLES, "can_read"),
  getRolePermissions,
);
router.put(
  "/permissions/:id",
  checkPermission(MENU.ROLES, "can_update"),
  updateRolePermissions,
);

export default router;
