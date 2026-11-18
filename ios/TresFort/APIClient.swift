import Foundation

enum APIError: Error, LocalizedError {
    case http(Int, String)
    /// A transient HTTP response that asks the client not to retry before the
    /// supplied delay. Kept distinct from ordinary HTTP errors so durable
    /// workout outboxes can honor server admission/rate-limit backoff without
    /// changing the existing error-matching surface for every API caller.
    case httpWithRetryAfter(Int, String, TimeInterval)
    case decoding(String)

    static let activeWorkoutTargetsMessage = "Finish or discard the in-progress workout before changing its week targets. Other weeks remain editable. Your unfinished changes are kept."

    var errorDescription: String? {
        switch self {
        case let .http(code, body):
            if code == 400, let data = body.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               object["error"] as? String == "active_workout_targets_changed" {
                return Self.activeWorkoutTargetsMessage
            }
            return "HTTP \(code): \(body)"
        case let .httpWithRetryAfter(code, body, retryAfter):
            return "HTTP \(code): \(body) (retry after \(retryAfter)s)"
        case let .decoding(msg): return "Decode failed: \(msg)"
        }
    }

    var httpStatus: Int? {
        switch self {
        case let .http(code, _), let .httpWithRetryAfter(code, _, _): code
        case .decoding: nil
        }
    }

    var httpBody: String? {
        switch self {
        case let .http(_, body), let .httpWithRetryAfter(_, body, _): body
        case .decoding: nil
        }
    }

    var retryAfter: TimeInterval? {
        guard case let .httpWithRetryAfter(_, _, seconds) = self else {
            return nil
        }
        return seconds
    }
}

struct AccountExportFile: Equatable {
    let data: Data
    let filename: String
}

struct APIClient {
    var baseURL = Config.apiBaseURL
    var transport: URLSession? = nil

    private static var session: URLSession {
#if DEBUG && targetEnvironment(simulator)
        if LocalDevelopmentConfiguration.current != nil { return LocalDevelopmentTransport.session }
        if UIFixtureScenario.selected != nil { return UIFixtureProtocol.session }
#endif
        return .shared
    }

    /// Marks writes that carry migration-0032 attempt tokens. The compatibility
    /// Worker uses this explicit declaration to atomically claim a legacy
    /// generation; absence remains the released app's tokenless protocol.
    static func attemptProtocolHeaders(
        expectedAttempt: Int?
    ) -> [String: String] {
        guard expectedAttempt != nil else { return [:] }
        return ["X-TresFort-Write-Protocol": "attempt-v1"]
    }

    func authApple(
        identityToken: String,
        authorizationCode: String? = nil,
        fullName: String?
    ) async throws -> AuthResponse {
        // Open sign-in: identityToken (required), the short-lived Apple
        // authorization code when the native UI supplied one, and an optional
        // display name. The code is sent directly to the Worker for provider
        // revocation support and is never persisted on-device.
        // Invite redemption is NOT bundled into sign-in — invited users
        // sign in first, then redeem via POST /api/groups/join (see
        // APIClient+Groups.joinGroup).
        var body: [String: Any] = ["identityToken": identityToken]
        if let authorizationCode { body["authorizationCode"] = authorizationCode }
        if let fullName { body["fullName"] = fullName }
        return try await post("auth/apple", body: body, jwt: nil)
    }

#if DEBUG && targetEnvironment(simulator)
    func authLocal(configuration: LocalDevelopmentConfiguration) async throws -> AuthResponse {
        guard baseURL == configuration.baseURL else { throw URLError(.unsupportedURL) }
        var local = self
        local.transport = transport ?? LocalDevelopmentTransport.session
        return try await local.post("auth/dev", body: ["secret": configuration.secret], jwt: nil)
    }
#endif

    /// Roll a still-valid app JWT forward before its fixed expiry. Sign in
    /// with Apple remains the recovery path after the bearer has expired.
    func renewAppSession(jwt: String) async throws -> SessionRenewalResponse {
        try await post("auth/renew", body: [:], jwt: jwt)
    }

    func revokeAppSession(jwt: String) async throws {
        struct Receipt: Decodable { let ok: Bool }
        let receipt: Receipt = try await post("auth/logout", body: [:], jwt: jwt)
        guard receipt.ok else { throw APIError.decoding("invalid sign-out acknowledgement") }
    }

    /// Permanently delete the authenticated account. The Profile UI owns the
    /// destructive confirmation; AuthModel clears local account state only
    /// after this response is acknowledged.
    func deleteAccount(
        jwt: String,
        idempotencyKey: String
    ) async throws -> AccountDeletionResponse {
        try await delete(
            "api/me",
            jwt: jwt,
            headers: ["X-Account-Deletion-Key": idempotencyKey])
    }

    /// Owner only: create a fresh test member and return its own session.
    /// The server answers 404 to every other account.
    func createTestMember(jwt: String) async throws -> AuthResponse {
        try await post("api/me/test-member", body: [String: Any](), jwt: jwt)
    }

    /// Called with the test member's own session; removes only a test member.
    func deleteTestMember(jwt: String) async throws -> TestMemberDeletionResponse {
        try await delete("api/me/test-member", jwt: jwt)
    }

