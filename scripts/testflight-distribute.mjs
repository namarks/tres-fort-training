#!/usr/bin/env node
// Give a TestFlight build to the external test groups.
//
// Adds tester-facing "What to Test" notes if the build has none, adds the
// build to each external group, and submits it to beta review when it has
// never been submitted. Idempotent: a re-run only does what is still missing.
// upload-testflight.sh runs this after every upload unless
// TESTFLIGHT_EXTERNAL=0. Needs the ASC API key on the release Mac; see
// docs/TESTFLIGHT.md.
//
// Usage:
//   node scripts/testflight-distribute.mjs --list-groups        # read-only
//   node scripts/testflight-distribute.mjs --build 82 --dry-run # show the steps
//   node scripts/testflight-distribute.mjs --build 82           # do them
//   node scripts/testflight-distribute.mjs                      # newest build
//   options: --group NAME (repeatable; default every external group)
//            --notes TEXT (What to Test; default a short generic note)
//            --wait MINUTES (poll while Apple processes; default 0)

import { asc, ascSend, ascToken, fail, findApp } from "./asc-api.mjs";
import { defaultWhatToTest, distributionSteps, pickExternalGroups } from "./testflight-distribution.mjs";

function parseArgs(argv) {
  const opts = { listGroups: false, build: null, groups: [], notes: null, wait: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v == null || v.startsWith("--")) fail(`${arg} needs a value`);
      i++;
      return v;
    };
    if (arg === "--list-groups") opts.listGroups = true;
    else if (arg === "--build") opts.build = value();
    else if (arg === "--group") opts.groups.push(value());
    else if (arg === "--notes") opts.notes = value();
    else if (arg === "--wait") {
      opts.wait = Number(value());
      if (!Number.isFinite(opts.wait) || opts.wait < 0) fail("--wait must be minutes >= 0");
    } else if (arg === "--dry-run") opts.dryRun = true;
    else fail(`unknown option ${arg}`);
  }
  return opts;
}

const BUILD_INCLUDE = "include=buildBetaDetail,betaGroups,betaBuildLocalizations";

async function readBuild(token, appId, version) {
  const filter = version ? `&filter[version]=${encodeURIComponent(version)}` : "";
  const res = await asc(token, `/v1/builds?filter[app]=${appId}${filter}&sort=-uploadedDate&limit=1&${BUILD_INCLUDE}`);
  const build = res.data?.[0];
  if (!build) return null;
  const included = res.included || [];
  const detail = included.find((x) => x.type === "buildBetaDetails");
  const localizations = included.filter((x) => x.type === "betaBuildLocalizations");
  return {
    id: build.id,
    version: build.attributes?.version,
    processingState: build.attributes?.processingState,
    externalBuildState: detail?.attributes?.externalBuildState,
    autoNotifyEnabled: detail?.attributes?.autoNotifyEnabled,
    betaDetailId: detail?.id || null,
    hasWhatToTest: localizations.some((l) => (l.attributes?.whatsNew || "").trim()),
    // Apple often creates an empty en-US localization with the build; fill
    // that one in, since a second en-US POST is refused with 409.
    emptyLocalizationId: localizations.find((l) => l.attributes?.locale === "en-US")?.id || null,
    groupIdsWithBuild: (build.relationships?.betaGroups?.data || []).map((g) => g.id),
  };
}

async function listGroups(token, appId) {
  const res = await asc(token, `/v1/apps/${appId}/betaGroups?limit=200`);
  return res.data || [];
}

