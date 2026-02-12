import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const CALCULATE_URL = "https://exphuay.com/calculate/laosdevelops";
const RESULT_URL = "https://exphuay.com/result/laosdevelops";
const BACKWARD_URL = "https://exphuay.com/backward/laosdevelops";

function nowISO() {
  return new Date().toISOString();
}

/**
 * เปิด browser แล้วโหลดหน้า calculate ก่อน (ผ่าน bot protection ได้)
 * จากนั้น navigate ไปหน้าที่ต้องการจริงภายใน session เดียวกัน
 */
async function createBrowserAndWarmup() {
  console.log("🌐 Opening browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.newPage();

  // ซ่อน headless fingerprints
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["th", "en-US", "en"],
    });
    window.chrome = { runtime: {} };
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setExtraHTTPHeaders({
    "Accept-Language": "th,en-US;q=0.9,en;q=0.8",
  });

  // Warmup: โหลดหน้า calculate ก่อน (ซึ่งทราบว่าทำงานได้บน GitHub Actions)
  console.log(`🔥 Warmup: Loading ${CALCULATE_URL}...`);
  await page.goto(CALCULATE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  console.log("✅ Warmup done (cookies & session established)");

  return { browser, page };
}

/**
 * ดึงข้อมูลจากหน้าเว็บผ่าน Puppeteer
 */
