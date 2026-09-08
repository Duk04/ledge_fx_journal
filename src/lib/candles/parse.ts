/**
 * CSV -> bars. Pure, dependency-free parsing logic — no Prisma, no
 * `server-only` import — on purpose: the import panel runs this exact
 * function in the browser to render a preview before anything is uploaded,
 * and the server action runs it again (from the real, possibly-larger file)
 * before writing to the database. One implementation, two call sites.
 *
 * -----------------------------------------------------------------------
 * THE TIMEZONE PROBLEM (read this before touching anything below)
 * -----------------------------------------------------------------------
 * An MT5 export has no timezone marker anywhere in the file. Every
 * `<DATE>\t<TIME>` pair is the BROKER's server clock, which is commonly
 * UTC+2 or UTC+3 and typically follows its own DST schedule (which does not
 * line up with the exchange's local DST, or with the importing user's
 * timezone). A generic CSV with a bare "2024-01-02 10:00:00" style timestamp
 * (no `Z`, no `+HH:MM`) has exactly the same problem — it's somebody's wall
 * clock, not UTC.
 *
 * If we stored those timestamps as if they were already UTC, every bar would
 * be silently shifted by whatever the broker's offset happens to be. That
 * shift is invisible in a naive OHLC chart — the candles still look like
 * candles — but it quietly destroys anything session-based: a "London open"
 * breakout strategy backtested against data that's really 2-3 hours off will
 * trade the wrong bars and produce results that mean nothing. There is no
 * way to detect this after the fact from the bars alone, which is exactly
 * why it is dangerous: it fails silently, not loudly.
 *
 * So: `tzOffsetMinutes` (minutes to ADD to a UTC instant to get the broker's
 * local wall-clock time — e.g. 180 for UTC+3) is a REQUIRED option, never
 * defaulted, and the import UI must ask the user for it explicitly every
 * time rather than assuming yesterday's answer still applies (brokers shift
 * their own offset with DST). We convert local -> UTC with
 *   utcMs = Date.UTC(y, m, d, h, mi, s) - tzOffsetMinutes * 60_000
 * i.e. we read the file's wall-clock fields as if they were UTC and then
 * subtract the offset, which is the same thing as saying "this wall clock
 * reading, interpreted in a zone tzOffsetMinutes ahead of UTC, corresponds to
 * this UTC instant". The offset actually used is recorded on the
 * `CandleImport` row (see prisma/schema.prisma) so "why is this bar at this
 * hour" is always answerable later, even months after the import.
 *
 * Only genuinely tz-less timestamps go through that conversion. An ISO 8601
 * value that already carries an explicit offset or `Z`, and an epoch
 * second/millisecond value (which is unambiguously UTC by definition), are
 * used as-is — applying `tzOffsetMinutes` to an already-absolute instant
 * would double-shift it.
 */

export type CandleCsvFormat = "MT5" | "GENERIC";

export interface ParsedBar {
  /** Bar OPEN time, UTC epoch milliseconds. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  spread?: number;
}

export interface ParseCandleCsvOptions {
  /**
   * Minutes to ADD to UTC to get the file's local wall-clock time (e.g. 180
   * for a broker quoting UTC+3). Required — see the module doc. Ignored for
   * timestamps that are already unambiguous (epoch values, or ISO strings
   * that carry their own offset/`Z`).
   */
  tzOffsetMinutes: number;
}

export interface ParseCandleCsvResult {
  rows: ParsedBar[];
  format: CandleCsvFormat;
  /** Human-readable notes: which rows were skipped and why, capped so one
   * broken file doesn't produce a wall of text. */
  warnings: string[];
  /** Total row count skipped (may exceed `warnings.length`). */
  skipped: number;
}

const MAX_WARNINGS = 8;

/** MT5 header columns, matched case-insensitively with or without the angle brackets. */
type Mt5Column = "date" | "time" | "open" | "high" | "low" | "close" | "tickvol" | "vol" | "spread";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitLines(text: string): string[] {
  // Handles CRLF, lone CR (old Mac exports), and LF, then drops blank lines
  // rather than trying to parse them as data.
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
}

function normalizeHeaderCell(cell: string): string {
  return cell.trim().replace(/^<|>$/g, "").toLowerCase();
}

/** True when the header line looks like an MT5 export: tab-separated with the `<DATE>`/`<OPEN>`/… column names. */
function looksLikeMt5(headerLine: string): boolean {
  if (!headerLine.includes("\t")) return false;
  const cells = headerLine.split("\t").map(normalizeHeaderCell);
  return cells.includes("date") && cells.includes("open") && cells.includes("close");
}

