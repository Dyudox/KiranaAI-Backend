import pool from "../config/db.js";
import bcrypt from "bcrypt";

export const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
        SELECT 
            u.id, 
            u.username, 
            u.name, 
            u.is_active, 
            u.role_id, 
            r.name AS role_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
        ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getUsers = async (req, res) => {
  const { page = 1, limit = 50, search = "", role_id, is_active } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query =
    "SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE 1=1";
  let countQuery = "SELECT COUNT(*) FROM users u WHERE 1=1";
  let values = [];
  let paramCount = 1; // Mulai counter dari 1

  // Filter Search
  if (search) {
    values.push(`%${search}%`);
    query += ` AND (u.name ILIKE $${paramCount} OR u.username ILIKE $${paramCount})`;
    countQuery += ` AND (u.name ILIKE $${paramCount} OR u.username ILIKE $${paramCount})`;
    paramCount++;
  }

  // Filter Role
  if (role_id) {
    values.push(role_id);
    query += ` AND u.role_id = $${paramCount}`;
    countQuery += ` AND u.role_id = $${paramCount}`;
    paramCount++;
  }

  // Filter Status
  if (is_active !== undefined && is_active !== "") {
    values.push(is_active === "true");
    query += ` AND u.is_active = $${paramCount}`;
    countQuery += ` AND u.is_active = $${paramCount}`;
    paramCount++;
  }

  // Tambahkan limit dan offset
  query += ` ORDER BY u.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
  values.push(parseInt(limit), offset);

  try {
    const users = await pool.query(query, values);
    const total = await pool.query(
      countQuery,
      values.slice(0, values.length - 2),
    );

    res.json({
      data: users.rows,
      total: parseInt(total.rows[0].count),
    });
  } catch (err) {
    console.error("SQL Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, username, password, role_id, is_active } = req.body;

  try {
    let query =
      "UPDATE users SET name = $1, username = $2, role_id = $3, is_active = $4";
    let values = [name, username, role_id, is_active];

    // Jika password diisi, enkripsi dan tambahkan ke query
    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ", password = $5";
      values.push(hashedPassword);
    }

    query += ` WHERE id = $${values.length + 1}`;
    values.push(id);

    await pool.query(query, values);
    res.json({ message: "User updated successfully" });
  } catch (err) {
    console.error("ERROR BACKEND:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ message: "User berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createUser = async (req, res) => {
  const { name, username, password, role_id, is_active } = req.body;
  const now = new Date();

  try {
    // Tambahkan hashing password di sini
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO users (name, username, password, role_id, is_active, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *
    `;

    const values = [
      name,
      username,
      hashedPassword,
      role_id,
      is_active,
      now,
      now,
    ];
    await pool.query(query, values);

    res.status(201).json({ message: "User berhasil ditambahkan" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
