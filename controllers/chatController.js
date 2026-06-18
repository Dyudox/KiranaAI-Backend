// backend/controllers/chatController.js
import pool from "../config/db.js";
import { cosineSimilarity } from "../src/utils/vectorUtils.js";
import { getKiranaEmbedding } from "../src/utils/kiranaAiService.js";
import ollama from "ollama";

// =========================================================================
// HELPER FUNCTIONS (MANAJEMEN RIWAYAT CHAT)
// =========================================================================
const getChatHistoryBySession = async (sessionId, limit = 5) => {
  try {
    const result = await pool.query(
      `SELECT sender, message FROM chat_histories 
       WHERE session_id = $1 
       ORDER BY created_at DESC LIMIT $2`,
      [sessionId, limit],
    );
    return result.rows.reverse();
  } catch (error) {
    console.error("Gagal mengambil riwayat chat:", error);
    return [];
  }
};

const saveChatMessage = async (sessionId, sender, message, userId) => {
  try {
    await pool.query(
      `INSERT INTO chat_histories (session_id, sender, message, user_id) 
       VALUES ($1, $2, $3, $4)`,
      [sessionId, sender, message, userId], // 👈 Murni menggunakan ID dari session login
    );
  } catch (error) {
    console.error("Gagal menyimpan pesan ke database:", error);
  }
};

// =========================================================================
// CONTROLLER UTAMA
// =========================================================================

