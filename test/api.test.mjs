import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchKeywords, toEntries, AzboxApiError } from "../src/api.mjs";

/** fetch de mentira que devuelve lo que se le diga y guarda la URL pedida. */
function stub({ status = 200, body = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return { fetchImpl, calls };
}

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
