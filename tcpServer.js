import net from "net";

const PORT = 15000;

const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    console.log("📥 RAW HEX :", chunk.toString("hex"));
    console.log("📥 RAW TXT :", chunk.toString("ascii"));

    // Extract IMEI if present
    const ascii = buffer.toString("ascii");
    const match = ascii.match(/\d{15}/);
    if (match) {
      console.log("🟢 IMEI FOUND:", match[0]);
    }

    // Prevent infinite buffer
    if (buffer.length > 2048) {
      buffer = buffer.slice(-256);
    }
  });

  socket.on("close", () => {
    console.log("🔌 Gateway disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Transparent TCP server listening on ${PORT}`);
});
