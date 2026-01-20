import net from "net";
import dotenv from "dotenv";
import crc from "crc";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;

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
  { slave: 1, name: "temperature", addr: 44097, type: "short" },
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

  socket.imei = null;
  socket.pollTimer = null;

  let rxBuffer = Buffer.alloc(0);
  let pollIndex = 0;
  let activePoll = null;
  let waitingResponse = false;

  const poll = () => {
    if (!socket.imei || waitingResponse) return;

    activePoll = pollList[pollIndex];

    const qty = activePoll.type === "short" ? 1 : 2;
    const func = activePoll.addr >= 40000 ? 0x04 : 0x03;

    const frame = buildModbusFrame(
      activePoll.slave,
      func,
      activePoll.addr - 1,
      qty
    );

    waitingResponse = true;
    socket.write(frame);

    pollIndex = (pollIndex + 1) % pollList.length;
  };

  socket.on("data", async (data) => {
    // 🔍 RAW LOG (keep for now)
    console.log("⬇ RAW:", data.toString("hex"), JSON.stringify(data.toString()));

    // ---------- IMEI REGISTRATION ----------
    if (!socket.imei) {
      const msg = data.toString().trim();
      const imeiMatch = msg.match(/\d{15}/);

      if (imeiMatch) {
        socket.imei = imeiMatch[0];
        console.log("📱 IMEI REGISTERED:", socket.imei);

        // 🔥 START POLLING ONLY AFTER IMEI
        socket.pollTimer = setInterval(poll, 2000);
      }
      return;
    }

    // ---------- MODBUS RESPONSE ----------
    rxBuffer = Buffer.concat([rxBuffer, data]);

    if (rxBuffer.length < 7) return;

    const byteCount = rxBuffer[2];
    const frameLength = 3 + byteCount + 2;

    if (rxBuffer.length < frameLength) return;

    const payload = rxBuffer.slice(3, 3 + byteCount);
    rxBuffer = rxBuffer.slice(frameLength);

    let value;
    if (activePoll.type === "short") {
      value = payload.readInt16BE(0);
    } else {
      value = parseFloatCDAB(payload, 0);
    }

    waitingResponse = false;

    console.log(
      `🟢 LIVE DATA | IMEI ${socket.imei} | Slave ${activePoll.slave} | ${activePoll.name}:`,
      value
    );

    await IotReading.create({
      imei: socket.imei,
      data: {
        slave: activePoll.slave,
        parameter: activePoll.name,
        value,
      },
    });
  });

  socket.on("close", () => {
    if (socket.pollTimer) clearInterval(socket.pollTimer);
    console.log("🔌 Gateway disconnected:", socket.imei);
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 TCP Server running on port ${PORT}`);
});
