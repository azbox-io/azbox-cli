/**
 * Cliente HTTP de la API de AZbox.
 *
 * Un solo endpoint, verificado contra el controlador real:
 *   GET /v1/projects/{projectId}/keywords?token=&language=&afterUpdatedAtStr=
 *
 * La forma de la respuesta importa y no es la obvia:
 *   [{ id: "<id interno>", data: { keyword: "home.title", translation: "…" } }]
 *
 * `id` es el identificador del documento y se genera solo: no significa nada
 * para quien consume la API. La clave es `data.keyword`.
 */

export const DEFAULT_BASE_URL = "https://api.azbox.io";

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
  url.searchParams.set("token", token);
  url.searchParams.set("language", language);
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
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
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
