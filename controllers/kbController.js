// backend/controllers/kbController.js
import pool from "../config/db.js";
import { cosineSimilarity } from "../src/utils/vectorUtils.js";
import { getKiranaEmbedding } from "../src/utils/kiranaAiService.js";
import * as xlsx from "xlsx";
import pdfParse from "pdf-parse-fork";
import fs from "fs";
import path from "path";

// Fungsi pembantu memotong teks menjadi chunk
const chunkText = (text, maxLength = 500) => {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxLength) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
};

// 1. TAMPILKAN DATA TABEL & STATISTIK
export const getFilesAndStats = async (req, res) => {
  try {
    const { search, file_type } = req.query;
    let fileQuery = `SELECT * FROM public.kb_documents WHERE 1=1`;
    const queryParams = [];
    let paramIndex = 1;

    if (search) {
      fileQuery += ` AND filename ILIKE $${paramIndex}`;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }
    if (file_type) {
      fileQuery += ` AND (file_type ILIKE $${paramIndex} OR filename ILIKE $${paramIndex})`;
      queryParams.push(`%${file_type}%`);
      paramIndex++;
    }

    fileQuery += ` ORDER BY created_at DESC`;
    const filesResult = await pool.query(fileQuery, queryParams);

    const formattedFiles = filesResult.rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      file_type: row.filename.toLowerCase().endsWith(".pdf") ? "pdf" : "xlsx",
      file_size: parseInt(row.file_size || 0),
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
      access_type: row.access_type || "RW",
      is_kb_loaded: row.status === "ready",
    }));

    const statsQuery = `
      SELECT 
        COUNT(*)::int AS total_file,
        COALESCE(SUM(file_size), 0)::bigint AS total_size,
        COUNT(CASE WHEN filename ILIKE '%.pdf' THEN 1 END)::int AS total_pdf,
        COUNT(CASE WHEN filename ILIKE '%.xlsx' OR filename ILIKE '%.xls' THEN 1 END)::int AS total_excel
      FROM public.kb_documents;
    `;
    const statsResult = await pool.query(statsQuery);
    return res.status(200).json({
      success: true,
      files: formattedFiles,
      statistics: statsResult.rows[0] || {
        total_file: 0,
        total_size: 0,
        total_pdf: 0,
        total_excel: 0,
      },
    });
  } catch (error) {
    console.error("💥 Error pada getFilesAndStats:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};

// 2. DETEKSI OTOMATIS UPLOAD (PDF / EXCEL)
export const uploadFile = async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ message: "Mohon unggah file terlebih dahulu." });

  const { originalname, size, path: filePath } = req.file; // 'path' didapat jika multer menggunakan diskStorage

  try {
    // Bersihkan riwayat lama dengan nama yang sama
    await pool.query(
      `DELETE FROM kb_document_chunks WHERE document_id IN (SELECT id FROM kb_documents WHERE filename = $1)`,
      [originalname],
    );
    await pool.query("DELETE FROM kb_documents WHERE filename = $1", [
      originalname,
    ]);

    // Simpan data induk dengan status 'queued' (Antrean)
    // Kita simpan lokasi file fisiknya di kolom file_type atau buat kolom baru (sementara kita simpan di file_type atau logs)
    const docResult = await pool.query(
      `INSERT INTO kb_documents (filename, file_type, file_size, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [originalname, filePath, size, "queued"], // Menyimpan path file di kolom file_type untuk dibaca nanti
    );

    return res.status(200).json({
      success: true,
      message: `Berkas '${originalname}' berhasil masuk antrean! Silakan klik 'Load ke KB' saat traffic sepi untuk memproses embedding.`,
      documentId: docResult.rows[0].id,
    });
  } catch (error) {
    console.error("💥 Error saat upload ke antrean:", error.message);
    return res
      .status(500)
      .json({ message: "Gagal memasukkan berkas ke antrean." });
  }
};

// PROCESS PDF
const uploadAndProcessPDF = async (req, res) => {
  let documentId = null;
  try {
    const { originalname, size, buffer, mimetype } = req.file;
    await pool.query(
      `DELETE FROM kb_document_chunks WHERE document_id IN (SELECT id FROM kb_documents WHERE filename = $1)`,
      [originalname],
    );
    await pool.query("DELETE FROM kb_documents WHERE filename = $1", [
      originalname,
    ]);

    const docResult = await pool.query(
      `INSERT INTO kb_documents (filename, file_type, file_size, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [originalname, mimetype, size, "processing"],
    );
    documentId = docResult.rows[0].id;

    const pdfData = await pdfParse(buffer);
    let pageSegments = pdfData.text.split(/\f/);
    if (pageSegments.length <= 1 && pdfData.numpages > 1) {
      pageSegments = [];
      const charsPerPage = Math.ceil(pdfData.text.length / pdfData.numpages);
      for (let p = 0; p < pdfData.numpages; p++) {
        pageSegments.push(
          pdfData.text.substring(
            p * charsPerPage,
            Math.min((p + 1) * charsPerPage, pdfData.text.length),
          ),
        );
      }
    }

    const chunkInsertQuery = `INSERT INTO kb_document_chunks (document_id, content, embedding, page_number) VALUES ($1, $2, $3, $4);`;
    let totalPdfChunks = 0;

    for (let index = 0; index < pageSegments.length; index++) {
      const pageText = pageSegments[index];
      if (!pageText || !pageText.trim()) continue;

      const pageChunks = chunkText(pageText.replace(/\s+/g, " "), 500);
      for (const contentChunk of pageChunks) {
        if (contentChunk.trim().length > 10) {
          try {
            totalPdfChunks++;
            console.log(
              `⏳ [PDF Hal ${index + 1}] Memproses embedding chunk-${totalPdfChunks}...`,
            );
            const vectorEmbedding = await getKiranaEmbedding(contentChunk);
            if (vectorEmbedding && Array.isArray(vectorEmbedding)) {
              await pool.query(chunkInsertQuery, [
                documentId,
                contentChunk,
                `{${vectorEmbedding.join(",")}}`,
                index + 1,
              ]);
            }
          } catch (err) {
            totalPdfChunks--;
          }
        }
      }
    }
    await pool.query("UPDATE kb_documents SET status = $1 WHERE id = $2", [
      "ready",
      documentId,
    ]);
    return res
      .status(200)
      .json({ success: true, message: "PDF berhasil di-load!" });
  } catch (error) {
    if (documentId)
      await pool.query("UPDATE kb_documents SET status = $1 WHERE id = $2", [
        "failed",
        documentId,
      ]);
    return res
      .status(500)
      .json({ message: "Gagal memproses PDF.", error: error.message });
  }
};

