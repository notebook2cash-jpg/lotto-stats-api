import fs from "node:fs/promises";

const TARGET_URL = "https://exphuay.com/calculate/goverment";

function nowISO() {
  return new Date().toISOString();
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
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

// NOTE: เป็นตัวอ่านแบบ “ดึงตัวเลข+ตาราง” จาก HTML (ไม่ใช้ OpenAI)
function extractFromHtml(html) {
  const clean = html.replace(/\s+/g, " ");

  // พยายามดึงเลขที่แสดงเป็นปุ่ม/กล่องในส่วน "คำนวณประจำวัน"
  // (ถ้าหน้าเว็บเปลี่ยน layout อาจต้องปรับ regex)
  const pickNear = (label, digits, limit = 10) => {
    const re = new RegExp(`${label}[\\s\\S]{0,2000}?`, "i");
    const m = clean.match(re);
    if (!m) return [];
    const seg = m[0];
    const nums = seg.match(new RegExp(`\\b\\d{${digits}}\\b`, "g")) || [];
    // unique + keep order
    const out = [];
    for (const n of nums) {
      if (!out.includes(n)) out.push(n);
      if (out.length >= limit) break;
    }
    return out;
  };

  // ตารางความถี่ (เลข, จำนวนครั้งที่ออก) สำหรับ 2 ตัว และ 3 ตัว
  const tableFreq = (digits, maxRows = 500) => {
    const re = new RegExp(`\\b(\\d{${digits}})\\b[^\\d]{1,20}(\\d+)`, "g");
    const rows = [];
    let m;
    while ((m = re.exec(clean))) {
      rows.push({
        number: m[1].padStart(digits, "0"),
        count: Number(m[2]),
      });
      if (rows.length >= maxRows) break;
    }
    return rows;
  };

  return {
    daily: {
      top3: pickNear("3 ตัวบน", 3, 10),
      bottom2: pickNear("2 ตัวล่าง", 2, 12),
    },
    top2_frequency_table: tableFreq(2),
    top3_frequency_table: tableFreq(3),
  };
}

async function main() {
  const html = await fetchHtml(TARGET_URL);
  const parsed = extractFromHtml(html);

  const result = {
    lottery: "thai_government",
    lottery_name: "หวยรัฐบาลไทย",
    source_url: TARGET_URL,
    fetched_at: nowISO(),
    window: { latest_n_draws: 30 },
    daily: parsed.daily,
    top2: { frequency_table: parsed.top2_frequency_table },
    top3: { frequency_table: parsed.top3_frequency_table },
    notes: "ดึงข้อมูลจากหน้าเว็บ exphuay โดยตรง ไม่ใช้ OpenAI",
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile("public/gov_thai.json", JSON.stringify(result, null, 2), "utf8");
  console.log("✅ public/gov_thai.json updated");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
