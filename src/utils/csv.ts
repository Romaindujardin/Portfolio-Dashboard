export type CsvParseResult = {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: string;
};

function detectDelimiter(sample: string): string {
  // Heuristic: count delimiters on the first ~10 lines
  const candidates = [",", ";", "\t", "|"];
  const lines = sample.split(/\r?\n/).slice(0, 10);
  const scores = candidates.map((d) => {
    let score = 0;
    for (const line of lines) {
      // naive count, still OK for delimiter detection
      score += (line.split(d).length - 1) || 0;
    }
    return { d, score };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score ? scores[0].d : ";";
}

function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // Escaped quote inside quoted field: ""
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((v) => v.trim());
}

function normalizeHeader(h: string, idx: number): string {
  const trimmed = (h || "").trim();
  return trimmed ? trimmed : `col_${idx + 1}`;
}

export function parseCsv(text: string): CsvParseResult {
  const normalized = (text || "").replace(/^\uFEFF/, ""); // remove BOM
  const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], delimiter: ";" };

  const delimiter = detectDelimiter(lines.slice(0, 20).join("\n"));
  const rawHeaders = parseLine(lines[0], delimiter);
  const headers = rawHeaders.map((h, idx) => normalizeHeader(h, idx));

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (values[c] ?? "").trim();
    }
    // keep extra values if any
    if (values.length > headers.length) {
      for (let c = headers.length; c < values.length; c++) {
        row[`extra_${c + 1}`] = (values[c] ?? "").trim();
      }
    }
    rows.push(row);
  }

  // If extra columns exist, include them in headers
  const extraKeys = new Set<string>();
  for (const r of rows) {
    Object.keys(r)
      .filter((k) => k.startsWith("extra_"))
      .forEach((k) => extraKeys.add(k));
  }
  const fullHeaders = [...headers, ...Array.from(extraKeys).sort()];

  return { headers: fullHeaders, rows, delimiter };
}

function escapeCsvValue(value: string, delimiter: string): string {
  const v = value ?? "";
  const needsQuotes =
    v.includes('"') || v.includes("\n") || v.includes("\r") || v.includes(delimiter);
  if (!needsQuotes) return v;
  // Escape quotes by doubling them
  const escaped = v.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function stringifyCsv(params: {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: string;
}): string {
  const delimiter = params.delimiter === "mix" ? ";" : params.delimiter;
  const headers = params.headers || [];
  const rows = params.rows || [];

  const headerLine = headers.map((h) => escapeCsvValue(h, delimiter)).join(delimiter);
  const lines: string[] = [headerLine];

  for (const row of rows) {
    const line = headers
      .map((h) => escapeCsvValue((row?.[h] ?? "").toString(), delimiter))
      .join(delimiter);
    lines.push(line);
  }

  return lines.join("\n");
}


