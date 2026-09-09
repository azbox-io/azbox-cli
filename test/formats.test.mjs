import { test } from "node:test";
import assert from "node:assert/strict";

import { serialize, canNest } from "../src/formats.mjs";

test("json anida las claves con puntos, que es lo que espera i18next", () => {
  const out = JSON.parse(
    serialize([["home.title", "Hola"], ["home.body", "Qué tal"]], { format: "json" }),
  );
  assert.deepEqual(out, { home: { title: "Hola", body: "Qué tal" } });
});

test("json --flat conserva los puntos en el nombre", () => {
  const out = JSON.parse(
    serialize([["home.title", "Hola"]], { format: "json", nested: false }),
  );
  assert.deepEqual(out, { "home.title": "Hola" });
});

test("si las claves chocan al anidar, cae a plano en vez de perder datos", () => {
  // "home" es una cadena y "home.title" pediría que "home" fuese un objeto.
  const entradas = [["home", "Inicio"], ["home.title", "Hola"]];
  assert.equal(canNest(entradas), false);
  const out = JSON.parse(serialize(entradas, { format: "json" }));
  assert.deepEqual(out, { home: "Inicio", "home.title": "Hola" });
});

test("el choque al revés también cae a plano", () => {
  const entradas = [["a.b", "AB"], ["a", "A"]];
  assert.equal(canNest(entradas), false);
  const out = JSON.parse(serialize(entradas, { format: "json" }));
  assert.deepEqual(out, { "a.b": "AB", a: "A" });
});

test("arb es plano y lleva @@locale", () => {
  const out = JSON.parse(
    serialize([["home.title", "Hola"]], { format: "arb", language: "es" }),
  );
  assert.deepEqual(out, { "@@locale": "es", "home.title": "Hola" });
});

test("arb ignora nested: el generador de Flutter quiere las claves al raso", () => {
  const out = JSON.parse(
    serialize([["a.b", "AB"]], { format: "arb", nested: true, language: "en" }),
  );
  assert.deepEqual(out, { "@@locale": "en", "a.b": "AB" });
});

test("la salida acaba en salto de línea", () => {
  assert.ok(serialize([["a", "A"]], { format: "json" }).endsWith("\n"));
  assert.ok(serialize([["a", "A"]], { format: "arb" }).endsWith("\n"));
});

test("un formato desconocido falla claro", () => {
  assert.throws(() => serialize([], { format: "yaml" }), /no soportado/);
});
