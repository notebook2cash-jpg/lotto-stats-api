import fs from "node:fs/promises";
import puppeteer from "puppeteer";

const TARGET_URL = "https://exphuay.com/calculate/goverment";

function nowISO() {
  return new Date().toISOString();
}

/**
 * ใช้ Puppeteer เปิดหน้าเว็บและดึงข้อมูลจาก DOM โดยตรง
 */
async function scrapeData(url) {
  console.log("🌐 Opening browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2000 });

  console.log(`📄 Loading ${url}...`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // รอให้ข้อมูลโหลดเสร็จ
  await new Promise((r) => setTimeout(r, 3000));

  // ดึงข้อมูลจาก DOM
  const data = await page.evaluate(() => {
    // Helper: ดึงข้อความจาก element
    const getText = (el) => el?.textContent?.trim() || "";

    // Helper: ดึง array ของตัวเลขจาก buttons
    const getNumbersFromButtons = (container) => {
      if (!container) return [];
      const buttons = container.querySelectorAll("button");
      return Array.from(buttons)
        .map((btn) => getText(btn))
        .filter((t) => /^\d+$/.test(t));
    };

    // Helper: ตรวจสอบว่า button เป็นสีเขียว (recommended)
    const getRecommendedNumbers = (container) => {
      if (!container) return [];
      const buttons = container.querySelectorAll("button");
      return Array.from(buttons)
        .filter((btn) => {
          const classes = btn.className || "";
          const style = btn.getAttribute("style") || "";
          return (
            classes.includes("green") ||
            classes.includes("bg-green") ||
            style.includes("green")
          );
        })
        .map((btn) => getText(btn))
        .filter((t) => /^\d+$/.test(t));
    };

    // ค้นหา section "คำนวณหวยรัฐบาลไทย ประจำวัน"
    const allText = document.body.innerText;

    // ดึง 3 ตัวบน - หาจาก heading แล้วดู sibling
    let top3 = [];
    let top3Recommended = [];
    let bottom2 = [];
    let bottom2Recommended = [];
    let runningNumber = "";
    let fullSetNumber = "";

    // หา elements โดยใช้ text content
    const headings = document.querySelectorAll("h4, h5, h3, div, span");

    headings.forEach((el) => {
      const text = getText(el);

      if (text === "3 ตัวบน") {
        // หา container ถัดไป
        let sibling = el.nextElementSibling;
        while (sibling && !getText(sibling).match(/^\d{3}/)) {
          sibling = sibling.nextElementSibling;
        }
        if (sibling) {
          const parent = el.parentElement;
          top3 = getNumbersFromButtons(parent);
          top3Recommended = getRecommendedNumbers(parent);
        }
      }

      if (text === "2 ตัวล่าง") {
        const parent = el.parentElement;
        bottom2 = getNumbersFromButtons(parent);
        bottom2Recommended = getRecommendedNumbers(parent);
      }

      if (text === "วิ่ง") {
        const parent = el.parentElement;
        const nums = getNumbersFromButtons(parent);
        runningNumber = nums[0] || "";
      }

      if (text === "รูด") {
        const parent = el.parentElement;
        const nums = getNumbersFromButtons(parent);
        fullSetNumber = nums[0] || "";
      }
    });

    // ถ้าวิธีข้างบนไม่ได้ผล ลองหาจาก button ทั้งหมด
    if (top3.length === 0) {
      const allButtons = document.querySelectorAll("button");
      const nums3 = [];
      const nums2 = [];

      allButtons.forEach((btn) => {
        const t = getText(btn);
        if (/^\d{3}$/.test(t) && !nums3.includes(t)) nums3.push(t);
        if (/^\d{2}$/.test(t) && !nums2.includes(t)) nums2.push(t);
      });

      top3 = nums3.slice(0, 5);
      bottom2 = nums2.slice(0, 6);
    }

    // ดึงตาราง digit frequency (สถิติจำนวนครั้งที่ออก)
    const digitFrequency = [];
    const tables = document.querySelectorAll("table");

    tables.forEach((table) => {
      const rows = table.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 4) {
          const digit = getText(cells[0]);
          if (/^[0-9]$/.test(digit)) {
            digitFrequency.push({
              digit,
              top3_count: parseInt(getText(cells[1])) || 0,
              bottom2_count: parseInt(getText(cells[2])) || 0,
              total: parseInt(getText(cells[3])) || 0,
            });
          }
        }
      });
    });

    // ดึงตาราง 30 งวดล่าสุด
    const stats30Bottom2 = [];
    const stats30Top3 = [];

    tables.forEach((table) => {
      const headerText =
        table.previousElementSibling?.textContent ||
        table.closest("div")?.querySelector("h3, h4, h5")?.textContent ||
        "";

      const rows = table.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const number = getText(cells[0]);
          const count = parseInt(getText(cells[1])) || 0;

          if (/^\d{2}$/.test(number)) {
            stats30Bottom2.push({ number, count });
          } else if (/^\d{3}$/.test(number)) {
            stats30Top3.push({ number, count });
          }
        }
      });
    });

    return {
      daily_calculation: {
        top3,
        top3_recommended: top3Recommended,
        bottom2,
        bottom2_recommended: bottom2Recommended,
        running_number: runningNumber,
        full_set_number: fullSetNumber,
      },
      digit_frequency: {
        data: digitFrequency,
      },
      statistics_30_draws: {
        bottom2: stats30Bottom2,
        top3: stats30Top3,
      },
    };
  });

  await browser.close();
  console.log("✅ Data extracted");
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
  process.exit(1);
});
