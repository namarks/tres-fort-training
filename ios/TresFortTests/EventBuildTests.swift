import XCTest
@testable import TresFort

/// "Train for an event" (docs/plans/progressive-plans P3): what the sheet
/// sends, the long-run day it suggests and how it explains a refused rule.
final class EventBuildTests: XCTestCase {
    private func slot(_ exerciseID: String) -> TemplateExercise {
        TemplateExercise(id: "slot-\(exerciseID)", exercise_id: exerciseID, exercise_name: exerciseID,
            exercise_unit: "lb", order_index: 0, target_sets: 1, target_reps: 1,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 60,
            target_weight: nil, cues: nil, exercise_modality: "cardio",
            exercise_laterality: nil, exercise_load_mode: nil,
            exercise_demo_slug: nil, target_duration_s: nil, is_warmup: 0,
            target_weight_unit: nil)
    }

    private func plan(week: [String: Any], extras: [String: [String]] = [:], race: [String: Any]? = nil) -> PlanTree {
        var meta: [String: Any] = ["schedule": ["version": 1, "week": week, "extras": extras] as [String: Any]]
        if let race { meta["race"] = race }
        let data = try! JSONSerialization.data(withJSONObject: meta)
        return PlanTree(id: "p", name: "Plan", version: 3, workouts: [
            Workout(id: "lift", name: "Lift", day_label: nil, order_index: 0, exercises: [slot("ex_goblet_squat")]),
            Workout(id: "run", name: "Run", day_label: nil, order_index: 1, exercises: [slot(RunPlan.exerciseID)]),
            Workout(id: "long", name: "Long run", day_label: nil, order_index: 2, exercises: [slot(RunPlan.exerciseID)]),
        ], meta: String(data: data, encoding: .utf8))
    }

    func testSendsTheEventAndOnlyTheRulesTheMemberChanged() {
        var request = EventBuildRequest(name: "  Spring Marathon ", date: "2031-06-01", distance: .marathon,
                                        longRunWeekday: "sun", today: "2031-02-01", unit: .miles)
        var body = request.body
        XCTAssertEqual(body["today"] as? String, "2031-02-01")
        XCTAssertEqual(body["long_run_weekday"] as? String, "sun")
        XCTAssertEqual(body["unit"] as? String, "mi")
        XCTAssertNil(body["peak_m"])
        XCTAssertNil(body["easy_every"])
        let race = body["race"] as? [String: Any]
        XCTAssertEqual(race?["name"] as? String, "Spring Marathon")
        XCTAssertEqual(race?["distance_m"] as? Int, 42_195)
        XCTAssertEqual(race?["discipline"] as? String, "running")

        request.name = ""
        request.unit = .kilometers
        request.peakMeters = EventBuilding.meters(30, .kilometers)
        request.easyEvery = 0
        request.taperWeeks = 2
        request.shortenOtherRuns = false
        body = request.body
        XCTAssertEqual((body["race"] as? [String: Any])?["name"] as? String, "Marathon")
        XCTAssertEqual(body["unit"] as? String, "km")
        XCTAssertEqual(body["peak_m"] as? Int, 30_000)
        XCTAssertEqual(body["easy_every"] as? Int, 0)
        XCTAssertEqual(body["taper_weeks"] as? Int, 2)
        XCTAssertEqual(body["shorten_other_runs"] as? Bool, false)
        XCTAssertNil(body["workout_weekday"])
        XCTAssertNil((body["race"] as? [String: Any])?["goal_time_s"])

        request.goalTimeSeconds = 12_600
        request.workoutDay = .off
        body = request.body
        XCTAssertEqual((body["race"] as? [String: Any])?["goal_time_s"] as? Int, 12_600)
        XCTAssertTrue(body["workout_weekday"] is NSNull)
        request.workoutDay = .day("wed")
        XCTAssertEqual(request.body["workout_weekday"] as? String, "wed")
    }

    func testKeepBuildingSendsNoEvent() {
        var request = EventBuildRequest(name: "", date: "2031-06-01", distance: .marathon,
                                        longRunWeekday: "sun", today: "2031-02-01", unit: .miles)
        request.openWeeks = 12
        request.peakMeters = EventBuilding.meters(10, .miles)
        let body = request.body
        XCTAssertNil(body["race"])
        XCTAssertEqual((body["open"] as? [String: Int])?["weeks"], 12)
        XCTAssertEqual(body["peak_m"] as? Int, 16_093)
        let weeks = ["base", "easy", "build", "hold", "hold", "easy"].enumerated().map { index, phase in
            EventBuildPreview.Week(start: "2031-02-03", phase: phase, label: phase, long_run_m: Double(index), factor: 1)
        }
        XCTAssertEqual(EventBuilding.phaseSpans(weeks).map(\.label), ["Base", "Build", "Holding"])
        XCTAssertEqual(EventBuilding.phaseSpans(weeks).map(\.range), ["1", "3", "4–5"])
    }

