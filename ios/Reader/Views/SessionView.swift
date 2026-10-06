import ReaderCore
import SwiftUI

/// One reading session: warm-up → preview → pages → chat → choose what happens next.
@MainActor
struct SessionView: View {
    enum Step: Equatable { case warmup, preview, page(Int), chat, next }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let book: Book

    @State private var step: Step = .warmup
    @State private var mode: ReadingMode = .together
    @State private var warmupWords: [String] = []
    @State private var warmupIndex = 0
    @State private var warmupEvents: [ReadEvent] = []
    @State private var marks: [Int: [Int: WordMark]] = [:]
    @State private var furthestPage = -1
    @State private var committed = false
    @State private var firstRead = true

    init(book: Book) {
        self.book = book
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            Group {
                switch step {
                case .warmup: warmupView
                case .preview: PreviewStep(book: book) { go(.page(0)) }
                case let .page(i): pageView(i)
                case .chat: ChatStep(book: book) { go(firstRead ? .next : nil) }
                case .next: NextStep(book: book) { dismiss() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.paper.ignoresSafeArea())
        .onAppear { start() }
        .onDisappear { commit(finished: false) }
    }

    // MARK: Flow

    private func start() {
        _ = Speech.shared  // load the voice now so the first tapped word speaks without a lag
        mode = model.settings.readingMode
        firstRead = book.finishedAt == nil
        if let lex = model.lexicon {
            warmupWords = Warmup.pick(state: model.learner, lexicon: lex, book: book, seenWords: model.seenWords)
        }
        if warmupWords.isEmpty {
            step = hasPreview ? .preview : .page(0)
            if !hasPreview { furthestPage = 0 }
        }
    }

    private var hasPreview: Bool { !book.previewWords.isEmpty || !book.spec.newHeartWords.isEmpty }

    private func go(_ next: Step?) {
        Speech.shared.stop()
        guard let next else { dismiss(); return }
        if case let .page(i) = next { furthestPage = max(furthestPage, i) }
        if next == .chat { commit(finished: true) }
        withAnimation(.easeInOut(duration: 0.25)) { step = next }
    }

    private func commit(finished: Bool) {
        guard !committed else { return }
        var events = warmupEvents
        if furthestPage >= 0, !book.pages.isEmpty {
            for i in 0...min(furthestPage, book.pages.count - 1) {
                events += SessionGrading.events(tokens: book.pages[i].tokens, marks: marks[i] ?? [:], mode: mode, bookId: book.id)
            }
        }
        guard !events.isEmpty else { return }
        committed = true
        model.commit(events: events, for: book, finished: finished)
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 16) {
            Button { go(nil) } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 34)).foregroundStyle(.secondary) }
            Spacer()
            if case let .page(i) = step {
                HStack(spacing: 8) {
                    ForEach(book.pages.indices, id: \.self) { j in
                        Circle().fill(j <= i ? Theme.accent : Color.gray.opacity(0.3)).frame(width: 10, height: 10)
                    }
                }
            } else {
                Text(book.title).font(Theme.reading(22, bold: true)).lineLimit(1)
            }
            Spacer()
            Menu {
                Picker("Reading mode", selection: $mode) {
                    Label("Reading together", systemImage: "person.2.fill").tag(ReadingMode.together)
                    Label("Reading alone", systemImage: "person.fill").tag(ReadingMode.alone)
                }
            } label: {
                Image(systemName: mode == .together ? "person.2.circle.fill" : "person.circle.fill")
                    .font(.system(size: 34)).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
    }

    // MARK: Warm-up

