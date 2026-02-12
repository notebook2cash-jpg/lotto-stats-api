import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const CALCULATE_URL = "https://exphuay.com/calculate/laosdevelops";
const RESULT_URL = "https://exphuay.com/result/laosdevelops";
const BACKWARD_URL = "https://exphuay.com/backward/laosdevelops";

function nowISO() {
  return new Date().toISOString();
}

/**
 * ใช้ Puppeteer โหลดหน้า /calculate/ ก่อน (ผ่าน Cloudflare ได้)
 * แล้วใช้ fetch() ภายใน browser context ดึง HTML จากหน้า /result/
 * (fetch ภายใน browser จะมี Cloudflare cookies ติดไปอัตโนมัติ)
 */
async function fetchHTMLViaBrowser(targetUrl) {
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1920, height: 1080 });

  // Step 1: โหลดหน้า /calculate/ ก่อน (หน้านี้ผ่าน Cloudflare ได้)
  console.log(`🔥 Step 1: Loading ${CALCULATE_URL} (Cloudflare warmup)...`);
  await page.goto(CALCULATE_URL, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  await new Promise((r) => setTimeout(r, 5000));

  const calcTitle = await page.title();
  console.log(`✅ Calculate page loaded. Title: "${calcTitle}"`);

  // Step 2: ใช้ fetch() ภายใน browser context (มี cookies ติดไปด้วย)
  console.log(`📄 Step 2: Fetching ${targetUrl} from browser context...`);
  const html = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: {
          Accept: "text/html",
        },
      });
      if (!res.ok) {
        return { error: `HTTP ${res.status}`, html: "" };
      }
      const text = await res.text();
      return { error: null, html: text };
    } catch (e) {
      return { error: e.message, html: "" };
    }
  }, targetUrl);

  await browser.close();

  if (html.error) {
    console.log(`⚠️  Fetch error: ${html.error}`);
    return "";
  }

  console.log(`✅ Got HTML (${html.html.length} bytes)`);
  return html.html;
}

/**
 * Fallback: ใช้ Puppeteer navigate ไปหน้า target โดยตรง
 */
async function fetchHTMLViaNavigation(targetUrl) {
  console.log(`\n🌐 Fallback: Direct navigation to ${targetUrl}...`);
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );

  // โหลดหน้า calculate ก่อน
  await page.goto(CALCULATE_URL, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  await new Promise((r) => setTimeout(r, 5000));

  // Navigate ไปหน้า target (ภายใน session เดียวกัน)
  await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 120000 });

  // รอ Cloudflare (ถ้ามี)
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (
      !title.includes("รอสักครู่") &&
      !title.includes("Just a moment") &&
      title.length > 5
    ) {
      console.log(`✅ Page loaded. Title: "${title}"`);
      break;
    }
    console.log(`⏳ Waiting for Cloudflare... (${i + 1}/15)`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  await new Promise((r) => setTimeout(r, 3000));

  // ดึงข้อมูลจาก DOM โดยตรง
  const draws = await page.evaluate(() => {
    const results = [];
    const listItems = document.querySelectorAll("li");

    for (const li of listItems) {
      const link = li.querySelector('a[href*="laosdevelops?date="]');
      if (!link) continue;

      const dateMatch = link.href.match(/date=(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      const spans = li.querySelectorAll("span");
      const numbers = [];
      for (const span of spans) {
        const text = span.textContent.trim();
        if (/^\d{2,3}$/.test(text)) numbers.push(text);
      }

      const top3 = numbers.find((n) => n.length === 3);
      const bottom2 = numbers.find((n) => n.length === 2);
      if (top3 && bottom2) {
        results.push({ date: dateMatch[1], top3, bottom2 });
      }
    }

    return results;
  });

  await browser.close();
  return draws;
}

/**
 * Parse ข้อมูลผลหวย 30 งวดจาก HTML
 */
function parseDrawResults(html) {
  const draws = [];

  // Pattern 1: SvelteKit SSR (มี <!--[-->XXX<!--]-->)
  const regex1 =
    /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?<!--\[-->(\d{3})<!--\]-->[\s\S]*?<!--\[-->(\d{2})<!--\]-->/g;
  let match;
  while ((match = regex1.exec(html)) !== null) {
    draws.push({ date: match[1], top3: match[2], bottom2: match[3] });
  }

  // Pattern 2: hydrated DOM (ไม่มี comment markers)
  if (draws.length === 0) {
    const regex2 =
      /href="\/result\/laosdevelops\?date=(\d{4}-\d{2}-\d{2})"[\s\S]*?font-bold[^>]*>\s*(\d{3})\s*<\/span>[\s\S]*?font-bold[^>]*>\s*(\d{2})\s*<\/span>/g;
    while ((match = regex2.exec(html)) !== null) {
      draws.push({ date: match[1], top3: match[2], bottom2: match[3] });
    }
  }

  console.log(`✅ Parsed ${draws.length} draws from HTML`);
  return draws;
}

// ===== สถิติ / คำนวณ =====

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

function computeDailyCalculation(draws, digitFrequency) {
  const sortedDigits = [...digitFrequency].sort((a, b) => b.total - a.total);
  const runningNumber = sortedDigits[0]?.digit || "";
  const fullSetNumber = sortedDigits[1]?.digit || "";
  const topDigits = sortedDigits.slice(0, 5).map((d) => d.digit);

  const top3Set = new Set();
  const top3Freq = {};
  for (const draw of draws)
    top3Freq[draw.top3] = (top3Freq[draw.top3] || 0) + 1;
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
  for (const draw of draws)
    bottom2Freq[draw.bottom2] = (bottom2Freq[draw.bottom2] || 0) + 1;
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

// ===== Main =====

async function main() {
  console.log("🚀 Starting scrape...\n");

  let draws = [];

  // วิธี 1: โหลด /calculate/ ก่อน แล้ว fetch /result/ จากภายใน browser
  console.log("=== Strategy 1: Browser-context fetch ===");
  const resultHtml = await fetchHTMLViaBrowser(RESULT_URL);

  if (resultHtml) {
    draws = parseDrawResults(resultHtml);
  }

  // วิธี 1 fallback: ลอง backward
  if (draws.length === 0 && resultHtml !== "") {
    console.log("\n🔄 Trying backward page...");
    const backwardHtml = await fetchHTMLViaBrowser(BACKWARD_URL);
    if (backwardHtml) {
      draws = parseDrawResults(backwardHtml);
    }
  }

  // วิธี 2: navigate ตรงไปหน้า result (ผ่าน session calculate)
  if (draws.length === 0) {
    console.log("\n=== Strategy 2: Direct navigation with session ===");
    draws = await fetchHTMLViaNavigation(RESULT_URL);
    console.log(`✅ Found ${draws.length} draws via navigation`);
  }

  // วิธี 2 fallback: ลอง backward
  if (draws.length === 0) {
    console.log("\n🔄 Trying backward via navigation...");
    draws = await fetchHTMLViaNavigation(BACKWARD_URL);
    console.log(`✅ Found ${draws.length} draws via navigation (backward)`);
  }

  if (draws.length === 0) {
    throw new Error("ไม่พบข้อมูลผลหวยจากทุกวิธี");
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
    notes: "ดึงข้อมูลจาก /result/laosdevelops แล้วคำนวณสถิติเอง",
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/laos_develops.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("\n✅ public/laos_develops.json updated");
  console.log(`📊 Total draws: ${draws.length}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
