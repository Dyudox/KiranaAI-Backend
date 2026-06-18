import pkg from "pg";
import "dotenv/config";

const { Pool } = pkg;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,

  // Ubah dari DB_NAME menjadi DB_DATABASE sesuai isi file .env milikmu
  database: process.env.DB_DATABASE || "forest",
});

// Tes koneksi saat aplikasi pertama kali berjalan
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error(" Database connection failed ❌", err.stack);
  } else {
    console.log(" Database connected successfully  at:", res.rows[0].now);
  }
});

export default pool;