export const handleKiranaChat = async (req, res) => {
  try {
    const { message, sessionId, userId } = req.body;

    console.log(
      `[Chat masuk] Sesi: ${sessionId}, User: ${userId}, Pesan: ${message}`,
    );

    if (!message) {
      return res.status(400).json({ message: "Pesan tidak boleh kosong." });
    }

    const activeSessionId = sessionId || "default-session-local";
    console.log(`\n💬 Chat Masuk [Sesi: ${activeSessionId}]: "${message}"`);

    const finalUserId = userId || 1;

    await saveChatMessage(activeSessionId, "user", message, finalUserId);

    const historyRows = await getChatHistoryBySession(activeSessionId, 5);
    const formattedHistory = historyRows
      .map(
        (chat) =>
          `${chat.sender === "user" ? "User" : "KiranaAI"}: ${chat.message}`,
      )
      .join("\n");

    console.log("⏳ Menyisir database regulasi dengan teknik Vector Search...");
    const contextChunks = await queryKnowledgeBase(message, 6);

    const documentContext = contextChunks
      .map((chunk, index) => `DATA REFERENSI #${index + 1}:\n${chunk.content}`)
      .join("\n\n-------------------------\n\n");

    console.log(
      `✅ Berhasil menemukan ${contextChunks.length} potongan regulasi.`,
    );

    // =========================================================================
    // 🌟 PERBAIKAN: EKSTRAKSI SEMUA SUMBER DOKUMEN (TERMASUK PDF Halaman)
    // =========================================================================
    const sourceMap = {};

    for (const chunk of contextChunks) {
      const filename = chunk.filename || "Dokumen_Internal";

      // Inisialisasi object untuk file baru
      if (!sourceMap[filename]) {
        sourceMap[filename] = {
          pages: [],
          rows: [],
        };
      }

      // Kelompokkan halaman (PDF) atau baris (Excel)
      if (chunk.page_number) {
        sourceMap[filename].pages.push(chunk.page_number);
      } else if (chunk.row_number) {
        sourceMap[filename].rows.push(chunk.row_number);
      }
    }

    // Ubah data object di atas menjadi array string yang rapi
    const sourceList = Object.keys(sourceMap).map((filename) => {
      const data = sourceMap[filename];

      // Ambil nilai unik dan urutkan dari angka terkecil ke terbesar
      const uniquePages = [...new Set(data.pages)].sort((a, b) => a - b);
      const uniqueRows = [...new Set(data.rows)].sort((a, b) => a - b);

      if (uniquePages.length > 0) {
        return `${filename} [hal: ${uniquePages.join(", ")}]`;
      } else if (uniqueRows.length > 0) {
        return `${filename} [baris: ${uniqueRows.join(", ")}]`;
      } else {
        return filename;
      }
    });

    const strictSystemInstruction = `
      Kamu adalah Kirana AI. Kamu adalah asisten informasi yang sangat rapi.
      Setiap kali menjawab pertanyaan tentang lokasi, jadwal, atau prosedur, ikuti aturan format ini:
      
      - Gunakan Heading ### untuk kategori utama.
      - Gunakan Bullet Points (*) untuk poin-poin.
      - Gunakan Bold (**) untuk judul sub-poin.
      - Jangan menulis dalam paragraf panjang, gunakan indentasi (spasi) agar terlihat seperti struktur pohon (tree).
      - JANGAN menuliskan angka 1, 2, atau 3 di awal jawabanmu.
      - Gunakan spasi atau indentasi 2-4 spasi untuk setiap sub-poin agar terlihat bertingkat secara visual.

      [STRUKTUR HIERARKI YANG WAJIB DIIKUTI]:
      * **Kategori**
        * **Nama**
          * Detail A: ...
            - Detail A1: ...
              - Detail A1.1: ...

      [DATA REFERENSI]: ${documentContext}

      Jawab pertanyaan User dengan mendeteksi kata kunci yang sama pada DATA REFERENSI di atas.
      Jika pada DATA REFERENSI terdapat rincian kategori, sebutkan semuanya secara lengkap, jelas dan singkat!
    `;

    console.log("⏳ Meminta Ollama merakit jawaban cerdas...");

    const startTime = performance.now();

    const response = await ollama.chat({
      model: "qwen2.5:1.5b",
      messages: [
        {
          role: "system",
          content: strictSystemInstruction,
        },
        {
          role: "user",
          content: message,
        },
      ],
      options: {
        num_predict: 500,
        temperature: 0.2,
      },
    });

    const endTime = performance.now();
    const durationInSeconds = ((endTime - startTime) / 1000).toFixed(1);
    console.log(
      `✅ Ollama selesai merespons dalam ${durationInSeconds} seconds.`,
    );

    let aiReply = response.message.content;

    // SINKRONISASI TAMPILAN AKHIR JAWABAN
    const formattedSources =
      sourceList.length > 0 ? `Data from ID : ${sourceList.join(", ")}` : "";

    if (formattedSources) {
      aiReply += `\n\n---\n ${formattedSources} | Time : ${durationInSeconds} seconds`;
    } else {
      aiReply += `\n\n---\n Time : ${durationInSeconds} seconds`;
    }

    await saveChatMessage(activeSessionId, "bot", aiReply, finalUserId);

    return res.status(200).json({
      reply: aiReply,
      sessionId: activeSessionId,
      sourceDocuments: contextChunks.map((c) => ({
        content: c.content.substring(0, 100) + "...",
      })),
    });
  } catch (error) {
    console.error("Error pada controller chat:", error);
    return res
      .status(500)
      .json({ message: "Terjadi kesalahan pada sistem chatbot Kirana AI." });
  }
};

// export const handleKiranaChat = async (req, res) => {
//   try {
//     const { message, sessionId, userId } = req.body;

//     console.log(
//       `[Chat masuk] Sesi: ${sessionId}, User: ${userId}, Pesan: ${message}`,
//     );

//     if (!message) {
//       return res.status(400).json({ message: "Pesan tidak boleh kosong." });
//     }

//     const activeSessionId = sessionId || "default-session-local";
//     console.log(`\n💬 Chat Masuk [Sesi: ${activeSessionId}]: "${message}"`);

//     const finalUserId = userId || 1;

//     await saveChatMessage(activeSessionId, "user", message, finalUserId);

//     const historyRows = await getChatHistoryBySession(activeSessionId, 5);
//     const formattedHistory = historyRows
//       .map(
//         (chat) =>
//           `${chat.sender === "user" ? "User" : "KiranaAI"}: ${chat.message}`,
//       )
//       .join("\n");

