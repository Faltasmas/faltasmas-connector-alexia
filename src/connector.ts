import {
  ConnectorError,
  type AbsenceReport,
  type ConnectorContext,
  type HttpClient,
  type HttpResponse,
} from "@faltasmas/connectors";
import { buildReport, extractGuidAlumno, extractHiddenPairs, isLoginPage, parseAbsenceGrid } from "./parse";

const ORIGIN = "https://web2.alexiaedu.com";
const BASE = `${ORIGIN}/ACWeb`;
const MAX_LOGIN_ATTEMPTS = 3;
const GRID_ID = "ctl00_ContenidoPagina_ctl00_GridIncidenciasTotalesAlumnoSesiones1";
const FILTER_CONTROL = "ctl00$ContenidoPagina$ctl00$filtradorFechas1";
const SCHOOL_YEAR_OPTION = "1000";

// The site sits behind bot management. A realistic User-Agent and Accept-Language
// are sent; sec-ch-* and Sec-Fetch-* are deliberately NOT, since a phone's HTTP
// stack cannot set them. Cookies belong to the host: no Cookie header is ever
// sent and Set-Cookie is never read.
const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};
const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const AJAX_ACCEPT = "application/json, text/javascript, */*; q=0.01";

const err = (code: ConstructorParameters<typeof ConnectorError>[0], msg: string) => new ConnectorError(code, msg);

/** Alexia's intermittent answers for a valid key and credentials; only these are retried. */
const FLAKY = /Institución no válida|Rol no válido/;

class FlakyLoginError extends ConnectorError {
  constructor(message: string) {
    super("unexpected_response", message);
    Object.setPrototypeOf(this, FlakyLoginError.prototype);
  }
}

function checkStatus(res: HttpResponse, what: string): void {
  if (res.status < 200 || res.status >= 300) throw err("unexpected_response", `${what} failed with status ${res.status}`);
}

async function getPage(http: HttpClient, url: string, what: string, extra: Record<string, string> = {}): Promise<string> {
  const res = await http.request({ url, method: "GET", headers: { ...BASE_HEADERS, Accept: PAGE_ACCEPT, ...extra } });
  checkStatus(res, what);
  return res.body;
}

/**
 * Calls one method of the `WS_Data/WSLogOn.asmx` ASP.NET AJAX web service.
 * The AJAX calls need `X-Requested-With: XMLHttpRequest` plus a matching
 * `Referer`; without either the server throws a null reference instead of
 * validating. The session cookie (AC_SessionId) that ties `token` to the
 * server-side session is carried by the host's cookie store.
 */
async function callLogOn(http: HttpClient, method: string, body: Record<string, unknown>, loginUrl: string): Promise<unknown> {
  const res = await http.request({
    url: `${BASE}/WS_Data/WSLogOn.asmx/${method}`,
    method: "POST",
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/json; charset=UTF-8",
      Accept: AJAX_ACCEPT,
      "X-Requested-With": "XMLHttpRequest",
      Referer: loginUrl,
    },
    body: JSON.stringify(body),
  });
  checkStatus(res, `Alexia login request (${method})`);
  try {
    return JSON.parse(res.body);
  } catch {
    throw err("unexpected_response", `Alexia login (${method}) did not return JSON`);
  }
}

/** Flaky server messages become retryable; any other server message is passed to `otherwise`. */
function failWith(message: string, otherwise: () => ConnectorError): never {
  if (FLAKY.test(message)) throw new FlakyLoginError(`Alexia login: ${message}`);
  throw otherwise();
}

