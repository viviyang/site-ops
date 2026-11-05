import path from "node:path";
import { nextId } from "./store.js";
import { statuses, type Platform, type Submission, type SubmissionStatus } from "./types.js";

/**
 * Parse CSV fields, including quoted commas, escaped quotes and quoted newlines.
 * Once a quote closes, the next character must delimit the field or record.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let state: "field" | "quoted" | "closed" = "field";
  const input = text.replace(/^\uFEFF/, "");

  function endField() {
    record.push(value);
    value = "";
    state = "field";
  }

  function endRecord() {
    endField();
    if (record.length !== 1 || record[0].trim() !== "") records.push(record);
    record = [];
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (state === "quoted") {
      if (char !== '"') {
        value += char;
      } else if (input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        state = "closed";
      }
      continue;
    }

    if (char === ",") {
      endField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      endRecord();
    } else if (state === "closed") {
      throw new Error(`CSV record ${records.length + 1}: unexpected text after closing quote.`);
    } else if (char === '"' && value === "") {
      state = "quoted";
    } else if (char === '"') {
      throw new Error(`CSV record ${records.length + 1}: quote inside an unquoted field.`);
    } else {
      value += char;
    }
  }
  if (state === "quoted") throw new Error(`CSV record ${records.length + 1}: unclosed quote.`);
  if (record.length || value || state === "closed") endRecord();
  return records;
}

const columns = [
  "site", "platform", "target_url", "status", "backlink_url",
  "anchor", "submitted_at", "submitted_by", "notes",
] as const;

export type ImportRow = Record<(typeof columns)[number], string>;

export function readCsvRows(text: string): ImportRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("CSV header is required.");
  const headings = header.map((field) => field.trim());
  const missing = columns.filter((name) => !headings.includes(name));
  if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(", ")}`);
  if (new Set(headings).size !== headings.length) throw new Error("Duplicate CSV column names.");

  return rows.map((row, index) => {
    if (row.length !== headings.length) {
      throw new Error(`CSV record ${index + 2}: expected ${headings.length} fields, got ${row.length}.`);
    }
    const fields = columns.map((name) => {
      const value = row[headings.indexOf(name)];
      return [name, name === "anchor" || name === "notes" ? value : value.trim()];
    });
    return Object.fromEntries(fields) as ImportRow;
  });
}

export function prepareCsvImport(
  text: string,
  file: string,
  platforms: readonly Platform[],
  submissions: readonly Submission[],
  now: Date,
  createPlatforms: boolean,
) {
  const rows = readCsvRows(text);
  const platformIds = new Set(platforms.map(({ id }) => id));
  const missing = [...new Set(rows.map(({ platform }) => platform).filter((id) => !platformIds.has(id)))].sort();
  if (missing.length && !createPlatforms) {
    throw new Error(`Missing platforms: ${missing.map((id) => id || "(blank)").join(", ")}. Use --create-platforms to create them.`);
  }

  const at = now.toISOString();
  const addedPlatforms: Platform[] = missing.map((id) => ({
    id,
    name: id,
    type: "other",
    createdAt: at,
  }));

  const addedSubmissions: Submission[] = [];
  for (const [index, row] of rows.entries()) {
    if (!statuses.includes(row.status as SubmissionStatus)) {
      throw new Error(`CSV record ${index + 2}: invalid status "${row.status}".`);
    }
    const status = row.status as SubmissionStatus;
    addedSubmissions.push({
      id: nextId([...submissions, ...addedSubmissions], row.site, row.platform),
      siteId: row.site,
      platformId: row.platform,
      targetUrl: row.target_url,
      status,
      backlinkUrl: row.backlink_url || undefined,
      anchorText: row.anchor || undefined,
      submittedAt: row.submitted_at || undefined,
      submittedBy: row.submitted_by || undefined,
      notes: row.notes || undefined,
      history: [{ at, from: null, to: status, note: `imported from ${path.basename(file)}` }],
      createdAt: at,
      updatedAt: at,
    });
  }

  return { addedPlatforms, addedSubmissions };
}