    /// Download the authenticated caller's portable account snapshot. The
    /// server chooses the attachment filename; validate that the successful
    /// response is actually JSON before offering it to the Files picker.
    func downloadAccountExport(jwt: String) async throws -> AccountExportFile {
        var req = URLRequest(
            url: URL(string: baseURL.absoluteString + "/api/me/export")!)
        req.httpMethod = "GET"
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        let (data, response) = try await Self.session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(-1, "missing HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(
                http.statusCode,
                String(data: data, encoding: .utf8) ?? "")
        }
        guard
            http.value(forHTTPHeaderField: "Content-Type")?
                .lowercased().hasPrefix("application/json") == true
        else {
            throw APIError.decoding("account export was not JSON")
        }
        do {
            let value = try JSONSerialization.jsonObject(with: data)
            guard value is [String: Any] else {
                throw APIError.decoding("account export was not a JSON object")
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.decoding("account export was invalid JSON: \(error)")
        }
        return AccountExportFile(
            data: data,
            filename: response.suggestedFilename
                ?? "tres-fort-account-export.json")
    }

    /// Compatibility full reload used by older test doubles and callers that
    /// do not yet own an account-scoped snapshot.
    func getState(jwt: String) async throws -> StateResponse {
        try await getState(jwt: jwt, watermarks: .fullReload)
    }

    /// The single incremental sync pull. Every cursor is explicit, including
    /// `log_since` for the user-authored activity log; zero means full reload
    /// for that collection. Watermarks come only from a previously committed
    /// server response, never from the device clock or a row's client-authored
    /// `logged_at`.
    func getState(
        jwt: String,
        watermarks: StateSyncWatermarks
    ) async throws -> StateResponse {
        try await get(
            "api/state?since=\(watermarks.planVersion)"
                + "&sets_since=\(watermarks.setsSince)"
                + "&events_since=\(watermarks.eventsSince)"
                + "&activities_since=\(watermarks.activitiesSince)"
                + "&log_since=\(watermarks.logSince)",
            jwt: jwt)
    }

    func getExercises(jwt: String) async throws -> [ExerciseCatalog] {
        try await get("api/exercises", jwt: jwt)
    }

    /// `workout_id` is an OPTIONAL field of the existing
    /// `POST /api/sessions` contract (not a new endpoint) — passing it lets
    /// the calendar/agenda resolve the one-off session as the right workout.
    func createSession(date: String, workoutID: String? = nil,
                       jwt: String) async throws -> SessionRow {
        try await createSession(
            date: date,
            workoutID: workoutID,
            expectedAttempt: nil,
            restartDiscardedAttempt: nil,
            jwt: jwt)
    }

    /// A discarded date is revived only when the runner persisted explicit
    /// user restart provenance. The prior attempt is a compare-and-swap token:
    /// a commit-then-timeout retry returns the same next generation, while a
    /// delayed request can never revive a later discard.
    func createSession(
        date: String,
        workoutID: String? = nil,
        expectedAttempt: Int?,
        restartDiscardedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        try await createSession(date: date, slot: 0, workoutID: workoutID,
                                expectedAttempt: expectedAttempt, restartDiscardedAttempt: restartDiscardedAttempt, jwt: jwt)
    }

    func createSession(
        date: String,
        slot: Int,
        workoutID: String? = nil,
        expectedAttempt: Int?,
        restartDiscardedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        var body: [String: Any] = ["date": date, "slot": slot]
        if let workoutID { body["workout_id"] = workoutID }
        if let restartDiscardedAttempt {
            body["restart_discarded"] = true
            body["expected_attempt"] = restartDiscardedAttempt
        } else if let expectedAttempt {
            body["expected_attempt"] = expectedAttempt
        }
        return try await post(
            "api/sessions",
            body: body,
            jwt: jwt,
            headers: Self.attemptProtocolHeaders(
                expectedAttempt: restartDiscardedAttempt ?? expectedAttempt))
    }

    func createAdditionalSession(id: String, date: String, workoutID: String?, freestyle: Bool,
                                 jwt: String) async throws -> SessionRow {
        var body: [String: Any] = ["id": id, "date": date, "additional": true,
                                  "expected_attempt": 0, "kind": freestyle ? "freestyle" : "planned"]
        if let workoutID { body["workout_id"] = workoutID }
        return try await post("api/sessions", body: body, jwt: jwt,
                              headers: Self.attemptProtocolHeaders(expectedAttempt: 0))
    }

    /// Idempotent on the immutable body's `id`. The typed body prevents a
    /// retry from accidentally minting a new UUID or tap timestamp.
    func logSet(
        sessionId: String,
        body: SetRequestBody,
        jwt: String
    ) async throws -> SetLogResult {
        try await post("api/sessions/\(sessionId)/sets", body: body, jwt: jwt)
    }

