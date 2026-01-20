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

function parseFloatCDAB(buf, offset) {
  const reordered = Buffer.from([
    buf[offset + 2],
    buf[offset + 3],
    buf[offset + 0],
    buf[offset + 1],
  ]);
  return reordered.readFloatBE(0);
}

// ---------------- DEVICE MAP ----------------
const pollList = [
  // 🌡️ Temperature Indicator (Slave 1)
  {
    slave: 1,
    name: "temperature",
    addr: 44097,
    type: "short",
  },

  // ⚡ Energy Meter (Slave 2)
  { slave: 2, name: "energy", addr: 30001, type: "float" },
  { slave: 2, name: "power", addr: 30015, type: "float" },
  { slave: 2, name: "voltage", addr: 30021, type: "float" },
  { slave: 2, name: "current", addr: 30023, type: "float" },
  { slave: 2, name: "powerFactor", addr: 30025, type: "float" },
  { slave: 2, name: "frequency", addr: 30027, type: "float" },
];

// ---------------- TCP SERVER ----------------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let pollIndex = 0;
  let activePoll = null;

  const poll = () => {
    activePoll = pollList[pollIndex];

    const qty = activePoll.type === "short" ? 1 : 2;
    const func = activePoll.addr >= 40000 ? 0x04 : 0x03;

    const frame = buildModbusFrame(
      activePoll.slave,
      func,
      activePoll.addr - 1,
      qty
    );

    socket.write(frame);
    pollIndex = (pollIndex + 1) % pollList.length;
  };

  const pollTimer = setInterval(poll, 2000);

  socket.on("data", async (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    if (rxBuffer.length < 7) return;

    const byteCount = rxBuffer[2];
    if (rxBuffer.length < 3 + byteCount) return;

    const payload = rxBuffer.slice(3, 3 + byteCount);
    rxBuffer = Buffer.alloc(0);

    let value;
    if (activePoll.type === "short") {
      value = payload.readInt16BE(0);
    } else {
      value = parseFloatCDAB(payload, 0);
    }

    console.log(
      `🟢 LIVE DATA | Slave ${activePoll.slave} | ${activePoll.name}:`,
      value
    );

    await IotReading.create({
      imei: IMEI,
      data: {
        slave: activePoll.slave,
        parameter: activePoll.name,
        value,
      },
    });
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