import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { HttpClient } from "@faltasmas/connectors";
import { fetchAbsences } from "../src/connector";

const userFile = process.env.ALEXIA_USER_FILE;
const passFile = process.env.ALEXIA_PASS_FILE;

/** fetch-backed HttpClient with a minimal in-memory cookie jar (test-only; the connector is cookie-free). */
function cookieHttp(): HttpClient {
  const jar = new Map<string, string>();
  return {
    async request(req) {
      let url = req.url;
      let method: string = req.method ?? "GET";
      let body = req.body;
      for (let hop = 0; hop < 10; hop++) {
        const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
        const res = await fetch(url, {
          method,
          body,
          redirect: "manual",
          headers: { ...req.headers, ...(cookie ? { Cookie: cookie } : {}) },
        });
        for (const [k, v] of res.headers.entries()) {
          if (k.toLowerCase() !== "set-cookie") continue;
          const pair = v.split(";")[0];
          const eq = pair.indexOf("=");
          if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
          url = new URL(loc, url).toString();
          if (res.status !== 307 && res.status !== 308) { method = "GET"; body = undefined; }
          continue;
        }
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() };
      }
      throw new Error("too many redirects");
    },
  };
}

test.skipIf(!userFile || !passFile)("live: fetches a report from Alexia", async () => {
  const credentials = {
    username: readFileSync(userFile!, "utf8").trim(),
    password: readFileSync(passFile!, "utf8").trim(),
  };
  const report = await fetchAbsences({ http: cookieHttp(), credentials, institutionId: "NS2IrX8Iq04%3d" });
  expect(report.totalHours).toBeGreaterThanOrEqual(0);
  expect(report.subjects.length).toBeGreaterThan(0);
  console.log(`live: totalHours=${report.totalHours} subjects=${report.subjects.length}`);
}, 60000);
