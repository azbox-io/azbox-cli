/**
 * Cliente HTTP de la API de AZbox.
 *
 * Un solo endpoint, verificado contra el controlador real:
 *   GET /v1/projects/{projectId}/keywords?api_key=&language=&afterUpdatedAtStr=
 *
 * La forma de la respuesta importa y no es la obvia:
 *   [{ id: "<id interno>", data: { keyword: "home.title", translation: "…" } }]
 *
 * `id` es el identificador del documento y se genera solo: no significa nada
 * para quien consume la API. La clave es `data.keyword`.
 */

export const DEFAULT_BASE_URL = "https://api.azbox.io";

/** Prefijo de las claves de API de AZbox. */
export const KEY_PREFIX = "azb_live_";

/**
 * ¿Esto es una clave nueva o una credencial del esquema antiguo?
 *
 * Las nuevas viajan en la cabecera `x-api-key`; las antiguas, en `?api_key=`,
 * porque es donde la API las espera — es el parámetro que usa la librería de
 * Flutter publicada. Un secreto en la URL termina en los logs del servidor, en
 * los del proxy y en el historial de la terminal, así que las nuevas no pasan
 * por ahí.
 */
export function isApiKey(credential) {
  return (
    typeof credential === "string" &&
    credential.startsWith(KEY_PREFIX) &&
    credential.length >= KEY_PREFIX.length + 20
  );
}

export class AzboxApiError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = "AzboxApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Keywords de un proyecto en un idioma.
 *
 * Devuelve `[]` cuando no hay ninguna. La API contesta 404 en ese caso, no un
 * array vacío, y eso es "todavía no hay nada", no un fallo: se traduce aquí
 * para que quien llame no tenga que distinguirlo.
 */
export async function fetchKeywords(
  { token, projectId, language, afterUpdatedAt, baseUrl = DEFAULT_BASE_URL },
  { fetchImpl = globalThis.fetch } = {},
) {
  if (!token) throw new AzboxApiError("Falta el token de la API.");
  if (!projectId) throw new AzboxApiError("Falta el projectId.");
  if (!language) throw new AzboxApiError("Falta el idioma.");

  const url = new URL(
    `/v1/projects/${encodeURIComponent(projectId)}/keywords`,
    baseUrl,
  );
  const headers = { accept: "application/json" };
  if (isApiKey(token)) headers["x-api-key"] = token;
  else url.searchParams.set("api_key", token);

  // Los códigos de idioma de un proyecto están en mayúsculas (EN-US, ES, PT-PT)
  // y la API los compara tal cual: con "es" devuelve todas las claves sin
  // ninguna traducción, y el CLI no escribiría nada. El plugin de Flutter ya
  // los pasa a mayúsculas; aquí igual.
  url.searchParams.set("language", String(language).toUpperCase());
  if (afterUpdatedAt) {
    url.searchParams.set(
      "afterUpdatedAtStr",
      afterUpdatedAt instanceof Date
        ? afterUpdatedAt.toISOString()
        : String(afterUpdatedAt),
    );
  }

  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (cause) {
    throw new AzboxApiError(`No se pudo conectar con ${baseUrl}: ${cause.message}`);
  }

  if (response.status === 404) {
    const detail = await readDetail(response);
    // "Language not found" sí es un error de quien llama: el idioma no se
    // envió o no existe. "No keywords found" solo significa que está vacío.
    if (/language/i.test(detail ?? "")) {
      throw new AzboxApiError(
        `El idioma "${language}" no existe en el proyecto ${projectId}.`,
        { status: 404, detail },
      );
    }
    return [];
  }

  if (response.status === 401) {
    throw new AzboxApiError(
      `La API rechazó la credencial. Usa una clave del panel de AZbox (empieza por ${KEY_PREFIX}).`,
      { status: 401, detail: await readDetail(response) },
    );
  }

  if (response.status === 403) {
    throw new AzboxApiError(
      `La clave no tiene permiso sobre el proyecto ${projectId}, o está atada a otro.`,
      { status: 403, detail: await readDetail(response) },
    );
  }

  if (!response.ok) {
    throw new AzboxApiError(
      `La API respondió ${response.status} para el idioma "${language}".`,
      { status: response.status, detail: await readDetail(response) },
    );
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new AzboxApiError("Respuesta inesperada: se esperaba un array.");
  }
  return body;
}

async function readDetail(response) {
  try {
    const body = await response.json();
    return typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return undefined;
  }
}

/**
 * Pasa la respuesta cruda a pares clave/traducción.
 *
 * Descarta las keywords sin `translation`: la API omite el campo cuando esa
 * clave todavía no tiene texto en el idioma pedido, y escribir esas entradas
 * vacías en el fichero sobrescribiría traducciones buenas con nada.
 */
export function toEntries(keywords) {
  const entries = [];
  const untranslated = [];

  for (const item of keywords) {
    const key = item?.data?.keyword;
    if (typeof key !== "string" || key === "") continue;
    const value = item?.data?.translation;
    if (typeof value === "string" && value !== "") entries.push([key, value]);
    else untranslated.push(key);
  }

  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  untranslated.sort();
  return { entries, untranslated };
}
