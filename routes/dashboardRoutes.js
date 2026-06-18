// routes/dashboardRoutes.js
import express from "express";
import {
  getStats,
  getChartData,
  getRecentActivities,
} from "../controllers/dashboardController.js";

const routerDashboard = express.Router();

routerDashboard.get("/dashboard/stats", getStats);
routerDashboard.get("/dashboard/chart", getChartData);
routerDashboard.get("/dashboard/recent", getRecentActivities); // 🌟 Jalur baru untuk aktivitas terbaru

export default routerDashboard;
