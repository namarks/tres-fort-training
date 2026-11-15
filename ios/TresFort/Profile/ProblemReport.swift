import Foundation
import UIKit

/// "Report a problem" (docs/DIAGNOSTICS.md): a member tells support what
/// went wrong, optionally with a screenshot and one of their activities,
/// and the app adds its version and the device. Sent to
/// `POST /api/me/problem-reports`; the shape and limits are owned by
/// `src/problemReports.ts`.
enum ProblemReportKind: String, CaseIterable, Identifiable {
    case bug, activity, feedback
    var id: String { rawValue }
    var label: String {
        switch self {
        case .bug: return "Something isn’t working"
        case .activity: return "An activity looks wrong"
        case .feedback: return "Feedback or an idea"
        }
    }
}

/// An activity a report can carry. Garmin and WHOOP activities can't be
/// attached: their licenses keep that data from support's AI tools.
struct ReportableActivity: Identifiable, Hashable {
    let id: String
    let title: String
    let date: String

    static let excludedSources: Set<String> = ["garmin", "whoop"]

    init?(_ activity: ExternalActivity) {
        guard !Self.excludedSources.contains(activity.source), activity.deleted_at == nil else { return nil }
        id = activity.id
        title = activity.displayTitle
        date = activity.date
    }

    init(id: String, title: String, date: String) {
        self.id = id
        self.title = title
        self.date = date
    }

    /// The member's activities from the last 30 days, newest first.
    static func recent(_ activities: [ExternalActivity], today: String, limit: Int = 30) -> [ReportableActivity] {
        let since = CalendarProjection.date(from: today)
            .flatMap { CalendarProjection.calendar.date(byAdding: .day, value: -30, to: $0) }
            .map(CalendarProjection.dateString)
        return activities
            .compactMap(ReportableActivity.init)
            .filter { since == nil || $0.date >= since! }
            .sorted { $0.date > $1.date }
            .prefix(limit)
            .map { $0 }
    }
}

struct ProblemReportDraft: Equatable {
    /// The idempotency key: a retry of the same draft is one report.
    var id = UUID().uuidString.lowercased()
    var kind: ProblemReportKind = .bug
    var message = ""
    var contact = ""
    var activity: ReportableActivity?
    var screenshot: Data?
    /// Where the member started: `profile` or `activity`.
    var screen = "profile"

    static let maximumMessage = 4000
    static let maximumContact = 200
    /// The server's limit is 1,000,000 bytes; stay under it.
    static let maximumScreenshotBytes = 900_000

    var trimmedMessage: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canSend: Bool {
        !trimmedMessage.isEmpty && trimmedMessage.count <= Self.maximumMessage
            && contact.trimmingCharacters(in: .whitespacesAndNewlines).count <= Self.maximumContact
    }
}

/// The app and device, so support needn't ask.
struct ProblemReportContext: Equatable {
    var appVersion: String
    var build: String
    var osVersion: String
    var device: String

    @MainActor static var current: ProblemReportContext {
        let info = Bundle.main.infoDictionary
        return ProblemReportContext(
            appVersion: info?["CFBundleShortVersionString"] as? String ?? "unknown",
            build: info?["CFBundleVersion"] as? String ?? "unknown",
            osVersion: "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
            device: modelIdentifier())
    }

    /// "iPhone14,2", not the member's device name.
    static func modelIdentifier() -> String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated + " (Simulator)"
        }
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: &system.machine) { buffer in
            String(decoding: buffer.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}

struct ProblemReportResponse: Decodable, Equatable {
    struct Report: Decodable, Equatable {
        let id: String
        let activity_attached: Bool
        let has_screenshot: Bool
    }
    let report: Report
    let deduplicated: Bool
}

extension APIClient {
    func sendProblemReport(_ draft: ProblemReportDraft, context: ProblemReportContext,
                           jwt: String) async throws -> ProblemReportResponse {
        let boundary = "TresFort-\(UUID().uuidString)"
        var req = URLRequest(url: URL(string: baseURL.absoluteString + "/api/me/problem-reports")!)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.httpBody = Self.problemReportBody(draft, context: context, boundary: boundary)
        return try await send(req)
    }

    static func problemReportFields(_ draft: ProblemReportDraft, context: ProblemReportContext) -> [(String, String)] {
        var fields: [(String, String)] = [
            ("id", draft.id),
            ("kind", draft.kind.rawValue),
            ("message", draft.trimmedMessage),
            ("platform", "ios"),
            ("app_version", context.appVersion),
            ("build", context.build),
            ("os_version", context.osVersion),
            ("device", context.device),
            ("screen", draft.screen),
        ]
        let contact = draft.contact.trimmingCharacters(in: .whitespacesAndNewlines)
        if !contact.isEmpty { fields.append(("contact", contact)) }
        if let activity = draft.activity { fields.append(("activity_id", activity.id)) }
        return fields
    }

    static func problemReportBody(_ draft: ProblemReportDraft, context: ProblemReportContext,
                                  boundary: String) -> Data {
        var body = Data()
        for (name, value) in problemReportFields(draft, context: context) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
            body.append(Data(value.utf8))
            body.append(Data("\r\n".utf8))
        }
        if let screenshot = draft.screenshot {
            body.append(Data(("--\(boundary)\r\nContent-Disposition: form-data; name=\"screenshot\"; "
                + "filename=\"screenshot.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").utf8))
            body.append(screenshot)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        return body
    }
}

enum ProblemReportScreenshot {
    /// A picked image as a JPEG under the upload limit: at most 1600 points
    /// on its long side, then lower quality and size until it fits.
    static func jpeg(from data: Data, limit: Int = ProblemReportDraft.maximumScreenshotBytes) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        var side: CGFloat = 1600
        while side >= 400 {
            let resized = scaled(image, longSide: side)
            for quality in [0.75, 0.6, 0.45] as [CGFloat] {
                if let jpeg = resized.jpegData(compressionQuality: quality), jpeg.count <= limit { return jpeg }
            }
            side *= 0.75
        }
        return nil
    }

    private static func scaled(_ image: UIImage, longSide: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        guard longest > longSide else { return image }
        let factor = longSide / longest
        let target = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

/// What the member sees when a report can't be sent.
enum ProblemReportOutcome {
    static func message(for error: Error) -> String {
        guard let status = (error as? APIError)?.httpStatus else {
            return "Très Fort couldn’t send this right now. Check your connection and try again."
        }
        switch status {
        case 401: return "Sign in again, then send your report."
        case 413: return "This screenshot is too large. Remove it and try again."
        case 429: return "You’ve sent a lot of reports today. Try again tomorrow, or email support."
        default:
            return status >= 500
                ? "Très Fort couldn’t send this right now. Try again."
                : "This report couldn’t be sent. Try again, or email support."
        }
    }
}
