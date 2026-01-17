import net from "net";
import dotenv from "dotenv";
import crc from "crc";
import { connectMongo } from "./mongo.js";
// import IotReading from "./models/IotReading.js"; // enable later

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

// ---------------- TCP SERVER ----------------
const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  let rxBuffer = Buffer.alloc(0);
  let waiting = false;

  // 🔁 Poll temperature every 2s
  const pollTemperature = () => {
    if (waiting) return;

    const frame = buildModbusFrame(
      1,          // Slave ID
      0x04,       // Read Input Registers
      44097 - 1,  // Modbus offset
      1           // 1 register (INT16)
    );

    waiting = true;
    socket.write(frame);
  };

  const timer = setInterval(pollTemperature, 2000);

  socket.on("data", (data) => {
    rxBuffer = Buffer.concat([rxBuffer, data]);

    // 🧹 Strip IMEI if gateway prepends ASCII
    while (rxBuffer.length >= 15) {
      const ascii = rxBuffer.slice(0, 15).toString();
      if (/^\d{15}$/.test(ascii)) {
        console.log("🧹 Stripped IMEI:", ascii);
        rxBuffer = rxBuffer.slice(15);
      } else {
        break;
      }
    }

    // Need at least Modbus header
    if (rxBuffer.length < 5) return;

    const slave = rxBuffer[0];
    const func = rxBuffer[1];

    // ❌ Modbus exception
    if (func & 0x80) {
      console.log("❌ Modbus exception:", rxBuffer[2]);
      rxBuffer = Buffer.alloc(0);
      waiting = false;
      return;
    }

    const byteCount = rxBuffer[2];
    const frameLen = 3 + byteCount + 2;
    if (rxBuffer.length < frameLen) return;

    const frame = rxBuffer.slice(0, frameLen);
    rxBuffer = rxBuffer.slice(frameLen);
    waiting = false;

    console.log("📥 MODBUS FRAME:", frame.toString("hex"));

    // CRC check
    const crcRx = frame.readUInt16LE(frameLen - 2);
    const crcCalc = crc.crc16modbus(frame.slice(0, frameLen - 2));
    if (crcRx !== crcCalc) {
      console.log("❌ CRC mismatch");
      return;
    }

    const payload = frame.slice(3, 3 + byteCount);

    // 🌡️ Parse temperature
    let rawTemp = payload.readInt16BE(0);
    let temperature = rawTemp / 10;

    console.log(`🌡️ LIVE TEMPERATURE: ${temperature} °C`);

    /*
    await IotReading.create({
      imei: "865661071962420",
      data: { temperature },
    });
    */
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
