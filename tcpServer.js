import net from "net";

const PORT = 15000;

net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  socket.on("data", (buf) => {
    // 🚫 Ignore HTTP scanners
    const ascii = buf.toString("ascii");
    if (
      ascii.startsWith("GET") ||
      ascii.startsWith("POST") ||
      ascii.includes("HTTP/1.")
    ) {
      console.log("🚫 Ignored HTTP scanner");
      return;
    }

    console.log("📥 UDC RAW HEX   :", buf.toString("hex"));
    console.log("📥 UDC RAW ASCII:", ascii.replace(/\0/g, ""));
  });

  socket.on("close", () => {
    console.log("🔌 Gateway disconnected");
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UDC TCP server listening on ${PORT}`);
});
