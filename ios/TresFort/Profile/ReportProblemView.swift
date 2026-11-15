import PhotosUI
import SwiftUI

/// "Report a problem": what went wrong, in the member's words, with an
/// optional screenshot and activity. Opened from Profile and from an
/// activity's "Something wrong?" link (which attaches that activity).
struct ReportProblemView: View {
    @ObservedObject var sync: SyncModel
    var initialActivity: ReportableActivity? = nil
    var screen = "profile"
    /// Set when the view is a sheet with no navigation stack of its own above it.
    var onClose: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var draft = ProblemReportDraft()
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var screenshotImage: UIImage?
    @State private var screenshotError: String?
    @State private var isSending = false
    @State private var sendError: String?
    @State private var sent = false
    @State private var prepared = false

    private var activityChoices: [ReportableActivity] {
        var choices = ReportableActivity.recent(sync.activities, today: sync.todayString)
        if let initialActivity, !choices.contains(initialActivity) { choices.insert(initialActivity, at: 0) }
        return choices
    }

    var body: some View {
        Form {
            if sent {
                Section {
                    Label("Thanks. Nick reads every report and will look into it.", systemImage: "checkmark.circle")
                        .accessibilityIdentifier("report.sent")
                    Button("Done") { close() }
                }
            } else {
                form
            }
        }
        .navigationTitle("Report a problem")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose, !sent {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onClose)
                }
            }
            if !sent {
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button("Send") { Task { await send() } }
                            .disabled(!draft.canSend)
                            .accessibilityIdentifier("report.send")
                    }
                }
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            draft.screen = screen
            if let initialActivity {
                draft.kind = .activity
                draft.activity = initialActivity
            }
        }
        .onChange(of: pickedPhoto) { _, item in
            Task { await loadScreenshot(item) }
        }
    }

    @ViewBuilder private var form: some View {
        Section("What kind of problem?") {
            Picker("Kind", selection: $draft.kind) {
                ForEach(ProblemReportKind.allCases) { kind in
                    Text(kind.label).tag(kind)
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
            .accessibilityIdentifier("report.kind")
        }

        Section {
            TextField("What happened? What did you expect?", text: $draft.message, axis: .vertical)
                .lineLimit(5...12)
                .accessibilityIdentifier("report.message")
        } header: {
            Text("Tell us more")
        } footer: {
            if draft.trimmedMessage.count > ProblemReportDraft.maximumMessage {
                Text("Keep it under \(ProblemReportDraft.maximumMessage) characters.")
            }
        }

        if draft.kind == .activity || draft.activity != nil {
            Section {
                Picker("Activity", selection: $draft.activity) {
                    Text("None").tag(ReportableActivity?.none)
                    ForEach(activityChoices) { activity in
                        Text("\(activity.title) · \(ActivityHistory.dayTitle(activity.date))")
                            .tag(Optional(activity))
                    }
                }
                .accessibilityIdentifier("report.activity")
            } header: {
                Text("Activity")
            } footer: {
                if draft.activity != nil {
                    Text("Sending this lets Nick, and the AI tools he uses to fix problems, read this activity’s details for 14 days, including its map, heart rate and pauses.")
                } else {
                    Text("Garmin and WHOOP activities can’t be attached.")
                }
            }
        }

        Section {
            if let screenshotImage {
                HStack(spacing: 12) {
                    Image(uiImage: screenshotImage)
                        .resizable()
                        .scaledToFit()
                        .frame(height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Attached screenshot")
                    Spacer()
                    Button("Remove", role: .destructive) {
                        draft.screenshot = nil
                        self.screenshotImage = nil
                        pickedPhoto = nil
                    }
                }
            } else {
                PhotosPicker(selection: $pickedPhoto, matching: .images) {
                    Label("Add a screenshot", systemImage: "photo")
                }
                .accessibilityIdentifier("report.screenshot")
            }
        } footer: {
            if let screenshotError { Text(screenshotError) }
        }

        Section {
            TextField("Email (optional)", text: $draft.contact)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("report.contact")
        } header: {
            Text("Where to reply")
        } footer: {
            Text("Reports go to Nick, who builds Très Fort, and may be read by the AI tools he uses to fix problems. Your app version and iPhone model are sent too.")
        }

        if let sendError {
            Section {
                Text(sendError)
                    .accessibilityIdentifier("report.error")
                Link("Email support instead", destination: AppInformation.supportURL)
            }
        }
    }

    private func loadScreenshot(_ item: PhotosPickerItem?) async {
        screenshotError = nil
        guard let item else { return }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let jpeg = ProblemReportScreenshot.jpeg(from: data),
              let image = UIImage(data: jpeg) else {
            screenshotError = "That image couldn’t be attached."
            pickedPhoto = nil
            return
        }
        draft.screenshot = jpeg
        screenshotImage = image
    }

    private func send() async {
        guard draft.canSend, !isSending else { return }
        isSending = true
        defer { isSending = false }
        sendError = await sync.sendProblemReport(draft)
        if sendError == nil { sent = true }
    }

    private func close() {
        if let onClose { onClose() } else { dismiss() }
    }
}