//     console.log("⏳ Menyisir database regulasi dengan teknik Vector Search...");
//     const contextChunks = await queryKnowledgeBase(message, 6);

//     const documentContext = contextChunks
//       .map((chunk, index) => `DATA REFERENSI #${index + 1}:\n${chunk.content}`)
//       .join("\n\n-------------------------\n\n");

//     console.log(
//       `✅ Berhasil menemukan ${contextChunks.length} potongan regulasi.`,
//     );

//     const sourceList = [];

//     for (const chunk of contextChunks.slice(0, 2)) {
//       const filename = chunk.filename || "Dokumen_Internal";

//       let sourceString = "";
//       if (chunk.row_number) {
//         sourceString = `${filename} (baris: ${chunk.row_number})`;
//       } else if (chunk.page_number) {
//         sourceString = `${filename} (hal: ${chunk.page_number})`;
//       } else {
//         sourceString = filename;
//       }

//       if (!sourceList.includes(sourceString)) {
//         sourceList.push(sourceString);
//       }
//     }

//     const strictSystemInstruction = `
//       Kamu adalah Kirana AI. Kamu adalah asisten informasi yang sangat rapi.
//       Setiap kali menjawab pertanyaan tentang lokasi, jadwal, atau prosedur, ikuti aturan format ini:

//       - Gunakan Heading ### untuk kategori utama.
//       - Gunakan Bullet Points (*) untuk poin-poin.
//       - Gunakan Bold (**) untuk judul sub-poin.
//       - Jangan menulis dalam paragraf panjang, gunakan indentasi (spasi) agar terlihat seperti struktur pohon (tree).
//       - JANGAN menuliskan angka 1, 2, atau 3 di awal jawabanmu.
//       - Gunakan spasi atau indentasi 2-4 spasi untuk setiap sub-poin agar terlihat bertingkat secara visual.

//       [STRUKTUR HIERARKI YANG WAJIB DIIKUTI]:
//       * **Kategori**
//         * **Nama**
//           * Detail A: ...
//             - Detail A1: ...
//               - Detail A1.1: ...

//       [DATA REFERENSI]: ${documentContext}

//       Jawab pertanyaan User dengan mendeteksi kata kunci yang sama pada DATA REFERENSI di atas.
//       Jika pada DATA REFERENSI terdapat rincian kategori, sebutkan semuanya secara lengkap, jelas dan singkat!
//     `;

//     console.log("⏳ Meminta Ollama merakit jawaban cerdas...");

//     const startTime = performance.now();

//     const response = await ollama.chat({
//       model: "qwen2.5:1.5b",
//       messages: [
//         {
//           role: "system",
//           content: strictSystemInstruction,
//         },
//         {
//           role: "user",
//           content: message,
//         },
//       ],
//       options: {
//         num_predict: 500,
//         temperature: 0.2,
//       },
//     });

//     const endTime = performance.now();
//     const durationInSeconds = ((endTime - startTime) / 1000).toFixed(1);
//     console.log(
//       `✅ Ollama selesai merespons dalam ${durationInSeconds} seconds.`,
//     );

//     let aiReply = response.message.content;

//     const formattedSources =
//       sourceList.length > 0 ? `Data from ID : ${sourceList.join(", ")}` : "";

//     if (formattedSources) {
//       aiReply += `\n\n---\n ${formattedSources} | Time : ${durationInSeconds} seconds`;
//     } else {
//       aiReply += `\n\n---\n Time : ${durationInSeconds} seconds`;
//     }

//     await saveChatMessage(activeSessionId, "bot", aiReply, finalUserId);

//     return res.status(200).json({
//       reply: aiReply,
//       sessionId: activeSessionId,
//       sourceDocuments: contextChunks.map((c) => ({
//         content: c.content.substring(0, 100) + "...",
//       })),
//     });
//   } catch (error) {
//     console.error("Error pada controller chat:", error);
//     return res
//       .status(500)
//       .json({ message: "Terjadi kesalahan pada sistem chatbot Kirana AI." });
//   }
// };

