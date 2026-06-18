// backend/src/utils/kiranaAiService.js
import { pipeline } from "@xenova/transformers";

let embeddingPipeline = null;

// Fungsi privat untuk memastikan model AI hanya di-download/di-load sekali saja ke memori RAM
async function getPipeline() {
  if (!embeddingPipeline) {
    console.log(
      "⏳ Sedang memuat Model AI Embedding Lokal (Xenova/all-MiniLM-L6-v2)...",
    );
    // Model ini berukuran kecil (~90MB), otomatis terunduh saat pertama kali dijalankan
    embeddingPipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
    console.log("✅ Model AI Embedding Lokal SIAP DIGUNAKAN!");
  }
  return embeddingPipeline;
}

/**
 * Fungsi untuk mengubah teks (PDF/Pertanyaan) menjadi Array Vektor Angka Nyata
 * @param {string} text - Teks mentah
 * @returns {Promise<Array<number>>} - Array angka berdimensi 384
 */
export const getKiranaEmbedding = async (text) => {
  try {
    const generateEmbedding = await getPipeline();

    // Proses teks menjadi vektor koordinat AI
    const output = await generateEmbedding(text, {
      pooling: "mean",
      normalize: true,
      model: "qwen2.5:1.5b", // Pastikan nama model ini sama dengan yang Anda gunakan sebelumnya
      prompt: text,
    });

    // Ubah format output object tensor menjadi array vanilla JavaScript angka biasa
    const embeddingArray = Array.from(output.data);
    return embeddingArray;
  } catch (error) {
    console.error("Gagal membuat embedding lokal:", error);
    // Fallback jika ada kendala teknis (array 384 dimensi)
    return Array.from({ length: 1536 }, () => 0.0);
  }
};
