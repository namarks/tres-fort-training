import XCTest
@testable import TresFort

/// A block's own workouts on the phone (docs/plans/progressive-plans P7).
/// `Fixtures/BlockLayers.json` is the contract with the server's
/// `layerProgram` and the web's own form (web/test/blockLayersFixture.test.ts).
final class BlockLayersTests: XCTestCase {
    private func slot(_ id: String) -> TemplateExercise {
        TemplateExercise(id: id, exercise_id: "ex_squat", exercise_name: "Squat",
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 90,
            target_weight: nil, cues: nil, exercise_modality: "barbell",
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: nil, is_warmup: 0)
    }

    private func workout(_ id: String, slots: [String] = []) -> Workout {
        Workout(id: id, name: id.capitalized, day_label: nil, order_index: 0, exercises: slots.map(slot))
    }

    /// Your week: KB A Monday (with core beside it), intervals Tuesday,
    /// soccer Wednesday, tempo Saturday, easy run Sunday.
    private func plan(program: [String: Any]? = nil) -> PlanTree {
        var meta: [String: Any] = ["schedule": [
            "version": 1,
            "week": ["mon": "kb_a", "tue": "intervals", "wed": "soccer", "thu": NSNull(), "fri": NSNull(),
                     "sat": "tempo", "sun": "easy_run"],
            "extras": ["mon": ["core"]],
        ] as [String: Any]]
        if let program { meta["program"] = program }
        let data = try! JSONSerialization.data(withJSONObject: meta)
        return PlanTree(id: "p", name: "Plan", version: 4, workouts: [
            workout("kb_a", slots: ["s_kb"]), workout("intervals", slots: ["s_int"]), workout("soccer"),
            workout("tempo", slots: ["s_tempo"]), workout("easy_run", slots: ["s_easy"]), workout("core", slots: ["s_core"]),
            workout("long_run", slots: ["s_long"]),
        ], meta: String(data: data, encoding: .utf8))
    }

    private func week(_ days: [String: String], extras: [String: [String]]? = nil) -> PlanProgram.Week {
        var map: [String: String?] = [:]
        for key in PlanSchedule.weekdayKeys { map[key] = .some(days[key]) }
        return PlanProgram.Week(label: nil, week: map, extras: extras)
    }

    // MARK: shared fixture

    private func pattern(_ json: Any?) -> PlanProgram.Week {
        let raw = json as? [String: Any] ?? [:]
        let days = (raw["week"] as? [String: Any] ?? [:]).compactMapValues { $0 as? String }
        return week(days, extras: raw["extras"] as? [String: [String]])
    }

    private func program(_ json: Any?) throws -> PlanProgram {
        var raw = try XCTUnwrap(json as? [String: Any])
        raw["id"] = "p"
        raw["start"] = "2030-01-07"
        return try XCTUnwrap(PlanProgram(json: raw))
    }

    private func assertWeeks(_ actual: [PlanProgram.Week], _ expected: Any?, _ name: String,
                             file: StaticString = #filePath, line: UInt = #line) throws {
        let weeks = try XCTUnwrap(expected as? [[String: Any]], name)
        XCTAssertEqual(actual.count, weeks.count, name, file: file, line: line)
        for (index, (got, want)) in zip(actual, weeks).enumerated() {
            let expect = pattern(want)
            for day in PlanSchedule.weekdayKeys {
                XCTAssertEqual(got.week[day] ?? nil, expect.week[day] ?? nil, "\(name) week \(index) \(day)",
                               file: file, line: line)
                XCTAssertEqual(got.extras?[day] ?? [], expect.extras?[day] ?? [], "\(name) week \(index) \(day) extras",
                               file: file, line: line)
            }
            XCTAssertEqual(got.label, want["label"] as? String, name, file: file, line: line)
            XCTAssertEqual(Set((got.targets ?? [:]).keys), Set((want["targets"] as? [String: Any] ?? [:]).keys), name,
                           file: file, line: line)
        }
    }

