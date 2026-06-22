import pool from "../config/db.js";

// @desc    Mengambil semua konfigurasi AI atau spesifik key
// @route   GET /api/ai-config
// @access  Private
export const getAIConfig = async (req, res) => {
  try {
    // Kita ambil semua config agar fleksibel jika kedepannya ada key lain (model, temperature, dll)
    const query = `SELECT config_key, config_value, description FROM public.ai_config;`;
    const result = await pool.query(query);

    // Mengubah array rows menjadi bentuk object key-value agar frontend lebih mudah konsumsi
    // Contoh hasil: { system_prompt: "...", ai_model: "..." }
    const configObject = {};
    result.rows.forEach((row) => {
      configObject[row.config_key] = row.config_value;
    });

    return res.status(200).json({
      success: true,
      data: configObject,
    });
  } catch (error) {
    console.error("Error getAIConfig:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat mengambil konfigurasi AI.",
    });
  }
};

// @desc    Memperbarui nilai konfigurasi AI berdasarkan key
// @route   PUT /api/ai-config
// @access  Private
export const updateAIConfig = async (req, res) => {
  const { configs } = req.body;
  // Frontend akan mengirim data berupa objek, contoh: { configs: { system_prompt: "..." } }

  if (!configs || typeof configs !== "object") {
    return res.status(400).json({
      success: false,
      message: "Data konfigurasi tidak valid.",
    });
  }

  try {
    // Kita gunakan perulangan untuk mendukung update banyak key sekaligus jika kedepannya dikembangkan
    const keys = Object.keys(configs);

    for (const key of keys) {
      const value = configs[key];
      const query = `
        INSERT INTO public.ai_config (config_key, config_value)
        VALUES ($1, $2)
        ON CONFLICT (config_key)
        DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW();
      `;
      await pool.query(query, [key, value]);
    }

    return res.status(200).json({
      success: true,
      message: "Konfigurasi AI berhasil diperbarui.",
    });
  } catch (error) {
    console.error("Error updateAIConfig:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal saat menyimpan konfigurasi AI.",
    });
  }
};
