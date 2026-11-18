import Foundation
import XCTest
@testable import TresFort

/// The goal event in the app (docs/plans/coach-free-planning P1): reading
/// `meta.race`, the editor's draft rules (the same as the web's Event page),
/// and the words the Plan tab's card shows.
final class EventGoalTests: XCTestCase {
    private func tree(race: String?) -> PlanTree {
        let meta = race.map { #"{"schedule":{"version":1,"week":{}},"race":\#($0)}"# }
        return PlanTree(id: "plan", name: "Plan", version: 3, workouts: [], meta: meta)
    }

    func testPlanReadsEveryEventField() {
        let plan = tree(race: #"{"name":"Turkey Trot","date":"2026-11-26","discipline":"running","distance":"5k","distance_m":5000,"goal_time_s":1200,"priority":"A","location":"Portland"}"#)
        XCTAssertEqual(plan.event, PlanEvent(name: "Turkey Trot", date: "2026-11-26", discipline: "running",
                                             distance: "5k", distance_m: 5_000, goal_time_s: 1_200,
                                             priority: "A", location: "Portland"))
        XCTAssertEqual(tree(race: #"{"name":"Spring Marathon","date":"2031-06-01"}"#).event,
                       PlanEvent(name: "Spring Marathon", date: "2031-06-01"))
        XCTAssertNil(tree(race: nil).event)
    }

    func testGoalTimeReadsLikeTheWeb() {
        XCTAssertEqual(EventGoal.parseGoalTime("18:00"), 1_080)
        XCTAssertEqual(EventGoal.parseGoalTime(" 1:45:30 "), 6_330)
        XCTAssertEqual(EventGoal.parseGoalTime("25"), 1_500, "A bare number is minutes")
        XCTAssertNil(EventGoal.parseGoalTime(""))
        XCTAssertNil(EventGoal.parseGoalTime("0:00"))
        XCTAssertNil(EventGoal.parseGoalTime("18:60"))
        XCTAssertNil(EventGoal.parseGoalTime("1:60:00"))
        XCTAssertNil(EventGoal.parseGoalTime("18:5"))
        XCTAssertNil(EventGoal.parseGoalTime("fast"))
        XCTAssertNil(EventGoal.parseGoalTime("9999999999999999:00:00"), "Huge hours are refused, not overflowed")
        XCTAssertNil(EventGoal.parseGoalTime("169:00:00"))
        XCTAssertEqual(EventGoal.parseGoalTime("168:00:00"), 7 * 24 * 3_600)
        XCTAssertEqual(EventGoal.goalTimeText(1_200), "20:00")
        XCTAssertEqual(EventGoal.goalTimeText(6_330), "1:45:30")
    }

    func testEventTypesPickTheirKind() {
        XCTAssertEqual(EventGoal.kinds("running"), [.run])
        XCTAssertEqual(EventGoal.kinds("Triathlon"), [.swim, .ride, .run])
        XCTAssertEqual(EventGoal.kinds("duathlon"), [.run, .ride])
        XCTAssertEqual(EventGoal.kinds("cycling"), [.ride])
        XCTAssertEqual(EventGoal.kinds("open water"), [.swim])
        XCTAssertEqual(EventGoal.kinds("Hood to Coast marathon"), [.run])
        XCTAssertEqual(EventGoal.kinds("biathlon"), [])
        XCTAssertEqual(EventGoal.disciplineLabel("cycling"), "Cycling")
        XCTAssertEqual(EventGoal.disciplineLabel("obstacle race"), "Obstacle race")
    }

    func testANewEventNeedsANameAndSendsWhatWasChosen() {
        var draft = EventGoalDraft(today: "2026-11-07", unit: .miles)
        XCTAssertTrue(draft.isNew)
        XCTAssertEqual(draft.dateString, "2027-01-02", "A new event starts eight weeks out")
        XCTAssertEqual(draft.kind, .run)
        XCTAssertFalse(draft.canSave)
        XCTAssertEqual(draft.problem, "Name the event.")

        draft.name = "  Turkey Trot 5k "
        draft.setDate(CalendarProjection.date(from: "2026-11-26")!)
        draft.distanceChoice = .preset("5k")
        draft.goal = "20:00"
        XCTAssertTrue(draft.canSave)
        guard case .success(let event) = draft.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(event, PlanEvent(name: "Turkey Trot 5k", date: "2026-11-26", discipline: "running",
                                        distance: "5k", distance_m: 5_000, goal_time_s: 1_200))
        XCTAssertEqual(event.wire["discipline"] as? String, "running")
        XCTAssertEqual(event.wire["distance_m"] as? Double, 5_000)
        XCTAssertNil(event.wire["priority"])

        draft.goal = "soon"
        XCTAssertEqual(draft.problem, "Enter the goal time like 18:00 or 1:45:30.")
        XCTAssertFalse(draft.canSave)
    }

    func testAnotherDistanceIsTypedInItsUnit() {
        var draft = EventGoalDraft(today: "2026-11-07", unit: .miles)
        draft.name = "Fun run"
        draft.distanceChoice = .custom
        XCTAssertEqual(draft.customUnit, .mi)
        draft.customAmount = "3,1"
        guard case .success(let event) = draft.event() else { return XCTFail("A comma reads as a decimal point") }
        XCTAssertEqual(event.distance, "3.1 mi")
        XCTAssertEqual(event.distance_m ?? 0, 4_989, accuracy: 0.1)
        draft.customAmount = "far"
        XCTAssertEqual(draft.problem, "Enter the distance as a number.")
    }

    func testAnEditOpensOnTheSavedDistanceAndKeepsTheCoachsFields() {
        let coachSet = PlanEvent(name: "Spring Half", date: "2027-04-18", discipline: "running",
                                 distance: "Half marathon", distance_m: 21_097.5, goal_time_s: 5_400,
                                 priority: "A", location: "Eugene")
        var draft = EventGoalDraft(event: coachSet, unit: .miles)
        XCTAssertFalse(draft.isNew)
        XCTAssertEqual(draft.distanceChoice, .preset("Half marathon"))
        XCTAssertEqual(draft.goal, "1:30:00")
        XCTAssertFalse(draft.canSave, "Nothing changed yet")

        draft.goal = "1:28:00"
        guard case .success(let event) = draft.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(event.goal_time_s, 5_280)
        XCTAssertEqual(event.priority, "A")
        XCTAssertEqual(event.location, "Eugene")
        XCTAssertTrue(draft.canSave)

        let odd = EventGoalDraft(event: PlanEvent(name: "Track mile", date: "2027-05-01", discipline: "running",
                                                  distance_m: 1_200), unit: .kilometers)
        XCTAssertEqual(odd.distanceChoice, .custom)
        XCTAssertEqual(odd.customUnit, .km)
        XCTAssertEqual(odd.customAmount, "1.2")

        // A distance the field can only show rounded is kept exactly until it's edited.
        let track = PlanEvent(name: "Track 400", date: "2027-05-01", discipline: "running",
                              distance: "400 m", distance_m: 400)
        var lap = EventGoalDraft(event: track, unit: .miles)
        XCTAssertEqual(lap.customAmount, "0.25")
        XCTAssertFalse(lap.canSave, "Opening it changes nothing")
        lap.name = "Track 400 m"
        guard case .success(let renamed) = lap.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(renamed.distance_m, 400)
        XCTAssertEqual(renamed.distance, "400 m")
        lap.customAmount = "0.5"
        guard case .success(let longer) = lap.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(longer.distance, "0.5 mi")
        XCTAssertEqual(longer.distance_m ?? 0, 804.7, accuracy: 0.05)

        let textOnly = EventGoalDraft(event: PlanEvent(name: "Hill climb", date: "2027-05-01",
                                                       discipline: "running", distance: "About 7 miles"),
                                      unit: .miles)
        XCTAssertEqual(textOnly.distanceChoice, .text, "A distance saved as words is kept as it is")
        guard case .success(let kept) = textOnly.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(kept.distance, "About 7 miles")
        XCTAssertNil(kept.distance_m)
    }

    func testANewTypeKeepsOnlyItsOwnDistances() {
        var draft = EventGoalDraft(today: "2026-11-07", unit: .miles)
        draft.name = "Big day"
        draft.distanceChoice = .preset("Marathon")
        draft.setDiscipline("cycling")
        XCTAssertEqual(draft.kind, .ride)
        XCTAssertEqual(draft.distanceChoice, .noDistance)
        draft.distanceChoice = .custom
        draft.setDiscipline("swimming")
        XCTAssertEqual(draft.customUnit, .mi, "Miles are a swim unit too")
        XCTAssertEqual(draft.distanceChoice, .custom)

        draft.setDiscipline("triathlon")
        XCTAssertNil(draft.kind)
        draft.distanceLabel = "70.3"
        guard case .success(let tri) = draft.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(tri.discipline, "triathlon")
        XCTAssertEqual(tri.distance, "70.3")
        XCTAssertNil(tri.distance_m)

        draft.setDiscipline(EventGoalDraft.otherDiscipline)
        XCTAssertEqual(draft.problem, "Say what kind of event it is.")
        draft.setOtherText("Biathlon")
        guard case .success(let other) = draft.event() else { return XCTFail("The draft is valid") }
        XCTAssertEqual(other.discipline, "Biathlon")

        let saved = EventGoalDraft(event: other, unit: .miles)
        XCTAssertEqual(saved.disciplineChoice, EventGoalDraft.otherDiscipline)
        XCTAssertEqual(saved.otherText, "Biathlon")
    }

    func testTheCardReadsTheCountdownDistanceAndGoalPace() {
        let event = PlanEvent(name: "Turkey Trot 5k", date: "2026-11-26", discipline: "running",
                              distance: "5k", distance_m: 5_000, goal_time_s: 1_200)
        XCTAssertEqual(EventGoal.dateLine(event, today: "2026-11-07"), "THU, NOV 26 · 19 DAYS TO GO")
        XCTAssertEqual(EventGoal.countdown(event, today: "2026-11-25"), "Tomorrow")
        XCTAssertEqual(EventGoal.countdown(event, today: "2026-11-26"), "Today")
        XCTAssertEqual(EventGoal.countdown(event, today: "2026-11-29"), "3 days ago")
        XCTAssertEqual(EventGoal.goalPaceText(event, unit: .miles), "6:26/mi")
        XCTAssertEqual(EventGoal.goalPaceText(event, unit: .kilometers), "4:00/km")
        XCTAssertEqual(EventGoal.detailLine(event, unit: .miles), "5k · goal 20:00 · 6:26/mi")
        XCTAssertEqual(EventGoal.todayLine(event, today: "2026-11-07"), "Turkey Trot 5k in 19 days")
        XCTAssertEqual(EventGoal.todayLine(event, today: "2026-11-25"), "Turkey Trot 5k tomorrow")
        XCTAssertEqual(EventGoal.todayLine(event, today: "2026-11-26"), "Turkey Trot 5k is today")
        XCTAssertNil(EventGoal.todayLine(event, today: "2026-11-27"), "Today drops the line once it has passed")

        let ride = PlanEvent(name: "Century", date: "2027-06-01", discipline: "cycling",
                             distance: "100 miles", distance_m: 100 * EventGoal.mile, goal_time_s: 5 * 3_600)
        XCTAssertEqual(EventGoal.goalPaceText(ride, unit: .miles), "20.0 mph")
        let swim = PlanEvent(name: "Lake swim", date: "2027-07-01", discipline: "swimming",
                             distance: "1500 m", distance_m: 1_500, goal_time_s: 1_800)
        XCTAssertEqual(EventGoal.goalPaceText(swim, unit: .kilometers), "2:00/100 m")

        let bare = PlanEvent(name: "Obstacle day", date: "2027-07-01", discipline: "obstacle race")
        XCTAssertEqual(EventGoal.detailLine(bare, unit: .miles), "Obstacle race")
        XCTAssertNil(EventGoal.goalPaceText(bare, unit: .miles))
    }
}
