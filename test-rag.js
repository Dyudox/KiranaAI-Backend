// backend/test-rag.js
import { queryKnowledgeBase } from "./controllers/kbController.js";
import pool from "./config/db.js";

async function jalankanSimulasiChat() {
  try {
    console.log("=== SIMULASI CHATBOT KIRANA AI (RAG LOKAL) ===");

    // Pertanyaan tiruan dari user seputar Ditjen AHU
    const pertanyaanUser = "Bagaimana syarat pendirian PT Biasa?";
    console.log(`\nUser Bertanya: "${pertanyaanUser}"`);

    console.log(
      "\n⏳ Memulai pencarian dokumen di database PostgreSQL 'forest'...",
    );
    console.log(
      "⏳ Mengonversi pertanyaan menjadi vektor menggunakan Transformers.js...",
    );

    // Panggil fungsi pencarian pintar yang kemarin kita buat
    const hasilSontekan = await queryKnowledgeBase(pertanyaanUser, 3);

    console.log("\n================ HASIL VECTOR SEARCH ================");
    if (hasilSontekan.length === 0) {
      console.log(
        "❌ Tidak ditemukan dokumen regulasi yang cocok di database.",
      );
      console.log(
        "💡 Tip: Kolom embedding kamu mungkin masih kosong. Silakan upload PDF terlebih dahulu!",
      );
    } else {
      console.log(
        `✅ Berhasil menemukan ${hasilSontekan.length} potongan dokumen paling relevan:\n`,
      );

      hasilSontekan.forEach((dokumen, index) => {
        console.log(
          `[Sumber #${index + 1}] (Skor Kemiripan: ${(dokumen.score * 100).toFixed(2)}%)`,
        );
        console.log(`Isi Teks: "${dokumen.content}"`);
        console.log("-".repeat(50));
      });
    }
    console.log("=====================================================");
  } catch (error) {
    console.error("Terjadi error saat simulasi:", error);
  } finally {
    // Tutup koneksi database agar skrip selesai dengan rapi
    await pool.end();
    process.exit(0);
  }
}

jalankanSimulasiChat();
