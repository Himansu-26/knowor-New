// Knowora backend: keeps the API key secret, calls the AI model (with model fallback), stores history in db.json

const express = require("express");
const fs = require("fs");
if (fs.existsSync('.env')){
process.loadEnvFile();}
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
}

const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

const app = express();
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MODELS = [...new Set([MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"])];
const DB = path.join(__dirname, "db.json");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));
app.get("/api/ping", (req, res) => res.status(200).json({ status: "ok", message: "pong" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const readDB = () => { try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return []; } };
const writeDB = (d) => fs.writeFileSync(DB, JSON.stringify(d, null, 2));

const PROMPT = `You are Knowora, an expert encyclopedia. Identify the subject (from the image, or from the text query) and reply with ONLY valid JSON in this exact shape:
{
 "name": "common name",
 "category": "animal | bird | plant | object | technology | other",
 "living": true or false,
 "scientificName": "" (for living things, else ""),
 "confidence": "high | medium | low",
 "summary": "2 simple sentences: what it is",
 "details": [{"title":"...","text":"..."}],
 "facts": ["3 interesting or little-known facts"],
 "wildOrDomestic": "" (animals/birds only),
 "habitat": "", "diet": "",
 "conservationStatus": "" (IUCN status for animals/birds/plants, else ""),
 "conservationInfo": "" (threats and how people can help; else ""),
 "howItWorks": "" (objects/technology only), "howToUse": "",
 "types": ["different types or varieties"],
 "buyable": true or false,
 "priceRange": "approximate price in INR and USD, else empty",
 "similar": ["3 similar things people confuse it with"]
}
Keep every text field short (1-2 sentences). "details" = max 3 items (characteristics, behaviour or parts). Use simple language for students. If nothing can be identified, set name to "Unknown" and explain in summary.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function askAI(parts) {
  let lastErr = "AI request failed";

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const generationConfig = {
        responseMimeType: "application/json",
        maxOutputTokens: 1500,
        temperature: 0.3,
      };

      if (model.includes("2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      });

      const data = await r.json();
      if (r.ok) {
        const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "{}";
        return JSON.parse(text.replace(/```json|```/g, "").trim());
      }

      lastErr = data.error?.message || lastErr;
      console.log(`[AI] ${model} -> ${r.status}: ${lastErr}`);

      if (r.status === 503 && attempt === 0) {
        await sleep(700);
        continue;
      }
      break;
    }
  }

  throw new Error(lastErr);
}

app.post("/api/identify", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "GEMINI_API_KEY is missing. Add it to your .env file." });

  const { image, mime, query } = req.body || {};
  if (!image && !query) return res.status(400).json({ error: "Send an image or a search query." });

  const parts = [{ text: PROMPT + (query ? `\n\nText query: ${String(query).slice(0, 200)}` : "") }];
  if (image) parts.push({ inline_data: { mime_type: mime || "image/jpeg", data: image } });

  try {
    const result = await askAI(parts);
    const db = readDB();
    db.unshift({ id: Date.now(), time: new Date().toISOString(), result });
    writeDB(db.slice(0, 50));
    res.json(result);
  } catch (e) {
    console.error("Identify failed:", e.message);
    res.status(500).json({ error: "Could not identify. " + e.message });
  }
});

app.get("/api/history", (_, res) => res.json(readDB()));
app.delete("/api/history", (_, res) => { writeDB([]); res.json({ ok: true }); });

app.listen(process.env.PORT || 3001, "0.0.0.0", () => console.log("Knowora running on http://localhost:" + (process.env.PORT || 3001)));
