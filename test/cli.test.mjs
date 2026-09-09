import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli.mjs";

function harness({ body = [], status = 200, env = {}, cwd } = {}) {
  const salida = [];
  const errores = [];
  const dir = cwd ?? mkdtempSync(join(tmpdir(), "azbox-cli-"));
  const io = {
    out: (s) => salida.push(s),
    err: (s) => errores.push(s),
    cwd: dir,
    env,
    fetchImpl: async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  };
  return { io, salida, errores, dir };
}

const KW = (keyword, translation) => ({ id: `id-${keyword}`, data: { keyword, translation } });

test("sin argumentos enseña la ayuda y sale con 0", async () => {
  const { io, salida } = harness();
  assert.equal(await run([], io), 0);
  assert.match(salida.join("\n"), /azbox pull/);
});

test("--version imprime solo la versión", async () => {
  const { io, salida } = harness();
  assert.equal(await run(["--version"], io), 0);
  assert.match(salida[0], /^\d+\.\d+\.\d+$/);
});

test("'push' explica que la API es de solo lectura y sale con 2", async () => {
  const { io, errores } = harness();
  assert.equal(await run(["push"], io), 2);
  assert.match(errores.join("\n"), /solo lectura/);
});

test("un comando desconocido no se inventa nada", async () => {
  const { io, errores } = harness();
  assert.equal(await run(["sincronizar"], io), 2);
  assert.match(errores.join("\n"), /Comando desconocido/);
});

test("faltando credenciales dice las tres cosas que faltan", async () => {
  const { io, errores } = harness();
  assert.equal(await run(["pull"], io), 2);
  const texto = errores.join("\n");
  assert.match(texto, /clave de API/);
  assert.match(texto, /proyecto/);
  assert.match(texto, /idioma/);
});

