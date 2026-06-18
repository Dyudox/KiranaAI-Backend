// Fungsi untuk mengambil 5 obrolan terakhir dalam satu sesi agar AI tidak lupa konteks
const getChatHistoryBySession = async (sessionId, limit = 5) => {
  try {
    const result = await pool.query(
      `SELECT sender, message FROM chat_histories 
       WHERE session_id = $1 
       ORDER BY created_at DESC LIMIT $2`,
      [sessionId, limit],
    );
    // Kita balik urutannya (reverse) agar teks chatnya berurutan dari yang paling lama ke yang terbaru
    return result.rows.reverse();
  } catch (error) {
    console.error("Gagal mengambil riwayat chat:", error);
    return [];
  }
};

// Fungsi untuk menyimpan chat baru (baik dari user maupun balasan dari bot)
const saveChatMessage = async (sessionId, sender, message, userId = null) => {
  try {
    await pool.query(
      `INSERT INTO chat_histories (session_id, sender, message, user_id) 
       VALUES ($1, $2, $3, $4)`,
      [sessionId, sender, message, userId],
    );
  } catch (error) {
    console.error("Gagal menyimpan pesan ke database:", error);
  }
};