function detectDelimiter(headerLine: string): "," | ";" {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

function addWarning(warnings: string[], skippedCount: { n: number }, message: string) {
  skippedCount.n += 1;
  if (warnings.length < MAX_WARNINGS) warnings.push(message);
}

/**
 * Applies every shared validation rule to a candidate bar, returning either
 * the bar or a reason it must be skipped. `lastAcceptedTs` is the ts of the
 * last row this parser has already accepted, used to catch duplicates and
 * out-of-order rows — the two ways "non-monotonic" data shows up in a real
 * export (a broker re-sending an overlapping range, or a corrupted line).
 */
function validate(
  row: { ts: number; open: number; high: number; low: number; close: number },
  lastAcceptedTs: number | null,
): string | null {
  if (!Number.isFinite(row.ts)) return "unparseable timestamp";
  if (![row.open, row.high, row.low, row.close].every((v) => Number.isFinite(v))) return "unparseable price";
  if (row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0) return "zero or negative price";
  if (row.high < row.low) return "high below low";
  if (row.high < row.open || row.high < row.close) return "high below open/close";
  if (row.low > row.open || row.low > row.close) return "low above open/close";
  if (lastAcceptedTs !== null) {
    if (row.ts === lastAcceptedTs) return "duplicate timestamp";
    if (row.ts < lastAcceptedTs) return "out-of-order (non-monotonic) timestamp";
  }
  return null;
}

/** MT5 date `YYYY.MM.DD` + optional time `HH:MM:SS`, both wall-clock in the broker's zone. */
function parseMt5Timestamp(dateStr: string, timeStr: string | undefined, tzOffsetMinutes: number): number {
  const dateMatch = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(dateStr.trim());
  if (!dateMatch) return NaN;
  const [, y, mo, d] = dateMatch;

  let h = 0;
  let mi = 0;
  let s = 0;
  if (timeStr && timeStr.trim()) {
    const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr.trim());
    if (!timeMatch) return NaN;
    h = Number(timeMatch[1]);
    mi = Number(timeMatch[2]);
    s = timeMatch[3] ? Number(timeMatch[3]) : 0;
  }

  const wallClockMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), h, mi, s);
  return wallClockMs - tzOffsetMinutes * 60_000;
}

/** Epoch seconds (10-digit-ish) vs milliseconds (13-digit-ish), by magnitude
 * — the boundary is far from both today's values and any plausible trading
 * data, so there's no realistic value that is ambiguous between the two. */
function looksLikeEpochSeconds(n: number): boolean {
  return n < 1e11;
}

/** Generic time column: epoch (unambiguous, used as-is), an ISO string that
 * already carries an offset/`Z` (unambiguous, used as-is), or a bare/naive
 * timestamp (broker/local wall clock — needs `tzOffsetMinutes`). */
function parseGenericTimestamp(raw: string, tzOffsetMinutes: number): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return looksLikeEpochSeconds(n) ? n * 1000 : n;
  }

  const hasExplicitOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (hasExplicitOffset) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? NaN : ms;
  }

  // Naive "YYYY-MM-DD[ T]HH:MM[:SS]" — read the wall-clock fields ourselves
  // rather than via Date.parse, which treats a naive string as LOCAL TIME
  // OF THE MACHINE RUNNING THE CODE. That's wrong twice over here: it's not
  // the broker's zone, and in the browser (client-side preview) it's
  // whatever timezone the viewer's OS happens to be in.
  const naiveMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (naiveMatch) {
    const [, y, mo, d, h, mi, s] = naiveMatch;
    const wallClockMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
    return wallClockMs - tzOffsetMinutes * 60_000;
  }

  return NaN;
}

