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

// Kết nối database Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.on("error", function (err) {
  console.error("Lỗi Postgres pool:", err.message);
});

pool.query("SELECT NOW()")
  .then(function () {
    console.log("Đã kết nối database Postgres");
  })
  .catch(function (err) {
    console.error("Lỗi kết nối Postgres:", err.message);
  });
// =======================
// TẠO BẢNG DATABASE
// =======================

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
pool.query(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, username, emoji)
  )
`).catch(function (err) {
  console.error("Lỗi tạo bảng message_reactions:", err.message);
});

pool.query(`
  ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id INTEGER
`).catch(function (err) {
  console.error("Lỗi thêm cột reply_to_id:", err.message);
});

pool.query(`
  ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_username TEXT
`).catch(function (err) {
  console.error("Lỗi thêm cột reply_to_username:", err.message);
});

pool.query(`
  ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message TEXT
`).catch(function (err) {
  console.error("Lỗi thêm cột reply_to_message:", err.message);
});

pool.query(`
  CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user1_email TEXT NOT NULL,
    user2_email TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user1_email, user2_email)
  )
`).catch(function (err) {
  console.error("Lỗi tạo bảng conversations:", err.message);
});

pool.query(`
  CREATE TABLE IF NOT EXISTS private_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_email TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).catch(function (err) {
  console.error("Lỗi tạo bảng private_messages:", err.message);
});

// =======================
// API KIỂM TRA SERVER
// =======================

app.get("/api", function (req, res) {
  res.json({
    success: true,
    message: "Backend API đang chạy!"
  });
});

// =======================
// API TÀI KHOẢN
// =======================

// Đăng ký
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
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (checkResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email này đã được đăng ký"
      });
    }

    const insertResult = await pool.query(
      `
      INSERT INTO users (name, email, password)
      VALUES ($1, $2, $3)
      RETURNING id, name, email
      `,
      [name, email, password]
    );

    res.status(201).json({
      success: true,
      message: "Đăng ký tài khoản thành công",
      user: insertResult.rows[0]
    });
  } catch (err) {
    console.error("Lỗi đăng ký:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo tài khoản"
    });
  }
});

// Đăng nhập
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

// Cập nhật profile
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
      `
      UPDATE users
      SET name = $1, email = $2
      WHERE email = $3
      RETURNING id, name, email
      `,
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

// Đổi mật khẩu
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

// Lấy danh sách user
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

// Xóa user theo id
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

// Xóa tài khoản
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

// =======================
// API CHAT PHÒNG CHUNG
// =======================

