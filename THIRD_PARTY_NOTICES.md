# Third-party notices

The materials identified below are separately licensed. The restricted
[project source license](LICENSE) does not replace their licenses or limit
rights granted by their owners. Preserve these notices when copying the
corresponding material. Names and credits do not imply endorsement.

## Exercise drawings — CC BY-SA 4.0

The PNG artwork under `ios/TresFort/Assets.xcassets/Drawings/` is adapted from
**Workout Guide by Bryl Lim**, based on **Everkinetic** pose artwork. Everkinetic
was created by Greg Priday. Workout Guide expanded the source with additional
exercises and frames, and normalized the assets; its upstream attribution
also records vector tracing of some Everkinetic poses.

- Source: [Workout Guide at commit `aac599224bb9780305239607ef98540b7e0ce389`](https://github.com/bryllim/workout-guide/tree/aac599224bb9780305239607ef98540b7e0ce389),
  directory `packages/workout-guide/assets`.
- Copyright notice: Copyright (c) 2026 Bryl Lim, except for the upstream
  sources identified in [Workout Guide's attribution](https://github.com/bryllim/workout-guide/blob/aac599224bb9780305239607ef98540b7e0ce389/ATTRIBUTION.md).
- Original upstream: [Everkinetic](https://github.com/everkinetic/data).
- Upstream asset license: [Workout Guide LICENSE-ASSETS](https://github.com/bryllim/workout-guide/blob/aac599224bb9780305239607ef98540b7e0ce389/LICENSE-ASSETS).
- License: [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/),
  including its [legal code and warranty disclaimer](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en).
- Changes for Très Fort: selected frames, cropped to the figure, and
  re-encoded as grayscale PNG. The exact exercise/frame selection and source
  revision are in [scripts/exercise_drawings.json](scripts/exercise_drawings.json);
  [scripts/bundle_exercise_drawings.py](scripts/bundle_exercise_drawings.py)
  performs the conversion. Workout Guide's pinned
  [manifest](https://github.com/bryllim/workout-guide/blob/aac599224bb9780305239607ef98540b7e0ce389/packages/workout-guide/manifest.json)
  retains its original-source attribution and prior changes.

Très Fort's contributions to these adapted drawing PNGs are also licensed
under **CC BY-SA 4.0**. These drawings may be reused under that license,
including its attribution and ShareAlike conditions. The project source
license's evaluation-only and permission-required restrictions do **not**
apply to these separately licensed drawings.

## Exercise photographs and source data — Unlicense

The photograph frames under `ios/TresFort/Assets.xcassets/Demos/` come from
[yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db), whose
upstream project publishes its data and imagery under the
[Unlicense](https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE.md).
The upstream project credits Ollie Jennings for the original exercise dataset.

[scripts/bundle_foundational_demos.py](scripts/bundle_foundational_demos.py)
records the exercise-to-source mappings. It scales the selected JPEG images
to a maximum 256-pixel edge and re-encodes them as PNG; exercises with a bundled
drawing are skipped. The import script does not record a pinned upstream
revision. The exercise seed/import scripts also identify free-exercise-db as
a source of catalog data. Its separately licensed material remains outside
the restricted project source license. The upstream Unlicense includes its
own warranty and liability disclaimer.

## Fonts — SIL Open Font License 1.1

**Bebas Neue** is by the Bebas Neue Project Authors / Dharma Type. The bundled
font includes its 2019 copyright notice; the upstream license also retains
the 2010 Dharma Type notice. **JetBrains Mono** is by the JetBrains Mono
Project Authors, copyright 2020.

The fonts retain the **SIL Open Font License, version 1.1**. Complete notices
and license text accompany their copies:

| Copy | Bebas Neue | JetBrains Mono |
| --- | --- | --- |
| iOS | [OFL-BebasNeue.txt](ios/TresFort/Fonts/OFL-BebasNeue.txt) | [OFL-JetBrainsMono.txt](ios/TresFort/Fonts/OFL-JetBrainsMono.txt) |
| Web app | [OFL-BebasNeue.txt](web/public/assets/OFL-BebasNeue.txt) | [OFL-JetBrainsMono.txt](web/public/assets/OFL-JetBrainsMono.txt) |
| Website | [OFL-BebasNeue.txt](website/public/assets/OFL-BebasNeue.txt) | [OFL-JetBrainsMono.txt](website/public/assets/OFL-JetBrainsMono.txt) |

## Package dependencies and provider names

The vendored planning compiler embeds `marked` and `yaml`. Their copyright
and license notices are included beside it: [Marked's MIT and Markdown
notices](scripts/vendor/planning/LICENSE-marked.txt) and
[yaml's ISC license](scripts/vendor/planning/LICENSE-yaml.txt). See the
[compiler provenance](scripts/vendor/planning/README.md) for the exact source
revision and bundle hash. These embedded dependencies retain their licenses
and are outside the restricted project source license.

Dependencies installed through the package managers retain their upstream
licenses. The repository lockfiles identify the selected versions. Preserve
their applicable notices when distributing builds that include them; this
document does not relicense dependency code.

Provider names and marks identify their respective services and owners.
Neither the project license nor this notice grants trademark rights in
third-party brands or access to their APIs and services.
