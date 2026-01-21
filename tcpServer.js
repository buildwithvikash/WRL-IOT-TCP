import net from "net";
import dotenv from "dotenv";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = 15000;

const server = net.createServer((socket) => {
  console.log("📡 Device connected:", socket.remoteAddress);

  let buffer = Buffer.alloc(0);
  let imeiCaptured = false;

  socket.on("data", async (chunk) => {
    console.log("📥 RAW HEX :", chunk.toString("hex"));
    console.log("📥 RAW TXT :", chunk.toString());

    buffer = Buffer.concat([buffer, chunk]);

    if (imeiCaptured) return;

    const ascii = buffer.toString("ascii");

    // 🔑 Find first 15-digit IMEI
    const match = ascii.match(/\d{15}/);

    if (match) {
      const imei = match[0];
      imeiCaptured = true;

      console.log("🟢 IMEI RECEIVED:", imei);

      await IotReading.create({
        imei,
        data: { type: "registration" },
      });

      socket.write("OK\r\n");
    }

    // prevent buffer from growing forever
    if (buffer.length > 1024) {
      buffer = buffer.slice(-100);
    }
  });

  socket.on("close", () => {
    console.log("🔌 Device disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Transparent TCP server listening on ${PORT}`);
});
