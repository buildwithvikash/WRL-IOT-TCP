import net from "net";
import dotenv from "dotenv";
import crc from "crc";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = 15000;
const IMEI = "865661071962420";

// ---------- FLOAT CDAB ----------
function parseFloatCDAB(buf, offset) {
  const b = Buffer.from([
    buf[offset + 2],
    buf[offset + 3],
    buf[offset + 0],
    buf[offset + 1],
  ]);
  return b.readFloatBE(0);
}

// ---------- TCP SERVER ----------
const server = net.createServer((socket) => {
  console.log("📡 Modbus Gateway Connected:", socket.remoteAddress);

  let buffer = Buffer.alloc(0);

  socket.on("data", async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 7) {
      const slave = buffer[0];
      const func = buffer[1];
      const byteCount = buffer[2];
      const frameLen = 3 + byteCount + 2;

      if (buffer.length < frameLen) break;

      const frame = buffer.slice(0, frameLen);
      buffer = buffer.slice(frameLen);

      // CRC check
      const crcRx = frame.readUInt16LE(frameLen - 2);
      const crcCalc = crc.crc16modbus(frame.slice(0, frameLen - 2));
      if (crcRx !== crcCalc) {
        console.log("❌ CRC error");
        continue;
      }

      const payload = frame.slice(3, 3 + byteCount);

      // 🌡️ TEMPERATURE (Slave 1)
      if (slave === 1 && func === 0x04) {
        const raw = payload.readInt16BE(0);
        const temperature = raw / 10;

        console.log(`🌡️ TEMP: ${temperature} °C`);

        await IotReading.create({
          imei: IMEI,
          data: { temperature },
        });
      }

      // ⚡ ENERGY METER (Slave 2)
      if (slave === 2 && func === 0x03) {
        const data = {
          energy: parseFloatCDAB(payload, 0),
          power: parseFloatCDAB(payload, 28),
          voltage: parseFloatCDAB(payload, 40),
          current: parseFloatCDAB(payload, 44),
          powerFactor: parseFloatCDAB(payload, 48),
          frequency: parseFloatCDAB(payload, 52),
        };

        console.log("⚡ ENERGY:", data);

        await IotReading.create({
          imei: IMEI,
          data,
        });
      }
    }
  });

  socket.on("close", () => console.log("🔌 Gateway disconnected"));
  socket.on("error", (e) => console.error("⚠️ Socket error:", e.message));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Modbus TCP Server listening on ${PORT}`);
});
