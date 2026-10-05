import Foundation
import Observation
import ReaderCore

/// A book being written on the server. Persisted, so writing continues across app restarts.
struct PendingBook: Identifiable, Equatable, Codable {
    enum Status: Equatable, Codable { case writing, failed(String) }
    var id = UUID()
    var label: String
    var request: BookRequest
    var seriesId: String?
    var status: Status = .writing
    /// Server job id, once submitted.
    var jobId: String?
    var submittedAt: Date?
    var resubmits: Int?
}

@MainActor
@Observable
final class AppModel {
    private(set) var lexicon: Lexicon?
    var learner = LearnerState()
    var settings = AppSettings() {
        didSet { if settings != oldValue { try? store.saveSettings(settings) } }
    }
    private(set) var books: [Book] = []
    private(set) var series: [Series] = []
    var pending: [PendingBook] = [] {
        didSet { try? store.save(pending, "pending.json") }
    }
    /// Pending ids with a polling loop running right now.
    @ObservationIgnored private var polling: Set<UUID> = []
    var loadError: String?
    /// Non-fatal: storage fell back to a temp folder, so data won't persist.
    var storageWarning: String?

    let store: FileStore

    init() {
        var storeError: String?
        do {
            store = try FileStore(root: FileStore.defaultRoot())
        } catch {
            // Fall back to a temp dir so the app still launches; surfaced in the UI.
            store = try! FileStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("Reader"))
            storeError = "Couldn't open app storage: \(error.localizedDescription)"
        }
        storageWarning = storeError
        settings = store.loadSettings()
        learner = store.loadLearner() ?? LearnerState()
        books = store.loadBooks()
        series = store.loadSeries()
        pending = store.load([PendingBook].self, "pending.json") ?? []
    }

    var needsPlacement: Bool { learner.placedThrough == nil }

    func loadLexicon() async {
        guard lexicon == nil else { return }
        guard let lexURL = Bundle.main.url(forResource: "lexicon", withExtension: "json"),
              let patURL = Bundle.main.url(forResource: "patterns", withExtension: "json") else {
            loadError = "lexicon.json is missing from the app bundle."
            return
        }
        do {
            lexicon = try await Task.detached(priority: .userInitiated) {
                try Lexicon(lexiconURL: lexURL, patternsURL: patURL)
            }.value
        } catch {
            loadError = "Couldn't load the word list: \(error.localizedDescription)"
        }
    }

    // MARK: Learner

    func saveLearner() {
        try? store.saveLearner(learner)
    }

    func place(through pattern: String) {
        guard let lexicon else { return }
        learner.place(through: pattern, lexicon: lexicon)
        saveLearner()
    }

    /// Commit a finished (or abandoned) session's evidence.
    func commit(events: [ReadEvent], for book: Book, finished: Bool) {
        guard let lexicon, !events.isEmpty else { return }
        learner.record(events, lexicon: lexicon)
        try? store.append(events: events)
        if finished, var b = books.first(where: { $0.id == book.id }) {
            let acc = learner.finishBook(events: events)
            b.finishedAt = Date()
            b.timesRead = (b.timesRead ?? 0) + 1
            if let acc { b.accuracy = acc }
            try? store.save(book: b)
            books = store.loadBooks()
        }
        saveLearner()
    }

    // MARK: Books

    var seenWords: Set<String> {
        Set(books.filter { $0.finishedAt != nil }.flatMap { $0.pages.flatMap { $0.tokens.compactMap(\.w) } })
    }

    func coverImage(_ book: Book) -> URL? {
        let u = store.coverURL(book.id)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    func pageImage(_ book: Book, page: Int) -> URL? {
        let u = store.pageImageURL(book.id, page: page)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    func delete(_ book: Book) {
        store.deleteBook(id: book.id)
        books = store.loadBooks()
    }

    func seriesFor(_ book: Book) -> Series? {
        guard let id = book.seriesId else { return nil }
        return series.first { $0.id == id }
    }

    /// Start writing a brand-new book.
    func requestBook(prompt: String, characters: [StoryCharacter] = []) {
        let req = BookRequest(prompt: prompt, characters: characters.isEmpty ? nil : characters)
        enqueue(PendingBook(label: prompt, request: req, seriesId: nil))
    }

    /// Write the next book in a series, following the option he picked.
    func continueSeries(_ seriesId: String, choice: String) {
        guard let s = series.first(where: { $0.id == seriesId }) else { return }
        let req = BookRequest(
            prompt: s.prompt,
            characters: s.characters,
            series: SeriesContext(id: s.id, title: s.title, summaries: s.summaries, choice: choice)
        )
        enqueue(PendingBook(label: choice, request: req, seriesId: s.id))
    }

    func retry(_ job: PendingBook) {
        pending.removeAll { $0.id == job.id }
        enqueue(PendingBook(label: job.label, request: job.request, seriesId: job.seriesId))
    }

    /// Call on launch and whenever the app comes back to the foreground: picks up books still being written.
    func resumePending() {
        for job in pending where job.status == .writing && !polling.contains(job.id) {
            if job.jobId != nil { track(job.id) } else { submit(job.id) }
        }
    }

    func dismiss(_ job: PendingBook) {
        pending.removeAll { $0.id == job.id }
    }

    private func enqueue(_ job: PendingBook) {
        pending.append(job)
        submit(job.id)
    }

    private var client: ProxyClient { ProxyClient(baseURL: settings.proxyURL, token: settings.appToken) }

    private func fail(_ id: UUID, _ message: String) {
        if let i = pending.firstIndex(where: { $0.id == id }) { pending[i].status = .failed(message) }
    }

    /// Send the request to the server, then start polling.
    private func submit(_ id: UUID) {
        guard let job = pending.first(where: { $0.id == id }) else { return }
        var req = job.request
        req.pages = settings.pages
        let avoid = settings.avoidTopics.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        req.avoid = avoid.isEmpty ? nil : avoid
        let client = self.client
        let snapshot = learner.snapshot()
        let images = settings.images
        let quality = settings.imageQuality
        polling.insert(id)
        Task { [req] in
            do {
                let jobId = try await client.submit(snapshot: snapshot, request: req, images: images, quality: quality)
                if let i = pending.firstIndex(where: { $0.id == id }) {
                    pending[i].jobId = jobId
                    pending[i].submittedAt = Date()
                }
                polling.remove(id)
                track(id)
            } catch {
                polling.remove(id)
                fail(id, error.localizedDescription)
            }
        }
    }

    /// Poll the server every few seconds until the book is done or failed. Network blips are retried;
    /// if the app is suspended the loop pauses and `resumePending()` restarts it on return.
    private func track(_ id: UUID) {
        guard let jobId = pending.first(where: { $0.id == id })?.jobId, !polling.contains(id) else { return }
        polling.insert(id)
        let client = self.client
        Task {
            defer { polling.remove(id) }
            var networkErrors = 0
            while pending.contains(where: { $0.id == id && $0.status == .writing }) {
                do {
                    switch try await client.poll(jobId: jobId) {
                    case .running:
                        networkErrors = 0
                        try? await Task.sleep(for: .seconds(5))
                    case let .done(fresh):
                        guard let job = pending.first(where: { $0.id == id }) else { return }
                        var book = fresh
                        book.seriesId = attachToSeries(book, seriesId: job.seriesId)
                        try store.save(book: book)
                        books = store.loadBooks()
                        pending.removeAll { $0.id == id }
                        return
                    }
                } catch let e as ProxyError {
                    if case .jobLost = e, let i = pending.firstIndex(where: { $0.id == id }), (pending[i].resubmits ?? 0) < 1 {
                        // Server slept or restarted (free hosting does this): start the book again, once.
                        pending[i].resubmits = (pending[i].resubmits ?? 0) + 1
                        pending[i].jobId = nil
                        Task { submit(id) }  // runs after this loop's `defer` clears the polling flag
                        return
                    }
                    if case .http(let code, _) = e, code >= 500 || code == 0, networkErrors < 30 {
                        networkErrors += 1
                        try? await Task.sleep(for: .seconds(10))
                        continue
                    }
                    fail(id, e.localizedDescription)
                    return
                } catch {
                    // Offline, timed out, or suspended mid-request: keep trying for a while.
                    networkErrors += 1
                    if networkErrors > 30 { fail(id, "Couldn't reach the book server. Try again later."); return }
                    try? await Task.sleep(for: .seconds(10))
                }
            }
        }
    }

    private func attachToSeries(_ book: Book, seriesId: String?) -> String {
        if let seriesId, let i = series.firstIndex(where: { $0.id == seriesId }) {
            series[i].summaries.append(book.summary)
            series[i].bookIds.append(book.id)
            for c in book.characters where !series[i].characters.contains(where: { $0.name.lowercased() == c.name.lowercased() }) {
                series[i].characters.append(c)
            }
            try? store.saveSeries(series)
            return seriesId
        }
        let s = Series(title: book.title, prompt: book.request.prompt, characters: book.characters, summaries: [book.summary], bookIds: [book.id])
        series.append(s)
        try? store.saveSeries(series)
        return s.id
    }

    var allCharacters: [StoryCharacter] {
        var seen = Set<String>()
        return series.flatMap(\.characters).filter { seen.insert($0.name.lowercased()).inserted }
    }
}
