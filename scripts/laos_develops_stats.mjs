import fs from "node:fs/promises";
import path from "node:path";

// ===== Config =====
// GitHub Models: ใช้ GITHUB_TOKEN (ฟรี, ไม่ต้อง key เพิ่ม)
// Gemini: ใช้ GEMINI_API_KEY (ฟรี, ต้องสมัคร)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";
const GEMINI_URL = GEMINI_API_KEY
  ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`
  : null;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const CALC_IMG = path.join(SCRIPT_DIR, "calc.png");
const STAT_IMG = path.join(SCRIPT_DIR, "stat.png");

function nowISO() {
  return new Date().toISOString();
}

// ===== Prompts =====

const CALC_PROMPT = `Read this Thai lottery calculation image (หวยลาวพัฒนา). Return JSON ONLY:
{
  "top3": ["043", "682", "430", "830", "482"],
  "top3_recommended": ["043", "430", "830"],
  "bottom2": ["76", "44", "39", "08", "46", "03"],
  "bottom2_recommended": ["44", "46"],
  "running_number": "4",
  "full_set_number": "3"
}
Rules:
- "top3": ALL 3-digit numbers under "3 ตัวบน" section (left to right)
- "top3_recommended": ONLY those with GREEN background
- "bottom2": ALL 2-digit numbers under "2 ตัวล่าง" section (left to right)
- "bottom2_recommended": ONLY those with GREEN background
- "running_number": number under "วิ่ง"
- "full_set_number": number under "รูด"
- All values MUST be strings
- Read EVERY number visible in the image`;

const STAT_PROMPT = `Read this Thai lottery statistics table (สถิติหวยลาวพัฒนา 30 งวด). Return JSON ONLY:
{
  "bottom2": [
    {"number": "45", "count": 2},
    {"number": "64", "count": 2}
  ],
  "top3": [
    {"number": "440", "count": 1}
  ],
  "digit_frequency": []
}
Rules:
- "bottom2": Read ALL rows from the LEFT table (2 ตัวล่าง). Each row has "เลขที่ออก" (number as string) and "จำนวนครั้งที่ออก" (count as integer)
- "top3": Read ALL rows from the RIGHT table (3 ตัวบน). Same format.
- "digit_frequency": if there's a 0-9 frequency table, read it as [{"digit":"0","top3_count":13,"bottom2_count":10,"total":23},...]. Otherwise empty array.
- Read EVERY row in both tables`;

// ===== GitHub Models (GPT-4o) =====

async function askGitHubModels(prompt, imageBase64) {
  if (!GITHUB_TOKEN) throw new Error("No GITHUB_TOKEN");

  const body = {
    model: "openai/gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 4000,
  };

  const res = await fetch(GITHUB_MODELS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Models error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("GitHub Models returned empty response");

  // Parse JSON
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return JSON.parse(m[1].trim());
    // ลอง extract JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error(`Cannot parse JSON: ${text.slice(0, 300)}`);
  }
}

// ===== Gemini (fallback) =====

async function askGemini(prompt, imageBase64, maxRetries = 3) {
  if (!GEMINI_URL) throw new Error("No GEMINI_API_KEY");

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const waitSec = attempt * 15;
      console.log(`  ⏳ Rate limited, retrying in ${waitSec}s...`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned empty response");

    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) return JSON.parse(m[1].trim());
      throw new Error(`Cannot parse JSON: ${text.slice(0, 300)}`);
    }
  }
  throw new Error("Gemini: max retries exceeded");
}

// ===== Generic Vision Call =====

async function readImageWithAI(prompt, imagePath) {
  const base64 = (await fs.readFile(imagePath)).toString("base64");

  // ลอง GitHub Models ก่อน (ฟรี, ใช้ GITHUB_TOKEN)
  if (GITHUB_TOKEN) {
    try {
      return await askGitHubModels(prompt, base64);
    } catch (e) {
      console.log(`  ⚠️ GitHub Models failed: ${e.message.slice(0, 100)}`);
    }
  }

  // ลอง Gemini (ฟรี, ต้อง API key)
  if (GEMINI_API_KEY) {
    try {
      return await askGemini(prompt, base64);
    } catch (e) {
      console.log(`  ⚠️ Gemini failed: ${e.message.slice(0, 100)}`);
    }
  }

  throw new Error(
    "ไม่มี AI service ใช้งานได้ ต้องมี GITHUB_TOKEN หรือ GEMINI_API_KEY"
  );
}

// ===== Main =====

async function main() {
  console.log("🚀 Starting image-based data extraction...\n");

  // แสดง available services
  console.log("🔑 Available AI services:");
  if (GITHUB_TOKEN) console.log("  ✅ GitHub Models (GITHUB_TOKEN)");
  else console.log("  ❌ GitHub Models (no GITHUB_TOKEN)");
  if (GEMINI_API_KEY) console.log("  ✅ Gemini (GEMINI_API_KEY)");
  else console.log("  ❌ Gemini (no GEMINI_API_KEY)");

  if (!GITHUB_TOKEN && !GEMINI_API_KEY) {
    throw new Error(
      "ต้องมีอย่างน้อย 1 อย่าง: GITHUB_TOKEN หรือ GEMINI_API_KEY"
    );
  }

  // ตรวจไฟล์
  console.log("\n📁 Images:");
  for (const img of [CALC_IMG, STAT_IMG]) {
    try {
      const s = await fs.stat(img);
      console.log(`  ${path.basename(img)}: ${(s.size / 1024).toFixed(1)} KB`);
    } catch {
      throw new Error(`ไม่พบไฟล์ ${img}`);
    }
  }

  // อ่าน calc.png
  console.log("\n📊 Reading calc.png...");
  const calcData = await readImageWithAI(CALC_PROMPT, CALC_IMG);
  console.log("✅ calc.png:", JSON.stringify(calcData, null, 2));

  // รอ 5 วินาทีก่อนส่ง request ถัดไป
  console.log("\n⏳ Waiting 5s...\n");
  await new Promise((r) => setTimeout(r, 5000));

  // อ่าน stat.png
  console.log("📊 Reading stat.png...");
  const statData = await readImageWithAI(STAT_PROMPT, STAT_IMG);
  console.log("✅ stat.png:");
  console.log(`  bottom2: ${statData.bottom2?.length || 0} entries`);
  console.log(`  top3: ${statData.top3?.length || 0} entries`);

  // สร้าง output
  const result = {
    lottery: "laos_develops",
    lottery_name: "หวยลาวพัฒนา",
    source_url: "https://exphuay.com/calculate/laosdevelops",
    fetched_at: nowISO(),
    window: { latest_n_draws: 30 },
    daily_calculation: {
      top3: calcData.top3 || [],
      top3_recommended: calcData.top3_recommended || [],
      bottom2: calcData.bottom2 || [],
      bottom2_recommended: calcData.bottom2_recommended || [],
      running_number: calcData.running_number || "",
      full_set_number: calcData.full_set_number || "",
    },
    digit_frequency: {
      data: statData.digit_frequency || [],
    },
    statistics_30_draws: {
      bottom2: statData.bottom2 || [],
      top3: statData.top3 || [],
    },
    notes: "อ่านข้อมูลจากรูป calc.png + stat.png ด้วย AI Vision",
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/laos_develops.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("\n✅ public/laos_develops.json updated");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
