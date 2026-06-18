// backend/routes/kbRoutes.js
import express from "express";
import upload from "../middlewares/uploadMiddleware.js"; // Middleware multer/memory Anda
import * as kbController from "../controllers/kbController.js";

const router = express.Router();

// Menampilkan data tabel & statistik file KB
router.get("/files", kbController.getFilesAndStats);

// Tombol proses ulang / load data eksisting
router.post("/files/load-to-kb", kbController.loadExistingFileToKB);

// Mengunggah file baru (Otomatis mendeteksi PDF / Excel di dalam controller)
router.post("/files/upload", upload.single("file"), kbController.uploadFile);

// Fitur hapus berkas (Cascade)
router.delete("/files/delete/:id", kbController.deleteFileKB);

// Fitur download berkas
router.get("/files/download/:id", kbController.downloadFileKB);

export default router;
