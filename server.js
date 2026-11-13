import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { GEMINI_API_KEY = process.env.GEMINI_API_KEY, GEMINI_MODEL = 'gemini-3.5-flash-lite', SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, PORT = 3000 } = process.env;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/api/config', (_, res) => res.json({ url: SUPABASE_URL, anon: SUPABASE_ANON_KEY }));

const PROMPT = (lang, text) => `You are Knowora, an expert identifier. ${text ? `The user searched: "${text}".` : 'Identify the main thing in the photo.'}
Reply ONLY with JSON in ${lang} (keep keys in English):
{"name":"","scientificName":"","category":"animal|bird|plant|object|technology|other","living":true,"confidence":0-100,
"summary":"2-3 sentences","details":[{"title":"","text":""}],
"howItWorksOrUse":"","funFacts":["","",""],
"priceRange":"approx price with currency, or null","whereToFind":"where it lives (living) or where to buy/find it",
"canBePurchased":true,"purchaseNote":"for living things: legality/ethics of keeping or buying, else null",
"conservation":{"status":"IUCN status or null","note":""},
"similar":["","",""],
"quiz":{"question":"","options":["","","",""],"answerIndex":0,"explanation":""}}
For animals/birds/plants include physical traits, habitat, food, behaviour, wild vs domestic in details. For objects include types and how to use. Never invent shopping URLs.`;

async function wikiFallback(q) {
  try {
    const s = await (await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${encodeURIComponent(q)}`)).json();
    if (!s[1]?.[0]) return null;
    const p = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s[1][0])}`)).json();
    return { name: p.title, category: 'other', living: null, confidence: 50, summary: p.extract, details: [], funFacts: [], similar: [], fromFallback: true };
  } catch { return null; }
}

app.post('/api/identify', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return res.status(401).json({ error: 'Please sign in again.' });
    const { image, text, lang = 'English' } = req.body;
    const key = crypto.createHash('sha256').update((image || text.toLowerCase()) + lang).digest('hex');

    let result, cached = await db.from('cache').select('result').eq('hash', key).maybeSingle();
    result = cached.data?.result;

    if (!result) {
      const parts = [{ text: PROMPT(lang, text) }];
      if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
      try {
        const ctl = AbortSignal.timeout(40000);
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
          method: 'POST', signal: ctl,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } })
        });
        const j = await r.json();
        result = JSON.parse(j.candidates[0].content.parts[0].text);
        await db.from('cache').upsert({ hash: key, result });
      } catch (e) {
        console.error('AI failed:', e.message);
        result = text ? await wikiFallback(text) : null;
        if (!result) return res.json({ soft: true, message: 'Knowora could not read this one clearly. Try a closer, well-lit photo, or type its name in search.' });
      }
    }
    await db.from('identifications').insert({ user_id: u.user.id, query: text || 'photo', name: result.name, category: result.category, result });
    res.json({ result });
  } catch (e) {
    console.error(e);
    res.json({ soft: true, message: 'Something small slipped. Please tap the button once more.' });
  }
});

app.get('/api/history', async (req, res) => {
  const { data: u } = await db.auth.getUser((req.headers.authorization || '').replace('Bearer ', ''));
  if (!u?.user) return res.json({ items: [] });
  const { data } = await db.from('identifications').select('id,name,category,result,created_at').eq('user_id', u.user.id).order('created_at', { ascending: false }).limit(30);
  res.json({ items: data || [] });
});

app.listen(PORT, () => console.log('Knowora running on', PORT));
