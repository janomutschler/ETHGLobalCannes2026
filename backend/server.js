import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { handleMessage } from "./agent.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('./frontend'));

app.post("/chat", async (req, res) => {
  try {
    const { userId = "current_user", message } = req.body;
    const reply = await handleMessage(userId, message);
    res.json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
});