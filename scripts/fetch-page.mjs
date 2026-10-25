// One-off debug helper: fetch a single URL politely and save the raw HTML
// to a file so you can grep/inspect it when a selector stops matching.
// Usage: node scripts/fetch-page.mjs <url> <outputFile>
import { writeFile } from "fs/promises";

const [, , url, outFile] = process.argv;
if (!url || !outFile) {
  console.error("Usage: node scripts/fetch-page.mjs <url> <outputFile>");
  process.exit(1);
}

const res = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
  },
});
if (!res.ok) {
  console.error(`Upstream responded ${res.status} ${res.statusText}`);
  process.exit(1);
}
await writeFile(outFile, await res.text(), "utf8");
console.log(`Saved ${outFile}`);
