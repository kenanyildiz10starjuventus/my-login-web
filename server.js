const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Kết nối tới database SQLite
const db = new sqlite3.Database("./database.db", function (err) {
  if (err) {
    console.log("Lỗi kết nối database:", err.message);
  } else {
    console.log("Đã kết nối database SQLite");
  }
});

// Tạo bảng users nếu chưa có
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )
`);


// API kiểm tra backend
app.get("/api", function (req, res) {
  res.json({
    message: "Backend API đang chạy!"
  });
});

// API đăng ký
app.post("/register", function (req, res) {
  const name = req.body.name ? req.body.name.trim() : "";
  const email = req.body.email ? req.body.email.trim() : "";
  const password = req.body.password ? req.body.password.trim() : "";
  const confirmPassword = req.body.confirmPassword ? req.body.confirmPassword.trim() : "";

  if (!name || !email || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin"
    });
  }

  if (password.length < 4) {
    return res.status(400).json({
      success: false,
      message: "Mật khẩu phải có ít nhất 4 ký tự"
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Mật khẩu xác nhận không khớp"
    });
  }

  const checkEmailSql = "SELECT * FROM users WHERE email = ?";

  db.get(checkEmailSql, [email], function (err, user) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi kiểm tra email"
      });
    }

    if (user) {
      return res.status(409).json({
        success: false,
        message: "Email này đã được đăng ký"
      });
    }

   const insertSql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

db.run(insertSql, [name, email, password], function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Lỗi server khi tạo tài khoản"
        });
      }

      res.status(201).json({
        success: true,
        message: "Đăng ký tài khoản thành công",
        user: {
          id: this.lastID,
          name: name,
          email: email
        }
      });
    });
  });
});

// API đăng nhập
app.post("/login", function (req, res) {
  const email = req.body.email ? req.body.email.trim() : "";
  const password = req.body.password ? req.body.password.trim() : "";

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập email và mật khẩu"
    });
  }

  const loginSql = "SELECT * FROM users WHERE email = ? AND password = ?";

  db.get(loginSql, [email, password], function (err, user) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi đăng nhập"
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Sai email hoặc mật khẩu"
      });
    }

    res.json({
  success: true,
  message: "Đăng nhập thành công",
  user: {
    id: user.id,
    name: user.name,
    email: user.email
  }
});
  });
});
app.put("/update-profile", function (req, res) {
  const oldEmail = req.body.oldEmail ? req.body.oldEmail.trim() : "";
  const newName = req.body.name ? req.body.name.trim() : "";
  const newEmail = req.body.email ? req.body.email.trim() : "";

  if (!oldEmail || !newName || !newEmail) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin"
    });
  }

  const findUserSql = "SELECT * FROM users WHERE email = ?";

  db.get(findUserSql, [oldEmail], function (err, user) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi tìm tài khoản"
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản"
      });
    }

    const checkEmailSql = "SELECT * FROM users WHERE email = ? AND email != ?";

    db.get(checkEmailSql, [newEmail, oldEmail], function (err, existedUser) {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Lỗi server khi kiểm tra email"
        });
      }

      if (existedUser) {
        return res.status(409).json({
          success: false,
          message: "Email mới đã được người khác sử dụng"
        });
      }

      const updateSql = "UPDATE users SET name = ?, email = ? WHERE email = ?";

      db.run(updateSql, [newName, newEmail, oldEmail], function (err) {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "Lỗi server khi cập nhật thông tin"
          });
        }

        res.json({
          success: true,
          message: "Cập nhật thông tin thành công",
          user: {
            id: user.id,
            name: newName,
            email: newEmail
          }
        });
      });
    });
  });
});
app.put("/change-password", function (req, res) {
  const email = req.body.email ? req.body.email.trim() : "";
  const oldPassword = req.body.oldPassword ? req.body.oldPassword.trim() : "";
  const newPassword = req.body.newPassword ? req.body.newPassword.trim() : "";
  const confirmNewPassword = req.body.confirmNewPassword ? req.body.confirmNewPassword.trim() : "";

  if (!email || !oldPassword || !newPassword || !confirmNewPassword) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin"
    });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({
      success: false,
      message: "Mật khẩu mới phải có ít nhất 4 ký tự"
    });
  }

  if (newPassword !== confirmNewPassword) {
    return res.status(400).json({
      success: false,
      message: "Mật khẩu mới nhập lại không khớp"
    });
  }

  const findUserSql = "SELECT * FROM users WHERE email = ?";

  db.get(findUserSql, [email], function (err, user) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi tìm tài khoản"
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản"
      });
    }

    if (user.password !== oldPassword) {
      return res.status(401).json({
        success: false,
        message: "Mật khẩu cũ không đúng"
      });
    }

    const updatePasswordSql = "UPDATE users SET password = ? WHERE email = ?";

    db.run(updatePasswordSql, [newPassword, email], function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Lỗi server khi đổi mật khẩu"
        });
      }

      res.json({
        success: true,
        message: "Đổi mật khẩu thành công"
      });
    });
  });
});
app.get("/users", function (req, res) {
  const sql = "SELECT id, name, email FROM users";

  db.all(sql, [], function (err, rows) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi lấy danh sách user"
      });
    }

    res.json({
      success: true,
      message: "Lấy danh sách user thành công",
      users: rows
    });
  });
});
app.delete("/users/:id", function (req, res) {
  const userId = req.params.id;

  const findUserSql = "SELECT * FROM users WHERE id = ?";

  db.get(findUserSql, [userId], function (err, user) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi tìm user"
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy user"
      });
    }

    const deleteSql = "DELETE FROM users WHERE id = ?";

    db.run(deleteSql, [userId], function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Lỗi server khi xóa user"
        });
      }

      res.json({
        success: true,
        message: "Xóa user thành công"
      });
    });
  });
});

app.delete("/delete-account", function (req, res) {
  const email = req.body.email ? req.body.email.trim() : "";
  const password = req.body.password ? req.body.password.trim() : "";

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng nhập đầy đủ email và mật khẩu"
    });
  }

  const findUserSql = "SELECT * FROM users WHERE email = ?";

  db.get(findUserSql, [email], function (err, user) {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi tìm tài khoản"
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản"
      });
    }

    if (user.password !== password) {
      return res.status(401).json({
        success: false,
        message: "Mật khẩu không đúng"
      });
    }

    const deleteSql = "DELETE FROM users WHERE email = ?";

    db.run(deleteSql, [email], function (err) {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Lỗi server khi xóa tài khoản"
        });
      }

      res.json({
        success: true,
        message: "Xóa tài khoản thành công"
      });
    });
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server đang chạy ở port " + PORT);
});