async function printGroups(token, appId, groups) {
  for (const g of groups) {
    const latest = await asc(token, `/v1/builds?filter[betaGroups]=${g.id}&sort=-uploadedDate&limit=1`);
    const b = latest.data?.[0]?.attributes;
    const a = g.attributes || {};
    const kind = a.isInternalGroup ? "internal" : "external";
    const link = a.publicLinkEnabled ? " · public link on" : "";
    console.log(`${a.name} (${kind}${link}) — newest build ${b?.version || "none"}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token0 = ascToken();
  const app = await findApp(token0);
  const groups = await listGroups(token0, app.id);
  if (opts.listGroups) {
    await printGroups(token0, app.id, groups);
    return;
  }
  let targets;
  try {
    targets = pickExternalGroups(groups, opts.groups);
  } catch (e) {
    fail(e.message);
  }
  if (!targets.length) fail("This app has no external TestFlight groups.");
  const groupIds = targets.map((g) => g.id);
  const groupName = (id) => targets.find((g) => g.id === id)?.attributes?.name || id;

  // Poll while Apple processes. Tokens last 10 minutes, so mint one per read.
  const deadline = Date.now() + opts.wait * 60_000;
  let build;
  let plan;
  for (;;) {
    const token = ascToken();
    build = await readBuild(token, app.id, opts.build);
    plan = build
      ? distributionSteps({ ...build, groupIds })
      : { wait: `build ${opts.build || "(newest)"} is not in App Store Connect yet` };
    if (!plan.wait || Date.now() >= deadline) break;
    console.log(`Waiting: ${plan.wait}…`);
    await sleep(60_000);
  }
  if (plan.wait) fail(`${plan.wait}. Re-run later: node scripts/testflight-distribute.mjs --build ${opts.build || build?.version || "<n>"}`);
  if (plan.blocked) fail(`Build ${build.version} cannot go to external testers: ${plan.blocked}.`);

  const label = `Build ${build.version} (external state ${build.externalBuildState || "unknown"})`;
  if (!plan.steps.length) {
    console.log(`${label}: already in ${targets.map((g) => g.attributes?.name).join(", ")} and submitted. Nothing to do.`);
    return;
  }
  const notes = opts.notes || defaultWhatToTest(build.version);
  for (const s of plan.steps) {
    const token = ascToken();
    if (s.step === "enableAutoNotify") {
      console.log(`${opts.dryRun ? "WOULD TURN ON" : "Turning on"} "Automatically notify testers" for build ${build.version}`);
      if (!opts.dryRun) {
        await ascSend(token, "PATCH", `/v1/buildBetaDetails/${build.betaDetailId}`, {
          data: { type: "buildBetaDetails", id: build.betaDetailId, attributes: { autoNotifyEnabled: true } },
        });
      }
    } else if (s.step === "notifyTesters") {
      console.log(`${opts.dryRun ? "WOULD NOTIFY" : "Notifying"} testers that build ${build.version} is available`);
      if (!opts.dryRun) {
        await ascSend(token, "POST", "/v1/buildBetaNotifications", {
          data: {
            type: "buildBetaNotifications",
            relationships: { build: { data: { type: "builds", id: build.id } } },
          },
        });
      }
    } else if (s.step === "whatToTest") {
      console.log(`${opts.dryRun ? "WOULD ADD" : "Adding"} What to Test (en-US): ${notes}`);
      if (!opts.dryRun && build.emptyLocalizationId) {
        await ascSend(token, "PATCH", `/v1/betaBuildLocalizations/${build.emptyLocalizationId}`, {
          data: { type: "betaBuildLocalizations", id: build.emptyLocalizationId, attributes: { whatsNew: notes } },
        });
      } else if (!opts.dryRun) {
        await ascSend(token, "POST", "/v1/betaBuildLocalizations", {
          data: {
            type: "betaBuildLocalizations",
            attributes: { locale: "en-US", whatsNew: notes },
            relationships: { build: { data: { type: "builds", id: build.id } } },
          },
        });
      }
    } else if (s.step === "addToGroup") {
      console.log(`${opts.dryRun ? "WOULD ADD" : "Adding"} build ${build.version} to group "${groupName(s.groupId)}"`);
      if (!opts.dryRun) {
        await ascSend(token, "POST", `/v1/betaGroups/${s.groupId}/relationships/builds`, {
          data: [{ type: "builds", id: build.id }],
        });
      }
    } else if (s.step === "submitForReview") {
      console.log(`${opts.dryRun ? "WOULD SUBMIT" : "Submitting"} build ${build.version} to TestFlight beta review`);
      if (!opts.dryRun) {
        await ascSend(token, "POST", "/v1/betaAppReviewSubmissions", {
          data: {
            type: "betaAppReviewSubmissions",
            relationships: { build: { data: { type: "builds", id: build.id } } },
          },
        });
      }
    }
  }
  console.log(`${opts.dryRun ? "[dry-run] " : ""}${label}: done. External testers get it once beta review approves.`);
}

main().catch((e) => fail(e?.message || String(e)));
