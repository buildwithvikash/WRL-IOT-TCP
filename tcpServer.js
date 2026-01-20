import express from "express";
import bodyParser from "body-parser";
import IotReading from "./models/IotReading.js";
import { connectMongo } from "./mongo.js";

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

await connectMongo();

app.post("/iot", async (req, res) => {
  try {
    const data = req.body;

    console.log("📥 HTTP RAW DATA:", data);

    const imei = data.IMEI || data.imei;
    if (!imei) {
      return res.status(400).send("IMEI missing");
    }

    const saved = await IotReading.create({
      imei,
      data,
    });

    console.log("🟢 LIVE HTTP DATA | IMEI:", imei, data);

    res.send("OK");
  } catch (err) {
    console.error("❌ HTTP ERROR:", err);
    res.status(500).send("ERROR");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HTTP Server running on port ${PORT}`);
});
