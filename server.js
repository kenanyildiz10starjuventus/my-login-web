// =======================
// ONLINE TRACKING
// =======================
// Thêm vào đầu file, sau khi khai báo io:

const onlineUsers = new Map();
// onlineUsers: Map<socketId, { username, email }>

// =======================
// THAY TOÀN BỘ io.on("connection") BẰNG ĐOẠN NÀY:
// =======================

io.on("connection", function (socket) {
  console.log("Một người dùng đã kết nối:", socket.id);

  // ── ONLINE TRACKING ──
  socket.on("user_online", function (data) {
    // data: { username, email }
    if (data && (data.username || data.email)) {
      onlineUsers.set(socket.id, {
        username: data.username || "",
        email: data.email || ""
      });
      io.emit("online_users", Array.from(onlineUsers.values()));
    }
  });

  // Chat phòng chung
  socket.on("send_message", async function (data) {
    try {
      const username = data.username ? data.username.trim() : "";
      const message = data.message ? data.message.trim() : "";

      if (!username || !message) return;
      if (message.length > 5000) return;

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
    if (!conversationId) return;
    socket.join("private_" + conversationId);
  });

  socket.on("send_private_message", async function (data) {
    try {
      const conversationId = data.conversationId;
      const senderEmail = data.senderEmail ? data.senderEmail.trim() : "";
      const senderName = data.senderName ? data.senderName.trim() : "";
      const message = data.message ? data.message.trim() : "";

      if (!conversationId || !senderEmail || !senderName || !message) return;
      if (message.length > 5000) return;

      const conversationCheck = await pool.query(
        `
        SELECT * FROM conversations
        WHERE id = $1 AND (user1_email = $2 OR user2_email = $2)
        `,
        [conversationId, senderEmail]
      );

      if (conversationCheck.rows.length === 0) return;

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
    onlineUsers.delete(socket.id);
    io.emit("online_users", Array.from(onlineUsers.values()));
  });
});