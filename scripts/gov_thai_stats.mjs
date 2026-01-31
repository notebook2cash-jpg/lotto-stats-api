import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const TARGET_URL = "https://exphuay.com/calculate/goverment";

function nowISO() {
  return new Date().toISOString();
}

async function scrapeData(url) {
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
  
  // ตั้ง User-Agent
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  
  await page.setViewport({ width: 1920, height: 1080 });

  console.log(`📄 Loading ${url}...`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

  // รอ 10 วินาทีให้ JavaScript render เสร็จ
  console.log("⏳ Waiting 10 seconds for JavaScript to render...");
  await new Promise((r) => setTimeout(r, 10000));

  // Scroll ทั้งหน้า
  console.log("📜 Scrolling page...");
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, 500);
      await new Promise((r) => setTimeout(r, 500));
    }
    window.scrollTo(0, 0);
  });

  await new Promise((r) => setTimeout(r, 3000));

  // Debug: ดู HTML structure
  const debugInfo = await page.evaluate(() => {
    const body = document.body.innerText;
    const allButtons = Array.from(document.querySelectorAll("button")).map(
      (b) => b.textContent?.trim()
    );
    const allTables = document.querySelectorAll("table").length;
    const allDivs = document.querySelectorAll("div").length;

    return {
      bodyTextLength: body.length,
      bodyTextPreview: body.slice(0, 2000),
      buttonTexts: allButtons.slice(0, 50),
      tableCount: allTables,
      divCount: allDivs,
    };
  });

  console.log("🔍 Debug Info:");
  console.log("Body text length:", debugInfo.bodyTextLength);
  console.log("Tables:", debugInfo.tableCount);
  console.log("Buttons:", debugInfo.buttonTexts);
  console.log("Body preview:", debugInfo.bodyTextPreview.slice(0, 500));

  // ดึงข้อมูลจาก body text โดยใช้ regex
  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // ฟังก์ชันดึงตัวเลขจาก text
    const extractNumbers = (text, digits) => {
      const regex = new RegExp(`\\b\\d{${digits}}\\b`, "g");
      const matches = text.match(regex) || [];
      return [...new Set(matches)].filter(
        (n) => n !== "0".repeat(digits) && n !== "000" && n !== "00"
      );
    };

    // หาส่วน "3 ตัวบน" และ "2 ตัวล่าง"
    let top3 = [];
    let bottom2 = [];
    let runningNumber = "";
    let fullSetNumber = "";

    // แยก sections
    const sections = bodyText.split(/\n+/);

    let inTop3Section = false;
    let inBottom2Section = false;
    let inRunningSection = false;
    let inFullSetSection = false;

    for (const line of sections) {
      const trimmed = line.trim();

      if (trimmed.includes("3 ตัวบน")) {
        inTop3Section = true;
        inBottom2Section = false;
        inRunningSection = false;
        inFullSetSection = false;
        continue;
      }
      if (trimmed.includes("2 ตัวล่าง")) {
        inTop3Section = false;
        inBottom2Section = true;
        inRunningSection = false;
        inFullSetSection = false;
        continue;
      }
      if (trimmed === "วิ่ง") {
        inTop3Section = false;
        inBottom2Section = false;
        inRunningSection = true;
        inFullSetSection = false;
        continue;
      }
      if (trimmed === "รูด") {
        inTop3Section = false;
        inBottom2Section = false;
        inRunningSection = false;
        inFullSetSection = true;
        continue;
      }

      // ดึงตัวเลขจากแต่ละ section
      if (inTop3Section) {
        const nums = extractNumbers(trimmed, 3);
        top3.push(...nums);
      }
      if (inBottom2Section) {
        const nums = extractNumbers(trimmed, 2);
        bottom2.push(...nums);
      }
      if (inRunningSection && /^\d$/.test(trimmed)) {
        runningNumber = trimmed;
        inRunningSection = false;
      }
      if (inFullSetSection && /^\d$/.test(trimmed)) {
        fullSetNumber = trimmed;
        inFullSetSection = false;
      }
    }

    // ดึง digit frequency จากตาราง
    const digitFrequency = [];
    const freqMatch = bodyText.match(
      /เลข\s+3 ตัวบน\s+2 ตัวล่าง\s+รวม([\s\S]*?)(?:สถิติ|$)/
    );
    if (freqMatch) {
      const freqText = freqMatch[1];
      const rows = freqText.trim().split("\n");
      for (const row of rows) {
        const parts = row.trim().split(/\s+/);
        if (parts.length >= 4 && /^[0-9]$/.test(parts[0])) {
          digitFrequency.push({
            digit: parts[0],
            top3_count: parseInt(parts[1]) || 0,
            bottom2_count: parseInt(parts[2]) || 0,
            total: parseInt(parts[3]) || 0,
          });
        }
      }
    }

    // ดึงสถิติ 30 งวด
    const stats30Bottom2 = [];
    const stats30Top3 = [];

    // หาตาราง 2 ตัวล่าง
    const bottom2Match = bodyText.match(
      /ตารางแสดงผลหวยรัฐบาลไทย 2 ตัวล่าง[\s\S]*?เลขที่ออก\s+จำนวนครั้งที่ออก([\s\S]*?)(?:ตาราง|คำนวณ|$)/
    );
    if (bottom2Match) {
      const rows = bottom2Match[1].trim().split("\n");
      for (const row of rows) {
        const parts = row.trim().split(/\s+/);
        if (parts.length >= 2 && /^\d{2}$/.test(parts[0])) {
          stats30Bottom2.push({
            number: parts[0],
            count: parseInt(parts[1]) || 0,
          });
        }
      }
    }

    // หาตาราง 3 ตัวบน
    const top3Match = bodyText.match(
      /ตารางแสดงผลหวยรัฐบาลไทย 3 ตัวบน[\s\S]*?เลขที่ออก\s+จำนวนครั้งที่ออก([\s\S]*?)(?:ตาราง|$)/
    );
    if (top3Match) {
      const rows = top3Match[1].trim().split("\n");
      for (const row of rows) {
        const parts = row.trim().split(/\s+/);
        if (parts.length >= 2 && /^\d{3}$/.test(parts[0])) {
          stats30Top3.push({
            number: parts[0],
            count: parseInt(parts[1]) || 0,
          });
        }
      }
    }

    return {
      daily_calculation: {
        top3: [...new Set(top3)].slice(0, 10),
        top3_recommended: [],
        bottom2: [...new Set(bottom2)].slice(0, 12),
        bottom2_recommended: [],
        running_number: runningNumber,
        full_set_number: fullSetNumber,
      },
      digit_frequency: { data: digitFrequency },
      statistics_30_draws: {
        bottom2: stats30Bottom2,
        top3: stats30Top3,
      },
      _debug: {
        foundTop3: top3.length,
        foundBottom2: bottom2.length,
      },
    };
  });

  // Save screenshot for debug
  await page.screenshot({ path: "debug-screenshot.png", fullPage: true });
  console.log("📸 Screenshot saved to debug-screenshot.png");

  await browser.close();
  console.log("✅ Data extracted");
  console.log("Found top3:", data._debug?.foundTop3);
  console.log("Found bottom2:", data._debug?.foundBottom2);

  return data;
}

async function main() {
  const parsed = await scrapeData(TARGET_URL);

  const result = {
    lottery: "thai_government",
    lottery_name: "หวยรัฐบาลไทย",
    source_url: TARGET_URL,
    fetched_at: nowISO(),
    window: { latest_n_draws: 30 },
    daily_calculation: parsed.daily_calculation,
    digit_frequency: parsed.digit_frequency,
    statistics_30_draws: parsed.statistics_30_draws,
    notes: "ดึงข้อมูลจากหน้าเว็บ exphuay โดยตรง (ไม่ใช้ OpenAI)",
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/gov_thai.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );
  console.log("✅ public/gov_thai.json updated");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
