const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("database.db");

db.all("SELECT * FROM users", [], function (err, rows) {
  if (err) {
    console.error("Lỗi:", err.message);
    return;
  }

  console.table(rows);
});

db.close();