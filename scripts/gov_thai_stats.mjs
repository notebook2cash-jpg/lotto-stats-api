import fs from "node:fs/promises";

/* ================= CONFIG ================= */

const TARGET_URL = "https://exphuay.com/calculate/goverment";

/* ================= UTILS ================= */

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
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return res.text();
}

/**
 * ดึงตัวเลขจาก HTML ตามรูปหน้าเว็บจริง
 * ใช้วิธี regex + text scan (ไม่พึ่ง DOM)
 */
function extractStats(html) {
  const clean = html.replace(/\s+/g, " ");

  // ===== 2 ตัวล่าง / 3 ตัวบน (จาก card สีเขียว) =====
  const pickNumbers = (label, size) => {
    const regex = new RegExp(`${label}[\\s\\S]{0,500}?([0-9]{${size}})`, "g");
    const out = [];
    let m;
    while ((m = regex.exec(clean)) && out.length < 5) {
      out.push(m[1]);
    }
    return out;
  };

  // ===== ตารางสถิติ 30 งวด =====
  const extractTable = (digits) => {
    const regex = new RegExp(
      `(\\d{${digits}})[^\\d]{1,20}(\\d+)`,
      "g"
    );
    const rows = [];
    let m;
    while ((m = regex.exec(clean))) {
      rows.push({
        number: m[1].padStart(digits, "0"),
        count: Number(m[2]),
      });
      if (rows.length >= 100) break;
    }
    return rows;
  };

  return {
    daily: {
      top3: pickNumbers("3 ตัวบน", 3),
      bottom2: pickNumbers("2 ตัวล่าง", 2),
    },
    stats_30_draws: {
      top2: extractTable(2),
      top3: extractTable(3),
    },
  };
}

/* ================= MAIN ================= */

async function main() {
  const html = await fetchHtml(TARGET_URL);
  const stats = extractStats(html);

  const result = {
    lottery: "thai_government",
    lottery_name: "หวยรัฐบาลไทย",
    source_url: TARGET_URL,
    fetched_at: nowISO(),
    window: {
      latest_n_draws: 30,
    },
    daily: stats.daily,
    top2: {
      frequency_table: stats.stats_30_draws.top2,
    },
    top3: {
      frequency_table: stats.stats_30_draws.top3,
    },
    notes:
      "ข้อมูลดึงตรงจาก exphuay.com ไม่ได้ใช้ OpenAI คำนวณ",
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/gov_thai.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("✅ public/gov_thai.json updated");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
