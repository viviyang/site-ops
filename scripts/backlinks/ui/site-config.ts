import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensure, validateBacklinksConfig } from "../sites.js";
import { atomicWrite, type Store } from "../store.js";

export async function saveSiteConfig(store: Store, id: string, form: URLSearchParams) {
  ensure(store.sites.has(id), "Unknown site: " + id);
  const file = path.join(store.root, "sites", id + ".json");
  const text = await readFile(file, "utf8");
  const original = JSON.parse(text);
  ensure(original.id === id, "Site file does not match its registered ID");
  const limit = form.get("maxNewPerWeek")?.trim();
  ensure(!limit || /^\d+$/.test(limit), "Invalid maxNewPerWeek");
  const next = {
    ...original.backlinks,
    enabled: form.get("enabled") === "on",
    maxNewPerWeek: limit ? Number(limit) : undefined,
    pausedUntil: form.get("pausedUntil")?.trim() || undefined,
    notes: form.get("notes") || undefined,
  };
  validateBacklinksConfig(next);
  await atomicWrite(file, replaceBacklinks(text, next));
}

// The source was parsed above. Scan its JSON tokens to replace only the top-level value.
function replaceBacklinks(text: string, config: object) {
  const tokens = Array.from(text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g));
  let depth = 0;
  let range: [number, number] | undefined;
  const value = JSON.stringify(config);
  for (const [i, token] of tokens.entries()) {
    const symbol = token[0];
    if (depth === 1 && symbol.startsWith('"') && tokens[i + 1]?.[0] === ":" && JSON.parse(symbol) === "backlinks") {
      const first = tokens[i + 2];
      let end = i + 2;
      if (first[0] === "{") {
        let objects = 1;
        while (objects) {
          const part = tokens[++end][0];
          if (part === "{") objects++;
          if (part === "}") objects--;
        }
      }
      range = [first.index!, tokens[end].index! + tokens[end][0].length];
    }
    if (symbol === "{" || symbol === "[") depth++;
    if (symbol === "}" || symbol === "]") depth--;
  }
  if (range) return text.slice(0, range[0]) + value + text.slice(range[1]);
  const close = tokens.at(-1)!.index!;
  return text.slice(0, close) + ', "backlinks": ' + value + text.slice(close);
}