// =========================================================================
// FUNGSI FEEDBACK (DIPERBARUI DENGAN PENCEGAHAN DUPLIKAT)
// =========================================================================
export const handleChatFeedback = async (req, res) => {
  try {
    const { messageId, rating, reason } = req.body;

    // 1. Cek apakah feedback untuk pesan ini sudah ada di database
    const checkQuery = `SELECT id FROM chat_feedback WHERE message_id = $1`;
    const existingFeedback = await pool.query(checkQuery, [messageId]);

    if (existingFeedback.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Feedback untuk pesan ini sudah tersimpan sebelumnya.",
      });
    }

    // 2. Simpan feedback baru
    const insertQuery = `
      INSERT INTO chat_feedback (message_id, rating, reason) 
      VALUES ($1, $2, $3)
    `;
    await pool.query(insertQuery, [messageId, rating, reason]);

    console.log(
      `[Feedback Disimpan] Pesan ID: ${messageId}, Rating: ${rating}`,
    );

    return res.status(200).json({
      success: true,
      message: "Terima kasih atas masukannya!",
    });
  } catch (error) {
    console.error("Gagal menyimpan feedback ke PostgreSQL:", error);
    return res
      .status(500)
      .json({ success: false, message: "Gagal menyimpan feedback." });
  }
};

// export const handleKiranaChat = async (req, res) => {
//   try {
//     const { message, sessionId } = req.body;

//     if (!message) {
//       return res.status(400).json({ message: "Pesan tidak boleh kosong." });
//     }

//     const activeSessionId = sessionId || "default-session-local";
//     console.log(`\n💬 Chat Masuk [Sesi: ${activeSessionId}]: "${message}"`);

//     // 1. Simpan chat dari User ke database
//     await saveChatMessage(activeSessionId, "user", message);

//     // 2. Tarik riwayat obrolan masa lalu
//     const historyRows = await getChatHistoryBySession(activeSessionId, 5);
//     const formattedHistory = historyRows
//       .map(
//         (chat) =>
//           `${chat.sender === "user" ? "User" : "KiranaAI"}: ${chat.message}`,
//       )
//       .join("\n");

//     // 3. VECTOR SEARCH (Ambil 6 chunks)
//     console.log("⏳ Menyisir database regulasi dengan teknik Vector Search...");
//     const contextChunks = await queryKnowledgeBase(message, 6);

//     const documentContext = contextChunks
//       .map((chunk, index) => `DATA REFERENSI #${index + 1}:\n${chunk.content}`)
//       .join("\n\n-------------------------\n\n");

//     console.log(
//       `✅ Berhasil menemukan ${contextChunks.length} potongan regulasi.`,
//     );

//     // ========================================================
//     // 4. AMBIL INFO SUMBER DOKUMEN (Format 1 Baris Ringkas)
//     // ========================================================
//     const sourceList = [];

//     for (const chunk of contextChunks.slice(0, 2)) {
//       const filename = chunk.filename || "Dokumen_Internal";

//       let sourceString = "";
//       if (chunk.row_number) {
//         sourceString = `${filename} (baris: ${chunk.row_number})`;
//       } else if (chunk.page_number) {
//         sourceString = `${filename} (hal: ${chunk.page_number})`;
//       } else {
//         sourceString = filename;
//       }

//       if (!sourceList.includes(sourceString)) {
//         sourceList.push(sourceString);
//       }
//     }

//     // 5. SATUKAN PROMPT SISTEM (Universal & Strict)
//     const strictSystemInstruction = `ANDA ADALAH ROBOT FORMATTER DATA HUKUM. TUGAS UTAMA ANDA ADALAH MENYALIN JAWABAN DARI DATA REFERENSI DAN MENYUSUNNYA DALAM FORMAT POIN KE BAWAH.

