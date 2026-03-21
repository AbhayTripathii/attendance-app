const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "railway",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  timezone: "+00:00",
  ssl: { rejectUnauthorized: false }
});

pool
  .getConnection()
  .then((conn) => {
    console.log("✅ MySQL connected successfully");
    conn.release();
  })
  .catch((err) => console.error("❌ MySQL connection failed:", err.message));

module.exports = pool;