// Lấy tin nhắn phòng chung
app.get("/api/messages", async function (req, res) {
  try {
   const result = await pool.query(
  `
  SELECT 
    m.id,
    m.username,
    m.message,
    m.created_at,
    m.reply_to_id,
    m.reply_to_username,
    m.reply_to_message,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'emoji', r.emoji,
            'count', r.total_count
          )
        )
        FROM (
          SELECT emoji, COUNT(*) AS total_count
          FROM message_reactions
          WHERE message_id = m.id
          GROUP BY emoji
          ORDER BY emoji
        ) r
      ),
      '[]'::json
    ) AS reactions
  FROM messages m
  ORDER BY m.id ASC
  LIMIT 300
  `
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

// Gửi tin nhắn phòng chung bằng API thường
app.post("/api/messages", async function (req, res) {
  try {
    const username = req.body.username ? req.body.username.trim() : "";
    const message = req.body.message ? req.body.message.trim() : "";
    const replyToId = req.body.replyToId || null;
    const replyToUsername = req.body.replyToUsername || null;
    const replyToMessage = req.body.replyToMessage || null;

    if (!username || !message) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tên người dùng hoặc tin nhắn."
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Tin nhắn quá dài."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO messages
      (username, message, reply_to_id, reply_to_username, reply_to_message)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, message, created_at,
                reply_to_id, reply_to_username, reply_to_message
      `,
      [username, message, replyToId, replyToUsername, replyToMessage]
    );

    const newMessage = result.rows[0];

    io.emit("receive_message", newMessage);

    res.json({
      success: true,
      message: "Đã gửi tin nhắn.",
      newMessage: newMessage
    });
  } catch (err) {
    console.error("Lỗi gửi tin nhắn:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi tin nhắn."
    });
  }
});

// Xóa tin nhắn phòng chung
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

// Sửa tin nhắn phòng chung
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

    if (message.length > 5000) {
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
      RETURNING id, username, message, created_at,
                reply_to_id, reply_to_username, reply_to_message
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

// =======================
// API CHAT RIÊNG 1V1
// =======================

// Lấy danh sách user để chat riêng
app.get("/api/chat-users", async function (req, res) {
  try {
    const currentEmail = req.query.email ? req.query.email.trim() : "";

    if (!currentEmail) {
      return res.status(400).json({
        success: false,
        message: "Thiếu email người dùng hiện tại."
      });
    }

    const result = await pool.query(
      "SELECT id, name, email FROM users WHERE email != $1 ORDER BY name ASC",
      [currentEmail]
    );

    res.json({
      success: true,
      users: result.rows
    });
  } catch (err) {
    console.error("Lỗi lấy danh sách chat users:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách người dùng."
    });
  }
});

// Tạo hoặc lấy cuộc trò chuyện 1v1
app.post("/api/conversation", async function (req, res) {
  try {
    const currentEmail = req.body.currentEmail ? req.body.currentEmail.trim() : "";
    const otherEmail = req.body.otherEmail ? req.body.otherEmail.trim() : "";

    if (!currentEmail || !otherEmail) {
      return res.status(400).json({
        success: false,
        message: "Thiếu email người dùng."
      });
    }

    if (currentEmail === otherEmail) {
      return res.status(400).json({
        success: false,
        message: "Không thể tự nhắn với chính mình."
      });
    }

    const checkUsers = await pool.query(
      "SELECT id, name, email FROM users WHERE email = $1 OR email = $2",
      [currentEmail, otherEmail]
    );

    if (checkUsers.rows.length < 2) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đủ 2 người dùng."
      });
    }

    const sortedEmails = [currentEmail, otherEmail].sort();
    const user1Email = sortedEmails[0];
    const user2Email = sortedEmails[1];

    const conversationResult = await pool.query(
      `
      INSERT INTO conversations (user1_email, user2_email)
      VALUES ($1, $2)
      ON CONFLICT (user1_email, user2_email)
      DO UPDATE SET user1_email = EXCLUDED.user1_email
      RETURNING id, user1_email, user2_email, created_at
      `,
      [user1Email, user2Email]
    );

    res.json({
      success: true,
      conversation: conversationResult.rows[0]
    });
  } catch (err) {
    console.error("Lỗi tạo/lấy conversation:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo cuộc trò chuyện."
    });
  }
});

// Lấy tin nhắn riêng 1v1
app.get("/api/private-messages/:conversationId", async function (req, res) {
  try {
    const conversationId = req.params.conversationId;
    const email = req.query.email ? req.query.email.trim() : "";

    if (!conversationId || !email) {
      return res.status(400).json({
        success: false,
        message: "Thiếu conversationId hoặc email."
      });
    }

    const conversationCheck = await pool.query(
      `
      SELECT * FROM conversations
      WHERE id = $1 AND (user1_email = $2 OR user2_email = $2)
      `,
      [conversationId, email]
    );

    if (conversationCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xem cuộc trò chuyện này."
      });
    }

    const messagesResult = await pool.query(
      `
      SELECT id, conversation_id, sender_email, sender_name, message, created_at
      FROM private_messages
      WHERE conversation_id = $1
      ORDER BY id ASC
      LIMIT 300
      `,
      [conversationId]
    );

    res.json({
      success: true,
      messages: messagesResult.rows
    });
  } catch (err) {
    console.error("Lỗi lấy private messages:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy tin nhắn riêng."
    });
  }
});

// =======================
// SOCKET.IO
// =======================

app.post("/api/messages/:id/reactions", async function (req, res) {
  try {
    const messageId = req.params.id;
    const username = req.body.username ? req.body.username.trim() : "";
    const emoji = req.body.emoji ? req.body.emoji.trim() : "";

    if (!messageId || !username || !emoji) {
      return res.status(400).json({
        success: false,
        message: "Thiếu ID tin nhắn, username hoặc emoji."
      });
    }

    const messageCheck = await pool.query(
      "SELECT id FROM messages WHERE id = $1",
      [messageId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tin nhắn."
      });
    }

    const existingReaction = await pool.query(
      `
      SELECT id 
      FROM message_reactions
      WHERE message_id = $1 AND username = $2 AND emoji = $3
      `,
      [messageId, username, emoji]
    );

    if (existingReaction.rows.length > 0) {
      await pool.query(
        `
        DELETE FROM message_reactions
        WHERE message_id = $1 AND username = $2 AND emoji = $3
        `,
        [messageId, username, emoji]
      );
    } else {
      await pool.query(
        `
        INSERT INTO message_reactions (message_id, username, emoji)
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id, username, emoji) DO NOTHING
        `,
        [messageId, username, emoji]
      );
    }

    const reactionsResult = await pool.query(
      `
      SELECT emoji, COUNT(*) AS count
      FROM message_reactions
      WHERE message_id = $1
      GROUP BY emoji
      ORDER BY emoji
      `,
      [messageId]
    );

    const reactions = reactionsResult.rows.map(function (item) {
      return {
        emoji: item.emoji,
        count: Number(item.count)
      };
    });

    io.emit("update_message_reactions", {
      messageId: Number(messageId),
      reactions: reactions
    });

    res.json({
      success: true,
      message: "Đã cập nhật reaction.",
      messageId: Number(messageId),
      reactions: reactions
    });
  } catch (err) {
    console.error("Lỗi reaction:", err.message);

    res.status(500).json({
      success: false,
      message: "Lỗi server khi reaction."
    });
  }
});

async function callOpenRouterAI(question) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Server chưa có OPENROUTER_API_KEY.");
  }

  const openRouterResponse = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nthxinhgai.onrender.com",
        "X-Title": "QUANOS AI"
      },
      body: JSON.stringify({
        model: "qwen/qwen3-8b:free",
        messages: [
          {
            role: "system",
            content:
              "Bạn là QUANOS AI, trợ lý trong website cá nhân của Quân. " +
              "Luôn trả lời bằng tiếng Việt tự nhiên như đang chat với người dùng. " +
              "Nếu câu người dùng ngắn, mơ hồ, hoặc giống tin nhắn trò chuyện, hãy trả lời ngắn gọn trong 1-3 câu. " +
              "Nếu người dùng nói đùa, nói cảm xúc, hoặc nhắn kiểu chat, hãy phản hồi tự nhiên, không biến thành bài giải thích dài. " +
              "Chỉ trả lời dài khi người dùng hỏi về code, lỗi, web, hướng dẫn từng bước, hoặc yêu cầu giải thích chi tiết. " +
              "Nếu không chắc người dùng muốn hỏi gì, hãy hỏi lại một câu ngắn thay vì đoán quá xa. " +
              "Không dùng markdown quá nhiều. Không tự cắt ngang câu."
          },
          {
            role: "user",
            content: question
          }
        ],
        temperature: 0.8,
        max_tokens: 1200
      })
    }
  );

  const data = await openRouterResponse.json();

  if (!openRouterResponse.ok) {
    console.error("Lỗi OpenRouter:", JSON.stringify(data, null, 2));

    throw new Error(
      data.error && data.error.message
        ? data.error.message
        : "OpenRouter đang lỗi."
    );
  }

  const answer =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
      ? data.choices[0].message.content
      : "OpenRouter chưa trả lời được câu này.";

  return answer;
}

app.post("/api/ai", async function (req, res) {
  try {
    const question = req.body.question ? req.body.question.trim() : "";

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Bạn chưa nhập câu hỏi."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Server chưa có GEMINI_API_KEY."
      });
    }

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                     "Bạn là QUANOS AI, trợ lý trong website cá nhân của Quân. " +
                    "Luôn trả lời bằng tiếng Việt tự nhiên như đang chat với người dùng. " +
                    "Không tự nhận là bạn đã nhớ, đã nắm rõ yêu cầu, hoặc sẽ luôn tuân thủ điều gì nếu người dùng không hỏi về việc đó. " +
                    "Nếu câu người dùng ngắn, mơ hồ, hoặc giống tin nhắn trò chuyện, hãy trả lời ngắn gọn trong 1-3 câu. " +
                    "Nếu người dùng nói đùa, nói cảm xúc, hoặc nhắn kiểu chat, hãy phản hồi tự nhiên, không biến thành bài giải thích dài. " +
                     "Chỉ trả lời dài khi người dùng hỏi về code, lỗi, web, hướng dẫn từng bước, hoặc yêu cầu giải thích chi tiết. " +
                      "Nếu không chắc người dùng muốn hỏi gì, hãy hỏi lại một câu ngắn thay vì đoán quá xa. " +
                     "Không dùng markdown quá nhiều. Không tự cắt ngang câu. " +
                        "Câu hỏi của người dùng: " +
                    question
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
  console.error("Lỗi Gemini:", JSON.stringify(data, null, 2));

  const errorMessage =
    data.error && data.error.message ? data.error.message : "";

  if (
  geminiResponse.status === 429 ||
  errorMessage.toLowerCase().includes("quota") ||
  errorMessage.toLowerCase().includes("rate") ||
  errorMessage.toLowerCase().includes("limit")
) {
  try {
    console.log("Gemini hết quota, đang chuyển sang OpenRouter...");

    const fallbackAnswer = await callOpenRouterAI(question);

    return res.json({
      success: true,
      answer:
        fallbackAnswer 
    });
  } catch (fallbackError) {
    console.error("OpenRouter fallback lỗi:", fallbackError.message);

    return res.status(429).json({
      success: false,
      message:
        "Gemini đang hết lượt miễn phí và OpenRouter dự phòng cũng chưa dùng được. Kiểm tra OPENROUTER_API_KEY hoặc thử lại sau nhé."
    });
  }
}

  return res.status(500).json({
    success: false,
    message: "AI đang lỗi. Kiểm tra API key hoặc Render Logs nhé."
  });
}
    const answer =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text
        ? data.candidates[0].content.parts[0].text
        : "AI chưa trả lời được câu này.";

    res.json({
      success: true,
      answer: answer
    });
  } catch (error) {
    console.error("Lỗi /api/ai:", error.message);

    res.status(500).json({
      success: false,
      message: "Server không gọi được Gemini AI."
    });
  }
});

io.on("connection", function (socket) {
  console.log("Một người dùng đã kết nối:", socket.id);

  // Chat phòng chung
  socket.on("send_message", async function (data) {
    try {
      const username = data.username ? data.username.trim() : "";
      const message = data.message ? data.message.trim() : "";

      if (!username || !message) {
        return;
      }

      if (message.length > 5000) {
        return;
      }

      const replyToId = data.replyToId || null;
      const replyToUsername = data.replyToUsername || null;
      const replyToMessage = data.replyToMessage || null;

      const result = await pool.query(
        `
        INSERT INTO messages
        (username, message, reply_to_id, reply_to_username, reply_to_message)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, username, message, created_at,
                  reply_to_id, reply_to_username, reply_to_message
        `,
        [username, message, replyToId, replyToUsername, replyToMessage]
      );

      const newMessage = result.rows[0];

      io.emit("receive_message", newMessage);
    } catch (err) {
      console.error("Lỗi Socket.IO gửi tin phòng chung:", err.message);
    }
  });

  socket.on("typing", function (username) {
    socket.broadcast.emit("user_typing", username);
  });

  socket.on("stop_typing", function () {
    socket.broadcast.emit("user_stop_typing");
  });

  // Chat riêng 1v1
  socket.on("join_private_chat", function (conversationId) {
    if (!conversationId) {
      return;
    }

    socket.join("private_" + conversationId);
  });

  socket.on("send_private_message", async function (data) {
    try {
      const conversationId = data.conversationId;
      const senderEmail = data.senderEmail ? data.senderEmail.trim() : "";
      const senderName = data.senderName ? data.senderName.trim() : "";
      const message = data.message ? data.message.trim() : "";

      if (!conversationId || !senderEmail || !senderName || !message) {
        return;
      }

      if (message.length > 5000) {
        return;
      }

      const conversationCheck = await pool.query(
        `
        SELECT * FROM conversations
        WHERE id = $1 AND (user1_email = $2 OR user2_email = $2)
        `,
        [conversationId, senderEmail]
      );

      if (conversationCheck.rows.length === 0) {
        return;
      }

      const result = await pool.query(
        `
        INSERT INTO private_messages
        (conversation_id, sender_email, sender_name, message)
        VALUES ($1, $2, $3, $4)
        RETURNING id, conversation_id, sender_email, sender_name, message, created_at
        `,
        [conversationId, senderEmail, senderName, message]
      );

      const newMessage = result.rows[0];

      io.to("private_" + conversationId).emit("receive_private_message", newMessage);
    } catch (err) {
      console.error("Lỗi gửi private message:", err.message);
    }
  });

  socket.on("disconnect", function () {
    console.log("Một người dùng đã rời:", socket.id);
  });
});

// =======================
// CHẠY SERVER
// =======================

const PORT = process.env.PORT || 3000;

server.listen(PORT, function () {
  console.log("Server đang chạy ở port " + PORT);
});