//       [DILARANG KERAS]
//       - Dilarang keras menulis jawaban dalam bentuk satu paragraf panjang yang memanjang ke samping!
//       - Dilarang mengarang atau menambah informasi di luar data yang disediakan!
//       - Jangan menghilangkan nominal angka, tanda baca poin, atau rincian hukum dari data asli!
//       - Dilarang keras menggunakan tanda bintang ganda (**...**) untuk menebalkan teks di bagian mana pun!

//       [DATA REFERENSI DATABASE]
//       """
//       ${documentContext}
//       """

//       [ATURAN FORMAT OUTPUT WAJIB]
//       1. Periksa DATA REFERENSI di atas, lalu jawab pertanyaan User dengan menyalin informasi yang cocok.
//       2. Jika data yang Anda salin mengandung rincian poin (seperti huruf a, b, c, angka 1, 2, 3, tanda strip, atau pemisah kalimat), Anda WAJIB memisahkannya dan menuliskan setiap poin di BARIS BARU (turun ke bawah).
//       3. Gunakan format bullet points Markdown untuk setiap poin agar tampilan rapi.
//       4. Gunakan format poin biasa (misal menggunakan angka biasa "1." atau strip "-") tanpa ada tanda bintang sama sekali.
//       5. Contoh struktur output wajib (TANPA TANDA BINTANG SAMA SEKALI!):

//           Berikut adalah rincian berdasarkan data resmi:
//           1. [Poin Pertama/Kategori A]
//           2. [Poin Kedua/Kategori B]
//           3. [Poin Ketiga/Kategori C]
//           2. [Poin Selanjutnya]

//       // Berdasarkan informasi yang disediakan 'Retrieved Context',
//       //   [Poin Pertama/Kategori A]
//       //   [Poin Kedua/Kategori B]
//       //   [Poin Ketiga/Kategori C]
//     `;
//     // const strictSystemInstruction = `ANDA ADALAH ROBOT PEMBACA TEKS. TUGAS ANDA HANYA MENYALIN JAWABAN DARI DATA DI BAWAH.

//     // [DILARANG KERAS]
//     // - Dilarang mengarang jawaban sendiri!
//     // - Dilarang memakai memori internal Anda tentang PP 8 Tahun 2021 jika ada data angka di bawah!
//     // - Jangan menulis kalimat "tidak ditentukan secara khusus" jika ada rincian angka nominal Rp di teks!
//     // - Dilarang keras menulis jawaban dalam bentuk satu paragraf panjang yang memanjang ke samping!
//     // - Dilarang mengarang atau menambah informasi di luar data yang disediakan!
//     // - Jangan menghilangkan nominal angka, tanda baca poin, atau rincian hukum dari data asli!

//     // [DATA REFERENSI YANG WAJIB DIULANG]
//     // """
//     // ${documentContext}
//     // """

//     // [PERINTAH]
//     // Jawab pertanyaan User dengan mendeteksi kata kunci yang sama pada DATA REFERENSI di atas. Jika pada DATA REFERENSI terdapat rincian kategori (seperti Usaha Mikro atau Usaha Kecil beserta nominal Rp), sebutkan semuanya secara lengkap dan jelas!

//     // [ATURAN FORMAT OUTPUT WAJIB]
//     // 1. Periksa DATA REFERENSI di atas, lalu jawab pertanyaan User dengan menyalin informasi yang cocok.
//     // 2. Jika data yang Anda salin mengandung rincian poin (seperti huruf a, b, c, angka 1, 2, 3, tanda strip, atau pemisah kalimat), Anda WAJIB memisahkannya dan menuliskan setiap poin di BARIS BARU (turun ke bawah).
//     // 3. Gunakan format bullet points Markdown (* atau -) untuk setiap poin agar tampilan rapi.
//     // 4. Contoh struktur output wajib (Gunakan baris baru/jarak yang jelas):

//     //   Berdasarkan informasi yang disediakan dalam DATA REFERENSI di atas:
//     //   [Poin Pertama/Kategori A]
//     //   [Poin Kedua/Kategori B]
//     //   [Poin Ketiga/Kategori C]

//     //   [Tulis dasar hukum/keterangan tambahan di baris baru paling bawah jika ada]
//     // `;

