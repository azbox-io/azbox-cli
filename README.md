# azbox-cli

Pull your [AZbox](https://azbox.io) translations into your project from the
command line, so a build step can do it instead of a person.

```bash
npx azbox-cli status -l ES
npx azbox-cli pull -l EN -l ES
```

## What it does, and what it can't

`azbox-cli` reads. There is **no `push`**, and there cannot be one: the AZbox
API is read-only for keywords. Keys are created in the dashboard or by
importing a file from it. If you type `azbox push` the CLI tells you that
instead of pretending.

That still covers the case that matters in CI: fetch the current translations,
write them to files, commit or bundle them.

## Install

```bash
npm install --save-dev azbox-cli
```

Node 18 or newer. No dependencies.

## Credentials

Two things are needed: the project ID and an API key, both from the dashboard.

```bash
export AZBOX_PROJECT_ID=your-project-id
export AZBOX_TOKEN=your-api-key
```

The token is **never** read from `azbox.json`. That file gets committed, and an
API key in a repository is a leak; the CLI refuses to start if it finds one
there.

## Configuration

Everything can go on the command line, but a project usually wants a file.
`azbox.json`, in the root:

```json
{
  "projectId": "your-project-id",
  "languages": ["EN", "ES"],
  "out": "locales/{language}.{ext}",
  "format": "json"
}
```

Precedence is flags, then environment, then file.

## Commands

### `azbox pull`

Downloads and writes one file per language. Creates directories as needed, and
says `sin cambios` instead of rewriting a file whose content is identical, so
it is safe to run on every build.

```bash
azbox pull -l ES                          # locales/ES.json
azbox pull -l es -f arb -o "l10n/app_{language}.{ext}"
azbox pull -l ES --since 2026-09-01       # only what changed since then
azbox pull -l ES --dry-run                # say what it would write
```

### `azbox status`

Same request, writes nothing. Reports how many keys are translated per language
and how many are still missing text.

```
ES: 412 traducidas, 7 sin traducir
FR: 0 traducidas
```

## Options

| Option | Meaning |
|---|---|
| `-p, --project <id>` | project ID, or `AZBOX_PROJECT_ID` |
| `-t, --token <key>` | API key, or `AZBOX_TOKEN` |
| `-l, --language <code>` | language; repeat for several, or `AZBOX_LANGUAGES=EN,ES` |
| `-o, --out <template>` | output path; `{language}` and `{ext}` are substituted |
| `-f, --format <fmt>` | `json` or `arb` |
| `--flat` | JSON with dotted keys instead of nested objects |
| `--since <iso date>` | only keywords updated after that date |
| `--dry-run` | report, don't write |
| `--base-url <url>` | point at a different API host |

## Formats

**`json`** nests dotted keys, which is what i18next expects by default:
`home.title` becomes `{ "home": { "title": … } }`. Use `--flat` to keep the
dots. If the keys collide — a project with both `home` and `home.title` —
nesting would destroy one of them, so the CLI writes flat and says so.

**`arb`** is always flat, with `@@locale` set from the language you asked for,
because Flutter's generator expects the keys at the top level.

## Notes worth knowing

- **A key with no translation is skipped.** The API omits `translation`
  entirely when a key has no text yet in that language. Writing those as empty
  strings would overwrite good translations with nothing.
- **Keys are sorted alphabetically**, so the diff only shows what actually
  changed.
- **An empty language is not an error.** The API answers `404` when a project
  has no keywords in a language; the CLI treats that as "nothing yet" and skips
  the file rather than writing an empty one.
- **Interpolation is yours.** Strings come back exactly as stored, placeholders
  included.

## Using it in CI

```yaml
- run: npx azbox-cli pull -l EN -l ES
  env:
    AZBOX_PROJECT_ID: ${{ vars.AZBOX_PROJECT_ID }}
    AZBOX_TOKEN: ${{ secrets.AZBOX_TOKEN }}
```

Exit codes: `0` fine, `1` the API failed for at least one language, `2` you
called it wrong.

## The API underneath

One endpoint:

```
GET https://api.azbox.io/v1/projects/{projectId}/keywords?token=&language=&afterUpdatedAtStr=
```

Documented at [azbox.io/docs/api/rest/](https://azbox.io/docs/api/rest/). The
key you index by is `data.keyword`; `id` is an internal document identifier and
means nothing to your application.

## Licence

MIT
