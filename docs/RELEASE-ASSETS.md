# Artwork for official releases

Contributor checkouts display neutral symbols beside Apple Health and Garmin
Connect. The integrations and provider names work without brand image files.

The raw provider artwork is not redistributed in this source repository.
For an authorized official release, the maintainer supplies the complete,
licensed image sets in these ignored directories before generating the Xcode
project:

- `ios/TresFort/Assets.xcassets/Connections/logo_apple_health.imageset/`
- `ios/TresFort/Assets.xcassets/Connections/logo_garmin_connect.imageset/`

Each set contains its `Contents.json` and unchanged universal 1x, 2x and 3x
PNG files at 30, 60 and 90 pixels square. Obtain the files and the applicable
permissions directly from [Apple Design Resources](https://developer.apple.com/design/resources/)
and [Garmin's developer brand resources](https://developer.garmin.com/brand-guidelines/connect/).
Downloading artwork does not establish permission to redistribute it here.

`python3 scripts/check-release-assets.py` checks the local files.
`scripts/upload-testflight.sh` runs that check before changing a build number,
generating a project or archiving. The same check belongs before any alternative
official release command. Passing it verifies file presence and dimensions;
the maintainer remains responsible for the applicable license and brand rules.
Never commit the supplied image sets or include them in public CI artifacts.

Signing keys, Apple account details and provider credentials stay outside Git.
Fastlane can read the owner's Apple account from `APPLE_ID` when needed.
