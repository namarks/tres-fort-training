import UIKit
import XCTest
@testable import TresFort

/// "Report a problem": the fields the app sends match what
/// `src/problemReports.ts` reads, Garmin and WHOOP activities are never
/// offered, and a screenshot always fits the server's limit.
final class ProblemReportTests: XCTestCase {
    private func activity(id: String, source: String, date: String, deleted: Bool = false) throws -> ExternalActivity {
        var value: [String: Any] = ["id": id, "source": source, "external_id": id,
            "date": date, "kind": "run", "name": "Run \(id)", "synced_at": 1_000]
        if deleted { value["deleted_at"] = 2_000 }
        return try JSONDecoder().decode(ExternalActivity.self, from: JSONSerialization.data(withJSONObject: value))
    }

    private let context = ProblemReportContext(appVersion: "1.2", build: "80", osVersion: "iOS 26.1", device: "iPhone14,2")

    func testSendsEveryFieldTheServerReads() {
        var draft = ProblemReportDraft()
        draft.id = "0b8f0f7e-8a3c-4c8a-9d55-2f6c8c4f1a10"
        draft.kind = .activity
        draft.message = "  The map is empty.\n"
        draft.contact = " sam@example.com "
        draft.activity = ReportableActivity(id: "recording:abc", title: "Run", date: "2026-11-10")
        draft.screen = "activity"
        let fields = Dictionary(uniqueKeysWithValues: APIClient.problemReportFields(draft, context: context))
        XCTAssertEqual(fields, [
            "id": "0b8f0f7e-8a3c-4c8a-9d55-2f6c8c4f1a10",
            "kind": "activity",
            "message": "The map is empty.",
            "contact": "sam@example.com",
            "activity_id": "recording:abc",
            "platform": "ios",
            "app_version": "1.2",
            "build": "80",
            "os_version": "iOS 26.1",
            "device": "iPhone14,2",
            "screen": "activity",
        ])

        // No contact or activity: those fields are left out.
        var plain = ProblemReportDraft()
        plain.message = "Hi"
        let names = APIClient.problemReportFields(plain, context: context).map(\.0)
        XCTAssertFalse(names.contains("contact"))
        XCTAssertFalse(names.contains("activity_id"))
    }

    func testMultipartBodyCarriesTheScreenshot() throws {
        var draft = ProblemReportDraft()
        draft.message = "Frozen"
        draft.screenshot = Data([0xFF, 0xD8, 0xFF, 0x01])
        let body = APIClient.problemReportBody(draft, context: context, boundary: "B")
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"message\"\r\n\r\nFrozen\r\n"))
        XCTAssertTrue(text.contains("name=\"screenshot\"; filename=\"screenshot.jpg\"\r\nContent-Type: image/jpeg"))
        XCTAssertTrue(text.hasSuffix("--B--\r\n"))
        XCTAssertNotNil(body.range(of: Data([0xFF, 0xD8, 0xFF, 0x01])))
    }

    func testNeverOffersGarminWhoopOrDeletedActivities() throws {
        let activities = [
            try activity(id: "recording:new", source: "recording", date: "2026-11-10"),
            try activity(id: "garmin:1", source: "garmin", date: "2026-11-10"),
            try activity(id: "whoop:1", source: "whoop", date: "2026-11-09"),
            try activity(id: "healthkit:old", source: "healthkit", date: "2026-09-01"),
            try activity(id: "intervals:gone", source: "intervals", date: "2026-11-08", deleted: true),
            try activity(id: "intervals:1", source: "intervals", date: "2026-11-01"),
        ]
        XCTAssertEqual(ReportableActivity.recent(activities, today: "2026-11-11").map(\.id),
                       ["recording:new", "intervals:1"])
        XCTAssertNil(ReportableActivity(try activity(id: "garmin:2", source: "garmin", date: "2026-11-10")))
    }

    func testCanSendOnlyAMessageWithinLimits() {
        var draft = ProblemReportDraft()
        XCTAssertFalse(draft.canSend)
        draft.message = "   \n"
        XCTAssertFalse(draft.canSend)
        draft.message = "It crashed"
        XCTAssertTrue(draft.canSend)
        draft.message = String(repeating: "x", count: ProblemReportDraft.maximumMessage + 1)
        XCTAssertFalse(draft.canSend)
    }

    func testScreenshotIsAJPEGUnderTheLimit() throws {
        let size = CGSize(width: 1290, height: 2796)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            // Noise compresses badly, so the shrinking path runs.
            for y in stride(from: 0, to: Int(size.height), by: 6) {
                for x in stride(from: 0, to: Int(size.width), by: 6) {
                    UIColor(hue: CGFloat((x * 7 + y * 13) % 360) / 360, saturation: 1, brightness: 1, alpha: 1).setFill()
                    context.fill(CGRect(x: x, y: y, width: 6, height: 6))
                }
            }
        }
        let png = try XCTUnwrap(image.pngData())
        let jpeg = try XCTUnwrap(ProblemReportScreenshot.jpeg(from: png))
        XCTAssertLessThanOrEqual(jpeg.count, ProblemReportDraft.maximumScreenshotBytes)
        XCTAssertEqual(Array(jpeg.prefix(3)), [0xFF, 0xD8, 0xFF])
        let decoded = try XCTUnwrap(UIImage(data: jpeg))
        XCTAssertLessThanOrEqual(max(decoded.size.width, decoded.size.height), 1600)
        XCTAssertNil(ProblemReportScreenshot.jpeg(from: Data("not an image".utf8)))
    }

    func testFailureMessages() {
        XCTAssertEqual(ProblemReportOutcome.message(for: APIError.http(429, "")),
                       "You’ve sent a lot of reports today. Try again tomorrow, or email support.")
        XCTAssertEqual(ProblemReportOutcome.message(for: APIError.http(413, "")),
                       "This screenshot is too large. Remove it and try again.")
        XCTAssertEqual(ProblemReportOutcome.message(for: URLError(.notConnectedToInternet)),
                       "Très Fort couldn’t send this right now. Check your connection and try again.")
    }
}
