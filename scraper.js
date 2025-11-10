// scraper.js
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

// ====== CONFIG ======
const SCHOLAR_ID = "bc6CiFkAAAAJ"; // your Scholar ID
const PROFILE_URL = `https://scholar.google.com/citations?hl=en&user=${SCHOLAR_ID}&view_op=list_works&sortby=pubdate`;

// Use your real Chrome profile (Windows path with forward slashes)
const USER_DATA_DIR = "C:/Users/ramzani/AppData/Local/Google/Chrome/User Data";
const PROFILE_DIRECTORY = "Default"; // change if you use another Chrome profile

// First run: set HEADLESS=false to solve consent/CAPTCHA in a visible window.
// In Actions you can keep it headless after cookies exist.
const HEADLESS =
  (process.env.HEADLESS || "").toLowerCase() === "false" ? false : "new";

// ====== UTILS ======
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => (t || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
async function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

(async () => {
  const outDir = path.join(process.cwd(), "docs");
  await ensureDir(outDir);

  // Prefer the installed Chrome so it can reuse your profile cleanly
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    channel: "chrome", // requires Google Chrome installed
    args: [
      `--user-data-dir=${USER_DATA_DIR}`,
      `--profile-directory=${PROFILE_DIRECTORY}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--lang=en-US,en",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1366, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // Human-like settling
    await page.goto(PROFILE_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(1500 + Math.random() * 800);
    await page.mouse.move(400 + Math.random() * 200, 300 + Math.random() * 150);
    await page.mouse.wheel({ deltaY: 600 + Math.floor(Math.random() * 400) });
    await sleep(1200 + Math.random() * 800);

    // Consent (if shown)
    try {
      await page.waitForSelector('form[action*="consent"] button, #introAgreeButton', { timeout: 3000 });
      await page.click('form[action*="consent"] button, #introAgreeButton');
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
    } catch {}

    // Block/CAPTCHA detection
    const html0 = await page.content();
    if (/unusual\s+traffic|captcha|verify|sorry/i.test(html0)) {
      await page.screenshot({ path: path.join(outDir, "blocked.png") });
      fs.writeFileSync(path.join(outDir, "blocked.html"), html0);
      console.log("Blocked by Scholar (unusual traffic). Kept previous pubs.json.");
      process.exit(0); // do NOT overwrite existing JSON
    }

    // Ensure table/rows
    await page.waitForSelector("#gsc_a_b", { timeout: 20000 }).catch(() => {});
    await page.waitForSelector("tr.gsc_a_tr", { timeout: 20000 }).catch(() => {});

    // Click "Show more" until no growth
    for (let tries = 0; tries < 40; tries++) {
      const btn = await page.$("#gsc_bpf_more");
      if (!btn) break;
      const enabled = await page.$eval("#gsc_bpf_more", (b) => !b.disabled).catch(() => false);
      if (!enabled) break;

      const before = await page.$$eval("tr.gsc_a_tr", (r) => r.length).catch(() => 0);
      await btn.click();
      await sleep(2200 + Math.floor(Math.random() * 1200));
      const after = await page.$$eval("tr.gsc_a_tr", (r) => r.length).catch(() => 0);
      if (after <= before) break;
    }

    // Final guard: if still no rows, save debug and keep previous JSON
    const rowCount = await page.$$eval("tr.gsc_a_tr", (r) => r.length).catch(() => 0);
    if (!rowCount) {
      const html = await page.content();
      fs.writeFileSync(path.join(outDir, "last.html"), html);
      await page.screenshot({ path: path.join(outDir, "last.png"), fullPage: true });
      console.log("No rows found. Saved docs/last.html and last.png. Kept previous pubs.json.");
      process.exit(0);
    }

    // Scrape rows
    const items = await page.$$eval("tr.gsc_a_tr", (rows) => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
      return rows.map((r) => {
        const a = r.querySelector("a.gsc_a_at");
        const title = a ? clean(a.textContent) : "";
        const url = a ? new URL(a.getAttribute("href"), "https://scholar.google.com").toString() : "";

        const gray = r.querySelectorAll(".gsc_a_t .gs_gray");
        const authors = gray[0] ? clean(gray[0].textContent) : "";
        let venue = gray[1] ? clean(gray[1].textContent) : "";

        let year = "";
        const y = r.querySelector(".gsc_a_y span");
        if (y) year = clean(y.textContent);
        else {
          const m = (venue || "").match(/(19|20)\d{2}/);
          year = m ? m[0] : "";
        }
        if (year) venue = (venue || "").replace(new RegExp(`[,;\\s]*${year}\\b`), "").trim();

        return { title, authors, venue, year, url };
      });
    });

    if (items.length > 0) {
      const payload = { updated: new Date().toISOString(), count: items.length, items };
      fs.writeFileSync(path.join(outDir, "pubs.json"), JSON.stringify(payload, null, 2));
      console.log(`Wrote ${items.length} items to docs/pubs.json`);
    } else {
      console.log("Parser returned 0 items; kept previous pubs.json.");
    }
  } catch (e) {
    try {
      const pages = await browser.pages();
      if (pages[0]) {
        fs.writeFileSync(path.join(process.cwd(), "docs", "error.html"), await pages[0].content());
        await pages[0].screenshot({ path: path.join(process.cwd(), "docs", "error.png"), fullPage: true });
      }
    } catch {}
    console.error("Scrape error:", e);
  } finally {
    await browser.close();
  }
})();
