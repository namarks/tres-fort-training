import XCTest
@testable import TresFort

/// The Plan tab's block of weeks (docs/plans/progressive-plans P2).
final class ProgramEditingTests: XCTestCase {
    private func workout(_ id: String) -> Workout {
        Workout(id: id, name: id.capitalized, day_label: nil, order_index: 0, exercises: [])
    }

    private func plan(program: [String: Any]? = nil) -> PlanTree {
        var meta: [String: Any] = ["schedule": [
            "version": 1,
            "week": ["mon": "lift", "tue": NSNull(), "wed": "run", "thu": NSNull(), "fri": NSNull(),
                     "sat": "gone", "sun": NSNull()],
            "extras": ["mon": ["yoga"]],
        ] as [String: Any]]
        if let program { meta["program"] = program }
        let data = try! JSONSerialization.data(withJSONObject: meta)
        return PlanTree(id: "p", name: "Plan", version: 7,
                        workouts: [workout("lift"), workout("run"), workout("yoga")],
                        meta: String(data: data, encoding: .utf8))
    }

    func testCivilDatesAndMondays() {
        XCTAssertEqual(ProgramEditing.ymd(dayNumber: 0), "1970-01-01")
        XCTAssertEqual(ProgramEditing.addingDays(7, to: "2026-12-28"), "2027-01-04")
        XCTAssertEqual(ProgramEditing.addingDays(1, to: "2028-02-28"), "2028-02-29")
        XCTAssertEqual(ProgramEditing.monday(onOrBefore: "2026-11-09"), "2026-11-09")
        XCTAssertEqual(ProgramEditing.monday(onOrBefore: "2026-11-15"), "2026-11-09")
        XCTAssertEqual(ProgramEditing.monday(onOrBefore: "2026-11-08"), "2026-11-02")
        XCTAssertEqual(ProgramEditing.startChoices(today: "2026-11-11", count: 3),
                       ["2026-11-09", "2026-11-16", "2026-11-23"])
    }