    func logSet(
        sessionId: String,
        body: SetRequestBody,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SetLogResult {
        try await post(
            "api/sessions/\(sessionId)/sets",
            body: body.scoped(to: expectedAttempt),
            jwt: jwt,
            headers: Self.attemptProtocolHeaders(
                expectedAttempt: expectedAttempt))
    }

    struct SetLogResult: Decodable {
        let set: SetLog
        let deduped: Bool
        /// Canonical session observed in the same D1 batch/read as the set
        /// acknowledgement. Optional only for rolling compatibility with an
        /// older Worker; the client never infers a terminal-sensitive status
        /// when it is absent.
        let session: SessionRow?

        init(set: SetLog, deduped: Bool, session: SessionRow? = nil) {
            self.set = set
            self.deduped = deduped
            self.session = session
        }
    }

    func completeSession(sessionId: String, jwt: String) async throws -> SessionRow {
        try await patch("api/sessions/\(sessionId)", body: ["status": "completed"], jwt: jwt)
    }

    /// Explicitly reopen a skipped/rest override. The Worker advances the
    /// reused date row's attempt, so delayed writes from the prior skipped
    /// generation cannot join this newly started workout.
    func reopenSkippedSession(
        sessionId: String,
        workoutID: String?,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        var body: [String: Any] = ["status": "planned"]
        if let workoutID { body["workout_id"] = workoutID }
        return try await patch(
            attemptScopedPath(
                "api/sessions/\(sessionId)", expectedAttempt: expectedAttempt),
            body: body,
            jwt: jwt,
            headers: Self.attemptProtocolHeaders(
                expectedAttempt: expectedAttempt))
    }

    func completeSession(
        sessionId: String,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        try await patch(
            attemptScopedPath(
                "api/sessions/\(sessionId)", expectedAttempt: expectedAttempt),
            body: ["status": "completed"],
            jwt: jwt,
            headers: Self.attemptProtocolHeaders(
                expectedAttempt: expectedAttempt))
    }

    func updateCompletedWorkoutFeedback(_ request: CompletedWorkoutFeedbackRequest, jwt: String) async throws -> SessionRow {
        try await patch("api/sessions/\(request.target.sessionID)/feedback", body: request.body, jwt: jwt,
                        headers: Self.attemptProtocolHeaders(expectedAttempt: request.target.attempt))
    }

    func completeSession(
        sessionId: String, expectedAttempt: Int?, feedback: WorkoutFeedback?, jwt: String
    ) async throws -> SessionRow {
        try await patch(attemptScopedPath("api/sessions/\(sessionId)", expectedAttempt: expectedAttempt),
                        body: feedback?.finishBody ?? ["status": "completed"], jwt: jwt,
                        headers: Self.attemptProtocolHeaders(expectedAttempt: expectedAttempt))
    }

    /// Discard a session — "I didn't really do this." Soft-deletes its sets
    /// and marks it discarded server-side (vanishes from the projection).
    /// Restarting the same day resurrects a fresh planned session.
    func discardSession(sessionId: String, jwt: String) async throws -> SessionRow {
        try await post("api/sessions/\(sessionId)/discard", body: [:], jwt: jwt)
    }

    func discardSession(
        sessionId: String,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        try await post(
            attemptScopedPath(
                "api/sessions/\(sessionId)/discard",
                expectedAttempt: expectedAttempt),
            body: [:],
            jwt: jwt,
            headers: Self.attemptProtocolHeaders(
                expectedAttempt: expectedAttempt))
    }

    private func attemptScopedPath(
        _ path: String,
        expectedAttempt: Int?
    ) -> String {
        guard let expectedAttempt else { return path }
        return "\(path)?expected_attempt=\(expectedAttempt)"
    }

    struct EmptyResponse: Decodable {}
    func deleteSet(setId: String, jwt: String) async throws {
        let _: SetLog = try await patch("api/sets/\(setId)", body: ["deleted": true], jwt: jwt)
    }

    func getWorkoutSummary(sessionID: String, jwt: String) async throws -> WorkoutSummary {
        try await get("api/sessions/\(sessionID)/summary", jwt: jwt)
    }

    func correctSet(_ intent: PendingSetCorrection, jwt: String) async throws -> SetCorrectionResult {
        guard let body = intent.requestBody else {
            throw APIError.decoding("Correction identity has not been resolved")
        }
        return try await patch("api/sets/\(intent.setID)", body: body, jwt: jwt)
    }

    // MARK: - in-app plan editing
    //
    // Add / edit / remove an exercise slot in the active plan's day template.
    // Thin wrappers over the REST editor endpoints (POST/PATCH/DELETE
    // /api/workouts/:dayId/exercises[/:teId]) — the app-side counterpart to the
    // MCP add_exercise / update_exercise / delete_exercise tools. The caller
    // reloads /api/state afterwards, so these return just the slot id.

    /// Minimal decode of an edited slot row (the response carries the full
    /// template_exercises row; the caller only needs the id and reloads).
    struct SlotIDRow: Decodable { let id: String }
    struct PlanSummaryRow: Decodable {
        let id: String
        let name: String
        let version: Int
    }
    struct EnsureActivePlanResult: Decodable {
        let plan: PlanSummaryRow
        let created: Bool
    }
    struct WorkoutIDRow: Decodable { let id: String }
    struct DeleteWorkoutResult: Decodable {
        let ok: Bool
        let version: Int
    }
    struct ScheduleWriteResult: Decodable {
        let ok: Bool
        let version: Int
        let schedule: PlanSchedule
    }
    struct CalendarWriteResult: Decodable {
        let ok: Bool
        let session: SessionRow
    }
    struct TripWriteResult: Decodable {
        let ok: Bool
        let version: Int
    }
    /// `PUT`/`DELETE /api/plan/program`: the new plan version.
    struct ProgramWriteResult: Decodable {
        let ok: Bool
        let version: Int
    }
    /// `POST /api/plan/program/build` ("Train for an event"): the weeks the
    /// rules lay out, and the new plan version when it was saved.
    struct EventBuildResult: Decodable {
        let ok: Bool
        let preview: EventBuildPreview
        let version: Int?
    }
    struct CalendarMoveRequest: Equatable {
        let id: String
        let fromDate: String
        let toDate: String
        let today: String
        let workoutID: String
        let planID: String
        let planVersion: Int
        let fromAttempt: Int
        let toAttempt: Int
    }
    struct CalendarMoveResult: Decodable {
        let ok: Bool
        let from: SessionRow
        let to: SessionRow
    }
    struct RestorePlanResult: Decodable {
        let ok: Bool
        let plan_id: String
        let restored_from_version: Int
        let version: Int
    }

    struct ExerciseGroupAcknowledgement: Decodable {
        let ok: Bool
        let plan_id: String
        let version: Int
        let group_id: String
        let day_id: String?
        let members: [String]
        let round_rest: Int?
        let transition_rest: Int?
        let target_sets: Int?
        let cleared: Bool
        var unchanged: Bool? = nil
        var replayed: Bool? = nil
    }

    /// Keep the caller's group UUID and expected version unchanged on retries;
    /// the server recognizes the original acknowledgement before stale checks.
    func setExerciseGroup(
        dayID: String, groupID: String, memberIDs: [String],
        expectedVersion: Int, roundRest: Int, transitionRest: Int,
        targetSets: Int, orderIndex: Int?, jwt: String
    ) async throws -> ExerciseGroupAcknowledgement {
        var body: [String: Any] = [
            "group_id": groupID, "exercises": memberIDs,
            "expected_version": expectedVersion, "round_rest": roundRest,
            "transition_rest": transitionRest, "target_sets": targetSets,
        ]
        if let orderIndex { body["order_index"] = orderIndex }
        return try await put("api/workouts/\(dayID)/groups", body: body, jwt: jwt)
    }

    func clearExerciseGroup(
        dayID: String, groupID: String, expectedVersion: Int, jwt: String
    ) async throws -> ExerciseGroupAcknowledgement {
        try await put("api/workouts/\(dayID)/groups", body: [
            "group_id": groupID, "exercises": [String](),
            "expected_version": expectedVersion,
        ], jwt: jwt)
    }

    func getPlanHistory(limit: Int, beforeVersion: Int?, jwt: String) async throws -> PlanHistoryResponse {
        var path = "api/plan/history?limit=\(limit)"
        if let beforeVersion { path += "&before_version=\(beforeVersion)" }
        return try await get(path, jwt: jwt)
    }

    func comparePlanVersion(_ version: Int, toVersion: Int, jwt: String) async throws
        -> PlanComparisonResponse
    {
        try await get("api/plan/history/\(version)/compare?to_version=\(toVersion)", jwt: jwt)
    }

    func restorePlanVersion(
        _ version: Int,
        expectedPlanID: String,
        expectedVersion: Int,
        reason: String?,
        jwt: String
    ) async throws -> RestorePlanResult {
        var body: [String: Any] = [
            "expected_plan_id": expectedPlanID,
            "expected_version": expectedVersion,
        ]
        if let reason { body["reason"] = reason }
        return try await post("api/plan/history/\(version)/restore", body: body, jwt: jwt)
    }

    func ensureActivePlan(name: String, jwt: String) async throws
        -> EnsureActivePlanResult
    {
        try await put("api/plan/active", body: ["name": name], jwt: jwt)
    }

    @discardableResult
    func addWorkout(
        name: String,
        exerciseIDs: [String],
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws
        -> WorkoutIDRow
    {
        var body: [String: Any] = [
            "name": name, "expected_plan_id": expectedPlanID, "expected_version": expectedVersion,
        ]
        if !exerciseIDs.isEmpty { body["exercise_ids"] = exerciseIDs }
        return try await post(
            "api/workouts",
            body: body,
            jwt: jwt)
    }

    /// Create the reviewed targets and groups together. Explicit nulls match
    /// the shared prescription contract, including the planless first write.
    func createPrescribedWorkout(request: WorkoutPrescriptionRequest, jwt: String) async throws
        -> WorkoutPrescriptionReceipt
    {
        let data = try JSONEncoder().encode(request)
        var body = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        if request.expected_plan_id == nil { body["expected_plan_id"] = NSNull() }
        if var slots = body["slots"] as? [[String: Any]] {
            for index in slots.indices where slots[index]["progression"] == nil {
                slots[index]["progression"] = NSNull()
            }
            body["slots"] = slots
        }
        return try await post("api/workouts/prescribed", body: body, jwt: jwt)
    }

    /// A one-time workout (docs/plans/workout-library P3), made for `date`
    /// only: a copy of `copyFrom` as it reads that date, or new with
    /// `exerciseIDs` (none for an activity such as soccer); the server takes
    /// one or the other. `id` is the client's UUID, so a retry returns the
    /// workout the first try made.
    @discardableResult
    func addOneTimeWorkout(
        id: String,
        name: String,
        date: String,
        copyFrom: String?,
        exerciseIDs: [String],
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws -> WorkoutIDRow {
        var body: [String: Any] = [
            "id": id, "name": name, "one_time_date": date,
            "expected_plan_id": expectedPlanID, "expected_version": expectedVersion,
        ]
        if let copyFrom { body["copy_from"] = copyFrom }
        if copyFrom == nil, !exerciseIDs.isEmpty { body["exercise_ids"] = exerciseIDs }
        return try await post("api/workouts", body: body, jwt: jwt)
    }

    @discardableResult
    func updateWorkout(
        dayID: String,
        fields: [String: Any],
        expectedVersion: Int,
        jwt: String
    ) async throws -> WorkoutIDRow {
        var body = fields
        body["expected_version"] = expectedVersion
        return try await patch("api/workouts/\(dayID)", body: body, jwt: jwt)
    }

    func deleteWorkout(dayID: String, expectedVersion: Int, jwt: String) async throws
        -> DeleteWorkoutResult
    {
        try await delete(
            "api/workouts/\(dayID)?expected_version=\(expectedVersion)", jwt: jwt)
    }

    /// `extras` replaces every weekday's activities besides its main workout;
    /// nil leaves them out of the request, so the saved ones stay.
    func setSchedule(
        _ week: [String: String],
        extras: [String: [String]]?,
        times: [String: [String: String]]?,
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws -> ScheduleWriteResult {
        var wireWeek: [String: Any] = [:]
        for key in PlanSchedule.weekdayKeys {
            let value = week[key] ?? ""
            if value.isEmpty {
                wireWeek[key] = NSNull()
            } else {
                wireWeek[key] = value
            }
        }
        var body: [String: Any] = [
            "week": wireWeek,
            "expected_plan_id": expectedPlanID,
            "expected_version": expectedVersion,
        ]
        if let extras {
            body["extras"] = extras.filter { PlanSchedule.weekdayKeys.contains($0.key) && !$0.value.isEmpty }
        }
        // Omitted, the server keeps the saved times; sent, it replaces them.
        if let times {
            body["times"] = times.filter { PlanSchedule.weekdayKeys.contains($0.key) && !$0.value.isEmpty }
        }
        return try await put("api/plan/schedule", body: body, jwt: jwt)
    }

    /// Replaces the plan's block of weeks (`program` is the wire body from
    /// `ProgramEditing.wire`), or ends it with nil.
    func setProgram(_ program: [String: Any]?, expectedVersion: Int, jwt: String) async throws
        -> ProgramWriteResult
    {
        try await setProgram(program, schedule: nil, expectedVersion: expectedVersion, jwt: jwt)
    }

    /// The same, with the repeating week (`{week, extras}`) saved in the same
    /// plan version: a workout that becomes the block's own leaves it.
    func setProgram(_ program: [String: Any]?, schedule: [String: Any]?, expectedVersion: Int,
                    jwt: String) async throws -> ProgramWriteResult
    {
        guard let program else {
            return try await delete("api/plan/program?expected_version=\(expectedVersion)", jwt: jwt)
        }
        var body: [String: Any] = ["program": program, "expected_version": expectedVersion]
        if let schedule { body["schedule"] = schedule }
        return try await put("api/plan/program", body: body, jwt: jwt)
    }

    /// Lays out a block of weeks to an event by the server's fixed rules
    /// (`EventBuildRequest.body`). Saves the event and the block together
    /// when `expectedVersion` is given; otherwise only previews.
    func buildEventBlock(_ body: [String: Any], expectedVersion: Int?, jwt: String) async throws
        -> EventBuildResult
    {
        var body = body
        if let expectedVersion {
            body["save"] = true
            body["expected_version"] = expectedVersion
        }
        return try await post("api/plan/program/build", body: body, jwt: jwt)
    }

    func addTrip(fields: [String: Any], expectedVersion: Int, jwt: String) async throws
        -> TripWriteResult
    {
        var body = fields
        body["expected_version"] = expectedVersion
        return try await post("api/plan/trips", body: body, jwt: jwt)
    }

    func updateTrip(id: String, fields: [String: Any], expectedVersion: Int, jwt: String)
        async throws -> TripWriteResult
    {
        var body = fields
        body["expected_version"] = expectedVersion
        return try await patch("api/plan/trips/\(id)", body: body, jwt: jwt)
    }

    func removeTrip(id: String, expectedVersion: Int, jwt: String) async throws -> TripWriteResult {
        try await delete("api/plan/trips/\(id)?expected_version=\(expectedVersion)", jwt: jwt)
    }

    func setCalendarDate(
        _ date: String,
        dayID: String?,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> CalendarWriteResult {
        var body: [String: Any] = [:]
        if let dayID {
            body["workout_id"] = dayID
        } else {
            body["workout_id"] = NSNull()
        }
        if let expectedAttempt { body["expected_attempt"] = expectedAttempt }
        return try await put("api/calendar/\(date)", body: body, jwt: jwt)
    }

    func moveCalendarWorkout(_ request: CalendarMoveRequest, jwt: String) async throws -> CalendarMoveResult {
        try await post("api/calendar/\(request.fromDate)/move", body: [
            "id": request.id, "to_date": request.toDate, "today": request.today,
            "workout_id": request.workoutID, "expected_plan_id": request.planID,
            "expected_version": request.planVersion, "expected_from_attempt": request.fromAttempt,
            "expected_to_attempt": request.toAttempt,
        ], jwt: jwt)
    }

    @discardableResult
    func addExercise(dayID: String, exercise: String, isWarmup: Bool,
                     targetSets: Int, targetReps: Int, targetRepsMax: Int?,
                     restSeconds: Int,
                     targetDurationS: Int?, load: [String: Any],
                     expectedVersion: Int, jwt: String) async throws -> SlotIDRow {
        // Target weight, its unit and RPE, only when the member set them.
        var body: [String: Any] = load
        body.merge([
            "exercise": exercise,
            "expected_version": expectedVersion,
            "target_sets": targetSets,
            "target_reps": targetReps,
            "rest_seconds": restSeconds,
            "is_warmup": isWarmup,
        ]) { _, prescription in prescription }
        if let targetRepsMax { body["target_reps_max"] = targetRepsMax }
        if let targetDurationS { body["target_duration_s"] = targetDurationS }
        return try await post("api/workouts/\(dayID)/exercises", body: body, jwt: jwt)
    }

    @discardableResult
    func updateExerciseSlot(dayID: String, teID: String,
                            fields: [String: Any], expectedVersion: Int, jwt: String) async throws -> SlotIDRow {
        var body = fields
        body["expected_version"] = expectedVersion
        return try await patch("api/workouts/\(dayID)/exercises/\(teID)", body: body, jwt: jwt)
    }

    func deleteExerciseSlot(dayID: String, teID: String, expectedVersion: Int, jwt: String) async throws {
        let _: SlotIDRow = try await delete("api/workouts/\(dayID)/exercises/\(teID)?expected_version=\(expectedVersion)", jwt: jwt)
    }

    func replaceExerciseSlot(dayID: String, teID: String, exercise: String,
                             targets: [String: Any]? = nil,
                             expectedVersion: Int, jwt: String) async throws -> SlotIDRow {
        var body: [String: Any] = [
            "to_exercise": exercise, "expected_version": expectedVersion,
        ]
        if let targets { body["targets"] = targets }
        return try await post("api/workouts/\(dayID)/exercises/\(teID)/swap", body: body, jwt: jwt)
    }

    // MARK: - transport
    //
    // INTERNAL (not private) so extension files (APIClient+Groups.swift,
    // etc.) can add new endpoint methods without re-implementing the
    // URLSession + JWT + JSON plumbing.

    func get<T: Decodable>(_ path: String, jwt: String) async throws -> T {
        // Build the URL by string so query strings aren't percent-escaped.
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "GET"
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        return try await send(req)
    }

    func post<T: Decodable>(
        _ path: String,
        body: [String: Any],
        jwt: String?,
        headers: [String: String] = [:]
    ) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        for (field, value) in headers {
            req.setValue(value, forHTTPHeaderField: field)
        }
        // NSNull must round-trip as JSON `null` — some POST endpoints
        // distinguish `null` from an omitted key (POST /groups/:id/invites
        // treats `expires_at: null` as "never expires" but `expires_at`
        // absent as "default 30d"). Call sites that want to OMIT a field
        // build the dict conditionally (see e.g. createSession), so
        // dropping NSNull here would silently re-map the explicit-null
        // contract to the default-value path.
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req)
    }

    func put<T: Decodable>(
        _ path: String,
        body: [String: Any],
        jwt: String
    ) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req)
    }

    /// Typed JSON-body variant used by the durable set writer. Keep this
    /// overload narrow: other endpoints intentionally retain their existing
    /// dictionary construction for explicit-null/omitted-field semantics.
    func post<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        jwt: String?,
        headers: [String: String] = [:]
    ) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let jwt { req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization") }
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        for (field, value) in headers {
            req.setValue(value, forHTTPHeaderField: field)
        }
        req.httpBody = try JSONEncoder().encode(body)
        return try await send(req)
    }

