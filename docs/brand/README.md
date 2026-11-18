# Brand

`app-icon.svg` is the source of the app icon: an orange fort on dark navy.
The fort is the "Fort" in Très Fort and belongs to no single sport.

| Color | Hex | Use |
|---|---|---|
| Navy | `#15273e` | Icon background and gate |
| Vermilion | `#ed4929` | Fort |

The PNG copies are 1024 × 1024, RGB with no alpha channel (App Store Connect
rejects an app icon with transparency). Re-export all four together after
changing the SVG:

- `ios/TresFort/Assets.xcassets/AppIcon.appiconset/icon-1024.png`
- `website/public/assets/app-icon.png`
- `web/public/assets/app-icon.png`
- `plugins/tres-fort/assets/icon.png`

## In the app

The app and the web app use the icon's two colors throughout
(`ios/Shared/BrandPalette.swift`, `web/src/styles.css`). Light mode is a
cool paper white with navy text; dark mode is navy, not black. Navy is the
accent, for links, tints and selection. Orange is the one signal color:

- `signalFill` (`#ee694f` under navy `#091628` labels, 5.8:1, the same in
  both modes) fills primary actions: `WorkoutPrimaryButtonStyle`, Join, the
  Group add button, and the web app's primary buttons.
- `signal` (`#c22d0c` in light mode, `#ec7859` in dark, 4.5:1 or better on
  every surface) colors the selected tab, set progress, the rest timer bar
  and route lines.
- `heroCard()` makes a screen's key card solid navy, the icon in miniature,
  with its content in the dark-mode colors. Today's card keeps that navy
  for what to do now and its one orange action (`todayActionBand()`); the
  rest of the card is plain.
- Today's week chart (`WeekFortView`) is the icon's fort on the page:
  every day you trained raises an orange tower, planned days stand as
  quiet blue towers (`weekPlanned`) and rest days stay low. Activity's
  week card keeps the navy fort.

The website keeps the earlier Ink palette until it is redesigned. How to use
the colors, type and components is in `docs/DESIGN-SYSTEM.md`.
