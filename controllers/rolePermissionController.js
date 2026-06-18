// rolePermissionController.js
export const updateRolePermissions = async (req, res) => {
  const { role_id } = req.params;
  const permissions = req.body; // Array of {menu_key, can_create, can_read, ...}

  try {
    // Gunakan transaksi untuk memastikan atomicity
    await pool.query("BEGIN");

    for (const p of permissions) {
      await pool.query(
        `
        INSERT INTO role_permissions (role_id, menu_key, can_create, can_read, can_update, can_delete)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (role_id, menu_key) 
        DO UPDATE SET 
          can_create = EXCLUDED.can_create,
          can_read = EXCLUDED.can_read,
          can_update = EXCLUDED.can_update,
          can_delete = EXCLUDED.can_delete
      `,
        [
          role_id,
          p.menu_key,
          p.can_create,
          p.can_read,
          p.can_update,
          p.can_delete,
        ],
      );
    }

    await pool.query("COMMIT");
    res.json({ message: "Permissions updated successfully" });
  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
};