    func patch<T: Decodable>(
        _ path: String,
        body: [String: Any],
        jwt: String,
        headers: [String: String] = [:]
    ) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        for (field, value) in headers {
            req.setValue(value, forHTTPHeaderField: field)
        }
        // No NSNull stripping here — PATCH bodies need to send explicit
        // `null` (e.g. the intervals.icu disconnect path sends both fields
        // null to clear credentials). JSONSerialization writes Swift's
        // NSNull as JSON null.
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req)
    }

    /// DELETE with no request body. Decodes the JSON response into T (the
    /// backend mostly returns `{ok: true}` for deletes; use `EmptyResponse`
    /// when you don't care about the body).
    func delete<T: Decodable>(
        _ path: String,
        jwt: String,
        headers: [String: String] = [:]
    ) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/" + path)!)
        req.httpMethod = "DELETE"
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Device-TZ")
        for (field, value) in headers {
            req.setValue(value, forHTTPHeaderField: field)
        }
        return try await send(req)
    }

    func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        var req = req
        // Covers every plan-bearing read, including restore responses, so a
        // grouped slot always retains its ordinary rest alongside group rests.
        req.setValue("groups", forHTTPHeaderField: "X-TresFort-Capabilities")
        let (data, resp) = try await (transport ?? Self.session).data(for: req)
        let http = resp as? HTTPURLResponse
        let code = http?.statusCode ?? -1
        guard (200..<300).contains(code) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            if [429, 503].contains(code),
               let raw = http?.value(forHTTPHeaderField: "Retry-After"),
               let seconds = TimeInterval(raw.trimmingCharacters(in: .whitespaces)),
               seconds >= 0
            {
                throw APIError.httpWithRetryAfter(code, body, seconds)
            }
            throw APIError.http(code, body)
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding("\(error)") }
    }
}