    func testSharedTypeScriptSwiftFixtures() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "BlockLayers", withExtension: "json"))
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let layer = try XCTUnwrap(raw["layer"] as? [[String: Any]])
        let ownForm = try XCTUnwrap(raw["own_form"] as? [[String: Any]])
        let trimmed = try XCTUnwrap(raw["trimmed"] as? [[String: Any]])
        XCTAssertFalse(layer.isEmpty || ownForm.isEmpty || trimmed.isEmpty)

        for item in layer {
            let name = item["name"] as? String ?? "layer"
            let laid = BlockLayers.layer(try program(item["program"]), before: pattern(item["before"]),
                                         after: pattern(item["after"]))
            try assertWeeks(laid.weeks, item["expected_weeks"], name)
        }
        for item in ownForm {
            let name = item["name"] as? String ?? "own form"
            let own = BlockLayers.ownForm(try program(item["program"]), schedule: pattern(item["schedule"]))
            try assertWeeks(own.weeks, item["expected_weeks"], name)
        }
        for item in trimmed {
            let name = item["name"] as? String ?? "trimmed"
            let got = BlockLayers.trimmedSchedule(pattern(item["schedule"]), workoutIDs: item["workout_ids"] as? [String])
            guard let want = item["expected"] as? [String: Any] else {
                XCTAssertNil(got, name)
                continue
            }
            let expect = pattern(want)
            let result = try XCTUnwrap(got, name)
            for day in PlanSchedule.weekdayKeys {
                XCTAssertEqual(result.week[day] ?? nil, expect.week[day] ?? nil, "\(name) \(day)")
                XCTAssertEqual(result.extras[day] ?? [], expect.extras?[day] ?? [], "\(name) \(day) extras")
            }
        }
    }

    // MARK: model and wire

    func testTheBlockListIsReadAndSentBack() throws {
        let tree = plan(program: ["id": "b1", "start": "2026-11-16", "repeat": false,
                                  "workout_ids": ["intervals", "", "intervals", 3, "tempo"],
                                  "weeks": [["week": ["tue": "intervals", "sat": "tempo"]]]])
        let block = try XCTUnwrap(tree.program)
        XCTAssertEqual(block.workoutIDs, ["intervals", "tempo"])
        XCTAssertTrue(BlockLayers.isLayered(block))
        let body = ProgramEditing.wire(block, activities: ProgramEditing.liveWorkouts(tree))
        XCTAssertEqual(body["workout_ids"] as? [String], ["intervals", "tempo"])

        // A block that never listed its workouts leaves the list out, so the
        // server keeps whatever the saved block has.
        let plain = PlanProgram(id: "b", name: nil, start: "2026-11-16", repeats: false, weeks: [week([:])])
        XCTAssertNil(ProgramEditing.wire(plain)["workout_ids"])
        XCTAssertNil(PlanProgram(json: ["id": "b", "start": "2026-11-16", "weeks": [["week": [:]]]])?.workoutIDs)
    }

    func testWholeBlockEditsKeepTheList() throws {
        let tree = plan(program: ["id": "b1", "start": "2026-11-16", "repeat": false, "workout_ids": ["tempo"],
                                  "weeks": [["week": ["sat": "tempo"]], ["week": ["sat": "tempo"]]]])
        let block = try XCTUnwrap(tree.program)
        XCTAssertEqual(ProgramEditing.relabeling(week: 0, to: "Base", in: block).workoutIDs, ["tempo"])
        XCTAssertEqual(ProgramEditing.addingWeek(to: block)?.workoutIDs, ["tempo"])
        XCTAssertEqual(ProgramEditing.copyingToNext(week: 0, in: block)?.workoutIDs, ["tempo"])
    }

    func testTheRepeatingWeekLeavesWithTheBlocksOwnWorkouts() throws {
        let tree = plan()
        let block = BlockLayers.newBlock(from: tree, start: "2026-11-23", weeks: 2, repeats: false,
                                         picked: ["intervals", "tempo"])
        let schedule = try XCTUnwrap(ProgramEditing.wireSchedule(beside: block, plan: tree))
        let week = try XCTUnwrap(schedule["week"] as? [String: Any])
        XCTAssertEqual(week["mon"] as? String, "kb_a")
        XCTAssertTrue(week["tue"] is NSNull)
        XCTAssertTrue(week["sat"] is NSNull)
        XCTAssertEqual(week["sun"] as? String, "easy_run")
        XCTAssertEqual((schedule["extras"] as? [String: [String]])?["mon"], ["core"])
        // A block without a list, or one Your week shares nothing with, sends none.
        XCTAssertNil(ProgramEditing.wireSchedule(beside: ProgramEditing.newProgram(
            from: tree, start: "2026-11-23", weeks: 1, repeats: false), plan: tree))
        XCTAssertNil(ProgramEditing.wireSchedule(beside: BlockLayers.newBlock(
            from: tree, start: "2026-11-23", weeks: 1, repeats: false, picked: ["long_run"]), plan: tree))
    }

    // MARK: starting

    func testANewBlockHoldsOnlyThePickedWorkouts() {
        let tree = plan()
        XCTAssertEqual(BlockLayers.suggested(tree), ["kb_a", "intervals", "tempo", "easy_run"],
                       "Activities (soccer) and workouts beside another (core) stay every week.")
        XCTAssertEqual(BlockLayers.repeatingWorkouts(tree).map(\.id),
                       ["kb_a", "core", "intervals", "soccer", "tempo", "easy_run"])
        let block = BlockLayers.newBlock(from: tree, start: "2026-11-23", weeks: 3, repeats: true,
                                         name: "  10K build ", picked: ["tempo", "intervals", "archived"])
        XCTAssertEqual(block.name, "10K build")
        XCTAssertEqual(block.weeks.count, 3)
        XCTAssertEqual(block.workoutIDs, ["tempo", "intervals"])
        let first = block.weeks[0]
        XCTAssertEqual(first.week["tue"] ?? nil, "intervals")
        XCTAssertEqual(first.week["sat"] ?? nil, "tempo")
        XCTAssertNil(first.week["mon"] ?? nil)
        XCTAssertNil(first.extras)
        XCTAssertEqual(BlockLayers.newBlock(from: tree, start: "2026-11-23", weeks: 99, repeats: false,
                                            picked: []).weeks.count, PlanProgram.maxWeeks)
    }

    // MARK: the block's own workouts

    private func layeredBlock() -> (PlanTree, PlanProgram) {
        // Stored as the server lays it: the block's own first, Your week beside.
        let tree = plan(program: ["id": "b1", "start": "2026-11-16", "repeat": false,
                                  "workout_ids": ["intervals", "long_run"],
                                  "weeks": [
                                    ["week": ["mon": "kb_a", "tue": "intervals", "wed": "soccer", "sun": "long_run"],
                                     "extras": ["mon": ["core"], "sun": ["easy_run"]],
                                     "targets": ["s_long": ["target_sets": 1], "s_kb": ["target_sets": 4]]],
                                    ["week": ["mon": "kb_a", "tue": "intervals", "wed": "soccer", "sat": "long_run"],
                                     "extras": ["mon": ["core"]]],
                                  ]])
        return (tree, tree.program!)
    }

    func testRowsMarkWhatComesFromYourWeek() {
        let (tree, block) = layeredBlock()
        let rows = ProgramEditing.rows(block, week: 0, plan: tree)
        let monday = rows[0], tuesday = rows[1], sunday = rows[6]
        XCTAssertTrue(monday.isEveryWeekOnly)
        XCTAssertEqual(monday.everyWeek, ["kb_a", "core"])
        XCTAssertFalse(tuesday.isEveryWeekOnly)
        XCTAssertTrue(tuesday.everyWeek.isEmpty)
        XCTAssertFalse(sunday.isEveryWeekOnly)
        XCTAssertEqual(sunday.everyWeek, ["easy_run"])

        let plain = ProgramEditing.newProgram(from: tree, start: "2026-11-16", weeks: 1, repeats: false)
        XCTAssertTrue(ProgramEditing.rows(plain, week: 0, plan: tree).allSatisfy { $0.everyWeek.isEmpty })
    }

    func testOwnWorkoutsTheirDaysAndWhatIsBeside() {
        let (tree, block) = layeredBlock()
        let own = BlockLayers.ownForm(block, schedule: BlockLayers.repeatingWeek(tree))
        XCTAssertEqual(BlockLayers.workouts(own, plan: tree).map(\.id), ["intervals", "long_run"])
        XCTAssertEqual(BlockLayers.days(own, workoutID: "intervals").days, ["tue"])
        XCTAssertFalse(BlockLayers.days(own, workoutID: "intervals").varies)
        XCTAssertEqual(BlockLayers.days(own, workoutID: "long_run").days, ["sat", "sun"])
        XCTAssertTrue(BlockLayers.days(own, workoutID: "long_run").varies)
        XCTAssertEqual(BlockLayers.daysLabel(["sat", "sun"]), "Sat, Sun")
        XCTAssertEqual(BlockLayers.daysLabel([]), "No day")
        XCTAssertEqual(BlockLayers.beside(block, plan: tree).map(\.id), ["kb_a", "core", "soccer", "tempo", "easy_run"])
    }

    func testMovingAddingAndRemovingAWorkout() {
        let (tree, block) = layeredBlock()
        let own = BlockLayers.ownForm(block, schedule: BlockLayers.repeatingWeek(tree))

        let moved = BlockLayers.placing(own, workoutID: "long_run", on: ["sun"])
        XCTAssertEqual(BlockLayers.days(moved, workoutID: "long_run").days, ["sun"])
        XCTAssertFalse(BlockLayers.days(moved, workoutID: "long_run").varies)
        XCTAssertEqual(moved.workoutIDs, ["intervals", "long_run"])

        // Tempo is in Your week on Saturday: it joins the list on that day.
        let added = BlockLayers.adding(own, workoutID: "tempo", on: BlockLayers.everyWeekDays(
            BlockLayers.repeatingWeek(tree), workoutID: "tempo"))
        XCTAssertEqual(added.workoutIDs, ["intervals", "long_run", "tempo"])
        XCTAssertEqual(added.weeks[0].week["sat"] ?? nil, "tempo")
        XCTAssertEqual(added.weeks[1].extras?["sat"], ["tempo"], "Week 2's long run keeps Saturday's main slot.")

        let removed = BlockLayers.removing(own, workout: tree.workouts.first { $0.id == "long_run" }!)
        XCTAssertEqual(removed.workoutIDs, ["intervals"])
        XCTAssertEqual(BlockLayers.days(removed, workoutID: "long_run").days, [])
        XCTAssertNil(removed.weeks[0].targets?["s_long"], "The targets the block gave it go with it.")
        XCTAssertNotNil(removed.weeks[0].targets?["s_kb"])
    }

    func testADayHoldsAtMostFiveWorkouts() {
        let tree = plan()
        let crowded = PlanProgram(id: "b", name: nil, start: "2026-11-16", repeats: false, weeks: [
            week(["mon": "a"], extras: ["mon": ["b", "c", "d", "e"]]), week([:]),
        ], workoutIDs: ["a", "b", "c", "d", "e"])
        XCTAssertTrue(BlockLayers.dayFull(crowded, day: "mon", workoutID: "tempo"))
        XCTAssertFalse(BlockLayers.dayFull(crowded, day: "mon", workoutID: "a"))
        XCTAssertEqual(BlockLayers.fullDays(crowded, workoutID: "tempo", days: ["mon", "tue"]), ["mon"])
        XCTAssertNotNil(tree.schedule)
    }

    func testADayChangeOnALayeredBlockTouchesOnlyItsOwn() {
        let (tree, block) = layeredBlock()
        // Rest on Tuesday, this week only: intervals leave, nothing else moves.
        let change = ProgramEditing.dayChange("tue", to: nil, week: 0, scope: .thisWeek, in: block, plan: tree)
        XCTAssertNotEqual(change.after, change.before)
        XCTAssertNil(change.after.weeks[0].week["tue"] ?? nil)
        XCTAssertEqual(change.after.weeks[1].week["tue"] ?? nil, "intervals")
        XCTAssertNil(change.after.weeks[0].week["mon"] ?? nil, "Your week's Monday is the server's to lay back.")
        XCTAssertEqual(change.after.workoutIDs, ["intervals", "long_run"])

        // Nothing from the block clears every workout it owns that day,
        // extras included, for the weeks in scope.
        let crowded = BlockLayers.adding(BlockLayers.ownForm(block, schedule: BlockLayers.repeatingWeek(tree)),
                                         workoutID: "tempo", on: ["sun"])
        XCTAssertEqual(crowded.weeks[0].extras?["sun"], ["tempo"])
        let cleared = ProgramEditing.dayChange("sun", to: nil, week: 0, scope: .thisAndLater, in: crowded, plan: tree)
        XCTAssertNil(cleared.after.weeks[0].week["sun"] ?? nil)
        XCTAssertNil(cleared.after.weeks[0].extras?["sun"])
        XCTAssertNil(cleared.after.weeks[1].week["sun"] ?? nil)
        XCTAssertEqual(cleared.after.weeks[1].week["sat"] ?? nil, "long_run")

        // Picking what the day already has changes nothing.
        let same = ProgramEditing.dayChange("tue", to: "intervals", week: 0, scope: .thisWeek, in: block, plan: tree)
        XCTAssertEqual(same.after, same.before)

        // An unlayered block still changes its whole days.
        let plain = ProgramEditing.newProgram(from: tree, start: "2026-11-16", weeks: 2, repeats: false)
        let whole = ProgramEditing.dayChange("mon", to: "tempo", week: 0, scope: .thisAndLater, in: plain, plan: tree)
        XCTAssertEqual(whole.before, plain)
        XCTAssertEqual(whole.after.weeks[1].week["mon"] ?? nil, "tempo")
    }

    func testSortingAnOlderBlock() {
        let tree = plan()
        var whole = ProgramEditing.newProgram(from: tree, start: "2026-11-16", weeks: 2, repeats: false)
        whole = ProgramEditing.setting("sun", to: "long_run", week: 0, scope: .thisAndLater, in: whole)
        // Long run sits where Your week doesn't have it, so it's the block's.
        XCTAssertEqual(BlockLayers.suggestedSorting(whole, plan: tree), ["long_run"])
        let sorted = BlockLayers.sorting(whole, picked: ["long_run", "tempo"], plan: tree)
        XCTAssertEqual(sorted.workoutIDs, ["long_run", "tempo"])
        XCTAssertEqual(sorted.weeks[0].week["sun"] ?? nil, "long_run")
        XCTAssertEqual(sorted.weeks[0].week["sat"] ?? nil, "tempo")
        XCTAssertNil(sorted.weeks[0].week["mon"] ?? nil)
        XCTAssertNil(sorted.weeks[0].extras)
    }

    func testYourWeekCarriesOnBesideALayeredBlock() {
        let (_, block) = layeredBlock()
        XCTAssertEqual(ProgramEditing.yourWeekWhileInUse(block), "Carries on beside the block every week")
        let plain = PlanProgram(id: "b", name: nil, start: "2026-11-16", repeats: true, weeks: [week([:])])
        XCTAssertEqual(ProgramEditing.yourWeekWhileInUse(plain), "Not in use while the block repeats")
    }
}