//     // 6. PROSES PANGGIL OLLAMA LOKAL
//     console.log("⏳ Meminta Ollama merakit jawaban cerdas...");

//     // 🔥 CATAT WAKTU MULAI
//     const startTime = performance.now();

//     const response = await ollama.chat({
//       model: "qwen2.5:1.5b",
//       messages: [
//         {
//           role: "system",
//           content: strictSystemInstruction,
//         },
//         {
//           role: "user",
//           content: message,
//         },
//       ],
//       options: {
//         num_predict: 500,
//         temperature: 0.1,
//       },
//     });

//     // 🔥 CATAT WAKTU SELESAI DAN HITUNG DURASI (Konversi ke Detik)
//     const endTime = performance.now();
//     const durationInSeconds = ((endTime - startTime) / 1000).toFixed(1);
//     console.log(
//       `✅ Ollama selesai merespons dalam ${durationInSeconds} seconds.`,
//     );

//     // 7. GABUNGKAN JAWABAN AI DENGAN SUMBER DOKUMEN & DURASI WAKTU
//     let aiReply = response.message.content;

//     // Tambahkan baris ini untuk menghapus semua tanda bintang ganda secara paksa
//     aiReply = aiReply.replace(/\*\*/g, "");

//     // Gabungkan array sumber data menjadi satu baris teks utuh
//     const formattedSources =
//       sourceList.length > 0 ? `Data from ID : ${sourceList.join(", ")}` : "";

//     if (formattedSources) {
//       // Tempelkan teks sumber sekaligus durasi waktu pemrosesan di akhir jawaban
//       aiReply += `\n\n---\n ${formattedSources} | Time : ${durationInSeconds} seconds`;
//     } else {
//       // Jika tidak ada dokumen referensi, tetap tampilkan durasi waktu
//       aiReply += `\n\n---\n Time : ${durationInSeconds} seconds`;
//     }

//     // 8. Simpan balasan AI + Sumber ke database agar diingat di chat berikutnya
//     await saveChatMessage(activeSessionId, "bot", aiReply);

//     // 9. Kembalikan jawaban ke frontend
//     return res.status(200).json({
//       reply: aiReply,
//       sessionId: activeSessionId,
//       sourceDocuments: contextChunks.map((c) => ({
//         content: c.content.substring(0, 100) + "...",
//       })),
//     });
//   } catch (error) {
//     console.error("Error pada controller chat:", error);
//     return res
//       .status(500)
//       .json({ message: "Terjadi kesalahan pada sistem chatbot Kirana AI." });
//   }
// };

// Menampilkan riwayat chat lengkap untuk sesi tertentu
export const getChatHistoryResponse = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Fallback jika sessionId kosong dari frontend
    const activeSessionId = sessionId || "sesi-kirana-lokal";

    console.log(
      `⏳ Mengambil riwayat dari tabel chat_histories untuk sesi: ${activeSessionId}`,
    );

    // Query disesuaikan dengan skema tabel asli Anda: public.chat_histories
    const query = `
      SELECT id, sender, message, created_at 
      FROM public.chat_histories 
      WHERE session_id = $1 
      ORDER BY created_at DESC 
      LIMIT 20
    `;

    const result = await pool.query(query, [activeSessionId]);

    // Membalikkan urutan agar chat lama di atas dan chat baru di bawah
    const formattedHistory = result.rows.reverse().map((chat) => {
      const tanggalLengkap = chat.created_at
        ? new Date(chat.created_at).toLocaleDateString("id-ID", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "Baru saja";

      return {
        id: chat.id,
        sender: chat.sender, // Menghasilkan "user" atau "bot" sesuai kolom VARCHAR(10) Anda
        message: chat.message,
        time: tanggalLengkap,
      };
    });

    return res.status(200).json({
      success: true,
      history: formattedHistory,
    });
  } catch (error) {
    console.error(
      "❌ Gagal mengambil riwayat dari public.chat_histories:",
      error,
    );
    return res.status(500).json({
      success: false,
      message: "Gagal memuat riwayat percakapan terakhir.",
    });
  }
};