    func testANewBlockCopiesYourWeekAndItsExtras() {
        let program = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 3, repeats: true,
                                                name: "  Spring build ")
        XCTAssertEqual(program.weeks.count, 3)
        XCTAssertEqual(program.name, "Spring build")
        XCTAssertTrue(program.repeats)
        XCTAssertEqual(program.weeks[0].week["mon"], .some("lift"))
        XCTAssertEqual(program.weeks[0].week["tue"], .some(nil))
        XCTAssertEqual(program.weeks[0].week["sat"], .some(nil), "An archived or missing workout becomes rest")
        XCTAssertEqual(program.weeks[2].extras, ["mon": ["yoga"]])
        XCTAssertEqual(ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 99, repeats: false)
            .weeks.count, PlanProgram.maxWeeks)
    }

    func testADayChangesForOneWeekOrThatWeekAndAfter() {
        let base = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 4, repeats: false)
        let one = ProgramEditing.setting("tue", to: "run", week: 1, scope: .thisWeek, in: base)
        XCTAssertEqual(one.weeks.map { $0.week["tue"] ?? nil }, [nil, "run", nil, nil])
        let later = ProgramEditing.setting("mon", to: "yoga", week: 2, scope: .thisAndLater, in: base)
        XCTAssertEqual(later.weeks.map { $0.week["mon"] ?? nil }, ["lift", "lift", "yoga", "yoga"])
        XCTAssertNil(later.weeks[2].extras, "The extra moved to the main slot, not shown twice")
        XCTAssertEqual(later.weeks[0].extras, ["mon": ["yoga"]])
        let rest = ProgramEditing.setting("wed", to: nil, week: 0, scope: .thisWeek, in: base)
        XCTAssertEqual(rest.weeks[0].week["wed"], .some(nil))
    }

    func testEditsKeepEachWeeksTargets() {
        let targets = ["slot": SlotTargets(sets: 5)]
        let base = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 2, repeats: false)
        let program = PlanProgram(id: "b", name: nil, start: base.start, repeats: false, weeks: [
            PlanProgram.Week(label: "Base", week: base.weeks[0].week, extras: nil, targets: targets),
            base.weeks[1],
        ])
        XCTAssertEqual(ProgramEditing.setting("tue", to: "run", week: 0, scope: .thisWeek, in: program)
            .weeks[0].targets, targets)
        XCTAssertEqual(ProgramEditing.relabeling(week: 0, to: " Build ", in: program).weeks[0].label, "Build")
        XCTAssertNil(ProgramEditing.relabeling(week: 0, to: "  ", in: program).weeks[0].label)
        let copied = ProgramEditing.copyingToNext(week: 0, in: program)!
        XCTAssertEqual(copied.weeks[1].targets, targets)
        XCTAssertNil(copied.weeks[1].label, "The next week keeps its own label")
        XCTAssertNil(ProgramEditing.copyingToNext(week: 1, in: program))
        XCTAssertEqual(ProgramEditing.addingWeek(to: program)?.weeks.count, 3)
        XCTAssertEqual(ProgramEditing.removingLastWeek(from: program)?.weeks.count, 1)
        XCTAssertNil(ProgramEditing.removingLastWeek(from: ProgramEditing.removingLastWeek(from: program)!))
    }

    func testPositionHeadingAndChips() {
        var program = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 3, repeats: false)
        program = ProgramEditing.relabeling(week: 1, to: "Easy week", in: program)
        XCTAssertEqual(ProgramEditing.position(of: program, today: "2026-11-02"), .upcoming(startsIn: 7))
        XCTAssertEqual(ProgramEditing.position(of: program, today: "2026-11-17"), .current(index: 1))
        XCTAssertEqual(ProgramEditing.position(of: program, today: "2026-11-30"), .ended)
        XCTAssertEqual(ProgramEditing.openingWeek(program, today: "2026-11-17"), 1)
        XCTAssertEqual(ProgramEditing.openingWeek(program, today: "2026-12-30"), 0)
        XCTAssertEqual(ProgramEditing.heading(program, week: 1, today: "2026-11-17"), "Week 2 of 3 · Easy week")
        XCTAssertEqual(ProgramEditing.chip(program, week: 1), "Easy")
        XCTAssertEqual(ProgramEditing.chip(program, week: 2), "W3")
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 2), "2026-11-23")
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 0, today: "2026-12-02"), "2026-11-09",
                       "A one-off block keeps its own dates")
    }

    func testARepeatingBlockDatesTheWeeksOfThisCycle() {
        let program = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 2, repeats: true)
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 1, today: "2026-11-02"), "2026-11-16")
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 0, today: "2026-11-23"), "2026-11-23")
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 1, today: "2026-11-23"), "2026-11-30")
        // In week 2 of the second cycle: this week, and week 1 next on Dec 7.
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 1, today: "2026-12-03"), "2026-11-30")
        XCTAssertEqual(ProgramEditing.weekStart(program, index: 0, today: "2026-12-03"), "2026-12-07")
    }

    func testOneScheduleIsInUseAtATime() {
        let oneOff = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 3, repeats: false)
        XCTAssertFalse(ProgramEditing.isInUse(oneOff, today: "2026-11-08"))
        XCTAssertTrue(ProgramEditing.isInUse(oneOff, today: "2026-11-09"))
        XCTAssertTrue(ProgramEditing.isInUse(oneOff, today: "2026-11-29"))
        XCTAssertFalse(ProgramEditing.isInUse(oneOff, today: "2026-11-30"))
        XCTAssertEqual(ProgramEditing.yourWeekReturns(oneOff), "2026-11-30")
        XCTAssertEqual(ProgramEditing.yourWeekWhileInUse(oneOff), "Not in use until Mon, Nov 30, after the block")
        XCTAssertEqual(ProgramEditing.yourWeekBesideBlock(oneOff, today: "2026-11-04"),
                       "In use until the block starts on Mon, Nov 9. Tap a day to swap it.")
        XCTAssertEqual(ProgramEditing.yourWeekBesideBlock(oneOff, today: "2026-12-01"),
                       "In use again now that the block has ended. Tap a day to swap it.")
        let cycle = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 2, repeats: true)
        XCTAssertNil(ProgramEditing.yourWeekReturns(cycle))
        XCTAssertTrue(ProgramEditing.isInUse(cycle, today: "2027-03-03"))
        XCTAssertEqual(ProgramEditing.yourWeekWhileInUse(cycle), "Not in use while the block repeats")
    }

    func testRowsReadLiveWorkouts() {
        let program = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 1, repeats: false)
        let rows = ProgramEditing.rows(program, week: 0, plan: plan())
        XCTAssertEqual(rows.map(\.weekdayKey), PlanSchedule.weekdayKeys)
        XCTAssertEqual(rows[0].workout?.id, "lift")
        XCTAssertEqual(rows[0].extras.map(\.id), ["yoga"])
        XCTAssertNil(rows[1].workout)
        XCTAssertFalse(ProgramEditing.differsFromYourWeek(program, week: 0, plan: plan()))
        let changed = ProgramEditing.setting("tue", to: "run", week: 0, scope: .thisWeek, in: program)
        XCTAssertTrue(ProgramEditing.differsFromYourWeek(changed, week: 0, plan: plan()))
    }

    /// What the app sends round-trips through the app's own reader, which
    /// mirrors the server's `normalizeProgram`.
    func testWireRoundTripsThroughTheReader() throws {
        var program = ProgramEditing.newProgram(from: plan(), start: "2026-11-09", weeks: 2, repeats: true,
                                                name: "Cycle")
        program = ProgramEditing.relabeling(week: 0, to: "A", in: program)
        program = PlanProgram(id: "x", name: program.name, start: program.start, repeats: true, weeks: [
            PlanProgram.Week(label: "A", week: program.weeks[0].week, extras: program.weeks[0].extras,
                             targets: ["s": SlotTargets(sets: 4, rpe: .some(nil), weight: .some(30), weightUnit: "kg",
                                                        runSteps: .some("[{\"kind\":\"work\",\"distance_m\":1000}]"))]),
            program.weeks[1],
        ])
        let wire = ProgramEditing.wire(program)
        XCTAssertNil(wire["id"], "The server keeps the block's id")
        let week0 = try XCTUnwrap((wire["weeks"] as? [[String: Any]])?.first)
        XCTAssertTrue((week0["week"] as? [String: Any])?["tue"] is NSNull)
        let target = try XCTUnwrap((week0["targets"] as? [String: Any])?["s"] as? [String: Any])
        XCTAssertTrue(target["target_rpe"] is NSNull)
        XCTAssertNil(target["target_reps"])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(wire))
        let filtered = ProgramEditing.wire(program, liveSlots: ["other"])
        XCTAssertNil((filtered["weeks"] as? [[String: Any]])?.first?["targets"],
                     "Targets of a deleted or archived slot are not sent back")
        XCTAssertEqual(ProgramEditing.liveWorkouts(plan()), ["lift", "run", "yoga"])
        XCTAssertEqual((wire["weeks"] as? [[String: Any]])?.first?["extras"] as? [String: [String]], ["mon": ["yoga"]])
        XCTAssertNil((ProgramEditing.wire(program, activities: ["lift"])["weeks"] as? [[String: Any]])?
            .first?["extras"], "An extra that has gained exercises is not sent back")
        var json = wire
        json["id"] = "x"
        let read = try XCTUnwrap(PlanProgram(json: json))
        XCTAssertEqual(read, program)
    }
}
