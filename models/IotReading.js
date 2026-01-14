import mongoose from "mongoose";

const IotReadingSchema = new mongoose.Schema({
  imei: { type: String, required: true },
  data: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("IotReading", IotReadingSchema);
