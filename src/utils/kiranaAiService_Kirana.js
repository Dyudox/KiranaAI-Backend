// backend/src/utils/kiranaAiService.js
import axios from "axios";

// Alamat URL API lokal Kirana AI milikmu (silakan sesuaikan port/jalurnya jika berbeda)
const KIRANA_AI_URL = "http://localhost:8000/v1/embeddings";

/**
 * Fungsi untuk meminta koordinat vektor (embedding) dari teks ke Kirana AI lokal
 * @param {string} text - Teks mentah regulasi atau pertanyaan user
 * @returns {Promise<Array<number>>} - Array angka vektor (misal dimensi 1536 atau sesuai modelmu)
 */
export const getKiranaEmbedding = async (text) => {
  try {
    // Sesuaikan format 'payload JSON' ini dengan spesifikasi API Kirana AI lokalmu
    const response = await axios.post(
      KIRANA_AI_URL,
      {
        input: text,
        model: "text-embedding-3-small", // sesuaikan nama model jika Kirana AI punya nama model sendiri
      },
      {
        headers: {
          "Content-Type": "application/json",
          // "Authorization": "Bearer KEY_KAMU" // Buka baris ini jika Kirana AI lokalmu pakai token pengaman
        },
      },
    );

    // Menyesuaikan pengambilan data array vektornya (biasanya response.data.data[0].embedding)
    return response.data.data[0].embedding;
  } catch (error) {
    console.error("Gagal mendapatkan embedding dari Kirana AI:", error.message);
    // Jika API lokal belum siap atau error, return array dummy dulu agar server tidak crash
    return Array.from({ length: 1536 }, () => Math.random());
  }
};
