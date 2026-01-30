import fs from "node:fs/promises";

/* ================= CONFIG ================= */

const TARGET = {
  key: "thai_government",
  name: "หวยรัฐบาลไทย",
  url: "https://exphuay.com/calculate/goverment",
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
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return await res.text();
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

async function callOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const body = {
    model: "gpt-5",
    input: [
      {
        role: "system",
        content:
          "Extract lottery statistics. Return ONLY valid JSON.",
      },
      {
        role: "user",
        content: `
LOTTERY: หวยรัฐบาลไทย
SOURCE_URL: ${TARGET.url}
FETCHED_AT: ${nowISO()}

TASK:
- วิเคราะห์สถิติหวยรัฐบาลไทย 30 งวดล่าสุด
- ความถี่เลข 2 ตัว
- ความถี่เลข 3 ตัว
- สรุปเลขเด่น

TEXT:
${text}
        `,
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}`);
  }

  const data = await res.json();
  const out =
    data.output_text ??
    data.output?.flatMap((o) => o.content || [])?.find(
      (c) => c.type === "output_text"
    )?.text;

  if (!out) throw new Error("No output from OpenAI");
  return JSON.parse(out);
}

/* ================= MAIN ================= */

async function main() {
  const html = await fetchHtml(TARGET.url);
  const text = cleanText(html);

  const stats = await callOpenAI(text);

  const result = {
    lottery: TARGET.key,
    source_url: TARGET.url,
    updated_at: nowISO(),
    stats,
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/gov_thai.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
