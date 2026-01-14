import mongoose from "mongoose";

let connected = false;

export async function connectMongo() {
  if (connected) return;

  await mongoose.connect(process.env.MONGO_URI);
  connected = true;

  console.log("✅ MongoDB connected");
}