async function scrapePageData(page, url) {
  console.log(`\n📄 Navigating to ${url}...`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));

  // Scroll เพื่อ trigger lazy loading
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      window.scrollBy(0, 500);
      await new Promise((r) => setTimeout(r, 300));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 2000));

  // ลองดึงข้อมูลจาก DOM โดยตรง
  const data = await page.evaluate(() => {
    const draws = [];

    // วิธี 1: หา li ที่มี grid layout (รูปแบบตาราง)
    const listItems = document.querySelectorAll("li");
    for (const li of listItems) {
      const link = li.querySelector('a[href*="laosdevelops?date="]');
      if (!link) continue;

      const dateMatch = link.href.match(/date=(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      // หาตัวเลขจาก span ที่อยู่ใน li เดียวกัน
      const spans = li.querySelectorAll("span");
      const numbers = [];
      for (const span of spans) {
        const text = span.textContent.trim();
        if (/^\d{2,3}$/.test(text)) {
          numbers.push(text);
        }
      }

      // ต้องมีเลข 3 ตัว (top3) และ 2 ตัว (bottom2)
      const top3 = numbers.find((n) => n.length === 3);
      const bottom2 = numbers.find((n) => n.length === 2);

      if (top3 && bottom2) {
        draws.push({
          date: dateMatch[1],
          top3,
          bottom2,
        });
      }
    }

    // Debug info
    const bodyText = document.body.innerText;
    const title = document.title;
    const allLinks = document.querySelectorAll(
      'a[href*="laosdevelops?date="]'
    );

    return {
      draws,
      debug: {
        title,
        bodyLength: bodyText.length,
        bodyPreview: bodyText.slice(0, 500),
        dateLinksCount: allLinks.length,
        listItemsCount: document.querySelectorAll("li").length,
      },
    };
  });

  console.log(`🔍 Debug: title="${data.debug.title}"`);
  console.log(`🔍 Debug: body length=${data.debug.bodyLength}`);
  console.log(`🔍 Debug: date links=${data.debug.dateLinksCount}`);
  console.log(`🔍 Debug: list items=${data.debug.listItemsCount}`);
  console.log(`✅ Found ${data.draws.length} draws from DOM`);

  // ถ้า DOM ไม่มีข้อมูล ลอง parse จาก HTML source
  if (data.draws.length === 0) {
    console.log("🔄 Trying HTML source parsing...");
    const html = await page.content();

    // Pattern 1: SvelteKit SSR markers
    const regex1 =
      /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?<!--\[-->(\d{3})<!--\]-->[\s\S]*?<!--\[-->(\d{2})<!--\]-->/g;
    let match;
    while ((match = regex1.exec(html)) !== null) {
      data.draws.push({
        date: match[1],
        top3: match[2],
        bottom2: match[3],
      });
    }

    // Pattern 2: hydrated DOM
    if (data.draws.length === 0) {
      const regex2 =
        /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?font-bold[^>]*>\s*(\d{3})\s*<\/span>[\s\S]*?font-bold[^>]*>\s*(\d{2})\s*<\/span>/g;
      while ((match = regex2.exec(html)) !== null) {
        data.draws.push({
          date: match[1],
          top3: match[2],
          bottom2: match[3],
        });
      }
    }

    console.log(`✅ Found ${data.draws.length} draws from HTML source`);

    // ถ้ายังไม่ได้ ลองดึงจาก body text
    if (data.draws.length === 0) {
      console.log("🔄 Trying body text parsing...");
      console.log("📜 Body preview:", data.debug.bodyPreview);

      const bodyText = await page.evaluate(() => document.body.innerText);
      // Pattern: date lines like "8 กุมภาพันธ์ 2569 509 55"
      const lines = bodyText.split("\n");
      for (const line of lines) {
        const m = line.match(/(\d{3})\s+(\d{2})\s*$/);
        if (m && m[1] !== "000") {
          // Try to find date from context
          data.draws.push({
            date: "unknown",
            top3: m[1],
            bottom2: m[2],
          });
        }
      }
      console.log(`✅ Found ${data.draws.length} draws from body text`);
    }
  }

  return data.draws;
}

/**
 * คำนวณ digit frequency
 */
function computeDigitFrequency(draws) {
  const freq = {};
  for (let d = 0; d <= 9; d++) {
    freq[d] = { digit: String(d), top3_count: 0, bottom2_count: 0, total: 0 };
  }
  for (const draw of draws) {
    for (const ch of draw.top3) freq[parseInt(ch)].top3_count++;
    for (const ch of draw.bottom2) freq[parseInt(ch)].bottom2_count++;
  }
  for (let d = 0; d <= 9; d++) {
    freq[d].total = freq[d].top3_count + freq[d].bottom2_count;
  }
  return Object.values(freq);
}

/**
 * คำนวณสถิติ 30 งวด
 */
function computeStats30(draws) {
  const bottom2Count = {};
  const top3Count = {};
  for (const draw of draws) {
    bottom2Count[draw.bottom2] = (bottom2Count[draw.bottom2] || 0) + 1;
    top3Count[draw.top3] = (top3Count[draw.top3] || 0) + 1;
  }
  return {
    bottom2: Object.entries(bottom2Count)
      .map(([number, count]) => ({ number, count }))
      .filter((s) => s.count > 1)
      .sort((a, b) => b.count - a.count),
    top3: Object.entries(top3Count)
      .map(([number, count]) => ({ number, count }))
      .filter((s) => s.count > 1)
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * คำนวณเลขเด่น
 */
function computeDailyCalculation(draws, digitFrequency) {
  const sortedDigits = [...digitFrequency].sort((a, b) => b.total - a.total);
  const runningNumber = sortedDigits[0]?.digit || "";
  const fullSetNumber = sortedDigits[1]?.digit || "";
  const topDigits = sortedDigits.slice(0, 5).map((d) => d.digit);

  const top3Set = new Set();
  const top3Freq = {};
  for (const draw of draws) {
    top3Freq[draw.top3] = (top3Freq[draw.top3] || 0) + 1;
  }
  Object.entries(top3Freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n]) => top3Set.add(n));

  for (let i = 0; i < topDigits.length && top3Set.size < 10; i++)
    for (let j = 0; j < topDigits.length && top3Set.size < 10; j++)
      for (let k = 0; k < topDigits.length && top3Set.size < 10; k++) {
        const num = topDigits[i] + topDigits[j] + topDigits[k];
        if (num !== "000") top3Set.add(num);
      }

  const bottom2Set = new Set();
  const bottom2Freq = {};
  for (const draw of draws) {
    bottom2Freq[draw.bottom2] = (bottom2Freq[draw.bottom2] || 0) + 1;
  }
  Object.entries(bottom2Freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n]) => bottom2Set.add(n));

  for (let i = 0; i < topDigits.length && bottom2Set.size < 12; i++)
    for (let j = 0; j < topDigits.length && bottom2Set.size < 12; j++) {
      const num = topDigits[i] + topDigits[j];
      if (num !== "00") bottom2Set.add(num);
    }

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

  const { browser, page } = await createBrowserAndWarmup();

  let draws = [];

  try {
    // ลองหน้า result ก่อน
    draws = await scrapePageData(page, RESULT_URL);

    // Fallback: ลองหน้า backward
    if (draws.length === 0) {
      console.log("\n⚠️  No draws from result, trying backward page...");
      draws = await scrapePageData(page, BACKWARD_URL);
    }
  } finally {
    await browser.close();
  }

  if (draws.length === 0) {
    throw new Error("ไม่พบข้อมูลผลหวยจากทั้งสองหน้า");
  }

  // เรียงลำดับจากเก่าไปใหม่
  draws.sort((a, b) => a.date.localeCompare(b.date));

  console.log("\n📊 5 งวดล่าสุด:");
  for (const d of draws.slice(-5)) {
    console.log(`  ${d.date}: 3 ตัวบน=${d.top3}, 2 ตัวล่าง=${d.bottom2}`);
  }

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
    draws,
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
  console.log(`📊 Running: ${dailyCalc.running_number}, Full set: ${dailyCalc.full_set_number}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
