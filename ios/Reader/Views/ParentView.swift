import ReaderCore
import SwiftUI

/// Grown-ups only: a quick multiplication gate, then the parent dashboard.
struct ParentArea: View {
    @State private var unlocked = false
    var body: some View {
        if unlocked { ParentView() } else { ParentGate { unlocked = true } }
    }
}

struct ParentGate: View {
    let onUnlock: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var a = Int.random(in: 6...9)
    @State private var b = Int.random(in: 6...9)
    @State private var answer = ""

    init(onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
    }

    var body: some View {
        VStack(spacing: 24) {
            Text("Grown-ups only").font(.largeTitle.bold())
            Text("What is \(a) × \(b)?").font(.title)
            TextField("Answer", text: $answer)
                .keyboardType(.numberPad)
                .font(.title)
                .multilineTextAlignment(.center)
                .frame(width: 200)
                .textFieldStyle(.roundedBorder)
                .onSubmit(check)
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(.bordered)
                Button("Continue", action: check).buttonStyle(.borderedProminent)
            }
        }
        .padding(40)
    }

    private func check() {
        if Int(answer) == a * b { onUnlock() } else {
            answer = ""
            a = Int.random(in: 6...9)
            b = Int.random(in: 6...9)
        }
    }
}

@MainActor
struct ParentView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var health: Bool?
    @State private var showPlacement = false

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                progressSection
                patternsSection
                stickySection
                Section("Next book") {
                    Picker("Focus pattern", selection: Binding(
                        get: { model.learner.targetOverride?.first ?? "" },
                        set: { model.learner.targetOverride = $0.isEmpty ? nil : [$0]; model.saveLearner() }
                    )) {
                        Text("Automatic").tag("")
                        ForEach(model.lexicon?.patterns.filter { !model.learner.patternState($0.id).isKnown } ?? []) { p in
                            Text(p.name).tag(p.id)
                        }
                    }
                    Stepper("Pages per book: \(model.settings.pages)", value: $model.settings.pages, in: 6...14)
                    Toggle("Pictures", isOn: $model.settings.images)
                    Picker("Picture quality", selection: $model.settings.imageQuality) {
                        Text("Low (cheapest)").tag("low")
                        Text("Medium").tag("medium")
                        Text("High").tag("high")
                    }
                    TextField("Topics to avoid (comma-separated)", text: $model.settings.avoidTopics)
                }
                Section("Reading") {
                    Picker("Default mode", selection: $model.settings.readingMode) {
                        Text("Reading together (you mark misses)").tag(ReadingMode.together)
                        Text("Reading alone (tap to hear)").tag(ReadingMode.alone)
                    }
                    Button("Redo placement check") { showPlacement = true }
                }
                Section {
                    TextField("Server URL", text: $model.settings.proxyURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    SecureField("App token", text: $model.settings.appToken)
                    HStack {
                        Button("Test connection") {
                            Task { health = await ProxyClient(baseURL: model.settings.proxyURL, token: model.settings.appToken).health() }
                        }
                        Spacer()
                        if let health { Image(systemName: health ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundStyle(health ? .green : .red) }
                    }
                } header: { Text("Book server") } footer: { Text("Run `npm run serve` in engine/ (see README).") }
                Section("Data") {
                    ShareLink("Export learner data", item: model.store.root.appendingPathComponent("learner.json"))
                    ShareLink("Export reading log", item: model.store.root.appendingPathComponent("events.jsonl"))
                }
            }
            .navigationTitle("Grown-ups")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $showPlacement) { PlacementView(onDone: { showPlacement = false }) }
        }
    }

    private var progressSection: some View {
        Section("Progress") {
            let mastered = model.learner.patterns.values.filter { $0.state.isKnown }.count
            let total = model.lexicon?.patterns.count ?? 0
            LabeledContent("Patterns known", value: "\(mastered) of \(total)")
            LabeledContent("Books finished", value: "\(model.books.filter { $0.finishedAt != nil }.count)")
            if !model.learner.bookAccuracy.isEmpty {
                LabeledContent("Recent accuracy", value: model.learner.bookAccuracy.suffix(5).map { "\(Int(($0 * 100).rounded()))%" }.joined(separator: "  "))
            }
            Text("Aim for 93–97% per book. The next book adapts automatically.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var patternsSection: some View {
        Section("Phonics patterns") {
            ForEach(model.lexicon?.patterns ?? []) { p in
                let item = model.learner.patterns[p.id]
                let state = item?.state ?? .new
                Menu {
                    ForEach(ItemState.allCases, id: \.self) { s in
                        Button(s.rawValue.capitalized) { model.learner.override(pattern: p.id, to: s); model.saveLearner() }
                    }
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(p.name).foregroundStyle(.primary)
                            Text(p.examples.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let item, item.seen > 0 {
                            Text("\(item.seen - item.missed)/\(item.seen)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        StateBadge(state: state)
                    }
                }
            }
        }
    }

    private var stickySection: some View {
        Section("Tricky words (last 2 weeks)") {
            let sticky = model.learner.stickyWords()
            if sticky.isEmpty {
                Text("None yet.").foregroundStyle(.secondary)
            }
            ForEach(Array(sticky.prefix(20))) { s in
                HStack {
                    Button { Speech.shared.word(s.word) } label: { Image(systemName: "speaker.wave.2") }.buttonStyle(.borderless)
                    Text(s.word).font(.title3)
                    Spacer()
                    Text("missed \(s.misses)×").foregroundStyle(.secondary)
                    StateBadge(state: model.learner.wordState(s.word))
                }
                .swipeActions {
                    Button("Knows it") { model.learner.override(word: s.word, to: .mastered); model.saveLearner() }.tint(.green)
                }
            }
        }
    }
}

struct StateBadge: View {
    let state: ItemState
    var body: some View {
        Text(label)
            .font(.caption.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
    private var label: String {
        switch state {
        case .new: return "Not yet"
        case .learning: return "Learning"
        case .reviewing: return "Reviewing"
        case .mastered: return "Mastered"
        }
    }
    private var color: Color {
        switch state {
        case .new: return .gray
        case .learning: return .orange
        case .reviewing: return .blue
        case .mastered: return .green
        }
    }
}