/**
 * Logs in and returns the path of the home page (`RutaHome`).
 *
 * LogOn.aspx is not a plain WebForms postback; the "Entrar" button drives a
 * sequence of session-bound calls against `WSLogOn.asmx`:
 * 1. `Validar({token, nickname, password})`: `token` is the page's hidden
 *    `Token` field. Success is `{"d":""}` and does NOT authenticate the session
 *    by itself; failure is `{"d":"<Spanish message>"}`.
 * 2. `GetRoles({token})`: `{"d":{"OK":[{"Identificador":...}]}}`. Exactly one
 *    role is supported (logon.js branches to a role picker or a "no role" error
 *    otherwise, which a headless flow cannot drive).
 * 3. `ValidarRol({token, idRol, evaluarMultifactor:false})`: THIS call flips the
 *    session to authenticated. Skipping it leaves cookies that pass `Validar`
 *    but make every authenticated page redirect back to LogOn.aspx.
 */
async function loginOnce(http: HttpClient, key: string, username: string, password: string): Promise<string> {
  const loginUrl = `${BASE}/LogOn.aspx?key=${key}`;
  const html = await getPage(http, loginUrl, "Alexia login page");
  const token = extractHiddenPairs(html).find(([n]) => n === "Token")?.[1];
  if (!token) throw err("unexpected_response", "Alexia login page did not return the expected form");

  const validar = (await callLogOn(http, "Validar", { token, nickname: username, password }, loginUrl)) as { d?: unknown };
  if (typeof validar?.d !== "string") throw err("unexpected_response", "Alexia Validar returned an unexpected shape");
  if (validar.d !== "") {
    failWith(validar.d, () => err("invalid_credentials", "Alexia rejected the credentials"));
  }

  const roles = (await callLogOn(http, "GetRoles", { token }, loginUrl)) as {
    d?: { OK?: Array<{ Identificador?: string }>; Error?: string };
  };
  if (roles?.d?.Error) failWith(roles.d.Error, () => err("unexpected_response", "Alexia GetRoles reported an error"));
  const list = roles?.d?.OK;
  if (!Array.isArray(list)) throw err("unexpected_response", "Alexia GetRoles returned an unexpected shape");
  if (list.length === 0 || !list[0]?.Identificador) throw new FlakyLoginError("Alexia login returned no usable role");
  if (list.length > 1) throw err("unsupported_account", "Account has more than one role");

  const rol = (await callLogOn(http, "ValidarRol", { token, idRol: list[0].Identificador, evaluarMultifactor: false }, loginUrl)) as {
    d?: { OK?: boolean; RutaHome?: string; Error?: string };
  };
  if (rol?.d?.Error) failWith(rol.d.Error, () => err("unexpected_response", "Alexia ValidarRol reported an error"));
  if (rol?.d?.OK !== true) throw err("unsupported_account", "Account requires an unsupported extra verification step");
  const home = rol.d.RutaHome;
  if (typeof home !== "string" || !home) throw err("unexpected_response", "Alexia ValidarRol returned no RutaHome");
  return home;
}

/** Alexia intermittently answers the flaky errors for valid input, so retry only those (no backoff). */
async function login(http: HttpClient, key: string, username: string, password: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await loginOnce(http, key, username, password);
    } catch (e) {
      if (!(e instanceof FlakyLoginError) || attempt >= MAX_LOGIN_ATTEMPTS) throw e;
    }
  }
}

/** Builds an absolute URL from a server-supplied path, refusing any other host. */
function sameHostUrl(path: string): string {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN) throw err("unexpected_response", "RutaHome points outside the Alexia host");
  return url.toString();
}

