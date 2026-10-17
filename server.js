require("dotenv").config();

const mongoose = require("mongoose");
const app = require("./app");

const PORT = Number(process.env.PORT) || 10000;
const MONGODB_URI = process.env.MONGODB_URI;

async function start() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is missing. Copy .env.example to .env and configure it.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    console.error("JWT_SECRET is required in production.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000
    });
    console.log("MongoDB connected.");
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log("PIM listening on port " + PORT);
    });

    const shutdown = async () => {
      server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
      });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    console.error("Unable to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

start();
