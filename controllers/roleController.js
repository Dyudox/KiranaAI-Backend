import pool from "../config/db.js";

export const getRoles = async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = `SELECT * FROM roles WHERE name ILIKE $1 ORDER BY name ASC LIMIT $2 OFFSET $3`;
  const countQuery = `SELECT COUNT(*) FROM roles WHERE name ILIKE $1`;
  const searchVal = `%${search}%`;

  const roles = await pool.query(query, [searchVal, parseInt(limit), offset]);
  const total = await pool.query(countQuery, [searchVal]);

  res.json({ data: roles.rows, total: parseInt(total.rows[0].count) });
};

export const createRole = async (req, res) => {
  const { name, description } = req.body;
  try {
    const newRole = await pool.query(
      "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *",
      [name, description],
    );
    res.status(201).json(newRole.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateRole = async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    const updated = await pool.query(
      "UPDATE roles SET name = $1, description = $2 WHERE id = $3 RETURNING *",
      [name, description, id],
    );
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM roles WHERE id = $1", [id]);
    res.json({ message: "Role berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- MENGAMBIL PERMISSION BERDASARKAN ROLE ID ---
export const getRolePermissions = async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT menu_key, can_create, can_read, can_update, can_delete 
      FROM role_permissions 
      WHERE role_id = $1
    `;
    const result = await pool.query(query, [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- UPDATE PERMISSION (BULK UPDATE) ---
export const updateRolePermissions = async (req, res) => {
  const { id } = req.params; // role_id
  const { permissions } = req.body;

  try {
    await pool.query("BEGIN"); // Transaksi agar data konsisten

    // Hapus akses lama
    await pool.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);

    // Insert akses baru
    for (const p of permissions) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, menu_key, can_create, can_read, can_update, can_delete) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, p.menu_key, p.can_create, p.can_read, p.can_update, p.can_delete],
      );
    }

    await pool.query("COMMIT");
    res.json({ message: "Permissions berhasil diperbarui" });
  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
};
