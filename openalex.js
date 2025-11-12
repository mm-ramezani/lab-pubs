// openalex.js — fetch lab publications from OpenAlex and write docs/pubs.json
import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "docs");
const OUT_FILE = path.join(OUT_DIR, "pubs.json");

// ==== CONFIG ====
// Prefer ORCID if you have it:
const ORCID = ""; // e.g., "0000-0002-1825-0097"  <-- put here if you have one
// OR fallback to a name search (use quotes; add institution to reduce ambiguity):
const AUTHOR_QUERY = '"Karlye Wong" University of Toronto'; // change to your author/lab PI

// How many results to fetch (OpenAlex paginates using cursor)
const MAX_ITEMS = 500;

// Small helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build base URL for works
function worksUrl(params) {
  const q = new URLSearchParams(params);
  return `https://api.openalex.org/works?${q.toString()}`;
}

// Select an author ID by ORCID or search
async function getAuthorId() {
  if (ORCID) {
    const u = `https://api.openalex.org/authors?filter=orcid:${encodeURIComponent(ORCID)}`;
    const r = await fetch(u, { headers: { "User-Agent": "lab-pubs (mailto:you@example.com)" } });
    const j = await r.json();
    if (j.results?.length) return j.results[0].id; // e.g., "https://openalex.org/A123..."
    throw new Error(`No OpenAlex author found for ORCID ${ORCID}`);
  }
  // name search (optionally disambiguate with institution in AUTHOR_QUERY)
  const u = `https://api.openalex.org/authors?search=${encodeURIComponent(AUTHOR_QUERY)}&per-page=5`;
  const r = await fetch(u, { headers: { "User-Agent": "lab-pubs (mailto:you@example.com)" } });
  const j = await r.json();
  if (!j.results?.length) throw new Error(`No author found for query: ${AUTHOR_QUERY}`);
  // Heuristic: pick the first result; you can refine if needed
  return j.results[0].id;
}

function mapWork(w) {
  const title = w.title || "";
  const year = w.publication_year || "";
  const authors = (w.authorships || [])
    .map(a => a?.author?.display_name)
    .filter(Boolean)
    .join(", ");
  const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "";
  const url = w.host_venue?.url || w.open_access?.oa_url || w.doi ? `https://doi.org/${w.doi}` : (w.id || "");
  return { title, authors, venue, year, url };
}

async function fetchAllWorksByAuthor(authorId) {
  const authorKey = authorId.replace("https://openalex.org/", ""); // e.g., "A123..."
  const items = [];
  let cursor = "*";
  while (items.length < MAX_ITEMS && cursor) {
    const url = worksUrl({
      filter: `author.id:${authorKey}`,
      sort: "publication_year:desc",
      "per-page": "200",
      cursor
    });
    const res = await fetch(url, { headers: { "User-Agent": "lab-pubs (mailto:you@example.com)" } });
    if (!res.ok) throw new Error(`OpenAlex works fetch failed: ${res.status}`);
    const json = await res.json();
    (json.results || []).forEach(w => items.push(mapWork(w)));
    cursor = json.meta?.next_cursor || null;
    if (json.results?.length === 0) break;
    await sleep(300); // be polite
  }
  return items;
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  try {
    const authorId = await getAuthorId();
    const items = await fetchAllWorksByAuthor(authorId);

    const payload = {
      source: "openalex",
      author: authorId,
      updated: new Date().toISOString(),
      count: items.length,
      items
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`✅ Wrote ${items.length} items to docs/pubs.json`);
  } catch (e) {
    console.error("OpenAlex sync failed:", e.message || e);
    // Don’t overwrite a previously good file; just exit non-zero if needed
    process.exitCode = 1;
  }
})();
