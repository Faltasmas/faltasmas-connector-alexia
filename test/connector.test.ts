import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ConnectorError, validateManifest,
  type ConnectorContext, type HttpClient, type HttpRequest, type HttpResponse,
} from "@faltasmas/connectors";
import connector, { fetchAbsences } from "../src/index";
import { manifest } from "../src/manifest";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const KEY = "NS2IrX8Iq04%3d";
const F = "ctl00$ContenidoPagina$ctl00$filtradorFechas1";
const FROM = "9/1/2025";

type Canned = string | { status?: number; body: string };

function fakeHttp(script: Canned[]) {
  const requests: HttpRequest[] = [];
  let i = 0;
  const http: HttpClient = {
    async request(req): Promise<HttpResponse> {
      requests.push(req);
      if (i >= script.length) throw new Error(`unscripted request #${i + 1}: ${req.url}`);
      const c = script[i++];
      const { status = 200, body } = typeof c === "string" ? { body: c } : c;
      return { status, headers: {}, body };
    },
  };
  return { http, requests };
}

const ctx = (http: HttpClient, over: Partial<ConnectorContext> = {}): ConnectorContext => ({
  http, institutionId: KEY, credentials: { username: "u-test", password: "p-test" }, ...over,
});

const logonPage = `<form><input type="hidden" name="Token" value="tok-1" /></form>`;
const ROLES_OK = `{"d":{"OK":[{"Identificador":"role-1"}]}}`;
const VALIDAR_ROL_OK = `{"d":{"OK":true,"RutaHome":"/ACWeb/paginas/Home/HomeMetro.aspx","OKCuenta":true}}`;
const pageHtml = (echo = FROM) => `<html><body>
<input type="hidden" name="__VIEWSTATE" value="vs" />
<input name="${F}$hdnFechaInicioCentro" type="hidden" value="${FROM}" />
<input type="hidden" name="${F}$hdnFechaFinalCentro" value="6/30/2026" />
<input name="${F}$fechaInicio" id="ctl00_ContenidoPagina_ctl00_filtradorFechas1_fechaInicio" type="text" value="${echo}" />
</body></html>`;

const loginScript = (): Canned[] => [logonPage, `{"d":""}`, ROLES_OK, VALIDAR_ROL_OK];
const fullScript = (grid = fx("grid.json"), echo = FROM): Canned[] => [
  ...loginScript(), fx("home.html"), pageHtml(), "{}", pageHtml(echo), grid,
];
const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e instanceof ConnectorError ? e.code : "other"; }
  return undefined;
};

describe("alexia connector", () => {
  test("manifest passes validateManifest", () => {
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(connector.manifest).toBe(manifest);
  });

  test("returns a report for a full successful run", async () => {
    const { http, requests } = fakeHttp(fullScript());
    const report = await fetchAbsences(ctx(http));
    expect(report.totalHours).toBeGreaterThan(0);
    expect(report.subjects.length).toBeGreaterThan(0);
    expect(requests[0].url).toContain(`LogOn.aspx?key=${KEY}`);
    expect(requests).toHaveLength(9);
    const post = requests[7];
    expect(post.method).toBe("POST");
    expect(post.body).toContain("__EVENTARGUMENT=" + encodeURIComponent(`${FROM}#6/30/2026`));
    expect(post.body).toContain("__VIEWSTATE=vs");
  });

  test("accepts an empty grid as 0 hours when the filter echo was verified", async () => {
    const { http } = fakeHttp(fullScript(fx("grid-empty.json")));
    const report = await fetchAbsences(ctx(http));
    expect(report.totalHours).toBe(0);
    expect(report.subjects).toEqual([]);
  });

  test("throws unexpected_response when the filter echo differs", async () => {
    const { http } = fakeHttp(fullScript(fx("grid-empty.json"), "1/1/2000"));
    expect(await code(fetchAbsences(ctx(http)))).toBe("unexpected_response");
  });

  test("only requests the host web2.alexiaedu.com", async () => {
    const { http, requests } = fakeHttp(fullScript());
    await fetchAbsences(ctx(http));
    for (const r of requests) expect(new URL(r.url).host).toBe("web2.alexiaedu.com");
  });

  test("never sends a Cookie header or sec-ch/Sec-Fetch headers", async () => {
    const { http, requests } = fakeHttp(fullScript());
    await fetchAbsences(ctx(http));
    for (const r of requests) {
      const names = Object.keys(r.headers ?? {}).map((h) => h.toLowerCase());
      expect(names).not.toContain("cookie");
      expect(names.some((h) => h.startsWith("sec-ch-") || h.startsWith("sec-fetch-"))).toBe(false);
      expect(names).toContain("user-agent");
      expect(names).toContain("accept-language");
    }
  });

  test("throws invalid_credentials and makes no further requests when Validar returns a message", async () => {
    const { http, requests } = fakeHttp([logonPage, `{"d":"Usuario o código de acceso incorrecto"}`]);
    expect(await code(fetchAbsences(ctx(http)))).toBe("invalid_credentials");
    expect(requests).toHaveLength(2);
  });

  test("throws invalid_credentials without requests when credentials are missing", async () => {
    const { http, requests } = fakeHttp([]);
    expect(await code(fetchAbsences(ctx(http, { credentials: { username: "u" } })))).toBe("invalid_credentials");
    expect(requests).toHaveLength(0);
  });

  test('retries "Rol no válido" up to 3 times and then throws', async () => {
    const attempt: Canned[] = [logonPage, `{"d":""}`, ROLES_OK, `{"d":{"Error":"Rol no válido"}}`];
    const { http, requests } = fakeHttp([...attempt, ...attempt, ...attempt]);
    expect(await code(fetchAbsences(ctx(http)))).toBe("unexpected_response");
    expect(requests).toHaveLength(12);
  });

  test("a flaky first attempt followed by success still returns a report", async () => {
    const bad: Canned[] = [logonPage, `{"d":"Institución no válida"}`];
    const { http } = fakeHttp([...bad, ...fullScript()]);
    expect((await fetchAbsences(ctx(http))).totalHours).toBeGreaterThan(0);
  });

  test("a flaky attempt followed by wrong credentials throws invalid_credentials", async () => {
    const { http } = fakeHttp([logonPage, `{"d":"Institución no válida"}`, logonPage, `{"d":"Usuario o código de acceso incorrecto"}`]);
    expect(await code(fetchAbsences(ctx(http)))).toBe("invalid_credentials");
  });

  test("throws unsupported_account when GetRoles returns more than one role", async () => {
    const roles = `{"d":{"OK":[{"Identificador":"a"},{"Identificador":"b"}]}}`;
    const { http } = fakeHttp([logonPage, `{"d":""}`, roles]);
    expect(await code(fetchAbsences(ctx(http)))).toBe("unsupported_account");
  });

  test("throws unsupported_account when ValidarRol asks for extra verification", async () => {
    const { http } = fakeHttp([logonPage, `{"d":""}`, ROLES_OK, `{"d":{"OK":false,"RutaHome":""}}`]);
    expect(await code(fetchAbsences(ctx(http)))).toBe("unsupported_account");
  });

  test("throws session_expired when the grid response is the login page", async () => {
    const { http } = fakeHttp(fullScript(fx("login-page.html")));
    expect(await code(fetchAbsences(ctx(http)))).toBe("session_expired");
  });

  test("throws unexpected_response when the grid response is not JSON", async () => {
    const { http } = fakeHttp(fullScript("<html>runtime error</html>"));
    expect(await code(fetchAbsences(ctx(http)))).toBe("unexpected_response");
  });
});
