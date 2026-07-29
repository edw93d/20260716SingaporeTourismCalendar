// PROTOTYPE ONLY (prototype/month-landing). Throwaway static server — the page
// fetches ./calendar.json, which file:// will not allow. No deps, no config.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = join(dir, path === "/" ? "index.html" : path.slice(1));
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(4173, () => {
  console.log("\n  Month-landing prototype\n");
  for (const [key, name] of [
    ["A", "Row landing — what main ships today (the bug)"],
    ["B", "Axis landing — horizontal views land on the surface"],
    ["C", "No landing on Month — leave the reader's scroll alone"],
  ]) {
    console.log(`  ${key}  http://localhost:4173/?variant=${key}   ${name}`);
  }
  console.log("\n  ← / → cycle variants. Ctrl-C to stop.\n");
});
