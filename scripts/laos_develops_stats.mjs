import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const RESULT_URL = "https://exphuay.com/result/laosdevelops";
const BACKWARD_URL = "https://exphuay.com/backward/laosdevelops";

function nowISO() {
  return new Date().toISOString();
}

/**
 * ดึง HTML จาก URL ผ่าน Puppeteer (หลีกเลี่ยง 403 จาก GitHub Actions)
 */
async function fetchHTMLViaPuppeteer(url) {
  console.log("🌐 Opening browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080 });

  console.log(`📄 Loading ${url}...`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

  // รอให้ SvelteKit hydrate เสร็จ
  console.log("⏳ Waiting for page to fully render...");
  await new Promise((r) => setTimeout(r, 5000));

  // ดึง HTML ทั้งหมด
  const html = await page.content();

  // Debug: แสดงจำนวน li ที่พบ
  const liCount = await page.evaluate(() => {
    return document.querySelectorAll("li.grid").length;
  });
  console.log(`🔍 Found ${liCount} grid list items`);

  await browser.close();
  return html;
}

/**
 * Parse ข้อมูลผลหวย 30 งวดจาก HTML
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

  // Pattern 1: SvelteKit SSR with comment markers
  // <!--[-->XXX<!--]--> ภายใน span
  const regex1 =
    /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?<!--\[-->(\d{3})<!--\]-->[\s\S]*?<!--\[-->(\d{2})<!--\]-->/g;

  let match;
  while ((match = regex1.exec(html)) !== null) {
    draws.push({
      date: match[1],
      top3: match[2],
      bottom2: match[3],
    });
  }

  // Pattern 2: หลัง hydrate แล้ว comment อาจหายไป
  // เป็น <span ...>XXX</span> <span ...>YY</span>
  if (draws.length === 0) {
    console.log("🔄 Trying alternative pattern (hydrated DOM)...");
    const regex2 =
      /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?font-bold[^>]*>(\d{3})<\/span>[\s\S]*?font-bold[^>]*>(\d{2})<\/span>/g;

    while ((match = regex2.exec(html)) !== null) {
      draws.push({
        date: match[1],
        top3: match[2],
        bottom2: match[3],
      });
    }
  }

  console.log(`✅ Found ${draws.length} draws`);
  return draws;
}

/**
 * คำนวณ digit frequency จากผลหวย 30 งวด
 */
function computeDigitFrequency(draws) {
  const freq = {};
  for (let d = 0; d <= 9; d++) {
    freq[d] = { digit: String(d), top3_count: 0, bottom2_count: 0, total: 0 };
  }

  for (const draw of draws) {
    for (const ch of draw.top3) {
      freq[parseInt(ch)].top3_count++;
    }
    for (const ch of draw.bottom2) {
      freq[parseInt(ch)].bottom2_count++;
    }
  }

  for (let d = 0; d <= 9; d++) {
    freq[d].total = freq[d].top3_count + freq[d].bottom2_count;
  }

  return Object.values(freq);
}

/**
 * คำนวณสถิติ 30 งวด: เลขที่ออกบ่อยสุด
 */
function computeStats30(draws) {
  const bottom2Count = {};
  for (const draw of draws) {
    bottom2Count[draw.bottom2] = (bottom2Count[draw.bottom2] || 0) + 1;
  }
  const stats30Bottom2 = Object.entries(bottom2Count)
    .map(([number, count]) => ({ number, count }))
    .filter((s) => s.count > 1)
    .sort((a, b) => b.count - a.count);

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
 */
function computeDailyCalculation(draws, digitFrequency) {
  const sortedDigits = [...digitFrequency].sort((a, b) => b.total - a.total);
  const runningNumber = sortedDigits[0]?.digit || "";
  const fullSetNumber = sortedDigits[1]?.digit || "";

  const topDigits = sortedDigits.slice(0, 5).map((d) => d.digit);

  // 3 ตัวบน: เลขที่ออกซ้ำ + permutation จากตัวเลขเด่น
  const top3Set = new Set();
  const top3Freq = {};
  for (const draw of draws) {
    top3Freq[draw.top3] = (top3Freq[draw.top3] || 0) + 1;
  }
  Object.entries(top3Freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n]) => top3Set.add(n));

  for (let i = 0; i < topDigits.length && top3Set.size < 10; i++) {
    for (let j = 0; j < topDigits.length && top3Set.size < 10; j++) {
      for (let k = 0; k < topDigits.length && top3Set.size < 10; k++) {
        const num = topDigits[i] + topDigits[j] + topDigits[k];
        if (num !== "000") top3Set.add(num);
      }
    }
  }

  // 2 ตัวล่าง: เลขที่ออกซ้ำ + permutation จากตัวเลขเด่น
  const bottom2Set = new Set();
  const bottom2Freq = {};
  for (const draw of draws) {
    bottom2Freq[draw.bottom2] = (bottom2Freq[draw.bottom2] || 0) + 1;
  }
  Object.entries(bottom2Freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n]) => bottom2Set.add(n));

  for (let i = 0; i < topDigits.length && bottom2Set.size < 12; i++) {
    for (let j = 0; j < topDigits.length && bottom2Set.size < 12; j++) {
      const num = topDigits[i] + topDigits[j];
      if (num !== "00") bottom2Set.add(num);
    }
  }

  // เลขจาก 5 งวดล่าสุด
  const recent5 = draws.slice(-5);

  return {
    top3: [...top3Set].slice(0, 10),
    top3_recommended: recent5.map((d) => d.top3),
    bottom2: [...bottom2Set].slice(0, 12),
    bottom2_recommended: recent5.map((d) => d.bottom2),
    running_number: runningNumber,
    full_set_number: fullSetNumber,
  };
}

async function main() {
  console.log("🚀 Starting scrape...\n");

  // ดึง HTML ผ่าน Puppeteer (หลีกเลี่ยง 403)
  let html = await fetchHTMLViaPuppeteer(RESULT_URL);
  let draws = parseDrawResults(html);

  // Fallback: ลองหน้า backward
  if (draws.length === 0) {
    console.log("⚠️  No draws from result page, trying backward page...");
    html = await fetchHTMLViaPuppeteer(BACKWARD_URL);
    draws = parseDrawResults(html);
  }

  if (draws.length === 0) {
    throw new Error("ไม่พบข้อมูลผลหวยจากทั้งสองหน้า");
  }

  // เรียงลำดับจากเก่าไปใหม่
  draws.sort((a, b) => a.date.localeCompare(b.date));

  console.log("\n📊 Sample draws (5 งวดล่าสุด):");
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
      "ดึงข้อมูลจากหน้า /result/laosdevelops ผ่าน Puppeteer แล้วคำนวณสถิติเอง",
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
