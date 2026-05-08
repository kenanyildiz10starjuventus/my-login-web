const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Kết nối tới database Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(function () {
    console.log("Đã kết nối database Postgres");
  })
  .catch(function (err) {
    console.error("Lỗi kết nối Postgres:", err.message);
  });

// Tạo bảng users nếu chưa có
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )
`).catch(function (err) {
  console.error("Lỗi tạo bảng users:", err.message);
});

// Tạo bảng messages nếu chưa có
pool.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).catch(function (err) {
  console.error("Lỗi tạo bảng messages:", err.message);
});

// API kiểm tra backend
app.get("/api", function (req, res) {
  res.json({
    message: "Backend API đang chạy!"
  });
});

// API đăng ký
app.post("/register", async function (req, res) {
  try {
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

    const checkResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (checkResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email này đã được đăng ký"
      });
    }

    const insertResult = await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email, password]
    );

    const user = insertResult.rows[0];

    res.status(201).json({
      success: true,
      message: "Đăng ký tài khoản thành công",
      user: user
    });
  } catch (err) {
    console.error("Lỗi đăng ký:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo tài khoản"
    });
  }
});

// API đăng nhập
app.post("/login", async function (req, res) {
  try {
    const email = req.body.email ? req.body.email.trim() : "";
    const password = req.body.password ? req.body.password.trim() : "";

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập email và mật khẩu"
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    const user = result.rows[0];

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
  } catch (err) {
    console.error("Lỗi đăng nhập:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi đăng nhập"
    });
  }
});

// API cập nhật profile
app.put("/update-profile", async function (req, res) {
  try {
    const oldEmail = req.body.oldEmail ? req.body.oldEmail.trim() : "";
    const newName = req.body.name ? req.body.name.trim() : "";
    const newEmail = req.body.email ? req.body.email.trim() : "";

    if (!oldEmail || !newName || !newEmail) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ thông tin"
      });
    }

    const findResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [oldEmail]
    );

    const user = findResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản"
      });
    }

    const checkEmailResult = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND email != $2",
      [newEmail, oldEmail]
    );

    if (checkEmailResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email mới đã được người khác sử dụng"
      });
    }

    const updateResult = await pool.query(
      "UPDATE users SET name = $1, email = $2 WHERE email = $3 RETURNING id, name, email",
      [newName, newEmail, oldEmail]
    );

    res.json({
      success: true,
      message: "Cập nhật thông tin thành công",
      user: updateResult.rows[0]
    });
  } catch (err) {
    console.error("Lỗi cập nhật profile:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi cập nhật thông tin"
    });
  }
});

// API đổi mật khẩu
app.put("/change-password", async function (req, res) {
  try {
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

    const findResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    const user = findResult.rows[0];

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

    await pool.query(
      "UPDATE users SET password = $1 WHERE email = $2",
      [newPassword, email]
    );

    res.json({
      success: true,
      message: "Đổi mật khẩu thành công"
    });
  } catch (err) {
    console.error("Lỗi đổi mật khẩu:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi đổi mật khẩu"
    });
  }
});

// API lấy danh sách users
app.get("/users", async function (req, res) {
  try {
    const result = await pool.query(
      "SELECT id, name, email FROM users ORDER BY id ASC"
    );

    res.json({
      success: true,
      message: "Lấy danh sách user thành công",
      users: result.rows
    });
  } catch (err) {
    console.error("Lỗi lấy users:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách user"
    });
  }
});

// API xóa user theo id
app.delete("/users/:id", async function (req, res) {
  try {
    const userId = req.params.id;

    const findResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [userId]
    );

    const user = findResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy user"
      });
    }

    await pool.query(
      "DELETE FROM users WHERE id = $1",
      [userId]
    );

    res.json({
      success: true,
      message: "Xóa user thành công"
    });
  } catch (err) {
    console.error("Lỗi xóa user:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi xóa user"
    });
  }
});

// API xóa tài khoản
app.delete("/delete-account", async function (req, res) {
  try {
    const email = req.body.email ? req.body.email.trim() : "";
    const password = req.body.password ? req.body.password.trim() : "";

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ email và mật khẩu"
      });
    }

    const findResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    const user = findResult.rows[0];

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

    await pool.query(
      "DELETE FROM users WHERE email = $1",
      [email]
    );

    res.json({
      success: true,
      message: "Xóa tài khoản thành công"
    });
  } catch (err) {
    console.error("Lỗi xóa tài khoản:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi xóa tài khoản"
    });
  }
});

// API lấy tin nhắn chat
app.get("/api/messages", async function (req, res) {
  try {
    const result = await pool.query(
      "SELECT id, username, message, created_at FROM messages ORDER BY id ASC LIMIT 100"
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (err) {
    console.error("Lỗi lấy tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy tin nhắn."
    });
  }
});

// API gửi tin nhắn chat
app.post("/api/messages", async function (req, res) {
  try {
    const username = req.body.username ? req.body.username.trim() : "";
    const message = req.body.message ? req.body.message.trim() : "";

    if (!username || !message) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tên người dùng hoặc tin nhắn."
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Tin nhắn quá dài."
      });
    }

    await pool.query(
      "INSERT INTO messages (username, message) VALUES ($1, $2)",
      [username, message]
    );

    res.json({
      success: true,
      message: "Đã gửi tin nhắn."
    });
  } catch (err) {
    console.error("Lỗi gửi tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi tin nhắn."
    });
  }
});

app.get("/api/messages", async function (req, res) {
  try {
    const result = await pool.query(
      "SELECT id, username, message, created_at FROM messages ORDER BY id ASC LIMIT 100"
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (err) {
    console.error("Lỗi lấy tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy tin nhắn."
    });
  }
});

app.post("/api/messages", async function (req, res) {
  try {
    const username = req.body.username ? req.body.username.trim() : "";
    const message = req.body.message ? req.body.message.trim() : "";

    if (!username || !message) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tên người dùng hoặc tin nhắn."
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Tin nhắn quá dài."
      });
    }

    await pool.query(
      "INSERT INTO messages (username, message) VALUES ($1, $2)",
      [username, message]
    );

    res.json({
      success: true,
      message: "Đã gửi tin nhắn."
    });
  } catch (err) {
    console.error("Lỗi gửi tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi tin nhắn."
    });
  }
});

io.on("connection", function (socket) {
  console.log("Một người dùng đã kết nối chat:", socket.id);

  socket.on("send_message", async function (data) {
    try {
      const username = data.username ? data.username.trim() : "";
      const message = data.message ? data.message.trim() : "";

      if (!username || !message) {
        return;
      }

      if (message.length > 500) {
        return;
      }

      const result = await pool.query(
        "INSERT INTO messages (username, message) VALUES ($1, $2) RETURNING id, username, message, created_at",
        [username, message]
      );

      const newMessage = result.rows[0];

      io.emit("receive_message", newMessage);
    } catch (err) {
      console.error("Lỗi Socket.IO gửi tin:", err.message);
    }
  });

  socket.on("disconnect", function () {
    console.log("Một người dùng đã rời chat:", socket.id);
  });
});

app.delete("/api/messages/:id", async function (req, res) {
  try {
    const messageId = req.params.id;

    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu ID tin nhắn."
      });
    }

    const result = await pool.query(
      "DELETE FROM messages WHERE id = $1 RETURNING id",
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tin nhắn."
      });
    }

    io.emit("delete_message", Number(messageId));

    res.json({
      success: true,
      message: "Đã xóa tin nhắn."
    });
  } catch (err) {
    console.error("Lỗi xóa tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi xóa tin nhắn."
    });
  }
});

app.put("/api/messages/:id", async function (req, res) {
  try {
    const messageId = req.params.id;
    const username = req.body.username ? req.body.username.trim() : "";
    const message = req.body.message ? req.body.message.trim() : "";

    if (!messageId || !username || !message) {
      return res.status(400).json({
        success: false,
        message: "Thiếu ID, tên người dùng hoặc nội dung tin nhắn."
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Tin nhắn quá dài."
      });
    }

    const result = await pool.query(
      `
      UPDATE messages
      SET message = $1
      WHERE id = $2 AND username = $3
      RETURNING id, username, message, created_at
      `,
      [message, messageId, username]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Bạn chỉ được sửa tin nhắn của chính mình."
      });
    }

    const updatedMessage = result.rows[0];

    io.emit("edit_message", updatedMessage);

    res.json({
      success: true,
      message: "Đã sửa tin nhắn.",
      updatedMessage: updatedMessage
    });
  } catch (err) {
    console.error("Lỗi sửa tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi sửa tin nhắn."
    });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, function () {
  console.log("Server đang chạy ở port " + PORT);
});