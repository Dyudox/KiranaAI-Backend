// backend/src/routes/chatRoutes.js
import express from "express";
import {
  handleKiranaChat,
  getAllSessions,
  getChatHistoryResponse,
  renameSessionTitle,
  deleteChatSession,
  handleChatFeedback,
} from "../controllers/chatController.js";

const router = express.Router();

// Route untuk menerima chat dari user
router.post("/message", handleKiranaChat);

// Jika pakai middleware: router.get('/sessions', verifyToken, getAllSessions);
router.get("/sessions", getAllSessions);

// Endpoint baru untuk mengambil riwayat chat berdasarkan Sesi
router.get("/history/:sessionId", getChatHistoryResponse);

// Route baru untuk mengubah judul pertanyaan pertama pada sesi tertentu
router.put("/session/:sessionId", renameSessionTitle);

// Route baru untuk menghapus satu sesi chat utuh beserta seluruh isinya
router.delete("/session/:sessionId", deleteChatSession);

// Route baru untuk mengirimkan feedback
router.post("/feedback", handleChatFeedback);

export default router;