    @ViewBuilder private var warmupView: some View {
        if warmupIndex < warmupWords.count {
            let w = warmupWords[warmupIndex]
            VStack(spacing: 40) {
                Text("Warm-up \(warmupIndex + 1) of \(warmupWords.count)").font(Theme.reading(22)).foregroundStyle(.secondary)
                Button { Speech.shared.word(w); if mode == .alone { warmupResult(w, .tapped) } } label: {
                    Text(w)
                        .font(Theme.reading(110, bold: true))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 60).padding(.vertical, 30)
                        .background(.white, in: RoundedRectangle(cornerRadius: 32))
                }
                .buttonStyle(.plain)
                if mode == .together {
                    HStack(spacing: 24) {
                        bigButton("Got it", "checkmark", .green) { warmupResult(w, .correct) }
                        bigButton("Needed help", "hand.raised.fill", Theme.helped) { warmupResult(w, .hinted) }
                        bigButton("Missed", "xmark", Theme.missed) { warmupResult(w, .incorrect) }
                    }
                    Text("Grown-up: tap how it went. Tap the word to hear it.").foregroundStyle(.secondary)
                } else {
                    bigButton("Next", "arrow.right", Theme.accent) { warmupResult(w, .correct) }
                    Text("Tap the word if you want to hear it.").font(Theme.reading(20)).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func warmupResult(_ w: String, _ outcome: Outcome) {
        let alreadyTapped = warmupEvents.contains { $0.word == w && $0.outcome == .tapped }
        // Reading alone: a tap followed by "Next" keeps the tap as the result.
        if !(mode == .alone && outcome == .correct && alreadyTapped) {
            warmupEvents.removeAll { $0.word == w }
            let weight: Double = (mode == .alone && outcome == .correct) ? SessionGrading.aloneUntappedWeight : 1
            let hint = outcome == .hinted ? 3 : (outcome == .tapped ? 4 : 0)
            let source: EvidenceSource = mode == .together ? .parent : .tapOnly
            warmupEvents.append(ReadEvent(word: w, outcome: outcome, hintLevel: hint, weight: weight, source: source, bookId: book.id))
        }
        if outcome == .tapped { return }  // stay on the word after hearing it
        if warmupIndex + 1 < warmupWords.count {
            warmupIndex += 1
        } else {
            go(hasPreview ? .preview : .page(0))
        }
    }

    // MARK: Pages

    @ViewBuilder private func pageView(_ i: Int) -> some View {
        let page = book.pages[i]
        VStack(spacing: 24) {
            if let url = model.pageImage(book, page: i), let img = UIImage(contentsOfFile: url.path) {
                Image(uiImage: img).resizable().scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .frame(maxHeight: 360)
            }
            PageText(tokens: page.tokens, mode: mode, marks: Binding(
                get: { marks[i] ?? [:] },
                set: { marks[i] = $0 }
            ))
            .frame(maxWidth: 900)
            Spacer(minLength: 0)
            HStack {
                if i > 0 {
                    arrow("arrow.left") { go(.page(i - 1)) }
                }
                Spacer()
                Text("Tap a tricky word to hear it. Tap it again to clear it.")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer()
                arrow(i + 1 < book.pages.count ? "arrow.right" : "checkmark") {
                    go(i + 1 < book.pages.count ? .page(i + 1) : .chat)
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.vertical, 20)
        .id(i)
        .transition(.opacity)
    }

    private func arrow(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 36, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 84, height: 84)
                .background(Theme.accent, in: Circle())
        }
    }

    private func bigButton(_ title: String, _ symbol: String, _ color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(Theme.reading(26, bold: true))
                .padding(.horizontal, 28).padding(.vertical, 18)
        }
        .buttonStyle(.borderedProminent)
        .tint(color)
    }
}

// MARK: - Page text

@MainActor
struct PageText: View {
    let tokens: [Token]
    let mode: ReadingMode
    @Binding var marks: [Int: WordMark]

    /// Gaps between words. Each word's tap area extends halfway into them, so there are no dead zones.
    private static let gap: CGFloat = 16
    private static let lineGap: CGFloat = 22

    init(tokens: [Token], mode: ReadingMode, marks: Binding<[Int: WordMark]>) {
        self.tokens = tokens
        self.mode = mode
        self._marks = marks
    }

    var body: some View {
        FlowLayout(spacing: 0, lineSpacing: 0) {
            ForEach(ReadingUnits.build(tokens)) { u in
                WordView(unit: u, mark: marks[u.id] ?? .none)
                    .padding(.horizontal, Self.gap / 2)
                    .padding(.vertical, Self.lineGap / 2)
                    .contentShape(Rectangle())
                    .onTapGesture { tap(u) }
            }
        }
    }

    /// Tap an unmarked word: say it at once and mark it as a word he needed help with (highlighted).
    /// Tap a marked word: clear the mark, silently. Names and theme words are pre-taught and never marked;
    /// tapping them just says them.
    private func tap(_ u: ReadingUnit) {
        guard u.cls != .story else { Speech.shared.word(u.word); return }
        if (marks[u.id] ?? WordMark.none) != .none {
            marks[u.id] = WordMark.none
        } else {
            Speech.shared.word(u.word)
            marks[u.id] = .tapped
        }
    }
}

struct WordView: View {
    let unit: ReadingUnit
    let mark: WordMark

    var body: some View {
        Text(unit.prefix + unit.word + unit.suffix)
            .font(Theme.reading(40))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(background, in: RoundedRectangle(cornerRadius: 10))
            .animation(.easeOut(duration: 0.1), value: mark)
    }

    private var background: Color {
        switch mark {
        case .none: return .clear
        case .missed: return Theme.missed.opacity(0.3)
        case .helped: return Theme.helped.opacity(0.35)
        case .tapped: return Theme.tapped.opacity(0.4)
        }
    }
}

/// "ship" shown as sh · i · p with the chunks colored, and the heart part of a heart word in pink.
struct ChunkedWord: View {
    let word: String
    let lexicon: Lexicon

    var body: some View {
        let chunks = lexicon.displayChunks(word)
        let heart = lexicon.entry(word)?.isHeartWord == true ? lexicon.entry(word)?.heartRange : nil
        HStack(spacing: 4) {
            ForEach(Array(chunks.enumerated()), id: \.offset) { idx, c in
                let start = chunks.prefix(idx).reduce(0) { $0 + $1.count }
                let inHeart = heart.map { $0.contains(start) } ?? false
                Text(c)
                    .foregroundStyle(inHeart ? Color.pink : (idx.isMultiple(of: 2) ? Theme.accent : Color.primary))
                if idx < chunks.count - 1 { Text("·").foregroundStyle(.secondary) }
            }
        }
    }
}

// MARK: - Preview

struct PreviewStep: View {
    @Environment(AppModel.self) private var model
    let book: Book
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 36) {
            Text("Words to know").font(Theme.reading(40, bold: true))
            Text("Tap each word to hear it.").font(Theme.reading(22)).foregroundStyle(.secondary)
            FlowLayout(spacing: 24, lineSpacing: 24) {
                ForEach(book.previewWords, id: \.self) { w in
                    Button { Speech.shared.word(w) } label: {
                        Text(w).font(Theme.reading(56, bold: true)).padding(.horizontal, 30).padding(.vertical, 16)
                            .background(Color.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 22))
                    }.buttonStyle(.plain)
                }
                ForEach(book.spec.newHeartWords, id: \.self) { w in
                    Button { Speech.shared.word(w) } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "heart.fill").foregroundStyle(.pink)
                            if let lex = model.lexicon { ChunkedWord(word: w, lexicon: lex).font(Theme.reading(56, bold: true)) }
                            Text("heart word").font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 30).padding(.vertical, 16)
                        .background(Theme.heart.opacity(0.5), in: RoundedRectangle(cornerRadius: 22))
                    }.buttonStyle(.plain)
                }
            }
            .frame(maxWidth: 900)
            Button(action: onDone) {
                Label("Let's read!", systemImage: "book.fill").font(Theme.reading(30, bold: true)).padding(.horizontal, 30).padding(.vertical, 14)
            }.buttonStyle(.borderedProminent)
        }
        .padding(40)
    }
}

