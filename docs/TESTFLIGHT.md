# TestFlight: external testers and feedback

How builds reach external testers and how their feedback comes back, using the
App Store Connect API from the release Mac. Uploading itself is in
[ios/fastlane/SETUP.md](../ios/fastlane/SETUP.md).

## The key

Every command here uses the existing **TresFort CI Signing** team API key
(App Manager role, key id `VP9G3R7Q85`), the same key the upload uses. On the
release Mac it lives at `~/.appstoreconnect/private_keys/AuthKey_VP9G3R7Q85.p8`,
mode `600`. App Manager is the least role that can both read TestFlight
feedback and manage external groups and beta review; Developer cannot manage
external testing. Never commit the `.p8` or paste it into chat. No new key is
needed for anything below.

The project's cloud environment holds the same key as the `ASC_KEY_ID`,
`ASC_ISSUER_ID` and `ASC_PRIVATE_KEY` environment variables, with
`api.appstoreconnect.apple.com` allowed, so cloud threads can run the
read-only commands below directly; the scripts use those variables whenever
`ASC_PRIVATE_KEY` is set. Screenshots come from
`tf-feedback.itunes.apple.com`, also allowed there; Node's `fetch` reaches it
only through the proxy, so use the `npm run` commands (they set
`NODE_USE_ENV_PROXY=1`) or set that variable when calling a script directly. Anything that
changes App Store Connect (distribution, beta review) needs the owner's
written go-ahead naming the action, wherever it runs.

## External testers get every build

`npm run ios:testflight` uploads, then runs
`scripts/testflight-distribute.mjs --build <n> --wait 45`, which:

1. waits while Apple processes the build (up to 45 minutes);
2. adds en-US **What to Test** notes if the build has none (`TESTFLIGHT_NOTES`
   sets them; otherwise a short generic note);
3. adds the build to every external group;
4. submits it to TestFlight beta review if it has never been submitted.

External testers get it once Apple approves the beta review. Every step is
idempotent, so a re-run only does what is still missing.

- `TESTFLIGHT_EXTERNAL=0 npm run ios:testflight` keeps a build internal-only,
  for example a build that shows an integration before its launch date.
- If the upload succeeds but distribution does not finish, the script exits
  `3` and prints the re-run command. Do not upload again.

By hand:

```bash
npm run testflight:external -- --list-groups              # read-only: groups and their newest build
npm run testflight:external -- --build 82 --dry-run       # read-only: show the steps
npm run testflight:external -- --build 82                 # do them
npm run testflight:external -- --build 82 --group Friends # only the named group(s)
```

## Reading feedback

```bash
npm run beta:feedback:list                          # read-only, last 14 days
npm run beta:feedback:list -- --days 3 --tester geoff
npm run beta:feedback:list -- --all --json
npm run beta:feedback:list -- --save                # also keep local copies
```

`--save` writes one folder per submission under
`~/Downloads/testflight-feedback/` (`<date>-<screenshot|crash>-<id>/`) with
`feedback.md` (comment, tester, build, device, locale, battery), the
screenshots and, for crashes, `crash.log`, plus an `index.md` of every saved
submission. Apple's screenshot links expire, so this is the durable copy.
Treat these files and the reader's terminal output as private support data:
do not commit, attach, or copy them into public issues, CI logs, or artifacts.

For a public bug report, reproduce the problem with a test account and write
fresh steps and screenshots using synthetic data. Keep the original report
in App Store Connect or private support storage. Raw TestFlight feedback is
subject to [Apple's Developer Program Agreement, section 7.4](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).
Removing an email address alone does not make a report suitable to publish.

The legacy GitHub mirror is disabled unless both the opt-in and an explicit
private destination are supplied:

```bash
FEEDBACK_FILE_ISSUES=1 REPO=owner/private-repo npm run beta:feedback -- --dry-run
FEEDBACK_FILE_ISSUES=1 REPO=owner/private-repo npm run beta:feedback
```

It refuses public, internal, redirected, or unknown destinations before
authenticating with App Store Connect or collecting feedback, including for
`--dry-run`. It rechecks visibility before writes. There is no public
repository override. Dry-run reports counts only, and the mirror does not
print raw titles, tester details, comments, or attachment links. Issues are
deduplicated by the submission id marker and identify the local copy when
one exists. Private visibility is a technical prerequisite; the operator
must also ensure the recipients and use comply with the relevant terms.

These checks do not make a visibility change atomic with a GitHub write.
Before making a repository public, stop all feedback writers, privately
preserve any originals that are still needed, and clean existing issue
bodies, titles, comments, attachments and their edit histories. Closed issues
remain visible when a repository becomes public. Existing jobs running an
older checkout must be stopped or refreshed and checked; merging this
change alone does not update every installed process.

## Hourly sync

`scripts/install-testflight-feedback-job.sh` installs a launchd job,
`app.tresfort.testflight-feedback`, on the release Mac. Every hour it moves a
dedicated detached worktree (`~/worktrees/testflight-feedback`) to
`origin/main` and runs `scripts/testflight-feedback-sync.sh`: save the last 30
days of feedback privately. GitHub mirroring is off by default. An explicitly
configured `FEEDBACK_FILE_ISSUES=1` and `REPO=owner/private-repo` opt in to the
private-only mirror above. Raw reader output is suppressed in the scheduled
log; saved reports remain in the private folder. It never touches other
checkouts.

```bash
scripts/install-testflight-feedback-job.sh --print      # show the job, change nothing
scripts/install-testflight-feedback-job.sh              # install and run once now
scripts/install-testflight-feedback-job.sh --uninstall  # stop and remove it
tail -f ~/Library/Logs/tres-fort-testflight-feedback.log
```

The job needs the key above and a signed-in `gh`. It runs only while the
release Mac is awake and its user is logged in.
