import net from "net";
import dotenv from "dotenv";
import { connectMongo } from "./mongo.js";
import IotReading from "./models/IotReading.js";

dotenv.config();
await connectMongo();

const PORT = process.env.PORT || 15000;
const IMEI = "865661071962420";

const server = net.createServer((socket) => {
  console.log("📡 Gateway connected:", socket.remoteAddress);

  socket.on("data", (data) => {
    console.log("📥 RAW HEX   :", data.toString("hex"));
    console.log("📥 RAW ASCII:", data.toString());
  });

  socket.on("close", () => {
    console.log("🔌 Gateway disconnected");
  });

  socket.on("error", (err) => {
    console.error("⚠️ Socket error:", err.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 RAW TCP Server listening on port ${PORT}`);
});
