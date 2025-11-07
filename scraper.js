import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const SCHOLAR_ID = "bc6CiFkAAAAJ"; // your ID
const PROFILE_URL = `https://scholar.google.com/citations?hl=en&user=${SCHOLAR_ID}&view_op=list_works&sortby=pubdate`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => (t || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--lang=en-US,en"
    ],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  // Go to profile and wait until network settles
  await page.goto(PROFILE_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Accept consent if shown
  try {
    await page.waitForSelector('form[action*="consent"] button, #introAgreeButton', { timeout: 3000 });
    await page.click('form[action*="consent"] button, #introAgreeButton');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
  } catch {}

  // Ensure the publications table exists
  await page.waitForSelector("#gsc_a_b", { timeout: 15000 }).catch(() => {});

  // Load all rows by clicking "Show more" repeatedly, with reliable waits
  while (true) {
    const moreSel = "#gsc_bpf_more";
    const hasBtn = await page.$(moreSel);
    if (!hasBtn) break;
    const enabled = await page.$eval(moreSel, (btn) => !btn.disabled).catch(() => false);
    if (!enabled) break;
    await page.click(moreSel);
    // wait for new rows to be added
    const before = await page.$$eval("tr.gsc_a_tr", (r) => r.length).catch(() => 0);
    await sleep(1200);
    const after = await page.$$eval("tr.gsc_a_tr", (r) => r.length).catch(() => 0);
    if (after <= before) break; // nothing new appeared
  }

  // As a final guard, wait for at least one row
  await page.waitForSelector("tr.gsc_a_tr", { timeout: 15000 }).catch(() => {});

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
        const m = venue.match(/(19|20)\d{2}/);
        year = m ? m[0] : "";
      }
      if (year) venue = venue.replace(new RegExp(`[,;\\s]*${year}\\b`), "").trim();

      return { title, authors, venue, year, url };
    });
  });

  await browser.close();

  const outDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(outDir, "pubs.json"),
    JSON.stringify({ updated: new Date().toISOString(), count: items.length, items }, null, 2)
  );
  console.log(`Wrote ${items.length} items to docs/pubs.json`);
})();
