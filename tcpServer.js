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

function parseFloatDCBA(buf, offset) {
  const reordered = Buffer.from([
    buf[offset + 3],
    buf[offset + 2],
    buf[offset + 1],
    buf[offset + 0],
  ]);
  return reordered.readFloatBE(0);
}

// ---------------- POLL DEFINITIONS ----------------
const polls = [
  {
    type: "temperature",
    slave: 1,
    func: 0x04,
    start: 44097,
    qty: 1,
  },
  {
    type: "energyBulk",
    slave: 2,
    func: 0x03,
    start: 30001,
    qty: 28,
  },
];

// ---------------- TCP SERVER ----------------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let pollIndex = 0;
  let activePoll = null;

  const poll = () => {
    activePoll = polls[pollIndex];

    const frame = buildModbusFrame(
      activePoll.slave,
      activePoll.func,
      activePoll.start - 1,
      activePoll.qty
    );

    socket.write(frame);
    pollIndex = (pollIndex + 1) % polls.length;
  };

  const pollTimer = setInterval(poll, 2000);

  socket.on("data", async (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    if (rxBuffer.length < 7) return;

    const byteCount = rxBuffer[2];
    if (rxBuffer.length < 3 + byteCount) return;

    const payload = rxBuffer.slice(3, 3 + byteCount);
    rxBuffer = Buffer.alloc(0);

    // 🌡️ TEMPERATURE
    if (activePoll.type === "temperature") {
      const temperature = payload.readInt16BE(0);
      console.log(`🟢 LIVE DATA | Temp: ${temperature}`);

      await IotReading.create({
        imei: IMEI,
        data: { temperature },
      });
    }

    // ⚡ ENERGY METER (BULK)
    if (activePoll.type === "energyBulk") {
      const data = {
        energy: parseFloatDCBA(payload, 0),
        power: parseFloatDCBA(payload, 28),
        voltage: parseFloatDCBA(payload, 40),
        current: parseFloatDCBA(payload, 44),
        powerFactor: parseFloatDCBA(payload, 48),
        frequency: parseFloatDCBA(payload, 52),
      };

      console.log("🟢 LIVE ENERGY DATA:", data);

      await IotReading.create({
        imei: IMEI,
        data,
      });
    }
  });

  socket.on("close", () => {
    clearInterval(pollTimer);
    console.log("🔌 Gateway disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 TCP Server running on port ${PORT}`);
});