const echoedFrom = (html: string) => html.match(/filtradorFechas1_fechaInicio"[^>]*value="([^"]*)"/)?.[1];

/**
 * Mirrors the page's "Display data for -> School year" option (value `1000`).
 * The date filter (default: last week) is server-side session state, set by a
 * plain WebForms postback whose `__EVENTARGUMENT` is `"<from>#<to>"` (M/D/YYYY),
 * with bounds taken from the page's own `hdnFechaInicioCentro`/`hdnFechaFinalCentro`.
 * The response echoes the applied "From" date; if it differs from what was
 * requested the filter did not apply and the grid would be the wrong period, so
 * that is an error, never a quiet zero.
 */
async function selectSchoolYear(http: HttpClient, pageUrl: string, pageHtml: string): Promise<void> {
  const pairs = extractHiddenPairs(pageHtml);
  const get = (n: string) => pairs.find(([k]) => k === `${FILTER_CONTROL}$${n}`)?.[1];
  const from = get("hdnFechaInicioCentro");
  const to = get("hdnFechaFinalCentro");
  if (!from || !to) throw err("unexpected_response", "Attendance page did not expose the school-year range");

  // Duplicate names are kept (the grid's two hidden inputs share one name),
  // then the filter fields are overridden.
  const form = new URLSearchParams(pairs);
  form.set(`${FILTER_CONTROL}$cmbFiltroFecha`, SCHOOL_YEAR_OPTION);
  form.set(`${FILTER_CONTROL}$fechaInicio`, from);
  form.set(`${FILTER_CONTROL}$fechaFin`, to);
  form.set("__EVENTTARGET", FILTER_CONTROL.replaceAll("$", "_"));
  form.set("__EVENTARGUMENT", `${from}#${to}`);

  const res = await http.request({
    url: pageUrl,
    method: "POST",
    headers: {
      ...BASE_HEADERS,
      Accept: PAGE_ACCEPT,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: ORIGIN,
      Referer: pageUrl,
    },
    body: form.toString(),
  });
  if (isLoginPage(res.body)) throw err("session_expired", "Alexia session expired");
  checkStatus(res, "Alexia school-year filter request");
  if (echoedFrom(res.body) !== from) throw err("unexpected_response", "School-year filter was not applied");
}

/**
 * Per-subject absence totals. The "ficha del alumno" page is only a shell; the
 * numbers live in a jqGrid ("Incidencias Totales Alumno Sesiones") served by a
 * second request to the SAME `SeguimientoDiario.aspx` URL with a `jqGridID`
 * query param. That JSON request only works after a plain GET of the page URL
 * in the same session (the server sets up per-grid session state there), and a
 * standalone WebForms POST for it lands on the generic runtime-error page. The
 * browser also loads the grid once before posting the filter, so that response
 * is fetched and discarded, then the grid is fetched again after the filter.
 */
export async function fetchAbsences(ctx: ConnectorContext): Promise<AbsenceReport> {
  const { http, institutionId } = ctx;
  const username = ctx.credentials?.username;
  const password = ctx.credentials?.password;
  if (!username || !password) throw err("invalid_credentials", "Missing username or password");

  const rutaHome = await login(http, institutionId, username, password);
  const homeHtml = await getPage(http, sameHostUrl(rutaHome), "Alexia home page");
  if (isLoginPage(homeHtml)) throw err("session_expired", "Alexia session expired");
  const guid = extractGuidAlumno(homeHtml);

  const pageUrl = `${BASE}/paginas/incidencias/SeguimientoDiario.aspx?GuidAlumno=${guid}`;
  const pageHtml = await getPage(http, pageUrl, "Alexia attendance page");
  if (isLoginPage(pageHtml)) throw err("session_expired", "Alexia session expired");

  const gridUrl = `${pageUrl}&jqGridID=${GRID_ID}&page=1&rows=500&sidx=&sord=asc&_search=false`;
  const fetchGrid = async () => {
    const res = await http.request({
      url: gridUrl,
      method: "GET",
      headers: { ...BASE_HEADERS, Accept: AJAX_ACCEPT, "X-Requested-With": "XMLHttpRequest", Referer: pageUrl },
    });
    if (isLoginPage(res.body)) throw err("session_expired", "Alexia session expired");
    checkStatus(res, "Alexia attendance grid request");
    return res.body;
  };

  await fetchGrid();
  await selectSchoolYear(http, pageUrl, pageHtml);
  const subjects = parseAbsenceGrid(await fetchGrid());
  return buildReport(subjects, new Date());
}
