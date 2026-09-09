import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchKeywords,
  toEntries,
  isApiKey,
  AzboxApiError,
  KEY_PREFIX,
} from "../src/api.mjs";

/** fetch de mentira que devuelve lo que se le diga y guarda lo que se le pide. */
function stub({ status = 200, body = [] } = {}) {
  const calls = [];
  const headers = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    headers.push(options.headers ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { fetchImpl, calls, headers };
}

const CLAVE = KEY_PREFIX + "K".repeat(32);

const CRED = { token: "tok", projectId: "p1", language: "ES" };

test("construye la URL con token, idioma y proyecto escapado", async () => {
  const { fetchImpl, calls } = stub({ body: [] });
  await fetchKeywords({ ...CRED, projectId: "a/b" }, { fetchImpl });
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/v1/projects/a%2Fb/keywords");
  assert.equal(url.searchParams.get("token"), "tok");
  assert.equal(url.searchParams.get("language"), "ES");
  assert.equal(url.searchParams.get("afterUpdatedAtStr"), null);
});

test("afterUpdatedAt viaja como ISO en afterUpdatedAtStr", async () => {
  const { fetchImpl, calls } = stub({ body: [] });
  const fecha = new Date("2026-01-02T03:04:05.000Z");
  await fetchKeywords({ ...CRED, afterUpdatedAt: fecha }, { fetchImpl });
  assert.equal(
    new URL(calls[0]).searchParams.get("afterUpdatedAtStr"),
    "2026-01-02T03:04:05.000Z",
  );
});

test("un 404 de 'No keywords found' es lista vacía, no error", async () => {
  const { fetchImpl } = stub({ status: 404, body: { detail: "No keywords found 1 pid: p1" } });
  assert.deepEqual(await fetchKeywords(CRED, { fetchImpl }), []);
});

test("un 404 de 'Language not found' sí es error", async () => {
  const { fetchImpl } = stub({ status: 404, body: { detail: "Language not found " } });
  await assert.rejects(
    () => fetchKeywords(CRED, { fetchImpl }),
    (e) => e instanceof AzboxApiError && /idioma "ES" no existe/.test(e.message),
  );
});

test("un 500 es error y conserva el estado", async () => {
  const { fetchImpl } = stub({ status: 500, body: { detail: "boom" } });
  await assert.rejects(
    () => fetchKeywords(CRED, { fetchImpl }),
    (e) => e.status === 500 && e.detail === "boom",
  );
});

test("faltar credenciales falla antes de la red", async () => {
  const { fetchImpl, calls } = stub();
  await assert.rejects(() => fetchKeywords({ ...CRED, token: "" }, { fetchImpl }));
  await assert.rejects(() => fetchKeywords({ ...CRED, projectId: "" }, { fetchImpl }));
  await assert.rejects(() => fetchKeywords({ ...CRED, language: "" }, { fetchImpl }));
  assert.equal(calls.length, 0);
});

test("una respuesta que no es array se rechaza", async () => {
  const { fetchImpl } = stub({ body: { nope: true } });
  await assert.rejects(() => fetchKeywords(CRED, { fetchImpl }), /array/);
});

// ── toEntries: aquí estaba el error que se documentó mal ───────────────────

test("la clave sale de data.keyword, nunca del id", () => {
  const { entries } = toEntries([
    { id: "8Kd0pQ2mNvXyZ1aB3cD4", data: { keyword: "home.title", translation: "Hola" } },
  ]);
  assert.deepEqual(entries, [["home.title", "Hola"]]);
});

test("las keywords sin translation se apartan, no se escriben vacías", () => {
  const { entries, untranslated } = toEntries([
    { id: "1", data: { keyword: "a", translation: "A" } },
    { id: "2", data: { keyword: "b" } },
    { id: "3", data: { keyword: "c", translation: "" } },
  ]);
  assert.deepEqual(entries, [["a", "A"]]);
  assert.deepEqual(untranslated, ["b", "c"]);
});

test("se ignoran las entradas sin keyword usable", () => {
  const { entries } = toEntries([
    { id: "1", data: {} },
    { id: "2" },
    {},
    { id: "3", data: { keyword: "", translation: "x" } },
    { id: "4", data: { keyword: "ok", translation: "v" } },
  ]);
  assert.deepEqual(entries, [["ok", "v"]]);
});

test("el orden es estable alfabéticamente, para que el diff no baile", () => {
  const { entries } = toEntries([
    { id: "1", data: { keyword: "z", translation: "Z" } },
    { id: "2", data: { keyword: "a", translation: "A" } },
    { id: "3", data: { keyword: "m", translation: "M" } },
  ]);
  assert.deepEqual(entries.map(([k]) => k), ["a", "m", "z"]);
});

// ---------------------------------------------------------------------------
// Cómo viaja la credencial
// ---------------------------------------------------------------------------

test("una clave de API va en la cabecera y nunca en la URL", async () => {
  const { fetchImpl, calls, headers } = stub({ body: [] });
  await fetchKeywords({ ...CRED, token: CLAVE }, { fetchImpl });

  assert.equal(headers[0]["x-api-key"], CLAVE);
  assert.equal(new URL(calls[0]).searchParams.get("token"), null);
  // Un secreto en la query acaba en los logs del servidor y del proxy.
  assert.ok(!calls[0].includes(CLAVE), "la clave no puede aparecer en la URL");
});

test("una credencial del esquema antiguo sigue yendo por la query", async () => {
  const { fetchImpl, calls, headers } = stub({ body: [] });
  await fetchKeywords({ ...CRED, token: "uid-antiguo" }, { fetchImpl });

  assert.equal(new URL(calls[0]).searchParams.get("token"), "uid-antiguo");
  assert.equal(headers[0]["x-api-key"], undefined);
});

test("isApiKey no se deja engañar por un prefijo suelto", () => {
  assert.equal(isApiKey(CLAVE), true);
  assert.equal(isApiKey(KEY_PREFIX), false);
  assert.equal(isApiKey(KEY_PREFIX + "corto"), false);
  assert.equal(isApiKey("uid-antiguo"), false);
  assert.equal(isApiKey(undefined), false);
});

test("un 401 explica qué credencial hace falta", async () => {
  const { fetchImpl } = stub({ status: 401, body: { error: "Invalid credentials" } });
  await assert.rejects(
    () => fetchKeywords({ ...CRED, token: "uid-antiguo" }, { fetchImpl }),
    (err) => err instanceof AzboxApiError && err.status === 401 && err.message.includes(KEY_PREFIX),
  );
});

test("un 403 dice que la clave puede estar atada a otro proyecto", async () => {
  const { fetchImpl } = stub({ status: 403, body: { error: "nope" } });
  await assert.rejects(
    () => fetchKeywords({ ...CRED, token: CLAVE }, { fetchImpl }),
    (err) => err instanceof AzboxApiError && err.status === 403 && err.message.includes("p1"),
  );
});
