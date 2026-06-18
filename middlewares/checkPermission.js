import pool from "../config/db.js";

// Di middleware/checkPermission.js
export const checkPermission = (menuKey, action) => {
  return async (req, res, next) => {
    try {
      // Pastikan req.user mendapatkan role_id dari token
      const roleId = req.user.role_id;

      const result = await pool.query(
        `SELECT ${action} FROM role_permissions WHERE role_id = $1 AND menu_key = $2`,
        [roleId, menuKey],
      );

      // Jika data tidak ditemukan atau kolom bernilai false
      if (result.rows.length === 0 || !result.rows[0][action]) {
        console.log(
          `Akses ditolak untuk role_id: ${roleId} pada menu: ${menuKey}`,
        );
        return res.status(403).json({ message: "Akses ditolak" });
      }

      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
};
