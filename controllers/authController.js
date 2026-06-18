// backend/controllers/authController.js
import pool from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// --- REGISTER USER ---
export const register = async (req, res) => {
  const { username, password, name, role_id } = req.body;

  try {
    if (!username || !password || !name || !role_id) {
      return res.status(400).json({ message: "Semua field wajib diisi" });
    }

    // Cek apakah username sudah dipakai
    const userExist = await pool.query(
      "SELECT id FROM public.users WHERE username = $1",
      [username],
    );
    if (userExist.rows.length > 0) {
      return res.status(400).json({ message: "Username sudah terdaftar" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user baru (updated_at diisi NOW() karena NOT NULL pada skema)
    const newUser = await pool.query(
      `INSERT INTO public.users (username, password, name, role_id, is_active, updated_at) 
       VALUES ($1, $2, $3, $4, true, NOW()) 
       RETURNING id, username, name, role_id, is_active, created_at`,
      [username, hashedPassword, name, role_id],
    );

    res.status(201).json({
      message: "User berhasil didaftarkan",
      user: newUser.rows[0],
    });
  } catch (error) {
    console.error("Error saat register:", error.message);
    res
      .status(500)
      .json({ message: "Terjadi kegagalan sistem internal server" });
  }
};

// --- LOGIN USER (RBAC Kompleks & Efisien) ---
export const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username dan password wajib diisi" });
    }

    const userQuery = `
            SELECT 
                u.id, 
                u.username, 
                u.name, 
                u.password, 
                u.is_active,
                u.role_id,
                r.name as role_name,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'menu_key', rp.menu_key,
                            'can_create', rp.can_create,
                            'can_read', rp.can_read,
                            'can_update', rp.can_update,
                            'can_delete', rp.can_delete
                        )
                    ) FILTER (WHERE rp.menu_key IS NOT NULL), 
                    '[]'
                ) as permissions
            FROM public.users u
            LEFT JOIN public.roles r ON u.role_id = r.id
            LEFT JOIN public.role_permissions rp ON r.id = rp.role_id
            WHERE u.username = $1
            GROUP BY u.id, r.name;
        `;

    const userResult = await pool.query(userQuery, [username]);

    if (userResult.rows.length === 0) {
      return res
        .status(401)
        .json({ message: "Kredensial salah (Username tidak terdaftar)" });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        message: "Akun Anda dinonaktifkan. Hubungi Administrator.",
      });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res
        .status(401)
        .json({ message: "Kredensial salah (Password tidak cocok)" });
    }

    // Token kedaluwarsa dalam 8 jam (cocok untuk jam kerja operasional)
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role_name,
        role_id: user.role_id, // <--- INI WAJIB ADA
        permissions: user.permissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.status(200).json({
      message: "Otentikasi berhasil",
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role_name,
        permissions: user.permissions,
      },
    });
  } catch (error) {
    console.error("Error saat login dengan skema RBAC penuh:", error.message);
    res
      .status(500)
      .json({ message: "Terjadi kegagalan sistem internal server" });
  }
};

export const getMe = async (req, res) => {
  // Asumsi: Anda menggunakan middleware untuk mendapatkan user dari JWT token
  const userId = req.user.id;

  const user = await pool.query(
    "SELECT id, username FROM users WHERE id = $1",
    [userId],
  );
  const permissions = await pool.query(
    "SELECT menu_key, can_create, can_read, can_update, can_delete FROM role_permissions WHERE role_id = $1",
    [user.rows[0].role_id],
  );

  res.json({
    user: user.rows[0],
    permissions: permissions.rows,
  });
};

export const getMyPermissions = async (req, res) => {
  try {
    // req.user didapat dari middleware authenticateToken
    const roleId = req.user.role_id;

    const result = await pool.query(
      "SELECT menu_key, can_create, can_read, can_update, can_delete FROM role_permissions WHERE role_id = $1",
      [roleId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching permissions:", err);
    res.status(500).json({ error: err.message });
  }
};