// PROCESS EXCEL
const uploadAndProcessExcel = async (req, res) => {
  let documentId = null;
  try {
    const { originalname, size, buffer } = req.file;
    await pool.query(
      `DELETE FROM kb_document_chunks WHERE document_id IN (SELECT id FROM kb_documents WHERE filename = $1)`,
      [originalname],
    );
    await pool.query("DELETE FROM kb_documents WHERE filename = $1", [
      originalname,
    ]);

    const docResult = await pool.query(
      `INSERT INTO kb_documents (filename, file_type, file_size, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [originalname, "xlsx", size, "processing"],
    );
    documentId = docResult.rows[0].id;

    console.log("⏳ Memulai ekstraksi data dari Excel menggunakan xlsx...");
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
    );

    if (rows.length === 0) {
      await pool.query("UPDATE kb_documents SET status = $1 WHERE id = $2", [
        "failed",
        documentId,
      ]);
      return res.status(400).json({ message: "File Excel kosong." });
    }

    const chunkInsertQuery = `INSERT INTO kb_document_chunks (document_id, content, embedding, row_number) VALUES ($1, $2, $3, $4);`;
    let totalExcelChunks = 0;
    let excelRowIndex = 2;

    for (const row of rows) {
      const topic = row.topic || "";
      const category = row.category || "";
      const subcategory = row.subcategory || "";
      const detailCategory = row.detail_category || "";
      const question = row.question || "";
      const answer = row.answer || "";

      const rowTextContext =
        `Topik: ${topic}. Kategori: ${category} ${subcategory} ${detailCategory}. Pertanyaan: ${question}. Jawaban Data: ${answer}`
          .replace(/\s+/g, " ")
          .trim();

      if (rowTextContext.length > 20 && (question.trim() || answer.trim())) {
        try {
          console.log(
            `⏳ [Excel Baris ${excelRowIndex}] Memproses embedding...`,
          );
          const vectorEmbedding = await getKiranaEmbedding(rowTextContext);

          if (vectorEmbedding && Array.isArray(vectorEmbedding)) {
            // 👉 FIXED PARAMS QUANTITY: Mengirim tepat 4 parameter ($1 s/d $4)
            await pool.query(chunkInsertQuery, [
              parseInt(documentId),
              rowTextContext,
              `{${vectorEmbedding.join(",")}}`,
              excelRowIndex,
            ]);
            totalExcelChunks++;
          }
        } catch (rowErr) {
          console.error(`💥 Error baris ${excelRowIndex}:`, rowErr.message);
        }
      }
      excelRowIndex++;
    }

    await pool.query("UPDATE kb_documents SET status = $1 WHERE id = $2", [
      "ready",
      documentId,
    ]);
    console.log(
      `✅ Sukses besar! Berhasil memasukkan ${totalExcelChunks} baris data ke database.`,
    );
    return res.status(200).json({
      success: true,
      message: "Excel berhasil masuk KB!",
      totalChunks: totalExcelChunks,
    });
  } catch (error) {
    if (documentId)
      await pool.query("UPDATE kb_documents SET status = $1 WHERE id = $2", [
        "failed",
        documentId,
      ]);
    return res
      .status(500)
      .json({ message: "Gagal memproses Excel.", error: error.message });
  }
};

// ==========================================================================
// 3. FUNGSI LOAD KE KB (MENDUKUNG EXCEL & PDF DI BACKGROUND)
// ==========================================================================
export const loadExistingFileToKB = async (req, res) => {
  const { file_ids } = req.body;
  if (!file_ids || file_ids.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Tidak ada berkas yang dipilih." });
  }

  const targetId = parseInt(file_ids[0]);

  try {
    const docCheck = await pool.query(
      "SELECT filename, file_type FROM public.kb_documents WHERE id = $1",
      [targetId],
    );
    if (docCheck.rows.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Data berkas tidak ditemukan di database.",
        });
    }

    const { filename, file_type: savedFilePath } = docCheck.rows[0];

    if (!fs.existsSync(savedFilePath)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "File fisik sudah terhapus di server. Silakan upload ulang.",
        });
    }

    // Ubah status jadi 'processing' agar frontend tahu server sedang bekerja
    await pool.query(
      "UPDATE public.kb_documents SET status = $1 WHERE id = $2",
      ["processing", targetId],
    );

    res.status(200).json({
      success: true,
      message: `Proses ekstraksi riil untuk '${filename}' berjalan di background server.`,
    });

    // JALANKAN PROSES BERAT DI BACKGROUND
    setImmediate(async () => {
      try {
        console.log(`📥 [Background] Mulai membaca file fisik: ${filename}`);
        const buffer = fs.readFileSync(savedFilePath);
        let totalChunksCreated = 0;

        // ------------------------------------------------------------------
        // JALUR A: MEMPROSES FILE EXCEL
        // ------------------------------------------------------------------
        if (
          filename.toLowerCase().endsWith(".xlsx") ||
          filename.toLowerCase().endsWith(".xls")
        ) {
          const workbook = xlsx.read(buffer, { type: "buffer" });
          const rows = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook.SheetNames[0]],
          );
          const chunkInsertQuery = `INSERT INTO kb_document_chunks (document_id, content, embedding, row_number) VALUES ($1, $2, $3, $4);`;
          let excelRowIndex = 2;

          for (const row of rows) {
            const rowTextContext =
              `Topik: ${row.topic || ""}. Kategori: ${row.category || ""} ${row.subcategory || ""}. Pertanyaan: ${row.question || ""}. Jawaban Data: ${row.answer || ""}`
                .replace(/\s+/g, " ")
                .trim();

            if (rowTextContext.length > 20 && (row.question || row.answer)) {
              try {
                console.log(
                  `⏳ [Background Excel] Baris ${excelRowIndex} memproses embedding...`,
                );
                const vectorEmbedding =
                  await getKiranaEmbedding(rowTextContext);
                if (vectorEmbedding && Array.isArray(vectorEmbedding)) {
                  await pool.query(chunkInsertQuery, [
                    targetId,
                    rowTextContext,
                    `{${vectorEmbedding.join(",")}}`,
                    excelRowIndex,
                  ]);
                  totalChunksCreated++;
                }
              } catch (rowErr) {
                console.error(
                  `💥 Gagal baris ${excelRowIndex}:`,
                  rowErr.message,
                );
              }
            }
            excelRowIndex++;
          }
        }
        // ------------------------------------------------------------------
        // JALUR B: MEMPROSES FILE PDF (KODE BARU YANG AWALNYA KETINGGALAN)
        // ------------------------------------------------------------------
        else if (filename.toLowerCase().endsWith(".pdf")) {
          console.log(
            `⏳ [Background PDF] Memulai parsing teks dengan pdf-parse-fork...`,
          );
          const pdfData = await pdfParse(buffer);
          const fullText = pdfData.text || "";
          const totalPagesInPdf = pdfData.numpages || 1;

          if (!fullText.trim()) {
            throw new Error(
              "Teks PDF kosong. Kemungkinan file ini adalah hasil scan/gambar (butuh OCR).",
            );
          }

          // Pecah teks berdasarkan form feed halaman
          let pageSegments = fullText.split(/\f/);
          if (pageSegments.length <= 1 && totalPagesInPdf > 1) {
            pageSegments = [];
            const charsPerPage = Math.ceil(fullText.length / totalPagesInPdf);
            for (let p = 0; p < totalPagesInPdf; p++) {
              pageSegments.push(
                fullText.substring(
                  p * charsPerPage,
                  Math.min((p + 1) * charsPerPage, fullText.length),
                ),
              );
            }
          }

          const chunkInsertQuery = `INSERT INTO kb_document_chunks (document_id, content, embedding, page_number) VALUES ($1, $2, $3, $4);`;

          for (let index = 0; index < pageSegments.length; index++) {
            const pageText = pageSegments[index];
            if (!pageText || !pageText.trim()) continue;

            const pageChunks = chunkText(pageText.replace(/\s+/g, " "), 500); // fungsi chunkText yang ada di atas file Anda
            for (const contentChunk of pageChunks) {
              if (contentChunk.trim().length > 10) {
                try {
                  console.log(
                    `⏳ [Background PDF Hal ${index + 1}] Memproses embedding chunk...`,
                  );
                  const vectorEmbedding =
                    await getKiranaEmbedding(contentChunk);

                  if (vectorEmbedding && Array.isArray(vectorEmbedding)) {
                    await pool.query(chunkInsertQuery, [
                      targetId,
                      contentChunk,
                      `{${vectorEmbedding.join(",")}}`,
                      index + 1,
                    ]);
                    totalChunksCreated++;
                  }
                } catch (err) {
                  console.error(
                    `💥 Gagal insert chunk PDF halaman ${index + 1}:`,
                    err.message,
                  );
                }
              }
            }
          }
        }

        // Selesai dengan sukses
        await pool.query(
          "UPDATE public.kb_documents SET status = $1 WHERE id = $2",
          ["ready", targetId],
        );
        console.log(
          `✅ [Background Selesai] Berkas ID ${targetId} sukses memproses ${totalChunksCreated} chunks.`,
        );
      } catch (bgError) {
        await pool.query(
          "UPDATE public.kb_documents SET status = $1 WHERE id = $2",
          ["failed", targetId],
        );
        console.log(
          `💥 [Background Gagal] Error pada ID ${targetId}:`,
          bgError.message,
        );
      }
    });
  } catch (error) {
    console.error("💥 Error pada loadExistingFileToKB:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Gagal memproses background job." });
  }
};

// 4. HAPUS FILE (AMAN DARI FOREIGN KEY & DATA TYPE CONFLICT)
export const deleteFileKB = async (req, res) => {
  try {
    // Pastikan ID dikonversi ke Integer karena PostgreSQL menggunakan tipe data SERIAL/INT
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "ID berkas tidak valid." });
    }

    console.log(`🧹 Memulai proses hapus berkas ID: ${id}`);

    // 1. Cari tahu nama file dan path fisiknya terlebih dahulu sebelum dihapus
    const fileCheck = await pool.query(
      "SELECT filename, file_type FROM public.kb_documents WHERE id = $1",
      [id],
    );

    if (fileCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Berkas tidak ditemukan di database.",
      });
    }

    const { filename, file_type: filePath } = fileCheck.rows[0];

    // 2. HAPUS ANAKNYA TERLEBIH DAHULU (kb_document_chunks) untuk menghindari Foreign Key Error
    await pool.query(
      "DELETE FROM public.kb_document_chunks WHERE document_id = $1",
      [id],
    );
    console.log(`🗑️ Berhasil menghapus semua chunks untuk ${filename}`);

    // 3. HAPUS INDUKNYA (kb_documents)
    await pool.query("DELETE FROM public.kb_documents WHERE id = $1", [id]);
    console.log(`🗑️ Berhasil menghapus data dokumen ${filename} dari database`);

    // 4. HAPUS FILE FISIK DI FOLDER SERVER (Jika file fisiknya ada)
    if (filePath && typeof filePath === "string" && filePath.includes("/")) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(
            `📁 File fisik berhasil dihapus dari server: ${filePath}`,
          );
        }
      } catch (fsErr) {
        console.error(
          `⚠️ Gagal menghapus file fisik di server (tetap lanjut):`,
          fsErr.message,
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: `Berkas '${filename}' dan seluruh data KB-nya berhasil dihapus total.`,
    });
  } catch (error) {
    console.error("💥 Error total pada deleteFileKB:", error.message);
    return res.status(500).json({
      success: false,
      message: "Gagal mengeksekusi perintah hapus di database.",
    });
  }
};

// ==========================================================================
// 5. FUNGSI PENCARIAN UTAMA KNOWLEDGE BASE (UNTUK CHATBOT AI)
// ==========================================================================
export const queryKnowledgeBase = async (userQuery, limit = 5) => {
  try {
    const userVector = await getKiranaEmbedding(userQuery);

    const dbResult = await pool.query(`
      SELECT 
        c.id, 
        c.document_id,
        c.content, 
        c.embedding, 
        c.page_number, 
        c.row_number,
        d.filename
      FROM kb_document_chunks c
      LEFT JOIN kb_documents d ON c.document_id = d.id
      WHERE c.embedding IS NOT NULL
    `);

    const chunks = dbResult.rows;
    const scoredChunks = [];
    const keywords = userQuery
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 3);

    for (const chunk of chunks) {
      let chunkEmbedding = chunk.embedding;

      if (typeof chunkEmbedding === "string") {
        chunkEmbedding = chunkEmbedding
          .replace(/{|}/g, "")
          .split(",")
          .map(Number);
      }

      if (
        Array.isArray(chunkEmbedding) &&
        chunkEmbedding.length === userVector.length
      ) {
        let score = cosineSimilarity(userVector, chunkEmbedding);

        const lowerContent = chunk.content.toLowerCase();
        let matchCount = 0;
        for (const kw of keywords) {
          if (lowerContent.includes(kw)) matchCount++;
        }
        if (matchCount > 0) {
          score += matchCount * 0.05;
        }

        scoredChunks.push({
          id: chunk.id,
          document_id: chunk.document_id,
          content: chunk.content,
          score: score,
          page_number: chunk.page_number,
          row_number: chunk.row_number,
          filename: chunk.filename,
        });
      }
    }

    scoredChunks.sort((a, b) => b.score - a.score);
    return scoredChunks.slice(0, limit);
  } catch (error) {
    console.error("Error saat mencari di Knowledge Base:", error);
    return [];
  }
};

// ==========================================================================
// 6. FUNGSI DOWNLOAD BERKAS FISIK (ANTI-CACHE & LEBIH AMAN)
// ==========================================================================

export const downloadFileKB = async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "ID berkas tidak valid." });
    }

    console.log(`📥 Menerima permintaan download untuk ID berkas: ${id}`);

    // 1. Cari info file di database
    const fileResult = await pool.query(
      "SELECT filename, file_type FROM public.kb_documents WHERE id = $1",
      [id],
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Berkas tidak ditemukan di database.",
      });
    }

    const { filename, file_type: filePath } = fileResult.rows[0];
    console.log(`📁 Lokasi file terdaftar di database: ${filePath}`);

    // 2. Cek apakah file fisiknya benar-benar ada di server
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`💥 File fisik TIDAK ADA di server: ${filePath}`);
      return res.status(404).json({
        success: false,
        message: `File fisik '${filename}' tidak ditemukan di server. Kemungkinan terhapus atau Anda menggunakan sistem RAM/MemoryStorage yang lama.`,
      });
    }

    // 3. PAKSA BROWSER UNTUK TIDAK MENGGUNAKAN CACHE (Mengatasi Error 304 Not Modified)
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    // 4. Kirim file sebagai unduhan murni
    return res.download(filePath, filename, (err) => {
      if (err) {
        console.error("💥 Gagal mentransfer file ke browser:", err.message);

        // Cek jika koneksi belum terputus, kirim status error JSON murni
        if (!res.headersSent) {
          return res.status(500).json({
            success: false,
            message: "Gagal mengunduh berkas dari server.",
          });
        }
      } else {
        console.log(`✅ Berkas '${filename}' sukses terdownload oleh user.`);
      }
    });
  } catch (error) {
    console.error("💥 Error fatal pada fungsi downloadFileKB:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Internal Server Error pada sistem unduh.",
      });
    }
  }
};
