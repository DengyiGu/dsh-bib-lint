# dsh-bib-lint

[中文](README.zh.md)

Read-only bibliography tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): audit BibTeX files, compare DOI metadata with Crossref, format references, and compare revisions.

## Installation

Requires Node.js 24.9 or later and DSH 0.2.2-rc.1. This release was tested with DSH 0.2.2-rc.1.

In DSH, open **Plugins → Add plugin** and paste:

```text
https://github.com/DengyiGu/dsh-bib-lint
```

Or install a tagged version from the CLI into a web profile:

```sh
dsh plugin --profile web add github:DengyiGu/dsh-bib-lint#v0.1.0
```

The repository includes executable JavaScript; installation needs no compilation or install scripts. No runtime dependencies are downloaded by this plugin; DSH supplies its two host peers. The package name alone requires a separate npm publication. A GitHub release does not automatically add a plugin to third-party marketplace search results.

## Tools

| Tool | Parameters | Result |
|---|---|---|
| `bib_audit` | `path`, `verify?`, `limit?`, `titleThreshold?` | Missing fields, duplicate keys and works, malformed values, parse errors, and optional Crossref comparisons |
| `bib_format` | `path`, `style?`, `keys?` | Reference list in `gbt7714`, `apa`, `ieee`, or `vancouver` style |
| `bib_diff` | `before`, `after` | Added and removed keys, changed entry types and fields |
| `bib_lookup` | `doi` | Crossref metadata and a BibTeX entry to copy |

Use absolute file paths. Relative paths resolve against the DSH process working directory. All tools return results to the conversation without modifying files.

Example requests after installation:

- Audit `C:/papers/references.bib` offline using `bib_audit` with `verify: "none"`.
- Format that file with `bib_format`, `style: "ieee"`.
- Compare `C:/papers/submitted.bib` and `C:/papers/revised.bib` using `bib_diff`.
- Look up DOI `10.1038/nature14539` using `bib_lookup`.

Audits check required fields by entry type, duplicate keys and works, years, DOI syntax, page ranges, empty fields, unsupported types and abbreviated author lists. Crossref comparisons check titles, years, first-author families, venues and recorded retractions. A one-year publication gap is tolerated; future-year warnings allow one year ahead.

Formatting and comparison reject parse errors and duplicate keys to avoid returning incomplete results. Formatting rejects requested keys that do not exist and reports entries skipped for missing titles.

## Configuration

Set these values in the plugin's settings or override the `bib-lint` row in your profile patch:

| Setting | Default | Meaning |
|---|---|---|
| `defaultStyle` | `apa` | Default reference style |
| `verifyLimit` | `20` | Maximum Crossref lookups per audit; `0` disables audit lookups |
| `maxIssues` | `200` | Maximum displayed audit issues; totals include omitted issues |
| `requestTimeoutMs` | `8000` | Timeout per Crossref request |
| `crossrefMailto` | empty | Optional contact email sent to Crossref |

```yaml
- id: bib-lint
  config:
    defaultStyle: gbt7714
    verifyLimit: 10
```

A profile patch replaces the entire `config` object. Restate settings you want to retain.

`bib_audit` defaults to `verify: "crossref"`. Set `verify: "none"` for an offline audit. Its `limit` argument can reduce the configured budget, and `titleThreshold` defaults to `0.9`. `bib_lookup` always contacts Crossref. Network requests send the DOI and optional contact email to `api.crossref.org`; other bibliography fields stay local. Requests run sequentially and respect cancellation. No background service or telemetry is started by the plugin.

## Limitations

- Reference styles are practical approximations, not complete style-manual implementations. Proofread output before submission.
- The parser supports nested values, quoted values, comments, `@string`, concatenation and month macros. It does not implement crossref inheritance, `@set`, or arbitrary LaTeX expansion.
- Crossref records can be missing or incomplete. An absent DOI is not evidence that a paper is fabricated. Retraction detection checks `updated-by`, `is-retracted-by`, and self-referential retraction updates; missing notices are not a clean bill of health.
- Title similarity uses character bigrams. Translations, subtitles and venue abbreviations can require manual review.
- The lookup preserves available author names, publication details and document type, but incomplete upstream records still need editing.

## Development

```sh
npm test
npm run check
npm run verify
npm pack
```

Tests use Node's built-in runner and need no network or host installation. The adapter tests substitute the two host imports. Tests and fixtures are excluded from the installable package. Real-host compatibility is tested separately; passing stub tests alone does not establish compatibility.

## License

[MIT](LICENSE). Not affiliated with DeepSeek, Crossref, or the cited style authorities.
