import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "../cli.js";
import { prepareCsvImport } from "../csv.js";

export async function importCsv({ store, flags, now, dryRun }: Context) {
  if (typeof flags.file !== "string") throw new Error("--file is required.");
  const file = path.resolve(store.root, flags.file);
  const text = await readFile(file, "utf8");
  const { addedPlatforms, addedSubmissions } = prepareCsvImport(
    text, file, store.platforms, store.submissions, now, flags["create-platforms"] === true,
  );

  await store.save({
    platforms: addedPlatforms.length ? [...store.platforms, ...addedPlatforms] : undefined,
    submissions: addedSubmissions.length ? [...store.submissions, ...addedSubmissions] : undefined,
  }, dryRun);

  return { file, dryRun, addedPlatforms, addedSubmissions };
}
