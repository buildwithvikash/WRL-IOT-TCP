import net from "net";
import dotenv from "dotenv";
import crc from "crc";
import { connectMongo } from "./mongo.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;

// -------- CONFIG --------
const SLAVES = [1,2,3,4,5,6,7,8,9,10];
const START_REG = 30001;
const END_REG   = 30100;

// -------- MODBUS HELPERS --------
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

// FLOAT CDAB
function parseFloatCDAB(buf, offset) {
  const reordered = Buffer.from([
    buf[offset + 2],
    buf[offset + 3],
    buf[offset + 0],
    buf[offset + 1],
  ]);
  return reordered.readFloatBE(0);
}

// -------- TCP SERVER --------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let waiting = false;

  let slaveIndex = 0;
  let currentRegister = START_REG;

  const poll = () => {
    if (waiting) return;

    const slave = SLAVES[slaveIndex];

    console.log(`🔎 SLAVE ${slave} | REGISTER ${currentRegister}`);

    const frame = buildModbusFrame(
      slave,
      0x04,                 // Read Input Registers
      currentRegister - 1,
      2                     // 2 registers = float
    );

    waiting = true;
    socket.write(frame);

    setTimeout(() => {
      if (waiting) {
        console.log(`⏱️ Timeout @ slave ${slave}, reg ${currentRegister}`);
        waiting = false;

        slaveIndex = (slaveIndex + 1) % SLAVES.length;
        if (slaveIndex === 0) currentRegister += 2;
        if (currentRegister > END_REG) currentRegister = START_REG;
      }
    }, 1500);
  };

  const timer = setInterval(poll, 1200);

  socket.on("data", (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    // 🧹 Strip ASCII IMEI if present
    while (rxBuffer.length >= 15) {
      const ascii = rxBuffer.slice(0, 15).toString();
      if (/^\d{15}$/.test(ascii)) {
        console.log("🧹 Stripped IMEI:", ascii);
        rxBuffer = rxBuffer.slice(15);
      } else break;
    }

    // Need minimum Modbus frame
    if (rxBuffer.length < 7) return;

    const slave = rxBuffer[0];
    const func  = rxBuffer[1];

    if (func & 0x80) {
      console.log(`❌ Modbus exception from slave ${slave}`);
      rxBuffer = rxBuffer.slice(5);
      waiting = false;
      return;
    }

    const byteCount = rxBuffer[2];
    const frameLen = 3 + byteCount + 2;
    if (rxBuffer.length < frameLen) return;

    const frame = rxBuffer.slice(0, frameLen);
    rxBuffer = rxBuffer.slice(frameLen);
    waiting = false;

    const crcRx = frame.readUInt16LE(frameLen - 2);
    const crcCalc = crc.crc16modbus(frame.slice(0, frameLen - 2));
    if (crcRx !== crcCalc) {
      console.log("❌ CRC mismatch:", frame.toString("hex"));
      return;
    }

    const payload = frame.slice(3, 3 + byteCount);
    const value = parseFloatCDAB(payload, 0);

    console.log(
      `✅ FOUND → Slave ${slave}, Register ${currentRegister}, Value = ${value}`
    );

    slaveIndex = (slaveIndex + 1) % SLAVES.length;
    if (slaveIndex === 0) currentRegister += 2;
    if (currentRegister > END_REG) currentRegister = START_REG;
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
