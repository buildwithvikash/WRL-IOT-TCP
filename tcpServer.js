import net from "net";
import dotenv from "dotenv";
import crc from "crc";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;
const IMEI = "865661071962420";

// ---------------- MODBUS FRAME ----------------
function buildModbusFrame(slave, func, start, qty) {
  const buf = Buffer.alloc(6);
  buf.writeUInt8(slave, 0);
  buf.writeUInt8(func, 1);
  buf.writeUInt16BE(start, 2);
  buf.writeUInt16BE(qty, 4);

  const crc16 = crc.crc16modbus(buf);
  return Buffer.concat([buf, Buffer.from([crc16 & 0xff, (crc16 >> 8) & 0xff])]);
}

// ---------------- TCP SERVER ----------------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let waiting = false;

  const pollTemperature = () => {
    if (waiting) return;

    const frame = buildModbusFrame(
      1, // ✅ Slave ID = 1
      0x04, // ✅ Read Input Registers
      44097 - 1, // Modbus offset
      1 // 1 register (INT16)
    );

    waiting = true;
    socket.write(frame);
  };

  const timer = setInterval(pollTemperature, 2000);

  socket.on("data", (buf) => {
    console.log("📥 RAW HEX   :", buf.toString("hex"));
    console.log("📥 RAW ASCII:", buf.toString("ascii"));

    // Extract readable content
    const ascii = buf.toString("ascii").replace(/\0/g, "");

    // Example: extract temperature number (adjust after seeing final format)
    const match = ascii.match(/(-?\d+(\.\d+)?)/);
    if (match) {
      const temperature = Number(match[1]) / 10; // if scaled
      console.log("🌡️ TEMPERATURE:", temperature);
    }
  });

  socket.on("close", () => {
    clearInterval(timer);
    console.log("🔌 Gateway disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 TCP Server running on port ${PORT}`);
});
