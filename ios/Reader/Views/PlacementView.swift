import ReaderCore
import SwiftUI

/// About five minutes, with a grown-up: he reads a few words per step; stop after two missed steps in a row.
@MainActor
struct PlacementView: View {
    @Environment(AppModel.self) private var model
    var onDone: (() -> Void)?

    @State private var check: PlacementCheck?
    @State private var stepIndex = 0
    @State private var wordIndex = 0
    @State private var correct = 0
    @State private var results: [(pattern: String, passed: Bool)] = []
    @State private var started = false
    @State private var manual = false
    @State private var manualPick = "suffix_ed"

    init(onDone: (() -> Void)? = nil) {
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            Group {
                if manual { manualView } else if !started { intro } else if let check, stepIndex < check.steps.count, !finished { testView(check) } else { summary }
            }
            .padding(40)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.paper)
            .navigationTitle("Placement")
        }
        .onAppear { if let lex = model.lexicon { check = PlacementCheck(lexicon: lex) } }
    }

    private var finished: Bool {
        results.count >= 2 && !results[results.count - 1].passed && !results[results.count - 2].passed
    }

    private var intro: some View {
        VStack(spacing: 24) {
            Text("Quick reading check").font(.largeTitle.bold())
            Text("Sit with him. He reads a few words from each step, easiest first. Tap ✓ or ✗ for each. It stops by itself when the words get too hard, usually in about five minutes.")
                .font(.title3).multilineTextAlignment(.center).frame(maxWidth: 640)
            Button("Start") { started = true }.buttonStyle(.borderedProminent).font(.title2)
            Button("I'll set the level myself") { manual = true }
        }
    }

    private func testView(_ check: PlacementCheck) -> some View {
        let step = check.steps[stepIndex]
        let word = step.words[wordIndex]
        return VStack(spacing: 36) {
            Text("Step \(stepIndex + 1): \(step.pattern.name)").font(.headline).foregroundStyle(.secondary)
            Text(word).font(Theme.reading(120, bold: true))
                .padding(.horizontal, 60).padding(.vertical, 24)
                .background(.white, in: RoundedRectangle(cornerRadius: 32))
            HStack(spacing: 30) {
                Button { answer(false, step) } label: { Label("Missed", systemImage: "xmark").font(.title).padding() }
                    .buttonStyle(.borderedProminent).tint(Theme.missed)
                Button { answer(true, step) } label: { Label("Read it", systemImage: "checkmark").font(.title).padding() }
                    .buttonStyle(.borderedProminent).tint(.green)
            }
        }
    }

    private func answer(_ ok: Bool, _ step: PlacementCheck.Step) {
        if ok { correct += 1 }
        if wordIndex + 1 < step.words.count {
            wordIndex += 1
            return
        }
        results.append((step.pattern.id, PlacementCheck.passed(correct: correct, of: step.words.count)))
        wordIndex = 0
        correct = 0
        stepIndex += 1
    }

    private var placement: String? { PlacementCheck.placement(results: results) }

    private var summary: some View {
        VStack(spacing: 24) {
            Text("All done!").font(.largeTitle.bold())
            if let p = placement, let pat = model.lexicon?.patternById[p] {
                Text("He's solid through **\(pat.name)**. Books will start right after that.").font(.title3).multilineTextAlignment(.center)
            } else {
                Text("We'll start at the very beginning: short vowels.").font(.title3)
            }
            Text("You can change this any time under Grown-ups.").foregroundStyle(.secondary)
            Button("Start reading") {
                model.place(through: placement ?? "consonants")
                onDone?()
            }
            .buttonStyle(.borderedProminent).font(.title2)
        }
    }

    private var manualView: some View {
        VStack(spacing: 24) {
            Text("He can already read everything up to and including:").font(.title3)
            Picker("Level", selection: $manualPick) {
                ForEach(model.lexicon?.patterns ?? []) { p in Text("\(p.order). \(p.name)").tag(p.id) }
            }
            .pickerStyle(.wheel)
            .frame(maxWidth: 600)
            Button("Save") {
                model.place(through: manualPick)
                onDone?()
            }
            .buttonStyle(.borderedProminent).font(.title2)
            Button("Back") { manual = false }
        }
    }
}
