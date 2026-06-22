import express from "express";
import {
  getAIConfig,
  updateAIConfig,
} from "../controllers/aiConfigController.js";

const router = express.Router();

// Route untuk manajemen konfigurasi AI
router.get("/ai-config", getAIConfig);
router.put("/ai-config", updateAIConfig);

export default router;