/// Narrow auth surface injected into AuthModel so expiry, offline renewal,
/// and same-user recovery are covered without real Apple/network calls.
protocol AuthAPI {
#if DEBUG && targetEnvironment(simulator)
    func authLocal(configuration: LocalDevelopmentConfiguration) async throws -> AuthResponse
#endif
    func authApple(
        identityToken: String,
        authorizationCode: String?,
        fullName: String?
    ) async throws -> AuthResponse
    func renewAppSession(jwt: String) async throws -> SessionRenewalResponse
    func revokeAppSession(jwt: String) async throws
    func deleteAccount(
        jwt: String,
        idempotencyKey: String
    ) async throws -> AccountDeletionResponse
    func downloadAccountExport(jwt: String) async throws -> AccountExportFile
    func createTestMember(jwt: String) async throws -> AuthResponse
    func deleteTestMember(jwt: String) async throws -> TestMemberDeletionResponse
}

extension AuthAPI {
#if DEBUG && targetEnvironment(simulator)
    func authLocal(configuration: LocalDevelopmentConfiguration) async throws -> AuthResponse {
        throw URLError(.unsupportedURL)
    }
#endif
    func createTestMember(jwt: String) async throws -> AuthResponse {
        throw APIError.http(404, "not_found")
    }
    func deleteTestMember(jwt: String) async throws -> TestMemberDeletionResponse {
        throw APIError.http(404, "not_found")
    }
}

