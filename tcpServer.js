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

// ---------------- POLLS ----------------
const polls = [
  { name: "temperature", slave: 1, func: 0x04, start: 44097, qty: 1 },
  { name: "energy", slave: 2, func: 0x03, start: 30001, qty: 28 },
];

// ---------------- TCP SERVER ----------------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let pollIndex = 0;
  let activePoll = null;
  let waiting = false;

  const poll = () => {
    if (waiting) return;

    activePoll = polls[pollIndex];
    pollIndex = (pollIndex + 1) % polls.length;

    const frame = buildModbusFrame(
      activePoll.slave,
      activePoll.func,
      activePoll.start - 1,
      activePoll.qty
    );

    waiting = true;
    socket.write(frame);
  };

  const timer = setInterval(poll, 2000);

  socket.on("data", async (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);
    if (rxBuffer.length < 7) return;

    const byteCount = rxBuffer[2];
    const frameLength = 3 + byteCount + 2;
    if (rxBuffer.length < frameLength) return;

    const frame = rxBuffer.slice(0, frameLength);
    rxBuffer = rxBuffer.slice(frameLength);
    waiting = false;

    // CRC
    const crcRx = frame.readUInt16LE(frameLength - 2);
    const crcCalc = crc.crc16modbus(frame.slice(0, frameLength - 2));
    if (crcRx !== crcCalc) return;

    const payload = frame.slice(3, 3 + byteCount);

    // 🔎 DEBUG (KEEP FOR NOW)
    console.log("📦 RAW HEX:", payload.toString("hex"));

    // 🌡️ TEMPERATURE
    if (activePoll.name === "temperature") {
      const temperature = payload.readInt16BE(0) / 10;
      console.log(`🌡️ LIVE TEMP: ${temperature} °C`);

      await IotReading.create({
        imei: IMEI,
        data: { temperature },
      });
    }

    // ⚡ ENERGY BULK
    if (activePoll.name === "energy") {
      const data = {
        energy: parseFloatCDAB(payload, 0),
        power: parseFloatCDAB(payload, 28),
        voltage: parseFloatCDAB(payload, 40),
        current: parseFloatCDAB(payload, 44),
        powerFactor: parseFloatCDAB(payload, 48),
        frequency: parseFloatCDAB(payload, 52),
      };

      console.log("⚡ LIVE ENERGY:", data);

      await IotReading.create({
        imei: IMEI,
        data,
      });
    }
  });

  socket.on("close", () => {
    clearInterval(timer);
    console.log("🔌 Gateway disconnected");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 TCP Server running on port ${PORT}`);
});
