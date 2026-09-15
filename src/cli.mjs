#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { fetchKeywords, toEntries, AzboxApiError } from "./api.mjs";
import { serialize, FORMATS, EXTENSIONS, canNest } from "./formats.mjs";
import { loadFile, resolveConfig, outputPath, CONFIG_FILE } from "./config.mjs";

const VERSION = "0.1.1";

const USAGE = `azbox ${VERSION} — traer las traducciones de AZbox a tu proyecto

  azbox pull      descarga las traducciones y las escribe en ficheros
  azbox status    dice qué hay en cada idioma, sin escribir nada

Opciones:
  -p, --project <id>     ID del proyecto (o AZBOX_PROJECT_ID)
  -t, --token <clave>    clave de API (o AZBOX_TOKEN). No la pongas en ${CONFIG_FILE}
  -l, --language <cod>   idioma; repetible (o AZBOX_LANGUAGES=EN,ES)
  -o, --out <plantilla>  ruta de salida, admite {language} y {ext}
                         por defecto: locales/{language}.{ext}
  -f, --format <fmt>     ${FORMATS.join(" | ")}   (por defecto json)
      --flat             JSON con claves planas en vez de anidadas
      --since <fecha>    solo lo cambiado desde una fecha ISO
      --dry-run          enseña qué escribiría, sin tocar el disco
      --base-url <url>   otra URL de la API
  -h, --help             esta ayuda
  -v, --version          versión

${CONFIG_FILE} (opcional, en la raíz del proyecto):

  {
    "projectId": "…",
    "languages": ["EN", "ES"],
    "out": "locales/{language}.{ext}",
    "format": "json"
  }

Nota: la API de AZbox es de SOLO LECTURA para keywords. Se crean en el panel o
importando un fichero, así que este CLI no tiene "push" y no puede tenerlo.
`;

const OPTIONS = {
  project: { type: "string", short: "p" },
  token: { type: "string", short: "t" },
  language: { type: "string", short: "l", multiple: true },
  out: { type: "string", short: "o" },
  format: { type: "string", short: "f" },
  flat: { type: "boolean" },
  since: { type: "string" },
  "dry-run": { type: "boolean" },
  "base-url": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

export async function run(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + "\n"));
  const err = io.err ?? ((s) => process.stderr.write(s + "\n"));
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    err(e.message);
    err("Prueba con: azbox --help");
    return 2;
  }

  const { values: flags, positionals } = parsed;
  if (flags.version) return out(VERSION), 0;
  if (flags.help || positionals.length === 0) return out(USAGE), 0;

  const command = positionals[0];
  if (command === "push") {
    err(
      "azbox no tiene 'push': la API de AZbox es de solo lectura para keywords.\n" +
        "Las claves se crean en el panel o importando un fichero desde ahí.",
    );
    return 2;
  }
  if (command !== "pull" && command !== "status") {
    err(`Comando desconocido: ${command}`);
    err("Los que hay son 'pull' y 'status'. Mira azbox --help.");
    return 2;
  }

  let config;
  try {
    config = resolveConfig({ flags, env, file: loadFile(cwd) });
  } catch (e) {
    err(e.message);
    return 2;
  }

  const problemas = [];
  if (!config.token) problemas.push("Falta la clave de API. Usa --token o AZBOX_TOKEN.");
  if (!config.projectId) problemas.push("Falta el proyecto. Usa --project o AZBOX_PROJECT_ID.");
  if (config.languages.length === 0) problemas.push("Falta al menos un idioma. Usa --language ES.");
  if (!FORMATS.includes(config.format)) {
    problemas.push(`Formato "${config.format}" no soportado. Los que hay: ${FORMATS.join(", ")}.`);
  }
  if (problemas.length) {
    for (const p of problemas) err(p);
    return 2;
  }

  const since = flags.since;
  const ext = EXTENSIONS[config.format];
  let totalEscritos = 0;
  let huboError = false;

  for (const language of config.languages) {
    let keywords;
    try {
      keywords = await fetchKeywords(
        {
          token: config.token,
          projectId: config.projectId,
          language,
          afterUpdatedAt: since,
          baseUrl: config.baseUrl,
        },
        { fetchImpl },
      );
    } catch (e) {
      huboError = true;
      err(`${language}: ${e instanceof AzboxApiError ? e.message : e.message}`);
      continue;
    }

    const { entries, untranslated } = toEntries(keywords);

    if (command === "status") {
      const aviso = untranslated.length
        ? `, ${untranslated.length} sin traducir`
        : "";
      out(`${language}: ${entries.length} traducidas${aviso}`);
      if (untranslated.length && untranslated.length <= 10) {
        for (const k of untranslated) out(`    sin traducir: ${k}`);
      }
      continue;
    }

    if (entries.length === 0) {
      err(`${language}: no hay ninguna traducción, no se escribe el fichero.`);
      continue;
    }

    const destino = outputPath(config.out, { language, ext });
    const contenido = serialize(entries, {
      format: config.format,
      nested: config.nested,
      language,
    });

    if (config.format === "json" && config.nested && !canNest(entries)) {
      err(
        `${language}: hay claves que chocan al anidar (por ejemplo "a" y "a.b"), ` +
          `así que se escribe plano.`,
      );
    }

    if (flags["dry-run"]) {
      out(`${destino}: escribiría ${entries.length} claves (${contenido.length} bytes)`);
      continue;
    }

    if (existsSync(destino) && readFileSync(destino, "utf8") === contenido) {
      out(`${destino}: sin cambios`);
      continue;
    }

    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
    out(`${destino}: ${entries.length} claves`);
    totalEscritos++;
  }

  if (command === "pull" && !flags["dry-run"] && totalEscritos === 0 && !huboError) {
    out("Nada que actualizar.");
  }
  return huboError ? 1 : 0;
}

// Solo se ejecuta como binario, no al importarlo desde los tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
