import net from "net";
import dotenv from "dotenv";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();

await connectMongo();

const PORT = process.env.PORT || 15000;

const server = net.createServer(socket => {
  console.log("📡 Device connected:", socket.remoteAddress);

  socket.on("data", async buffer => {
    const raw = buffer.toString().trim();
    console.log("📥 RAW DATA:", raw);

    // Parse: KEY=VALUE;KEY=VALUE;
    const parsed = {};
    raw.split(";").forEach(pair => {
      if (!pair) return;
      const [k, v] = pair.split("=");
      parsed[k] = v;
    });

    if (!parsed.IMEI) {
      console.log("❌ IMEI missing");
      return;
    }

    await IotReading.create({
      imei: parsed.IMEI,
      data: parsed
    });

    console.log("💾 Data saved for IMEI:", parsed.IMEI);
  });

  socket.on("close", () => {
    console.log("🔌 Device disconnected");
  });

  socket.on("error", err => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 TCP Server running on port ${PORT}`);
});