export const getAllSessions = async (req, res) => {
  try {
    // 💡 Mengambil user_id dari token login/session (tergantung sistem auth Anda)
    // Asumsi: user_id dilewatkan oleh middleware auth ke req.user, atau dikirim lewat query/params
    const userId = req.user?.id || req.query.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID tidak ditemukan. Pastikan Anda sudah login.",
      });
    }

    console.log(`⏳ Mengambil daftar sesi unik untuk User ID: ${userId}`);

    // Query cerdas: Ambil session_id yang unik, beserta pesan + waktu terbarunya
    const query = `
      SELECT DISTINCT ON (session_id) 
        session_id, 
        message, 
        created_at
      FROM public.chat_histories
      WHERE (user_id = $1 OR user_id IS NULL) AND sender = 'user'
      ORDER BY session_id, created_at ASC
    `;

    const result = await pool.query(query, [userId]);

    // Urutkan hasil akhir berdasarkan waktu chat terbaru di paling atas
    const sortedSessions = result.rows.sort(
      (a, b) => b.created_at - a.created_at,
    );

    // Format data sebelum dikirim ke frontend
    const sessionsList = sortedSessions.map((session) => {
      const tanggalFormat = session.created_at
        ? new Date(session.created_at).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "Baru saja";

      return {
        sessionId: session.session_id,
        lastMessage: session.message,
        date: tanggalFormat,
      };
    });

    return res.status(200).json({
      success: true,
      sessions: sessionsList,
    });
  } catch (error) {
    console.error("❌ Gagal mengambil daftar sesi dari database:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal memuat daftar riwayat percakapan.",
    });
  }
};

// ============================================================================
// 1. FUNGSI UNTUK MENGUBAH NAMA JUDUL PERCAKAPAN (RENAME)
// ============================================================================
export const renameSessionTitle = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body; // Nama baru yang diketik dari input frontend

    if (!message || !message.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Nama baru tidak boleh kosong." });
    }

    // Cari ID pesan paling pertama (terlama) yang dikirim oleh USER dalam sesi ini
    const firstChatQuery = `
      SELECT id FROM public.chat_histories 
      WHERE session_id = $1 AND sender = 'user' 
      ORDER BY created_at ASC LIMIT 1
    `;
    const { rows } = await pool.query(firstChatQuery, [sessionId]);

    if (rows.length > 0) {
      const firstChatId = rows[0].id;

      // Update teks pertanyaan pertama tersebut dengan nama baru
      await pool.query(
        "UPDATE public.chat_histories SET message = $1 WHERE id = $2",
        [message.trim(), firstChatId],
      );

      console.log(
        `[Rename] Sesi ${sessionId} berhasil diubah namanya menjadi: "${message}"`,
      );
      return res
        .status(200)
        .json({ success: true, message: "Judul sesi berhasil diperbarui." });
    }

    return res
      .status(404)
      .json({ success: false, message: "Sesi obrolan tidak ditemukan." });
  } catch (error) {
    console.error("❌ Gagal mengubah nama sesi:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

// ============================================================================
// 2. FUNGSI UNTUK MENGHAPUS SATU SESI CHAT UTUH (DELETE)
// ============================================================================
export const deleteChatSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Hapus seluruh baris data (baik user maupun bot) yang memiliki session_id tersebut
    const deleteResult = await pool.query(
      "DELETE FROM public.chat_histories WHERE session_id = $1",
      [sessionId],
    );

    console.log(
      `[Delete] Sesi ${sessionId} berhasil dihapus dari database (${deleteResult.rowCount} baris terhapus).`,
    );
    return res.status(200).json({
      success: true,
      message: "Sesi obrolan berhasil dihapus secara permanen.",
    });
  } catch (error) {
    console.error("❌ Gagal menghapus sesi chat:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

// ==========================================================================
// 3. FUNGSI PENCARIAN UTAMA KNOWLEDGE BASE (UNTUK CHATBOT AI)
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
