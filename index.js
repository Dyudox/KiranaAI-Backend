// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db.js";
import authRouter from "./routes/authRoutes.js";
// import kbRouter from "./routes/kbRoutes.js";
import fileManagementRoutes from "./routes/fileManagementRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import routerRecording from "./routes/recordingRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";

dotenv.config();

// === POTONG KOMPAS JALUR .ENV YANG MACET ===
// Kita isi manual variabelnya di sini agar dibaca oleh seluruh controller backend
// process.env.DB_NAME = "forest";
// process.env.JWT_SECRET = "KiranaAHU_SuperSecretKey_2026";
// ===========================================

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Pasang Router
app.use("/api/auth", authRouter);
// app.use("/api", kbRoutes);
app.use("/api", fileManagementRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api", dashboardRoutes);
// app.use("/uploads", express.static("uploads"));
app.use(routerRecording);
// Main Route
app.get("/", (req, res) => {
  res.status(200).json({ message: "Welcome to the API server!" });
});

// Menjalankan Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
