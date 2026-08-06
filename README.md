# lab-pubs

Keeps `docs/pubs.json` — the publication list used by the lab website — in sync
with [OpenAlex](https://openalex.org).

## How it works

`openalex.js` resolves the PI's OpenAlex author record from an ORCID, pages
through all their works, and writes a flat JSON file:

```json
{
  "source": "openalex",
  "author": "https://openalex.org/A5019943485",
  "updated": "2026-08-06T00:00:00.000Z",
  "count": 40,
  "items": [
    { "title": "...", "authors": "...", "venue": "...", "year": 2025, "url": "https://doi.org/10.1021/..." }
  ]
}
```

The GitHub Action in `.github/workflows/scrape.yml` runs it every Monday at
04:00 UTC and commits the result if anything changed. You can also trigger it
manually from the **Actions** tab → *sync-openalex* → *Run workflow*.

## Setup

1. Set a contact email for the [OpenAlex polite pool](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication).
   Either edit `CONTACT_EMAIL` at the top of `openalex.js`, or add a repository
   secret named `OPENALEX_MAILTO` (Settings → Secrets and variables → Actions).
   The address is sent to OpenAlex as a contact header only — it is not written
   to `pubs.json` and never appears on the website.
2. Confirm `ORCID` in `openalex.js` points at the right person.

## Running locally

Requires Node 18+ (for built-in `fetch`). No dependencies to install.

```bash
node openalex.js
# or
npm run sync
```

## Troubleshooting

**The file has stopped updating.** GitHub disables scheduled workflows in
repositories with no activity for 60 days. Open the **Actions** tab; if you see
a banner offering to re-enable the workflow, click it.

**The run fails.** The script exits non-zero and leaves the existing
`docs/pubs.json` untouched, so a bad run never wipes the publication list.
Check the step log in the Actions tab for the reason.

## History

An earlier version scraped Google Scholar with Puppeteer. Scholar blocks
automated access, so that approach was retired in favour of the OpenAlex API,
which is open, documented, and has no anti-bot measures.