    func testSavesTheRulesThePreviewResolved() throws {
        let json = #"""
        {"start":"2031-02-03","weeks":[],"reached_peak":true,"replaces_block":false,"plan_version":9,
         "rules":{"long_run_weekday":"sun","long_run_now_m":12875,"longest_recent_m":12875,"peak_m":32187,
                  "easy_every":4,"taper_weeks":3,"shorten_other_runs":true,"unit":"mi"}}
        """#
        let preview = try JSONDecoder().decode(EventBuildPreview.self, from: Data(json.utf8))
        var request = EventBuildRequest(name: "M", date: "2031-06-01", distance: .marathon,
                                        longRunWeekday: "sun", today: "2031-02-01", unit: .miles)
        request.peakMeters = 29_000
        let body = request.resolved(by: preview).body
        XCTAssertEqual(body["long_run_now_m"] as? Int, 12_875)
        XCTAssertEqual(body["peak_m"] as? Int, 29_000)
        XCTAssertEqual(body["easy_every"] as? Int, 4)
        XCTAssertEqual(body["taper_weeks"] as? Int, 3)
        XCTAssertEqual(body["shorten_other_runs"] as? Bool, true)
        XCTAssertEqual(body["start"] as? String, "2031-02-03")
        XCTAssertNil(request.body["start"])
        // No workout day in the preview means none, sent as such.
        XCTAssertTrue(body["workout_weekday"] is NSNull)
    }

    func testSavesTheSuggestedWorkoutDay() throws {
        let json = #"""
        {"start":"2031-02-03","reached_peak":true,"replaces_block":false,"plan_version":9,
         "weeks":[{"start":"2031-02-03","phase":"peak","label":"Peak","long_run_m":32187,"factor":1,
                   "long_run_goal_m":9656,"workout":{"type":"goal_pace","reps":2,"work_s":1200}}],
         "rules":{"long_run_weekday":"sun","long_run_now_m":12875,"longest_recent_m":null,"peak_m":32187,
                  "easy_every":4,"taper_weeks":3,"shorten_other_runs":true,"unit":"mi",
                  "workout_weekday":"tue","style":"goal","goal_pace_s_per_km":299}}
        """#
        let preview = try JSONDecoder().decode(EventBuildPreview.self, from: Data(json.utf8))
        XCTAssertEqual(preview.weeks[0].workout, EventBuildPreview.Workout(type: "goal_pace", reps: 2, work_s: 1200))
        let request = EventBuildRequest(name: "M", date: "2031-06-01", distance: .marathon,
                                        longRunWeekday: "sun", today: "2031-02-01", unit: .miles)
        XCTAssertEqual(request.resolved(by: preview).body["workout_weekday"] as? String, "tue")
        XCTAssertEqual(EventBuilding.longRunText(preview.weeks[0], raceMeters: 42_195, .miles),
                       "Long run 20 mi, last 6 at goal pace")
        XCTAssertEqual(EventBuilding.paceText(299, .miles), "8:01/mi")
    }

    func testDescribesEachWeeksSessions() {
        func workout(_ type: String, _ reps: Int, _ seconds: Int) -> String {
            EventBuilding.workoutText(EventBuildPreview.Workout(type: type, reps: reps, work_s: seconds))
        }
        XCTAssertEqual(workout("strides", 6, 20), "Strides 6 × 20 s")
        XCTAssertEqual(workout("tempo", 1, 1_200), "Tempo 20 min")
        XCTAssertEqual(workout("intervals", 5, 180), "5 × 3 min")
        XCTAssertEqual(workout("goal_pace", 2, 900), "2 × 15 min at goal pace")
        XCTAssertEqual(workout("shakeout", 4, 20), "Shakeout and 4 strides")
        let race = EventBuildPreview.Week(start: "2031-05-26", phase: "race", label: "Race week", long_run_m: 42_195,
                                          factor: 0.5, long_run_goal_m: 42_195)
        XCTAssertEqual(EventBuilding.longRunText(race, raceMeters: 42_195, .miles), "Race day at goal pace")
        let easy = EventBuildPreview.Week(start: "2031-02-24", phase: "easy", label: "Easier week",
                                          long_run_m: EventBuilding.meters(8, .miles), factor: 0.75)
        XCTAssertEqual(EventBuilding.longRunText(easy, raceMeters: 42_195, .miles), "Long run 8 mi")
        XCTAssertEqual(EventBuilding.goalTimeText(12_600), "3:30")
        XCTAssertEqual(EventBuilding.goalTimeText(1_500), "25:00")
        XCTAssertEqual(EventBuilding.goalTimeText(12_570), "3:29:30")
    }

    func testSuggestsTheLongRunDay() {
        XCTAssertEqual(EventBuilding.longRunWeekday(in: plan(week: ["mon": "lift", "tue": "run", "sun": "long"])), "sun")
        XCTAssertEqual(EventBuilding.longRunWeekday(in: plan(week: ["tue": "run", "sat": "long", "sun": "lift"])), "sat")
        XCTAssertEqual(EventBuilding.longRunWeekday(in: plan(week: ["sun": "lift"], extras: ["sun": ["long"]])), "sun")
        XCTAssertNil(EventBuilding.longRunWeekday(in: plan(week: ["mon": "lift"])))
    }

    func testDistancesReadInWholeUnitsUnlessTheyArent() {
        XCTAssertEqual(EventBuilding.units(12_875, .miles), 8)
        XCTAssertEqual(EventBuilding.distanceText(EventBuilding.meters(8, .miles), .miles), "8 mi")
        XCTAssertEqual(EventBuilding.distanceText(42_195, .miles), "26.2 mi")
        XCTAssertEqual(EventBuilding.distanceText(12_000, .kilometers), "12 km")
        XCTAssertEqual(EventBuilding.easyEveryTitle(4), "Every 4th")
        XCTAssertEqual(EventBuilding.easyEveryTitle(0), "Never")
    }

    func testPhaseKeyMatchesTheChart() {
        let phases = ["base", "base", "easy", "build", "build", "easy", "peak", "taper", "race"]
        let weeks = phases.enumerated().map { index, phase in
            EventBuildPreview.Week(start: "2031-02-03", phase: phase, label: phase, long_run_m: Double(index), factor: 1)
        }
        let spans = EventBuilding.phaseSpans(weeks)
        XCTAssertEqual(spans.map(\.label), ["Base", "Build", "Peak", "Taper"])
        XCTAssertEqual(spans.map(\.range), ["1–2", "4–5", "7", "8–9"])
    }

    func testExplainsARefusedRule() {
        XCTAssertTrue(EventBuilding.message(for: #"{"error":"long_run_shared","weekday":"wed"}"#).contains("Wednesday"))
        XCTAssertTrue(EventBuilding.message(for: #"{"error":"no_long_run"}"#).contains("no run"))
        XCTAssertTrue(EventBuilding.message(for: #"{"error":"too_many_weeks"}"#).contains("52 weeks"))
        XCTAssertTrue(EventBuilding.message(for: #"{"error":"workout_shared","weekday":"sat"}"#).contains("Saturday"))
        XCTAssertTrue(EventBuilding.message(for: #"{"error":"no_workout_run"}"#).contains("workout day"))
        XCTAssertTrue(EventBuilding.message(for: #"{"error":"goal_pace_out_of_range"}"#).contains("goal time"))
    }

    func testRaceDayLineShowsOverABlockThatReachesTheEvent() {
        let tree = plan(week: ["sun": "long"], race: ["name": "Spring Marathon", "date": "2031-06-01",
                                                      "discipline": "running"])
        XCTAssertEqual(tree.event, PlanEvent(name: "Spring Marathon", date: "2031-06-01"))
        let weeks = Array(repeating: PlanProgram.Week(label: nil, week: [:], extras: nil), count: 17)
        let block = PlanProgram(id: "b", name: "Spring Marathon", start: "2031-02-03", repeats: false, weeks: weeks)
        XCTAssertEqual(EventBuilding.raceDayLine(tree.event!, program: block, today: "2031-02-16"),
                       "RACE DAY SUN, JUN 1 · 15 WEEKS TO GO")
        XCTAssertEqual(EventBuilding.raceDayLine(tree.event!, program: block, today: "2031-05-30"),
                       "RACE DAY SUN, JUN 1 · IN 2 DAYS")
        XCTAssertNil(EventBuilding.raceDayLine(tree.event!, program: block, today: "2031-06-02"))
        let short = PlanProgram(id: "b", name: nil, start: "2031-02-03", repeats: false, weeks: Array(weeks.prefix(4)))
        XCTAssertNil(EventBuilding.raceDayLine(tree.event!, program: short, today: "2031-02-16"))
        XCTAssertNil(plan(week: [:]).event)
    }
}
