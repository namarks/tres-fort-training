import SwiftUI
import UIKit

/// The ways to start a block of weeks from the Plan tab. A block can hold any
/// mix of workouts, so the open path comes first; the run builders are
/// starting points that change only runs. The coach prompt is optional: every
/// path here works without AI.
enum PlanBlockChoice: Hashable {
    case ownWeek, event, keepBuilding
}

enum PlanBlockChooser {
    /// What the "Copy a prompt" row puts on the clipboard, for Claude, ChatGPT
    /// or another AI app connected to Tres Fort.
    static let coachPrompt = """
    Help me design a training block in Tres Fort. Read my current plan first. \
    I want to train for: [what you're working toward, for example a sprint triathlon, \
    swimming and running, or getting stronger]. Length: [number] weeks. \
    Keep the workouts I already do unless I say otherwise, make the weeks build \
    gradually with an easier week every three or four weeks, and save it as a \
    block so I can review each week in the app and edit its targets on the web.
    """

    /// Starting from your week opens only while no block exists: the builders
    /// say they replace a block, but that sheet never replaces one.
    static func ownWeekAvailable(hasBlock: Bool) -> Bool { !hasBlock }
}

struct PlanBlockChooserSheet: View {
    let hasBlock: Bool
    let onPick: (PlanBlockChoice) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    choiceRow("Start from my week",
                              detail: "Any mix: lifting, runs, swims, rides and sports. Each week starts as a copy of your week. Choose each week's workouts here; edit week-specific targets on the web.",
                              systemImage: "rectangle.split.3x1", id: "plan.blockSetup") {
                        onPick(.ownWeek)
                    }
                    .disabled(!PlanBlockChooser.ownWeekAvailable(hasBlock: hasBlock))
                    .opacity(PlanBlockChooser.ownWeekAvailable(hasBlock: hasBlock) ? 1 : 0.45)
                } header: {
                    Text("Your own")
                } footer: {
                    if hasBlock {
                        Text("You're using a block now. Change its weeks on the Plan tab, or end it to start a new one from your week.")
                    }
                }

                Section("Week-specific targets") {
                    ProgramTargetsWebLink(hasBlock: hasBlock)
                }

                Section {
                    choiceRow("Train for an event",
                              detail: "Your long run builds to a race date, then tapers.",
                              systemImage: "flag.checkered", id: "plan.eventBuild") {
                        onPick(.event)
                    }
                    choiceRow("Keep building",
                              detail: "Your long run grows to a distance you choose, then holds. No date needed.",
                              systemImage: "chart.line.uptrend.xyaxis", id: "plan.keepBuilding") {
                        onPick(.keepBuilding)
                    }
                } header: {
                    Text("Starting points for runs")
                } footer: {
                    Text("These change only your runs. The rest of your week stays as it is, and you can change any week afterwards.")
                }

                Section {
                    Button {
                        UIPasteboard.general.string = PlanBlockChooser.coachPrompt
                        copied = true
                    } label: {
                        HStack(spacing: 12) {
                            Label(copied ? "Prompt copied" : "Copy a prompt",
                                  systemImage: copied ? "checkmark" : "doc.on.doc")
                                .font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                            Spacer()
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("plan.coachPrompt")
                } header: {
                    Text("Ask your coach")
                } footer: {
                    Text("For a mix of sports or something more specific, paste it into Claude, ChatGPT or another AI app connected to Tres Fort (Profile > Coach). Review its block here. Change each week's workouts in the app and its targets on the web.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Plan a block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func choiceRow(_ title: String, detail: String, systemImage: String, id: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label(title, systemImage: systemImage)
                        .font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                    Text(detail).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}

/// The web also offers a full cross-week target grid. Keep the
/// destination and scope consistent at setup, block and day entry points.
struct ProgramTargetsWebLink: View {
    var week: Int? = nil
    var hasBlock = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Link(destination: AppInformation.blockPlannerURL) {
                Label("Compare week targets on web", systemImage: "arrow.up.right.square")
                    .font(Theme.mono(15, .bold))
                    .foregroundStyle(Theme.text)
                    .frame(minHeight: 44, alignment: .leading)
            }
            .accessibilityIdentifier("plan.block.targets.web")
            .accessibilityHint("Opens the Tres Fort block editor in your browser")
            Text(instructions)
                .font(.subheadline).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("plan.block.targets.help")
        }
    }

    private var instructions: String {
        let selection = week.map { "then edit Week \($0 + 1)." } ?? "then choose the week to edit."
        let setup = hasBlock ? "" : " Start a block from your week first."
        return "Sign in with the same Apple account.\(setup) In Targets by week, choose a workout and exercise, \(selection) Sets, reps, load and time apply wherever that workout appears in that block week. Your saved workout stays unchanged."
    }
}
