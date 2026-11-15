# Shared plan compiler

`plan-graph.mjs` is an unmodified copy of the dependency-free bundled runtime
from `namarks/dotfiles`, `agents/skills/planning-conventions/scripts/plan-graph.mjs`,
at commit `32de648e6241ddc15b8d101d17fc916a88b2b9a1`.

SHA-256: `94caffd837cedeeed7ca4010b3cc11afdd753b47681e598e8dd64f284838e008`.

Vendoring keeps `npm run plans:check` identical locally and in CI without an
installed agent skill or a network fetch. Update by copying the upstream bundle,
recording its revision/hash here, and comparing its output with the installed
shared skill against this repository. Do not edit the generated bundle here.

## Bundled dependency notices

The TypeScript source at the pinned upstream commit directly imports `marked`
and `yaml`; their implementations are embedded in this runtime. Their separate
licenses apply to that embedded code, regardless of the project's source
license:

- `marked`: [MIT license and retained Markdown notice](LICENSE-marked.txt),
  including copyright credits for MarkedJS, Christopher Jeffrey and John Gruber.
  [Upstream license source](https://github.com/markedjs/marked/blob/master/LICENSE).
- `yaml`: [ISC license](LICENSE-yaml.txt), copyright Eemeli Aro.
  [Upstream license source](https://github.com/eemeli/yaml/blob/main/LICENSE).

These complete notices were verified against the upstream license files on
2026-11-15. The pinned compiler source does not track a dependency manifest or
lockfile, so the embedded dependency versions are not claimed here. A future
bundle update must preserve its dependency notices and record resolved versions
along with the source revision and bundle hash. The generated bundle has not
been modified to add these adjacent notices.
