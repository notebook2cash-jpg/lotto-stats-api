import fs from "node:fs/promises";

/* ================= CONFIG ================= */

const TARGET = {
  key: "thai_government",
  name: "หวยรัฐบาลไทย",
  url: "https://exphuay.com/calculate/goverment",
  out: "public/gov_thai.json",
};

/* ================= UTILS ================= */

function nowISO() {
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(tz) / 60)).padStart(2, "0");
  const mm = String(Math.abs(tz) % 60).padStart(2, "0");
  return d.toISOString().replace("Z", `${sign}${hh}:${mm}`);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      accept: "text/html",
      "accept-language": "th-TH,th;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14000);
}

async function callOpenAI({ lotteryName, sourceUrl, fetchedAt, text }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const prompt = `
สรุป/คำนวณสถิติจากหน้าเว็บ "คำนวณหวย" ที่แนบให้

เงื่อนไข:
- ตอบกลับเป็น JSON เท่านั้น (ห้ามมีข้อความนอก JSON)
- ใช้ข้อมูลจาก TEXT ที่ให้เท่านั้น ห้ามเดาเพิ่ม
- สรุป "30 งวดล่าสุด" (ถ้าใน TEXT มีน้อยกว่า 30 ให้ใช้เท่าที่มี)

ให้ output JSON รูปแบบนี้เท่านั้น:
{
  "lottery": "thai_government",
  "lottery_name": "${lotteryName}",
  "source_url": "${sourceUrl}",
  "fetched_at": "${fetchedAt}",
  "window": { "latest_n_draws": 30 },
  "top2": {
    "most_common": [{"number":"00","count":0}],
    "frequency_table": [{"number":"00","count":0}]
  },
  "top3": {
    "most_common": [{"number":"000","count":0}],
    "frequency_table": [{"number":"000","count":0}]
  },
  "notes": ""
}

TEXT:
${text}
`.trim();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You output ONLY valid JSON. No markdown. No extra text.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from OpenAI");

  // กันเคสโมเดลเผลอใส่ ```json
  const cleaned = content
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

/* ================= MAIN ================= */

async function main() {
  const html = await fetchHtml(TARGET.url);
  const text = cleanText(html);

  const stats = await callOpenAI({
    lotteryName: TARGET.name,
    sourceUrl: TARGET.url,
    fetchedAt: nowISO(),
    text,
  });

  // normalize
  stats.lottery = "thai_government";
  stats.lottery_name = TARGET.name;
  stats.source_url = TARGET.url;
  stats.fetched_at = stats.fetched_at || nowISO();
  stats.window = stats.window || { latest_n_draws: 30 };
  if (!stats.window.latest_n_draws) stats.window.latest_n_draws = 30;

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(TARGET.out, JSON.stringify(stats, null, 2), "utf8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
