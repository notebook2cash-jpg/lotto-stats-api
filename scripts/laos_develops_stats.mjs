import fs from "node:fs/promises";

const RESULT_URL = "https://exphuay.com/result/laosdevelops";
const BACKWARD_URL = "https://exphuay.com/backward/laosdevelops";

function nowISO() {
  return new Date().toISOString();
}

/**
 * ดึง HTML จาก URL ด้วย fetch ธรรมดา (ไม่ต้องใช้ Puppeteer)
 * เพราะหน้า /result และ /backward เป็น server-side rendered
 */
async function fetchHTML(url) {
  console.log(`📄 Fetching ${url}...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "th,en-US;q=0.7,en;q=0.3",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

/**
 * Parse ข้อมูลผลหวย 30 งวดจาก HTML ของหน้า /result/laosdevelops
 *
 * โครงสร้าง HTML จริง (SvelteKit):
 *   <li ...>
 *     <span ...><a href="/result/laosdevelops?date=2026-02-08" ...>...8 กุมภาพันธ์ 2569...</a></span>
 *     <span ...><!--[-->509<!--]--></span>
 *     <span ...><!--[-->55<!--]--></span>
 *   </li>
 */
function parseDrawResults(html) {
  const draws = [];

  // Pattern ที่ match กับ SvelteKit HTML จริง:
  // href="/result/laosdevelops?date=YYYY-MM-DD" ... <!--[-->XXX<!--]--> ... <!--[-->YY<!--]-->
  const regex =
    /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?<!--\[-->(\d{3})<!--\]-->[\s\S]*?<!--\[-->(\d{2})<!--\]-->/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    draws.push({
      date: match[1],
      top3: match[2],
      bottom2: match[3],
    });
  }

  console.log(`✅ Found ${draws.length} draws`);
  return draws;
}

/**
 * คำนวณ digit frequency จากผลหวย 30 งวด
 * นับว่าตัวเลข 0-9 ปรากฏกี่ครั้งใน 3 ตัวบน, 2 ตัวล่าง, และรวม
 */
function computeDigitFrequency(draws) {
  const freq = {};
  for (let d = 0; d <= 9; d++) {
    freq[d] = { digit: String(d), top3_count: 0, bottom2_count: 0, total: 0 };
  }

  for (const draw of draws) {
    // นับจาก 3 ตัวบน
    for (const ch of draw.top3) {
      const d = parseInt(ch);
      freq[d].top3_count++;
    }
    // นับจาก 2 ตัวล่าง
    for (const ch of draw.bottom2) {
      const d = parseInt(ch);
      freq[d].bottom2_count++;
    }
  }

  // คำนวณรวม
  for (let d = 0; d <= 9; d++) {
    freq[d].total = freq[d].top3_count + freq[d].bottom2_count;
  }

  return Object.values(freq);
}

/**
 * คำนวณสถิติ 30 งวด: เลขที่ออกบ่อยสุด (3 ตัวบน และ 2 ตัวล่าง)
 */
function computeStats30(draws) {
  // นับ 2 ตัวล่างที่ออกซ้ำ
  const bottom2Count = {};
  for (const draw of draws) {
    bottom2Count[draw.bottom2] = (bottom2Count[draw.bottom2] || 0) + 1;
  }
  const stats30Bottom2 = Object.entries(bottom2Count)
    .map(([number, count]) => ({ number, count }))
    .filter((s) => s.count > 1)
    .sort((a, b) => b.count - a.count);

  // นับ 3 ตัวบนที่ออกซ้ำ
  const top3Count = {};
  for (const draw of draws) {
    top3Count[draw.top3] = (top3Count[draw.top3] || 0) + 1;
  }
  const stats30Top3 = Object.entries(top3Count)
    .map(([number, count]) => ({ number, count }))
    .filter((s) => s.count > 1)
    .sort((a, b) => b.count - a.count);

  return { bottom2: stats30Bottom2, top3: stats30Top3 };
}

/**
 * คำนวณเลขเด่น (daily calculation) จากสถิติ 30 งวด
 * - 3 ตัวบน: เลขที่ออกบ่อย + เลขจากหลักที่ออกบ่อย
 * - 2 ตัวล่าง: เลขที่ออกบ่อย + เลขจากหลักที่ออกบ่อย
 * - วิ่ง: ตัวเลข (0-9) ที่ออกบ่อยสุด
 * - รูด: ตัวเลข (0-9) ที่ออกบ่อยรองลงมา
 */
function computeDailyCalculation(draws, digitFrequency) {
  // หา top digit (ตัวเลขที่ปรากฏบ่อยสุด)
  const sortedDigits = [...digitFrequency].sort((a, b) => b.total - a.total);
  const runningNumber = sortedDigits[0]?.digit || "";
  const fullSetNumber = sortedDigits[1]?.digit || "";

  // หาเลข 3 ตัวบนที่น่าสนใจ
  // วิธี: เอาตัวเลข (digit) ที่ออกบ่อยสุด 3 ตัวมาสร้างชุดเลข
  const topDigits = sortedDigits.slice(0, 5).map((d) => d.digit);

  // สร้างชุด 3 ตัวบนจากตัวเลขเด่น
  const top3Set = new Set();

  // เพิ่มเลข 3 ตัวบนที่ออกซ้ำในช่วง 30 งวด
  const top3Freq = {};
  for (const draw of draws) {
    top3Freq[draw.top3] = (top3Freq[draw.top3] || 0) + 1;
  }
  const repeatedTop3 = Object.entries(top3Freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n);
  for (const n of repeatedTop3) top3Set.add(n);

  // สร้างเลข 3 ตัวจากตัวเลขเด่น (permutation)
  for (let i = 0; i < topDigits.length && top3Set.size < 10; i++) {
    for (let j = 0; j < topDigits.length && top3Set.size < 10; j++) {
      for (let k = 0; k < topDigits.length && top3Set.size < 10; k++) {
        const num = topDigits[i] + topDigits[j] + topDigits[k];
        if (num !== "000") top3Set.add(num);
      }
    }
  }

  // สร้างชุด 2 ตัวล่างจากตัวเลขเด่น
  const bottom2Set = new Set();

  // เพิ่มเลข 2 ตัวล่างที่ออกซ้ำ
  const bottom2Freq = {};
  for (const draw of draws) {
    bottom2Freq[draw.bottom2] = (bottom2Freq[draw.bottom2] || 0) + 1;
  }
  const repeatedBottom2 = Object.entries(bottom2Freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n);
  for (const n of repeatedBottom2) bottom2Set.add(n);

  // สร้างเลข 2 ตัวจากตัวเลขเด่น
  for (let i = 0; i < topDigits.length && bottom2Set.size < 12; i++) {
    for (let j = 0; j < topDigits.length && bottom2Set.size < 12; j++) {
      const num = topDigits[i] + topDigits[j];
      if (num !== "00") bottom2Set.add(num);
    }
  }

  // เลขจาก 5 งวดล่าสุด (recommended)
  const recent5 = draws.slice(-5);
  const top3Recommended = recent5.map((d) => d.top3);
  const bottom2Recommended = recent5.map((d) => d.bottom2);

  return {
    top3: [...top3Set].slice(0, 10),
    top3_recommended: top3Recommended,
    bottom2: [...bottom2Set].slice(0, 12),
    bottom2_recommended: bottom2Recommended,
    running_number: runningNumber,
    full_set_number: fullSetNumber,
  };
}

async function main() {
  console.log("🚀 Starting scrape (no Puppeteer needed!)...\n");

  // ดึง HTML จากหน้า result
  const html = await fetchHTML(RESULT_URL);

  // Parse ผลหวย 30 งวด
  let draws = parseDrawResults(html);

  if (draws.length === 0) {
    // ลองจากหน้า backward เป็น fallback
    console.log("⚠️  No draws found from result page, trying backward page...");
    const backwardHtml = await fetchHTML(BACKWARD_URL);
    draws = parseDrawResults(backwardHtml);
    if (draws.length === 0) {
      throw new Error("ไม่พบข้อมูลผลหวยจากทั้งสองหน้า");
    }
  }

  // เรียงลำดับจากเก่าไปใหม่ (จาก HTML มาเป็นใหม่ไปเก่า)
  draws.sort((a, b) => a.date.localeCompare(b.date));

  console.log("\n📊 Sample draws:");
  for (const d of draws.slice(-5)) {
    console.log(`  ${d.date}: 3 ตัวบน=${d.top3}, 2 ตัวล่าง=${d.bottom2}`);
  }

  // คำนวณสถิติ
  const digitFrequency = computeDigitFrequency(draws);
  const stats30 = computeStats30(draws);
  const dailyCalc = computeDailyCalculation(draws, digitFrequency);

  const result = {
    lottery: "laos_develops",
    lottery_name: "หวยลาวพัฒนา",
    source_url: RESULT_URL,
    fetched_at: nowISO(),
    window: { latest_n_draws: draws.length },
    latest_draw: draws[draws.length - 1] || null,
    draws: draws,
    daily_calculation: dailyCalc,
    digit_frequency: { data: digitFrequency },
    statistics_30_draws: stats30,
    notes:
      "ดึงข้อมูลจากหน้า /result/laosdevelops (server-rendered) แล้วคำนวณสถิติเอง ไม่ต้องใช้ Puppeteer",
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/laos_develops.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("\n✅ public/laos_develops.json updated");
  console.log(`📊 Total draws: ${draws.length}`);
  console.log(`📊 Digit frequency entries: ${digitFrequency.length}`);
  console.log(
    `📊 Stats 30 - bottom2 repeated: ${stats30.bottom2.length}, top3 repeated: ${stats30.top3.length}`
  );
  console.log(
    `📊 Daily calc - top3: ${dailyCalc.top3.length}, bottom2: ${dailyCalc.bottom2.length}`
  );
  console.log(
    `📊 Running: ${dailyCalc.running_number}, Full set: ${dailyCalc.full_set_number}`
  );
  console.log("\n" + JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
