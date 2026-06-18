import jwt from "jsonwebtoken";

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Harus memecah "Bearer <token>"

  if (!token) return res.sendStatus(401); // Jika token tidak ada, kirim 401

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Jika token tidak valid, kirim 403
    req.user = user;
    next();
  });
};
