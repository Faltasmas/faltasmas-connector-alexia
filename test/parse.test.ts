import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ConnectorError } from "@faltasmas/connectors";
import { buildReport, extractGuidAlumno, isLoginPage, parseAbsenceGrid } from "../src/parse";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const GUID = "00000000-0000-0000-0000-000000000000";

function code(fn: () => unknown): string | undefined {
  try { fn(); } catch (e) { return e instanceof ConnectorError ? e.code : "other"; }
  return undefined;
}

describe("extractGuidAlumno", () => {
  test("extractGuidAlumno returns the guid from the sanitised home page", () => {
    expect(extractGuidAlumno(fx("home.html"))).toBe(GUID);
  });
  test("extractGuidAlumno throws unexpected_response when the page has no student link", () => {
    expect(code(() => extractGuidAlumno("<html>nothing</html>"))).toBe("unexpected_response");
  });
});

test("isLoginPage is true for login-page.html and false for home.html", () => {
  expect(isLoginPage(fx("login-page.html"))).toBe(true);
  expect(isLoginPage(fx("home.html"))).toBe(false);
});

describe("parseAbsenceGrid", () => {
  test("parseAbsenceGrid returns one entry per row with the right hours", () => {
    expect(parseAbsenceGrid(fx("grid.json"))).toEqual([
      { name: "Acceso a datos.", hours: 5 },
      { name: "Desarrollo de interfaces.", hours: 14 },
      { name: "Sistemas de gestión empresarial.", hours: 0 },
      { name: "Principios De Ciberseguridad", hours: 2 },
    ]);
  });
  test('parseAbsenceGrid reads "23,4" as 23.4', () => {
    expect(parseAbsenceGrid(fx("grid-comma.json"))).toEqual([{ name: "Acceso a datos.", hours: 23.4 }]);
  });
  test("parseAbsenceGrid returns [] for a grid with an empty rows array", () => {
    expect(parseAbsenceGrid(fx("grid-empty.json"))).toEqual([]);
  });
  test("parseAbsenceGrid throws unexpected_response for an HTML error page", () => {
    expect(code(() => parseAbsenceGrid("<html><body>Runtime Error</body></html>"))).toBe("unexpected_response");
  });
  test("parseAbsenceGrid throws unexpected_response when rows is missing", () => {
    expect(code(() => parseAbsenceGrid("{}"))).toBe("unexpected_response");
  });
  test("parseAbsenceGrid throws unexpected_response on a malformed row or unparsable hours", () => {
    expect(code(() => parseAbsenceGrid(JSON.stringify({ rows: [{ cell: ["a"] }] })))).toBe("unexpected_response");
    const bad = `<span id="spanObs">abc</span>`;
    expect(code(() => parseAbsenceGrid(JSON.stringify({ rows: [{ cell: ["", "", "", "X", "", bad] }] })))).toBe("unexpected_response");
  });
  test("parseAbsenceGrid decodes HTML entities in subject names", () => {
    const g = JSON.stringify({ rows: [{ cell: ["", "", "", "Gesti&oacute;n y Tecnolog&iacute;a &amp; m&aacute;s", "", "<div></div>"] }] });
    expect(parseAbsenceGrid(g)[0].name).toBe("Gestión y Tecnología & más");
    const g2 = JSON.stringify({ rows: [{ cell: ["", "", "", "Matem&aacute;ticas", "", "<div></div>"] }] });
    expect(parseAbsenceGrid(g2)[0].name).toBe("Matemáticas");
  });
});

test("buildReport sums hours and stamps syncedAt as an ISO string", () => {
  const now = new Date("2026-10-27T10:00:00.000Z");
  const r = buildReport([{ name: "A", hours: 0.1 }, { name: "B", hours: 0.2 }, { name: "C", hours: 5 }], now);
  expect(r.totalHours).toBe(5.3);
  expect(r.syncedAt).toBe("2026-10-27T10:00:00.000Z");
  expect(r.subjects).toHaveLength(3);
});
