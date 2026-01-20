import net from "net";

const PORT = 15000;

const server = net.createServer((socket) => {
  console.log("📡 UDC Gateway Connected:", socket.remoteAddress);

  socket.on("data", (buf) => {
    console.log("📥 RAW ASCII:");
    console.log(buf.toString());
  });

  socket.on("close", () => console.log("🔌 Gateway disconnected"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UDC TCP Server listening on ${PORT}`);
});
