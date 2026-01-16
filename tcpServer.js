import net from "net";
import dotenv from "dotenv";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;

const server = net.createServer((socket) => {
  console.log("📡 Device connected:", socket.remoteAddress);

  let bufferData = ""; // 🔴 IMPORTANT: TCP buffer

  socket.on("data", async (chunk) => {
    bufferData += chunk.toString();

    // Wait until a full packet is received
    if (!bufferData.includes("\n") && !bufferData.includes(";")) {
      return;
    }

    const raw = bufferData.trim();
    bufferData = ""; // clear buffer

    console.log("📥 RAW DATA:", raw);

    /* -----------------------------
       CASE 1: Registration packet
       ----------------------------- */
    if (/^\d{15}$/.test(raw)) {
      console.log(`🟢 REGISTRATION IMEI: ${raw}`);

      await IotReading.create({
        imei: raw,
        data: { type: "registration" },
      });

      socket.write("OK\r\n");
      return;
    }

    /* -----------------------------
       CASE 2: Telemetry packet
       ----------------------------- */
    const parsed = {};
    raw.split(";").forEach((pair) => {
      if (!pair) return;
      const [k, v] = pair.split("=");
      if (k && v) parsed[k.trim()] = v.trim();
    });

    if (!parsed.IMEI) {
      console.log("❌ IMEI missing in telemetry packet");
      return;
    }

    console.log(
      `🟢 LIVE DATA | IMEI: ${parsed.IMEI}`,
      parsed
    );

    await IotReading.create({
      imei: parsed.IMEI,
      data: parsed,
    });

    socket.write("OK\r\n"); // ACK to device
  });

  socket.on("close", () => {
    console.log("🔌 Device disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 TCP Server running on port ${PORT}`);
});