// MARK: - Chat

struct ChatStep: View {
    let book: Book
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 32) {
            Text("The End!").font(Theme.reading(56, bold: true))
            Text("Let's talk about it").font(Theme.reading(28)).foregroundStyle(.secondary)
            ForEach(book.chatQuestions, id: \.self) { q in
                Button { Speech.shared.say(q) } label: {
                    HStack(spacing: 16) {
                        Image(systemName: "speaker.wave.2.fill").font(.title)
                        Text(q).font(Theme.reading(28)).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(24)
                    .frame(maxWidth: 800)
                    .background(.white, in: RoundedRectangle(cornerRadius: 24))
                }.buttonStyle(.plain)
            }
            Button(action: onDone) {
                Text("Done").font(Theme.reading(30, bold: true)).padding(.horizontal, 40).padding(.vertical, 14)
            }.buttonStyle(.borderedProminent)
        }
        .padding(40)
        .onAppear { if let q = book.chatQuestions.first { Speech.shared.say(q) } }
    }
}

// MARK: - What happens next

struct NextStep: View {
    @Environment(AppModel.self) private var model
    let book: Book
    let onDone: () -> Void
    @State private var picked: String?

    init(book: Book, onDone: @escaping () -> Void) {
        self.book = book
        self.onDone = onDone
    }

    var body: some View {
        VStack(spacing: 28) {
            Text("What happens next?").font(Theme.reading(48, bold: true))
            Text("Pick one, and I'll write the next book.").font(Theme.reading(24)).foregroundStyle(.secondary)
            ForEach(book.nextOptions, id: \.self) { opt in
                Button {
                    picked = opt
                    Speech.shared.say(opt)
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: picked == opt ? "checkmark.circle.fill" : "circle").font(.title)
                        Text(opt).font(Theme.reading(28)).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(24)
                    .frame(maxWidth: 800)
                    .background(picked == opt ? Theme.practice : .white, in: RoundedRectangle(cornerRadius: 24))
                }.buttonStyle(.plain)
            }
            HStack(spacing: 24) {
                Button("Not now") { onDone() }.font(Theme.reading(24)).buttonStyle(.bordered)
                Button {
                    guard let picked else { return }
                    if let sid = book.seriesId { model.continueSeries(sid, choice: picked) } else { model.requestBook(prompt: picked, characters: book.characters) }
                    onDone()
                } label: {
                    Label("Write it!", systemImage: "pencil.and.scribble").font(Theme.reading(30, bold: true)).padding(.horizontal, 30).padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .disabled(picked == nil)
            }
        }
        .padding(40)
    }
}
