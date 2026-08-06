// openalex.js — fetch lab publications from OpenAlex and write docs/pubs.json
//
// Usage:  node openalex.js
// Writes: docs/pubs.json   (only on success; a failed run leaves the old file intact)

import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "docs");
const OUT_FILE = path.join(OUT_DIR, "pubs.json");

// ==== CONFIG ====================================================

// OpenAlex "polite pool": requests carrying a real contact address get a
// dedicated, faster, more reliable rate limit. Set this to your York address.
// It is only sent to OpenAlex as a contact header — it is never written to
// pubs.json and never appears on the website.
const CONTACT_EMAIL = process.env.OPENALEX_MAILTO || "ramzani@yorku.ca";

// Preferred: ORCID. Leave AUTHOR_QUERY as a fallback if ORCID is ever blank.
const ORCID = "0000-0002-3229-749X";
const AUTHOR_QUERY = '"Shooka Karimpour" York University';

// Max works to pull. OpenAlex pages with a cursor; 200 per page is the max.
const MAX_ITEMS = 500;

// ================================================================

const UA = `lab-pubs (mailto:${CONTACT_EMAIL})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (CONTACT_EMAIL.startsWith("CHANGE_ME")) {
  console.warn(
    "⚠️  CONTACT_EMAIL is still a placeholder. Set it in openalex.js (or the " +
      "OPENALEX_MAILTO env var) so requests use the OpenAlex polite pool."
  );
}

/** GET a URL as JSON, with the polite-pool mailto appended and basic retries. */
async function getJson(url, { retries = 3 } = {}) {
  const u = new URL(url);
  u.searchParams.set("mailto", CONTACT_EMAIL);

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(u, { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} from ${u.pathname}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${u.pathname} (not retryable)`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || /not retryable/.test(err.message)) break;
      const backoff = 1000 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${retries - 1} in ${backoff}ms — ${err.message}`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/** Resolve the OpenAlex author ID from ORCID, falling back to a name search. */
async function getAuthorId() {
  if (ORCID) {
    const j = await getJson(
      `https://api.openalex.org/authors?filter=orcid:${encodeURIComponent(ORCID)}`
    );
    if (j.results?.length) return j.results[0].id;
    throw new Error(`No OpenAlex author found for ORCID ${ORCID}`);
  }

  const j = await getJson(
    `https://api.openalex.org/authors?search=${encodeURIComponent(AUTHOR_QUERY)}&per-page=5`
  );
  if (!j.results?.length) throw new Error(`No author found for query: ${AUTHOR_QUERY}`);
  return j.results[0].id;
}

/**
 * Normalise a DOI into a clickable https://doi.org/... link.
 * OpenAlex already returns `doi` as a full URL, but older/odd records can be a
 * bare "10.xxxx/yyy", so handle both rather than blindly prefixing.
 */
function doiUrl(doi) {
  if (!doi) return "";
  const s = String(doi).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://doi.org/${s.replace(/^doi:/i, "")}`;
}

/**
 * Map an OpenAlex work to the shape the website consumes.
 *
 * Note: `host_venue` was removed from the OpenAlex work object in 2023 — venue
 * now lives under primary_location / best_oa_location / locations.
 */
function mapWork(w) {
  const title = w.title || w.display_name || "";
  const year = w.publication_year || "";

  const authors = (w.authorships || [])
    .map((a) => a?.author?.display_name)
    .filter(Boolean)
    .join(", ");

  const venue =
    w.primary_location?.source?.display_name ||
    w.best_oa_location?.source?.display_name ||
    (w.locations || []).map((l) => l?.source?.display_name).find(Boolean) ||
    "";

  // Preference order: DOI (stable + citable) → landing page → OA full text →
  // the OpenAlex record itself as a last resort.
  const url =
    doiUrl(w.doi) ||
    w.primary_location?.landing_page_url ||
    w.best_oa_location?.pdf_url ||
    w.open_access?.oa_url ||
    w.id ||
    "";

  return { title, authors, venue, year, url };
}

async function fetchAllWorksByAuthor(authorId) {
  const authorKey = authorId.replace("https://openalex.org/", "");
  const items = [];
  let cursor = "*";

  while (cursor && items.length < MAX_ITEMS) {
    const q = new URLSearchParams({
      filter: `author.id:${authorKey}`,
      sort: "publication_year:desc",
      "per-page": "200",
      cursor,
    });

    const json = await getJson(`https://api.openalex.org/works?${q}`);
    const batch = json.results || [];
    batch.forEach((w) => items.push(mapWork(w)));

    console.log(`  fetched ${batch.length} (total ${items.length})`);

    if (batch.length === 0) break;
    cursor = json.meta?.next_cursor || null;
    if (cursor) await sleep(300); // be polite
  }

  return items.slice(0, MAX_ITEMS);
}

(async () => {
  try {
    const authorId = await getAuthorId();
    console.log(`Author: ${authorId}`);

    const items = await fetchAllWorksByAuthor(authorId);

    // Guard: never replace a good file with an empty one.
    if (items.length === 0) {
      throw new Error("OpenAlex returned 0 works — keeping the existing pubs.json");
    }

    const payload = {
      source: "openalex",
      author: authorId,
      updated: new Date().toISOString(),
      count: items.length,
      items,
    };

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
    console.log(`✅ Wrote ${items.length} items to docs/pubs.json`);
  } catch (e) {
    console.error("❌ OpenAlex sync failed:", e?.message || e);
    process.exitCode = 1; // fail the Actions step; leave the old JSON untouched
  }
})();
