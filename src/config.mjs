import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Configuración, por orden de precedencia: flags > entorno > azbox.json.
 *
 * El token NUNCA se lee de azbox.json. Ese fichero se commitea, y una clave de
 * API en el repositorio es una fuga: sale del entorno o de un flag.
 */
export const CONFIG_FILE = "azbox.json";

export function loadFile(cwd = process.cwd()) {
  const path = resolve(cwd, CONFIG_FILE);
  if (!existsSync(path)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`${CONFIG_FILE} no es JSON válido: ${cause.message}`);
  }
  for (const campo of ["token", "apiKey", "api_key"]) {
    if (parsed && typeof parsed === "object" && campo in parsed) {
      throw new Error(
        `${CONFIG_FILE} contiene un "${campo}". Quítalo: ese fichero se commitea. ` +
          `Usa la variable de entorno AZBOX_TOKEN.`,
      );
    }
  }
  return parsed ?? {};
}

export function resolveConfig({ flags = {}, env = process.env, file = {} } = {}) {
  const languages =
    flags.language?.length ? flags.language
    : Array.isArray(file.languages) ? file.languages
    : env.AZBOX_LANGUAGES ? env.AZBOX_LANGUAGES.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    token: flags.token ?? env.AZBOX_TOKEN ?? env.AZBOX_API_KEY ?? null,
    projectId: flags.project ?? env.AZBOX_PROJECT_ID ?? file.projectId ?? null,
    baseUrl: flags["base-url"] ?? env.AZBOX_BASE_URL ?? file.baseUrl ?? undefined,
    languages,
    out: flags.out ?? file.out ?? "locales/{language}.{ext}",
    format: flags.format ?? file.format ?? "json",
    nested: flags.flat ? false : (file.nested ?? true),
  };
}

/** Sustituye {language} y {ext} en la plantilla de salida. */
export function outputPath(template, { language, ext }) {
  return template.replaceAll("{language}", language).replaceAll("{ext}", ext);
}
