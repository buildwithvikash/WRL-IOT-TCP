import net from "net";

const PORT = 15000;

const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  socket.on("data", (buf) => {
    console.log("📥 RAW HEX   :", buf.toString("hex"));
    console.log("📥 RAW ASCII:", buf.toString());
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
