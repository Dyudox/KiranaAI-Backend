import pool from "../config/db.js";

// 1. GET ALL WITH PAGINATION, FILTER & SEARCH
export const getSuggestedQuestions = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let queryValues = ["suggested_questions"];
    let countQuery = `SELECT COUNT(*) FROM public.enumerations WHERE "group" = $1`;
    let dataQuery = `SELECT id, name, value as question, is_active, created_at FROM public.enumerations WHERE "group" = $1`;

    let paramIndex = 2;

    // Filter Berdasarkan Searching Teks (Nama atau Pertanyaan)
    if (search) {
      const searchFilter = ` AND (name ILIKE $${paramIndex} OR value ILIKE $${paramIndex})`;
      countQuery += searchFilter;
      dataQuery += searchFilter;
      queryValues.push(`%${search}%`);
      paramIndex++;
    }

    // Filter Berdasarkan Status Aktif (true/false)
    if (status !== undefined && status !== "") {
      const statusFilter = ` AND is_active = $${paramIndex}`;
      countQuery += statusFilter;
      dataQuery += statusFilter;
      queryValues.push(status === "active" ? true : false);
      paramIndex++;
    }

    // Hitung Total Data untuk Pagination
    const totalResult = await pool.query(countQuery, queryValues);
    const totalRows = parseInt(totalResult.rows[0].count);
    const totalPage = Math.ceil(totalRows / limit);

    // Tambahkan pengurutan dan limit paginasi
    dataQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryValues.push(parseInt(limit), parseInt(offset));

    const dataResult = await pool.query(dataQuery, queryValues);

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalRows,
        totalPage,
      },
    });
  } catch (error) {
    console.error("Error getSuggestedQuestions:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

// 2. CREATE NEW SUGGESTED QUESTION
export const createSuggestedQuestion = async (req, res) => {
  try {
    const { name, question } = req.body;
    if (!name || !question) {
      return res
        .status(400)
        .json({ success: false, message: "Nama dan Pertanyaan wajib diisi." });
    }

    const query = `
      INSERT INTO public.enumerations (name, value, "group", is_active, updated_at)
      VALUES ($1, $2, 'suggested_questions', true, CURRENT_TIMESTAMP)
      RETURNING id, name, value as question, is_active, created_at
    `;
    const result = await pool.query(query, [name, question]);

    return res.status(201).json({
      success: true,
      message: "Pertanyaan berhasil ditambahkan.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error createSuggestedQuestion:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

// 3. TOGGLE STATUS (ACTIVE / INACTIVE)
export const toggleQuestionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const query = `
      UPDATE public.enumerations 
      SET is_active = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2 AND "group" = 'suggested_questions'
      RETURNING id, is_active
    `;
    const result = await pool.query(query, [is_active, id]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }

    return res.status(200).json({
      success: true,
      message: "Status berhasil diperbarui.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error toggleQuestionStatus:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

// 4. DELETE QUESTION
export const deleteSuggestedQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const query = `DELETE FROM public.enumerations WHERE id = $1 AND "group" = 'suggested_questions' RETURNING id`;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Data tidak ditemukan." });
    }

    return res.status(200).json({
      success: true,
      message: "Pertanyaan berhasil dihapus secara permanen.",
    });
  } catch (error) {
    console.error("Error deleteSuggestedQuestion:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

// Fungsi untuk Update / Edit Suggested Question
export const updateSuggestedQuestion = async (req, res) => {
  const { id } = req.params;
  const { name, question, is_active } = req.body; // 🎯 Tangkap is_active dari frontend

  if (!name || !question) {
    return res.status(400).json({
      success: false,
      message: "Nama / Kategori dan Teks Pertanyaan wajib diisi.",
    });
  }

  try {
    // Konversi nilai string "true"/"false" dari frontend menjadi Boolean murni untuk PostgreSQL
    const statusBoolean = is_active === "true" || is_active === true;

    // 🎯 Tambahkan is_active = $3 ke dalam query UPDATE
    const query = `
      UPDATE public.enumerations 
      SET 
        name = $1, 
        value = $2, 
        is_active = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;

    // Pemetaan parameter query: $1=name, $2=question, $3=statusBoolean, $4=id
    const result = await pool.query(query, [name, question, statusBoolean, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data tidak ditemukan.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Suggested question berhasil diperbarui.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updateSuggestedQuestion:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan internal pada server.",
    });
  }
};
