import { Store, withStoreWrite } from "./backlinks/store.js";
import type { Context } from "./backlinks/cli.js";
import { validate } from "./backlinks/commands/validate.js";
import { due } from "./backlinks/commands/due.js";
import { report } from "./backlinks/commands/report.js";
import { importCsv } from "./backlinks/commands/import-csv.js";
import { checkIndex } from "./backlinks/commands/check-index.js";
import { indexExport } from "./backlinks/commands/index-export.js";
import { indexImport } from "./backlinks/commands/index-import.js";
import { live } from "./backlinks/commands/live.js";
import { add } from "./backlinks/commands/add.js";
import { update } from "./backlinks/commands/update.js";
import { list } from "./backlinks/commands/list.js";
import { show } from "./backlinks/commands/show.js";
import { platformAdd } from "./backlinks/commands/platform-add.js";
import { platformList } from "./backlinks/commands/platform-list.js";
import { weekly } from "./backlinks/commands/weekly.js";

type Handler = (ctx: Context) => object | Promise<object>;
type Command = { run: Handler; values?: string[]; switches?: string[]; positionals?: number; writes?: boolean };
const commands: Record<string, Command> = {
  validate: { run: validate },
  weekly: { run: weekly, values: ["site"], writes: true },
  due: { run: due, values: ["site"] },
  report: { run: report, values: ["site", "out"], writes: true },
  "import-csv": { run: importCsv, values: ["file"], switches: ["create-platforms"], writes: true },
  "check index": { run: checkIndex, values: ["site", "id", "target", "provider", "out"], switches: ["force"], writes: true },
  "index export": { run: indexExport, values: ["site", "out"], writes: true },
  "index import": { run: indexImport, values: ["file"], writes: true },
  "check live": { run: live, values: ["site", "id"], switches: ["browser"], writes: true },
  "platform add": { run: platformAdd, values: ["id", "name", "url", "type", "dr", "review-days", "link-rel", "notes"], switches: ["requires-human"], writes: true },
  "platform list": { run: platformList, values: ["type"] },
  add: { run: add, values: ["site", "platform", "target-url", "status", "anchor", "by", "backlink-url", "notes", "note"], switches: ["force"], writes: true },
  update: { run: update, values: ["status", "backlink-url", "anchor", "notes", "note"], positionals: 1, writes: true },
  list: { run: list, values: ["site", "status", "platform"] },
  show: { run: show, positionals: 1 },
};

async function main() {
  const raw = process.argv.slice(2);
  const json = raw.includes("--json");
  const words = raw.filter(arg => arg !== "--json");
  if (!words.length || words.includes("--help")) {
    const usage = { commands: Object.keys(commands) };
    console.log(json ? JSON.stringify(usage) : "Usage: npm run backlinks -- <" + usage.commands.join(" | ") + "> [--json]");
    return;
  }
  try {
    const first = words.shift()!;
    const key = ["platform", "check", "index"].includes(first) ? first + " " + (words.shift() ?? "") : first;
    const command = Object.hasOwn(commands, key) ? commands[key] : undefined;
    if (!command) throw new Error("Unknown command: " + key);
    const flags: Context["flags"] = Object.create(null);
    const args: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const arg = words[i];
      if (!arg.startsWith("--")) { args.push(arg); continue; }
      const name = arg.slice(2);
      if (Object.hasOwn(flags, name)) throw new Error("Duplicate option: " + arg);
      if (command.switches?.includes(name) || (command.writes && name === "dry-run")) {
        flags[name] = true;
      } else if (command.values?.includes(name)) {
        const value = words[++i];
        if (!value?.trim() || value.startsWith("--")) throw new Error(arg + " requires a value");
        flags[name] = value;
      } else {
        throw new Error("Unknown option: " + arg);
      }
    }
    if (args.length !== (command.positionals ?? 0)) throw new Error("Wrong number of arguments for " + key);
    const dryRun = flags["dry-run"] === true;
    const run = async (store: Store) => command.run({ store, flags, args, dryRun, now: new Date() });
    const dataWrites = ["add", "update", "platform add", "import-csv", "index import"];
    const result = !dryRun && dataWrites.includes(key) ? await withStoreWrite(undefined, run) : await run(await Store.open());
    console.log(JSON.stringify(result, null, json ? undefined : 2));
    if ("exitCode" in result && typeof result.exitCode === "number") process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message }));
    console.error(message);
    process.exitCode = 1;
  }
}
void main();
