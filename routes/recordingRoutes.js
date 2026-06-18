import express from "express";
import pool from "../config/db.js"; // Pastikan ekstensi .js ada dan path ke database PostgreSQL Anda benar
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

const routerRecording = express.Router();

// Karena menggunakan ES Modules, kita perlu mendefinisikan __dirname secara manual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pastikan folder khusus untuk audio hasil konversi sementara sudah otomatis dibuat
const tempDir = path.resolve(__dirname, "../uploads/audio_temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// =========================================================================
// 1. GET ALL RECORDINGS (Fetch data dengan Search & Filter)
// =========================================================================
routerRecording.get("/api/recordings", async (req, res) => {
  try {
    // 1. Ambil parameter pagination dari query string (serta filter yang lama)
    const { page = 1, limit = 10, search, setup_id, agent_name } = req.query;

    // Pastikan tipe data berupa angka bulat (integer)
    const bunderanLimit = parseInt(limit) || 10;
    const bunderanPage = parseInt(page) || 1;
    const offset = (bunderanPage - 1) * bunderanLimit;

    // 2. Siapkan kondisi WHERE dinamis (dipakai barengan oleh Query Data & Query Total)
    let whereClause = " WHERE 1=1";
    const queryParams = [];
    let paramIndex = 1;

    // Fitur Pencarian Global
    if (search) {
      whereClause += ` AND (file_name ILIKE $${paramIndex} OR summary ILIKE $${paramIndex})`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Filter Berdasarkan Kategori Setup ID
    if (setup_id) {
      whereClause += ` AND setup_id = $${paramIndex}`;
      queryParams.push(setup_id);
      paramIndex++;
    }

    // Filter Berdasarkan Nama Agent
    if (agent_name) {
      whereClause += ` AND agent_name = $${paramIndex}`;
      queryParams.push(agent_name);
      paramIndex++;
    }

    // 3. Susun Teks Query Utama (Ambil Data dengan Batasan LIMIT & OFFSET)
    const dataQueryText = `
      SELECT id, file_name, uid, created_at, result, setup_id, agent_name, transcript, summary, audio 
      FROM public.output 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${bunderanLimit} OFFSET ${offset}
    `;

    // 4. Susun Teks Query Total (Hitung total baris murni tanpa limitasi potongan)
    const countQueryText = `
      SELECT COUNT(*) 
      FROM public.output 
      ${whereClause}
    `;

    // 5. Eksekusi kedua query secara paralel agar menghemat waktu pemrosesan
    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQueryText, queryParams),
      pool.query(countQueryText, queryParams),
    ]);

    // Total baris utuh diekstrak dari object count Postgres (selalu bertipe string dari DB, konversi ke int)
    const totalItems = parseInt(countResult.rows[0].count) || 0;

    // 6. Kembalikan respon berformat standarisasi Server-Side
    return res.status(200).json({
      success: true,
      data: dataResult.rows, // Hanya berisi maksimal 10 data sesuai limit
      total: totalItems, // Angka total kumulatif untuk logic navigasi halaman frontend
    });
  } catch (error) {
    console.error("Error Fetching Recordings:", error.message);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server saat memuat data rekaman.",
    });
  }
});

// =========================================================================
// 2. GET AUDIO STREAM (Rute untuk memutar/streaming file audio ke frontend)
// =========================================================================
routerRecording.get("/api/recordings/audio/:id", async (req, res) => {
  try {
    const audioId = parseInt(req.params.id, 10);
    if (isNaN(audioId)) {
      return res
        .status(400)
        .json({ success: false, message: "ID rekaman tidak valid." });
    }

    // 1. Ambil nama file dari database
    const result = await pool.query(
      "SELECT file_name FROM public.output WHERE id = $1",
      [audioId],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }

    let audioFileName = result.rows[0].file_name.trim();

    // 2. Cek Ekstensi Asli File (wav atau ogg)
    const ext = path.extname(audioFileName).toLowerCase();

    // Jika di DB tidak ada ekstensinya, kita default-kan ke .wav
    // Tapi jika ada (.ogg / .wav), biarkan menggunakan ekstensi aslinya
    // if (!ext) {
    //   audioFileName = `${audioFileName}.wav`;
    // }
    if (!ext) {
      const pathWav = path.resolve(
        __dirname,
        "../uploads/audio",
        `${audioFileName}.wav`,
      );
      const pathOgg = path.resolve(
        __dirname,
        "../uploads/audio",
        `${audioFileName}.ogg`,
      );

      if (fs.existsSync(pathWav)) {
        audioFileName = `${audioFileName}.wav`;
      } else if (fs.existsSync(pathOgg)) {
        audioFileName = `${audioFileName}.ogg`;
      } else {
        // Fallback jika dua-duanya tidak ada di folder, biarkan .wav agar memicu error 404 nanti
        audioFileName = `${audioFileName}.wav`;
      }
    }

    const audioFilePath = path.resolve(
      __dirname,
      "../uploads/audio",
      audioFileName,
    );

    if (!fs.existsSync(audioFilePath)) {
      return res.status(404).json({
        success: false,
        message: `Fisik berkas audio (${audioFileName}) tidak ditemukan di storage server.`,
      });
    }

    // 3. Tentukan Target Format Output & Content-Type untuk FFmpeg
    // Kita ganti nama file temp-nya menjadi format .wav standar PCM agar WaveSurfer selalu lancar membaca data wave-nya
    const targetFileName = `clean_${path.basename(audioFileName, ext)}.wav`;
    const tempAudioPath = path.join(tempDir, targetFileName);

    // KUNCI UTAMA: Jika file temp hasil konversinya sudah ada, langsung sendFile!
    if (fs.existsSync(tempAudioPath)) {
      return res.sendFile(tempAudioPath);
    }

    // 4. Proses Konversi Kilat Menggunakan FFmpeg (Bisa menerima input .wav maupun .ogg)
    ffmpeg(audioFilePath)
      .toFormat("wav")
      .audioCodec("pcm_s16le")
      .audioFrequency(8000)
      .audioChannels(1)
      .on("end", () => {
        if (fs.existsSync(tempAudioPath)) {
          // res.sendFile otomatis menangani 'Accept-Ranges: bytes' yang dibutuhkan oleh WaveSurfer Region/Drag Selection
          res.sendFile(tempAudioPath);
        }
      })
      .on("error", (err) => {
        console.error("FFmpeg Conversion Error:", err.message);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "Gagal memproses berkas pemutar audio.",
          });
        }
      })
      .save(tempAudioPath);
  } catch (error) {
    console.error("🔴 Error Streaming Audio Server:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Terjadi kesalahan internal server.",
      });
    }
  }
});

// =========================================================================
// OOT: LOGIKA PEMBERSIHAN OTOMATIS (FUNGSI PENJAGA HARDDISK)
// Menghapus file di folder audio_temp yang umurnya sudah lebih dari 2 jam setiap malam
// =========================================================================
setInterval(() => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    const sekarang = Date.now();
    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        // 2 jam = 2 * 60 * 60 * 1000 milidetik
        if (sekarang - stats.mtimeMs > 7200000) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 3600000); // Diperiksa berkala setiap 1 jam sekali

export default routerRecording;
