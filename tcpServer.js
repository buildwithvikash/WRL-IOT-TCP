import net from "net";
import dotenv from "dotenv";
import crc from "crc";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;
const IMEI = "865661071962420";

// ---------------- MODBUS HELPERS ----------------
function buildModbusFrame(slave, func, start, qty) {
  const buf = Buffer.alloc(6);
  buf.writeUInt8(slave, 0);
  buf.writeUInt8(func, 1);
  buf.writeUInt16BE(start, 2);
  buf.writeUInt16BE(qty, 4);

  const crc16 = crc.crc16modbus(buf);
  return Buffer.concat([
    buf,
    Buffer.from([crc16 & 0xff, (crc16 >> 8) & 0xff]),
  ]);
}

// FLOAT CDAB (most common for energy meters)
function parseFloatCDAB(buf, offset) {
  const reordered = Buffer.from([
    buf[offset + 2],
    buf[offset + 3],
    buf[offset + 0],
    buf[offset + 1],
  ]);
  return reordered.readFloatBE(0);
}

// ---------------- TCP SERVER ----------------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let waiting = false;

  // 🔍 REGISTER SCAN RANGE
  let currentRegister = 30001;
  const END_REGISTER = 30100;

  const scan = () => {
    if (waiting) return;

    const frame = buildModbusFrame(
      2,              // Slave ID (Energy meter)
      0x03,           // Read Holding Registers
      currentRegister - 1,
      2               // 2 registers = 1 float
    );

    console.log(`🔎 SCANNING REGISTER ${currentRegister}`);
    waiting = true;
    socket.write(frame);
  };

  const timer = setInterval(scan, 1500);

  socket.on("data", async (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    if (rxBuffer.length < 7) return;

    const byteCount = rxBuffer[2];
    const frameLen = 3 + byteCount + 2;
    if (rxBuffer.length < frameLen) return;

    const frame = rxBuffer.slice(0, frameLen);
    rxBuffer = rxBuffer.slice(frameLen);
    waiting = false;

    console.log("📥 RAW HEX:", frame.toString("hex"));

    // CRC validation
    const crcRx = frame.readUInt16LE(frameLen - 2);
    const crcCalc = crc.crc16modbus(frame.slice(0, frameLen - 2));
    if (crcRx !== crcCalc) {
      console.log("❌ CRC mismatch");
      return;
    }

    const payload = frame.slice(3, 3 + byteCount);

    let value = 0;
    if (byteCount === 4) {
      value = parseFloatCDAB(payload, 0);
    }

    console.log(
      `📊 Register ${currentRegister} →`,
      value
    );

    // Save only meaningful values
    if (value !== 0 && !Number.isNaN(value)) {
      await IotReading.create({
        imei: IMEI,
        data: {
          slave: 2,
          register: currentRegister,
          value,
        },
      });
    }

    currentRegister += 2;
    if (currentRegister > END_REGISTER) {
      currentRegister = 30001;
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
