import { ConnectorError, type AbsenceReport } from "@faltasmas/connectors";

export type SubjectHours = { name: string; hours: number };

const unexpected = (msg: string) => new ConnectorError("unexpected_response", msg);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ccedil: "ç", Ccedil: "Ç",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([A-Za-z]+));/g, (m, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED_ENTITIES[name] ?? m;
  });
}

/** Takes the first GuidAlumno found in a FichaAlumno.aspx link on the home page. */
export function extractGuidAlumno(homeHtml: string): string {
  const m = homeHtml.match(/FichaAlumno\.aspx\?GuidAlumno=([0-9a-fA-F-]{36})/);
  if (!m) throw unexpected("No FichaAlumno link with GuidAlumno found on the home page");
  return m[1];
}

export function isLoginPage(html: string): boolean {
  return html.includes('name="txtPassword"');
}

/** Parses the jqGrid JSON. Returns [] only for a well-formed grid with empty rows. */
export function parseAbsenceGrid(gridText: string): SubjectHours[] {
  let grid: unknown;
  try {
    grid = JSON.parse(gridText);
  } catch {
    throw unexpected("Attendance grid is not JSON");
  }
  const rows = (grid as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) throw unexpected("Attendance grid has no rows array");

  return rows.map((row: { cell?: unknown }) => {
    const cell = row?.cell;
    if (!Array.isArray(cell) || typeof cell[3] !== "string" || !cell[3].trim()) {
      throw unexpected("Attendance grid row has no subject");
    }
    const html = typeof cell[5] === "string" ? cell[5] : "";
    const match = html.match(/<span id="spanObs">([^<]*)<\/span>/);
    const raw = match ? match[1].trim().replace(",", ".") : "0";
    const hours = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (Number.isNaN(hours)) throw unexpected("Attendance grid row has unreadable hours");
    return { name: decodeEntities(cell[3]).trim(), hours };
  });
}

export function buildReport(subjects: SubjectHours[], now: Date): AbsenceReport {
  const totalHours = Math.round(subjects.reduce((sum, s) => sum + s.hours, 0) * 100) / 100;
  return { totalHours, subjects, syncedAt: now.toISOString() };
}