extension APIClient: AuthAPI {}

extension AuthAPI {
    // Existing test doubles fail closed unless they explicitly model revocation.
    func revokeAppSession(jwt: String) async throws { throw URLError(.unsupportedURL) }
}

/// Only the calls required to settle a set intent and the shared state-sync
/// pull are injectable. The rest of SyncModel continues using APIClient
/// directly, avoiding a broad sync abstraction while making persistence,
/// retry identity, and response-ordering deterministic in model tests.
@MainActor
protocol SetWriteAPI {
    func createSession(date: String, slot: Int, workoutID: String?, expectedAttempt: Int?,
                       restartDiscardedAttempt: Int?, jwt: String) async throws -> SessionRow
    func createAdditionalSession(id: String, date: String, workoutID: String?, freestyle: Bool,
                                 jwt: String) async throws -> SessionRow

    func createSession(
        date: String,
        workoutID: String?,
        jwt: String
    ) async throws -> SessionRow
    func createSession(
        date: String,
        workoutID: String?,
        expectedAttempt: Int?,
        restartDiscardedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow
    func logSet(
        sessionId: String,
        body: SetRequestBody,
        jwt: String
    ) async throws -> APIClient.SetLogResult
    func reopenSkippedSession(
        sessionId: String,
        workoutID: String?,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow
    func logSet(
        sessionId: String,
        body: SetRequestBody,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> APIClient.SetLogResult
    func deleteSet(setId: String, jwt: String) async throws
    func correctSet(_ intent: PendingSetCorrection, jwt: String) async throws -> SetCorrectionResult
    func getWorkoutSummary(sessionID: String, jwt: String) async throws -> WorkoutSummary
    func getState(jwt: String) async throws -> StateResponse
    func getState(
        jwt: String,
        watermarks: StateSyncWatermarks
    ) async throws -> StateResponse
}

extension SetWriteAPI {
    func createSession(date: String, slot: Int, workoutID: String?, expectedAttempt: Int?,
                       restartDiscardedAttempt: Int?, jwt: String) async throws -> SessionRow {
        guard slot == 0 else { throw APIError.decoding("Session slot is unavailable") }
        return try await createSession(date: date, workoutID: workoutID, expectedAttempt: expectedAttempt,
                                       restartDiscardedAttempt: restartDiscardedAttempt, jwt: jwt)
    }
    func createAdditionalSession(id: String, date: String, workoutID: String?, freestyle: Bool,
                                 jwt: String) async throws -> SessionRow {
        throw APIError.decoding("Additional workouts are unavailable")
    }

    func getWorkoutSummary(sessionID: String, jwt: String) async throws -> WorkoutSummary {
        throw APIError.decoding("Completion summary is unavailable")
    }

    func correctSet(_ intent: PendingSetCorrection, jwt: String) async throws -> SetCorrectionResult {
        throw APIError.decoding("Set correction is unavailable")
    }

    /// Compatibility bridge for focused write-test doubles. Production's
    /// APIClient overrides this requirement and sends every cursor; a legacy
    /// double that only models complete responses can keep implementing
    /// getState.
    func getState(
        jwt: String,
        watermarks: StateSyncWatermarks
    ) async throws -> StateResponse {
        try await getState(jwt: jwt)
    }

    func createSession(
        date: String,
        workoutID: String?,
        expectedAttempt: Int?,
        restartDiscardedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        try await createSession(
            date: date, workoutID: workoutID, jwt: jwt)
    }

    func logSet(
        sessionId: String,
        body: SetRequestBody,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> APIClient.SetLogResult {
        try await logSet(
            sessionId: sessionId,
            body: body.scoped(to: expectedAttempt),
            jwt: jwt)
    }

    func reopenSkippedSession(
        sessionId: String,
        workoutID: String?,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        throw APIError.decoding("Skipped-session reopen is unavailable")
    }
}

extension APIClient: SetWriteAPI {}

@MainActor
protocol ExerciseCatalogAPI {
    func getExercises(jwt: String) async throws -> [ExerciseCatalog]
}

extension APIClient: ExerciseCatalogAPI {}

/// Narrow plan-editor seam so delayed mutation callbacks can be proven across
/// feature-session replacement without exercising URLSession in unit tests.
@MainActor
protocol PlanEditingAPI {
    func setExerciseGroup(
        dayID: String, groupID: String, memberIDs: [String],
        expectedVersion: Int, roundRest: Int, transitionRest: Int,
        targetSets: Int, orderIndex: Int?, jwt: String
    ) async throws -> APIClient.ExerciseGroupAcknowledgement
    func clearExerciseGroup(
        dayID: String, groupID: String, expectedVersion: Int, jwt: String
    ) async throws -> APIClient.ExerciseGroupAcknowledgement
    func replaceExerciseSlot(
        dayID: String, teID: String, exercise: String,
        targets: [String: Any]?,
        expectedVersion: Int, jwt: String
    ) async throws -> APIClient.SlotIDRow
    func addExercise(
        dayID: String,
        exercise: String,
        isWarmup: Bool,
        targetSets: Int,
        targetReps: Int,
        targetRepsMax: Int?,
        restSeconds: Int,
        targetDurationS: Int?,
        load: [String: Any],
        expectedVersion: Int, jwt: String
    ) async throws -> APIClient.SlotIDRow
    func updateExerciseSlot(
        dayID: String,
        teID: String,
        fields: [String: Any],
        expectedVersion: Int, jwt: String
    ) async throws -> APIClient.SlotIDRow
    func deleteExerciseSlot(
        dayID: String,
        teID: String,
        expectedVersion: Int, jwt: String
    ) async throws
}

extension APIClient: PlanEditingAPI {}

/// Manual routine and calendar editing are separate from the gym-floor slot
/// seam so their conflict/reload behavior can be tested without networking.
@MainActor
protocol RoutineEditingAPI {
    func getPlanHistory(limit: Int, beforeVersion: Int?, jwt: String) async throws -> PlanHistoryResponse
    func comparePlanVersion(_ version: Int, toVersion: Int, jwt: String) async throws
        -> PlanComparisonResponse
    func restorePlanVersion(
        _ version: Int, expectedPlanID: String, expectedVersion: Int,
        reason: String?, jwt: String
    ) async throws -> APIClient.RestorePlanResult
    func ensureActivePlan(name: String, jwt: String) async throws
        -> APIClient.EnsureActivePlanResult
    func addWorkout(
        name: String,
        exerciseIDs: [String],
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws
        -> APIClient.WorkoutIDRow
    func createPrescribedWorkout(request: WorkoutPrescriptionRequest, jwt: String) async throws
        -> WorkoutPrescriptionReceipt
    func updateWorkout(
        dayID: String,
        fields: [String: Any],
        expectedVersion: Int,
        jwt: String
    ) async throws -> APIClient.WorkoutIDRow
    func addOneTimeWorkout(
        id: String,
        name: String,
        date: String,
        copyFrom: String?,
        exerciseIDs: [String],
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws -> APIClient.WorkoutIDRow
    func deleteWorkout(dayID: String, expectedVersion: Int, jwt: String) async throws
        -> APIClient.DeleteWorkoutResult
    func setSchedule(
        _ week: [String: String],
        extras: [String: [String]]?,
        times: [String: [String: String]]?,
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws -> APIClient.ScheduleWriteResult
    func setCalendarDate(
        _ date: String,
        dayID: String?,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> APIClient.CalendarWriteResult
    func moveCalendarWorkout(_ request: APIClient.CalendarMoveRequest, jwt: String) async throws -> APIClient.CalendarMoveResult
    func addTrip(fields: [String: Any], expectedVersion: Int, jwt: String) async throws
        -> APIClient.TripWriteResult
    func updateTrip(id: String, fields: [String: Any], expectedVersion: Int, jwt: String)
        async throws -> APIClient.TripWriteResult
    func removeTrip(id: String, expectedVersion: Int, jwt: String) async throws
        -> APIClient.TripWriteResult
    func setProgram(_ program: [String: Any]?, expectedVersion: Int, jwt: String) async throws
        -> APIClient.ProgramWriteResult
    func setProgram(_ program: [String: Any]?, schedule: [String: Any]?, expectedVersion: Int,
                    jwt: String) async throws -> APIClient.ProgramWriteResult
    func buildEventBlock(_ body: [String: Any], expectedVersion: Int?, jwt: String) async throws
        -> APIClient.EventBuildResult

}

extension APIClient: RoutineEditingAPI {}

extension RoutineEditingAPI {
    func createPrescribedWorkout(request: WorkoutPrescriptionRequest, jwt: String) async throws
        -> WorkoutPrescriptionReceipt
    {
        throw APIError.http(501, "prescribed_workouts_unavailable")
    }

    func addOneTimeWorkout(
        id: String,
        name: String,
        date: String,
        copyFrom: String?,
        exerciseIDs: [String],
        expectedPlanID: String,
        expectedVersion: Int,
        jwt: String
    ) async throws -> APIClient.WorkoutIDRow {
        throw APIError.http(501, "one_time_workouts_unavailable")
    }

    func moveCalendarWorkout(_ request: APIClient.CalendarMoveRequest, jwt: String) async throws -> APIClient.CalendarMoveResult {
        throw APIError.http(501, "calendar_move_unavailable")
    }

    func addTrip(fields: [String: Any], expectedVersion: Int, jwt: String) async throws
        -> APIClient.TripWriteResult
    {
        throw APIError.http(501, "away_dates_unavailable")
    }

    func updateTrip(id: String, fields: [String: Any], expectedVersion: Int, jwt: String)
        async throws -> APIClient.TripWriteResult
    {
        throw APIError.http(501, "away_dates_unavailable")
    }

    func removeTrip(id: String, expectedVersion: Int, jwt: String) async throws
        -> APIClient.TripWriteResult
    {
        throw APIError.http(501, "away_dates_unavailable")
    }

    func setProgram(_ program: [String: Any]?, expectedVersion: Int, jwt: String) async throws
        -> APIClient.ProgramWriteResult
    {
        throw APIError.http(501, "program_unavailable")
    }

    /// A double that predates the schedule beside a block takes the
    /// block alone; one that would also change the repeating week can't.
    func setProgram(_ program: [String: Any]?, schedule: [String: Any]?, expectedVersion: Int,
                    jwt: String) async throws -> APIClient.ProgramWriteResult
    {
        guard schedule == nil else { throw APIError.http(501, "program_schedule_unavailable") }
        return try await setProgram(program, expectedVersion: expectedVersion, jwt: jwt)
    }

    func buildEventBlock(_ body: [String: Any], expectedVersion: Int?, jwt: String) async throws
        -> APIClient.EventBuildResult
    {
        throw APIError.http(501, "event_build_unavailable")
    }
}

/// Narrow terminal-session seam used only to prove the P0 exclusion between
/// destructive/completing session mutations and new set persistence.
@MainActor
protocol WorkoutTerminalAPI {
    func completeSession(sessionId: String, expectedAttempt: Int?, feedback: WorkoutFeedback?, jwt: String) async throws -> SessionRow
    func completeSession(sessionId: String, jwt: String) async throws -> SessionRow
    func discardSession(sessionId: String, jwt: String) async throws -> SessionRow
    func completeSession(
        sessionId: String,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow
    func discardSession(
        sessionId: String,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow
}

extension WorkoutTerminalAPI {
    func completeSession(sessionId: String, expectedAttempt: Int?, feedback: WorkoutFeedback?, jwt: String) async throws -> SessionRow {
        // Legacy test/provider adapters may complete only feedback-free choices.
        guard feedback == nil || feedback?.isEmpty == true else {
            throw APIError.decoding("Terminal adapter does not support workout feedback")
        }
        return try await completeSession(sessionId: sessionId, expectedAttempt: expectedAttempt, jwt: jwt)
    }

    func completeSession(
        sessionId: String,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        try await completeSession(sessionId: sessionId, jwt: jwt)
    }

    func discardSession(
        sessionId: String,
        expectedAttempt: Int?,
        jwt: String
    ) async throws -> SessionRow {
        try await discardSession(sessionId: sessionId, jwt: jwt)
    }
}

extension APIClient: WorkoutTerminalAPI {}

extension APIClient: CompletedWorkoutFeedbackAPI {}
