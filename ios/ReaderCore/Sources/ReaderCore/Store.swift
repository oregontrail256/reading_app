import Foundation

/// A recurring set of characters and the story so far.
public struct Series: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var prompt: String
    public var characters: [StoryCharacter]
    public var summaries: [String]
    public var bookIds: [String]

    public init(id: String = UUID().uuidString, title: String, prompt: String, characters: [StoryCharacter], summaries: [String] = [], bookIds: [String] = []) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.characters = characters
        self.summaries = summaries
        self.bookIds = bookIds
    }
}

public struct AppSettings: Codable, Sendable, Equatable {
    public var proxyURL: String = "http://localhost:8787"
    public var appToken: String = ""
    public var images: Bool = true
    public var imageQuality: String = "low"
    public var avoidTopics: String = "scary monsters, getting lost"
    public var readingMode: ReadingMode = .together
    public var pages: Int = 10
    public var childName: String = ""
    public init() {}

    /// The family cast offered on the "Make a new book" screen. Descriptions go to both the story
    /// writer and the illustrator, so looks stay consistent across books.
    public static let defaultFamily: [StoryCharacter] = [
        StoryCharacter(name: "Jamie", description: "a boy with black hair"),
        StoryCharacter(name: "Lincoln", description: "a boy with black hair"),
        StoryCharacter(name: "Mommy", description: "the kids' mom, a woman with black hair"),
        StoryCharacter(name: "Daddy", description: "the kids' dad, a man with black hair"),
        StoryCharacter(name: "Lily", description: "a girl with black hair"),
        StoryCharacter(name: "Reese", description: "a girl with black hair"),
        StoryCharacter(name: "Loki", description: "the family dog: a small black-and-white dog that looks like a mini border collie or sheltie"),
    ]

    // Tolerant decoding: settings saved by an older version (missing newer keys) keep their values
    // and get defaults for the rest, instead of being thrown away.
    enum CodingKeys: String, CodingKey {
        case proxyURL, appToken, images, imageQuality, avoidTopics, readingMode, pages, childName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppSettings()
        proxyURL = try c.decodeIfPresent(String.self, forKey: .proxyURL) ?? d.proxyURL
        appToken = try c.decodeIfPresent(String.self, forKey: .appToken) ?? d.appToken
        images = try c.decodeIfPresent(Bool.self, forKey: .images) ?? d.images
        imageQuality = try c.decodeIfPresent(String.self, forKey: .imageQuality) ?? d.imageQuality
        avoidTopics = try c.decodeIfPresent(String.self, forKey: .avoidTopics) ?? d.avoidTopics
        readingMode = try c.decodeIfPresent(ReadingMode.self, forKey: .readingMode) ?? d.readingMode
        pages = try c.decodeIfPresent(Int.self, forKey: .pages) ?? d.pages
        childName = try c.decodeIfPresent(String.self, forKey: .childName) ?? d.childName
    }
}

/// JSON-file persistence under one directory:
///   learner.json, settings.json, series.json, events.jsonl, books/<id>.json, books/<id>/<n>.jpg
public final class FileStore: @unchecked Sendable {
    public let root: URL
    private let fm = FileManager.default
    private let enc: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
    private let dec: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    public init(root: URL) throws {
        self.root = root
        try fm.createDirectory(at: root.appendingPathComponent("books"), withIntermediateDirectories: true)
    }

    public static func defaultRoot() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Reader", isDirectory: true)
    }

    // MARK: Generic

    public func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: root.appendingPathComponent(name)) else { return nil }
        return try? dec.decode(T.self, from: data)
    }

    public func save<T: Encodable>(_ value: T, _ name: String) throws {
        try enc.encode(value).write(to: root.appendingPathComponent(name), options: .atomic)
    }

    // MARK: Learner, settings, series

    public func loadLearner() -> LearnerState? { load(LearnerState.self, "learner.json") }
    public func saveLearner(_ s: LearnerState) throws { try save(s, "learner.json") }
    public func loadSettings() -> AppSettings { load(AppSettings.self, "settings.json") ?? AppSettings() }
    public func saveSettings(_ s: AppSettings) throws { try save(s, "settings.json") }
    public func loadSeries() -> [Series] { load([Series].self, "series.json") ?? [] }
    public func saveSeries(_ s: [Series]) throws { try save(s, "series.json") }

    // MARK: Events (append-only log)

    public func append(events: [ReadEvent]) throws {
        guard !events.isEmpty else { return }
        let url = root.appendingPathComponent("events.jsonl")
        var blob = Data()
        for ev in events {
            blob.append(try enc.encode(ev))
            blob.append(0x0A)
        }
        if let h = try? FileHandle(forWritingTo: url) {
            defer { try? h.close() }
            try h.seekToEnd()
            try h.write(contentsOf: blob)
        } else {
            try blob.write(to: url)
        }
    }

    public func loadEvents() -> [ReadEvent] {
        guard let text = try? String(contentsOf: root.appendingPathComponent("events.jsonl"), encoding: .utf8) else { return [] }
        return text.split(separator: "\n").compactMap { try? dec.decode(ReadEvent.self, from: Data($0.utf8)) }
    }

    // MARK: Books

    /// Save a book, moving base64 images out to JPEG files.
    public func save(book: Book) throws {
        var b = book
        let dir = imageDir(b.id)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        if let c = b.cover, let data = Data(base64Encoded: c) {
            try data.write(to: dir.appendingPathComponent("cover.jpg"))
            b.cover = nil
        }
        for i in b.pages.indices {
            if let img = b.pages[i].image, let data = Data(base64Encoded: img) {
                try data.write(to: dir.appendingPathComponent("\(i).jpg"))
                b.pages[i].image = nil
            }
        }
        try save(b, "books/\(b.id).json")
    }

    public func loadBooks() -> [Book] {
        let dir = root.appendingPathComponent("books")
        let files = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? dec.decode(Book.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    public func deleteBook(id: String) {
        try? fm.removeItem(at: root.appendingPathComponent("books/\(id).json"))
        try? fm.removeItem(at: imageDir(id))
    }

    public func imageDir(_ bookId: String) -> URL { root.appendingPathComponent("books/\(bookId)", isDirectory: true) }
    public func coverURL(_ bookId: String) -> URL { imageDir(bookId).appendingPathComponent("cover.jpg") }
    public func pageImageURL(_ bookId: String, page: Int) -> URL { imageDir(bookId).appendingPathComponent("\(page).jpg") }
}