function parseMt5(lines: string[], opts: ParseCandleCsvOptions): ParseCandleCsvResult {
  const header = lines[0].split("\t").map(normalizeHeaderCell);
  const colIndex = (name: Mt5Column) => header.indexOf(name);

  const iDate = colIndex("date");
  const iTime = colIndex("time"); // -1 on a daily export — that's expected, not an error.
  const iOpen = colIndex("open");
  const iHigh = colIndex("high");
  const iLow = colIndex("low");
  const iClose = colIndex("close");
  const iTickVol = colIndex("tickvol");
  const iVol = colIndex("vol");
  const iSpread = colIndex("spread");

  const rows: ParsedBar[] = [];
  const warnings: string[] = [];
  const skipped = { n: 0 };
  let lastAcceptedTs: number | null = null;

  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split("\t");
    const ts = parseMt5Timestamp(cells[iDate] ?? "", iTime >= 0 ? cells[iTime] : undefined, opts.tzOffsetMinutes);
    const open = Number(cells[iOpen]);
    const high = Number(cells[iHigh]);
    const low = Number(cells[iLow]);
    const close = Number(cells[iClose]);

    const reason = validate({ ts, open, high, low, close }, lastAcceptedTs);
    if (reason) {
      addWarning(warnings, skipped, `Row ${li + 1}: skipped (${reason}).`);
      continue;
    }

    const volumeRaw = iTickVol >= 0 ? cells[iTickVol] : iVol >= 0 ? cells[iVol] : undefined;
    const volume = volumeRaw !== undefined && volumeRaw !== "" ? Number(volumeRaw) : undefined;
    const spreadRaw = iSpread >= 0 ? cells[iSpread] : undefined;
    const spread = spreadRaw !== undefined && spreadRaw !== "" ? Number(spreadRaw) : undefined;

    rows.push({
      ts,
      open,
      high,
      low,
      close,
      volume: volume !== undefined && Number.isFinite(volume) ? volume : undefined,
      spread: spread !== undefined && Number.isFinite(spread) ? spread : undefined,
    });
    lastAcceptedTs = ts;
  }

  return { rows, format: "MT5", warnings, skipped: skipped.n };
}

function parseGeneric(lines: string[], opts: ParseCandleCsvOptions): ParseCandleCsvResult {
  const delimiter = detectDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((c) => c.trim().toLowerCase());

  const findCol = (patterns: RegExp) => header.findIndex((h) => patterns.test(h));
  const iTime = findCol(/^(time|date|timestamp|datetime)$/);
  const iOpen = findCol(/^(open|o)$/);
  const iHigh = findCol(/^(high|h)$/);
  const iLow = findCol(/^(low|l)$/);
  const iClose = findCol(/^(close|c)$/);
  const iVolume = findCol(/^(volume|vol|v)$/);

  const rows: ParsedBar[] = [];
  const warnings: string[] = [];
  const skipped = { n: 0 };

  if (iTime === -1 || iOpen === -1 || iHigh === -1 || iLow === -1 || iClose === -1) {
    warnings.push(
      "Could not find one or more required columns (time/date, open, high, low, close) in the header row.",
    );
    return { rows, format: "GENERIC", warnings, skipped: 0 };
  }

  let lastAcceptedTs: number | null = null;

  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split(delimiter);
    const ts = parseGenericTimestamp(cells[iTime] ?? "", opts.tzOffsetMinutes);
    const open = Number(cells[iOpen]);
    const high = Number(cells[iHigh]);
    const low = Number(cells[iLow]);
    const close = Number(cells[iClose]);

    const reason = validate({ ts, open, high, low, close }, lastAcceptedTs);
    if (reason) {
      addWarning(warnings, skipped, `Row ${li + 1}: skipped (${reason}).`);
      continue;
    }

    const volumeRaw = iVolume >= 0 ? cells[iVolume] : undefined;
    const volume = volumeRaw !== undefined && volumeRaw.trim() !== "" ? Number(volumeRaw) : undefined;

    rows.push({
      ts,
      open,
      high,
      low,
      close,
      volume: volume !== undefined && Number.isFinite(volume) ? volume : undefined,
    });
    lastAcceptedTs = ts;
  }

  return { rows, format: "GENERIC", warnings, skipped: skipped.n };
}

export function parseCandleCsv(text: string, opts: ParseCandleCsvOptions): ParseCandleCsvResult {
  if (!Number.isFinite(opts.tzOffsetMinutes)) {
    throw new Error("tzOffsetMinutes is required — see the module doc on why it cannot default to 0.");
  }

  const stripped = stripBom(text);
  const lines = splitLines(stripped);

  if (lines.length === 0) {
    return { rows: [], format: "GENERIC", warnings: ["The file is empty."], skipped: 0 };
  }

  const format: CandleCsvFormat = looksLikeMt5(lines[0]) ? "MT5" : "GENERIC";
  const result = format === "MT5" ? parseMt5(lines, opts) : parseGeneric(lines, opts);

  if (result.skipped > result.warnings.length) {
    result.warnings.push(`…and ${result.skipped - result.warnings.length} more skipped row(s).`);
  }

  return result;
}