test("pull escribe el fichero con las claves de data.keyword", async () => {
  const { io, dir, salida } = harness({
    body: [KW("home.title", "Hola"), KW("home.body", "Qué tal")],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  const out = join(dir, "locales/{language}.{ext}");
  assert.equal(await run(["pull", "-l", "ES", "-o", out], io), 0);

  const escrito = JSON.parse(readFileSync(join(dir, "locales/ES.json"), "utf8"));
  assert.deepEqual(escrito, { home: { title: "Hola", body: "Qué tal" } });
  assert.match(salida.join("\n"), /2 claves/);
});

test("pull en formato arb usa la extensión y el @@locale correctos", async () => {
  const { io, dir } = harness({
    body: [KW("saludo", "Hola")],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  const out = join(dir, "l10n/app_{language}.{ext}");
  assert.equal(await run(["pull", "-l", "es", "-f", "arb", "-o", out], io), 0);
  const escrito = JSON.parse(readFileSync(join(dir, "l10n/app_es.arb"), "utf8"));
  assert.deepEqual(escrito, { "@@locale": "es", saludo: "Hola" });
});

test("--dry-run no toca el disco", async () => {
  const { io, dir, salida } = harness({
    body: [KW("a", "A")],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  const out = join(dir, "locales/{language}.{ext}");
  assert.equal(await run(["pull", "-l", "ES", "-o", out, "--dry-run"], io), 0);
  assert.equal(existsSync(join(dir, "locales/ES.json")), false);
  assert.match(salida.join("\n"), /escribiría 1 claves/);
});

test("si el contenido no cambia, lo dice y no reescribe", async () => {
  const { io, dir, salida } = harness({
    body: [KW("a", "A")],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  const out = join(dir, "locales/{language}.{ext}");
  await run(["pull", "-l", "ES", "-o", out], io);
  const antes = readFileSync(join(dir, "locales/ES.json"), "utf8");
  await run(["pull", "-l", "ES", "-o", out], io);
  assert.equal(readFileSync(join(dir, "locales/ES.json"), "utf8"), antes);
  assert.match(salida.join("\n"), /sin cambios/);
});

test("un idioma sin traducciones no crea un fichero vacío", async () => {
  const { io, dir, errores } = harness({
    body: [],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  const out = join(dir, "locales/{language}.{ext}");
  assert.equal(await run(["pull", "-l", "ES", "-o", out], io), 0);
  assert.equal(existsSync(join(dir, "locales/ES.json")), false);
  assert.match(errores.join("\n"), /no hay ninguna traducción/);
});

test("status informa y no escribe", async () => {
  const { io, dir, salida } = harness({
    body: [KW("a", "A"), { id: "2", data: { keyword: "b" } }],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  assert.equal(await run(["status", "-l", "ES"], io), 0);
  assert.match(salida.join("\n"), /ES: 1 traducidas, 1 sin traducir/);
  assert.equal(existsSync(join(dir, "locales")), false);
});

test("un error de la API devuelve 1 y nombra el idioma", async () => {
  const { io, errores } = harness({
    status: 500,
    body: { detail: "boom" },
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  assert.equal(await run(["status", "-l", "ES"], io), 1);
  assert.match(errores.join("\n"), /^ES: /m);
});

test("azbox.json aporta proyecto e idiomas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "azbox-cli-cfg-"));
  writeFileSync(
    join(dir, "azbox.json"),
    JSON.stringify({ projectId: "desde-fichero", languages: ["EN", "ES"] }),
  );
  const { io, salida } = harness({
    body: [KW("a", "A")],
    env: { AZBOX_TOKEN: "t" },
    cwd: dir,
  });
  assert.equal(await run(["pull", "-o", join(dir, "{language}.{ext}")], io), 0);
  assert.ok(existsSync(join(dir, "EN.json")));
  assert.ok(existsSync(join(dir, "ES.json")));
  assert.equal(salida.filter((l) => /claves/.test(l)).length, 2);
});

test("una credencial en azbox.json se rechaza: ese fichero se commitea", async () => {
  for (const campo of ["token", "apiKey", "api_key"]) {
    const dir = mkdtempSync(join(tmpdir(), "azbox-cli-tok-"));
    writeFileSync(join(dir, "azbox.json"), JSON.stringify({ [campo]: "secreto" }));
    const { io, errores } = harness({ cwd: dir });
    assert.equal(await run(["pull", "-l", "ES"], io), 2, campo);
    assert.match(errores.join("\n"), /Qu[íi]talo|AZBOX_TOKEN/, campo);
  }
});

test("un azbox.json corrupto no revienta con un stack", async () => {
  const dir = mkdtempSync(join(tmpdir(), "azbox-cli-bad-"));
  writeFileSync(join(dir, "azbox.json"), "{ esto no es json");
  const { io, errores } = harness({ cwd: dir });
  assert.equal(await run(["pull", "-l", "ES"], io), 2);
  assert.match(errores.join("\n"), /no es JSON válido/);
});

test("los flags mandan sobre el fichero y el entorno", async () => {
  const dir = mkdtempSync(join(tmpdir(), "azbox-cli-prec-"));
  writeFileSync(join(dir, "azbox.json"), JSON.stringify({ projectId: "fichero", format: "arb" }));
  const { io } = harness({
    body: [KW("a", "A")],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "entorno" },
    cwd: dir,
  });
  // el entorno gana al fichero para projectId, y el flag gana al fichero para format
  assert.equal(await run(["pull", "-l", "ES", "-f", "json", "-o", join(dir, "{language}.{ext}")], io), 0);
  assert.ok(existsSync(join(dir, "ES.json")));
  assert.equal(existsSync(join(dir, "ES.arb")), false);
});

test("un formato inventado se rechaza antes de pedir nada", async () => {
  const { io, errores } = harness({ env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" } });
  assert.equal(await run(["pull", "-l", "ES", "-f", "yaml"], io), 2);
  assert.match(errores.join("\n"), /no soportado/);
});

test("crea los directorios que falten", async () => {
  const { io, dir } = harness({
    body: [KW("a", "A")],
    env: { AZBOX_TOKEN: "t", AZBOX_PROJECT_ID: "p" },
  });
  const out = join(dir, "muy/dentro/de/aqui/{language}.{ext}");
  assert.equal(await run(["pull", "-l", "ES", "-o", out], io), 0);
  assert.ok(existsSync(join(dir, "muy/dentro/de/aqui/ES.json")));
});
