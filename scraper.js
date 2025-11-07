import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const SCHOLAR_ID = "bc6CiFkAAAAJ"; // your ID
const PROFILE_URL = `https://scholar.google.com/citations?hl=en&user=${SCHOLAR_ID}&view_op=list_works&sortby=pubdate`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(t) {
  return (t || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
  );

  await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded" });

  // Accept consent if shown
  try {
    await page.waitForSelector(
      'form[action*="consent"] button, #introAgreeButton',
      { timeout: 3000 }
    );
    await page.click('form[action*="consent"] button, #introAgreeButton');
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 });
  } catch {}

  // Load all publications (click "Show more" until disabled or missing)
  while (true) {
    const moreSel = "#gsc_bpf_more";
    const exists = await page.$(moreSel);
    if (!exists) break;
    const enabled = await page.$eval(moreSel, (btn) => !btn.disabled).catch(() => false);
    if (!enabled) break;
    await page.click(moreSel);
    await sleep(1200); // <-- replaced waitForTimeout
  }

  // Scrape rows
  const items = await page.$$eval("tr.gsc_a_tr", (rows) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
    return rows.map((r) => {
      const a = r.querySelector("a.gsc_a_at");
      const title = a ? clean(a.textContent) : "";
      const url = a ? new URL(a.getAttribute("href"), "https://scholar.google.com").toString() : "";

      const metaBlocks = r.querySelectorAll(".gsc_a_t .gs_gray");
      const authors = metaBlocks[0] ? clean(metaBlocks[0].textContent) : "";
      let venue = metaBlocks[1] ? clean(metaBlocks[1].textContent) : "";

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

  // Write JSON to docs/pubs.json (served by GitHub Pages)
  const outDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(outDir, "pubs.json"),
    JSON.stringify({ updated: new Date().toISOString(), count: items.length, items }, null, 2)
  );
  console.log(`Wrote ${items.length} items to docs/pubs.json`);
})();
