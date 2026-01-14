import mongoose from "mongoose";
import dotenv from "dotenv";
import IotReading from "./models/IotReading.js";

dotenv.config();
await mongoose.connect(process.env.MONGO_URI);

console.log("👀 Watching live data for IMEI 865661071962420...\n");

IotReading.watch([
  { $match: { "fullDocument.imei": "865661071962420" } }
]).on("change", change => {
  console.log("📡 LIVE DB DATA:", change.fullDocument);
});
