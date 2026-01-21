import net from "net";
import dotenv from "dotenv";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;
const IMEI = "865661071962420";

const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  socket.on("data", async (buffer) => {
    // RAW formats
    const hex = buffer.toString("hex");
    const ascii = buffer.toString("utf8");

    console.log("📥 RAW HEX   :", hex);
    console.log("📥 RAW ASCII:", ascii);

    // Store raw dump
    await IotReading.create({
      imei: IMEI,
      data: {
        rawHex: hex,
        rawAscii: ascii,
        length: buffer.length,
      },
    });

    // ACK (some gateways expect this)
    socket.write("OK\r\n");
  });

  socket.on("close", () => {
    console.log("🔌 Gateway disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 RAW TCP Server listening on port ${PORT}`);
});
