// controllers/dashboardController.js
import pool from "../config/db.js";

export const getStats = async (req, res) => {
  try {
    // Paksa browser/cloudflare tidak menyimpan cache data statistik
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // 1. Query menghitung total rekaman
    const queryRecordings = `SELECT COUNT(*) AS total FROM public.output`;

    // 2. Query menghitung total user
    const queryUsers = `SELECT COUNT(*) AS total FROM public.users`;

    // 3. Query menghitung total dokumen di Knowledge Base
    // (Sesuaikan 'public.documents' dengan nama tabel berkas AI Anda)
    const queryDocuments = `SELECT COUNT(*) AS total FROM public.kb_documents`;

    // 4. Query menghitung interaksi chat AI khusus HARI INI saja
    // (Sesuaikan 'public.chat_logs' dan kolom 'created_at' dengan struktur Anda)
    const queryAiHits = `
      SELECT COUNT(*) AS total 
      FROM public.chat_histories 
      WHERE created_at >= CURRENT_DATE
    `;

    // Eksekusi ke-4 query secara paralel agar menghemat waktu pemrosesan database
    const [resRec, resUsers, resDocs, resAi] = await Promise.all([
      pool.query(queryRecordings).catch(() => ({ rows: [{ total: 0 }] })), // Guard aman jika tabel belum migrasi
      pool.query(queryUsers).catch(() => ({ rows: [{ total: 0 }] })),
      pool.query(queryDocuments).catch(() => ({ rows: [{ total: 0 }] })),
      pool.query(queryAiHits).catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    // Konversi hasil string count PostgreSQL ke tipe data Number JavaScript
    const totalRecordings = Number(resRec.rows[0]?.total) || 0;
    const totalUsers = Number(resUsers.rows[0]?.total) || 0;
    const totalDocuments = Number(resDocs.rows[0]?.total) || 0;
    const aiHitsToday = Number(resAi.rows[0]?.total) || 0;

    // Kirim data murni tanpa dummy ke frontend
    return res.status(200).json({
      success: true,
      data: {
        totalRecordings,
        totalDocuments,
        aiHitsToday,
        totalUsers,
      },
    });
  } catch (error) {
    console.error("Error Dashboard Controller Real-Time:", error.message);
    return res.status(500).json({
      success: false,
      message:
        "Terjadi kesalahan pada server saat memuat statistik riil dashboard.",
    });
  }
};

export const getChartData = async (req, res) => {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    // Query untuk mengambil tanggal dan jumlah rekaman 7 hari terakhir
    // Menghasilkan data urut dari tanggal terlama ke terbaru
    const queryChart = `
      SELECT 
        TO_CHAR(created_at, 'DD Mon') AS tanggal,
        COUNT(*) AS jumlah
      FROM public.output
      WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY TO_CHAR(created_at, 'DD Mon'), DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `;

    const result = await pool.query(queryChart);

    // Format data agar siap dibaca oleh library grafik di frontend
    const chartData = result.rows.map((row) => ({
      name: row.tanggal,
      "Total Rekaman": Number(row.jumlah) || 0,
    }));

    return res.status(200).json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    console.error("Error Dashboard Chart Controller:", error.message);
    return res.status(500).json({
      success: false,
      message: "Gagal memuat data grafik dashboard.",
    });
  }
};

export const getRecentActivities = async (req, res) => {
  try {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    // 1. Query ambil 5 rekaman terbaru (sesuaikan nama kolom Anda jika berbeda)
    // Asumsi kolom: id, file_name, agent_name (atau user_id), created_at
    const queryRecordings = `
      SELECT id, file_name, created_at 
      FROM public.output 
      ORDER BY created_at DESC 
      LIMIT 5
    `;

    // 2. Query ambil 5 interaksi chat AI terakhir
    // Asumsi kolom: id, prompt/question, created_at
    const queryChatLogs = `
      SELECT id, message, created_at 
      FROM public.chat_histories 
      ORDER BY created_at DESC 
      LIMIT 5
    `;

    // Eksekusi paralel demi efisiensi tinggi
    const [resRec, resChat] = await Promise.all([
      pool.query(queryRecordings).catch(() => ({ rows: [] })), // Guard jika tabel kosong/belum ada
      pool.query(queryChatLogs).catch(() => ({ rows: [] })),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        recentRecordings: resRec.rows,
        recentChats: resChat.rows,
      },
    });
  } catch (error) {
    console.error(
      "Error Dashboard Recent Activities Controller:",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Gagal memuat aktivitas terbaru.",
    });
  }
};
