import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ConnectorError } from "@faltasmas/connectors";
import { buildReport, extractGuidAlumno, extractHiddenPairs, isLoginPage, parseAbsenceGrid } from "../src/parse";

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
  test("extractGuidAlumno returns the first of two distinct guids", () => {
    const a = "11111111-1111-1111-1111-111111111111", b = "22222222-2222-2222-2222-222222222222";
    const html = `<a href="FichaAlumno.aspx?GuidAlumno=${a}">x</a><a href="FichaAlumno.aspx?GuidAlumno=${b}">y</a>`;
    expect(extractGuidAlumno(html)).toBe(a);
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
  const grid = (name: unknown, html: string) =>
    JSON.stringify({ rows: [{ cell: ["", "", "", name, "", html] }] });
  test("parseAbsenceGrid treats an empty spanObs as 0 hours", () => {
    expect(parseAbsenceGrid(grid("X", '<span id="spanObs"></span>'))).toEqual([{ name: "X", hours: 0 }]);
  });
  test("parseAbsenceGrid throws on a non-empty unparseable hours value", () => {
    expect(code(() => parseAbsenceGrid(grid("X", '<span id="spanObs">abc</span>')))).toBe("unexpected_response");
  });
  test("parseAbsenceGrid skips a subject-less row with 0 or absent hours", () => {
    expect(parseAbsenceGrid(grid("", "<div></div>"))).toEqual([]);
    expect(parseAbsenceGrid(grid("", '<span id="spanObs">0</span>'))).toEqual([]);
    expect(parseAbsenceGrid(JSON.stringify({ rows: [{ cell: ["a"] }] }))).toEqual([]);
  });
  test("parseAbsenceGrid throws on a subject-less row with non-zero hours", () => {
    expect(code(() => parseAbsenceGrid(grid("", '<span id="spanObs">3</span>')))).toBe("unexpected_response");
    expect(code(() => parseAbsenceGrid(grid(" ", '<span id="spanObs">3</span>')))).toBe("unexpected_response");
  });
  test("parseAbsenceGrid decodes &amp;lt; in a single pass to literal &lt;", () => {
    expect(parseAbsenceGrid(grid("A &amp;lt; B", "<div></div>"))[0].name).toBe("A &lt; B");
  });
  test("parseAbsenceGrid leaves an out-of-range numeric entity unchanged without throwing", () => {
    expect(parseAbsenceGrid(grid("A &#99999999; B", "<div></div>"))[0].name).toBe("A &#99999999; B");
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

describe("extractHiddenPairs", () => {
  test("extractHiddenPairs handles either attribute order and keeps duplicates", () => {
    const html = `<input type="hidden" name="a" value="1&amp;2" /><input name="b" type="hidden" value="x&quot;y" /><input name="a" type="hidden" /><input type="text" name="c" value="no" />`;
    expect(extractHiddenPairs(html)).toEqual([["a", "1&2"], ["b", 'x"y'], ["a", ""]]);
  });
});
