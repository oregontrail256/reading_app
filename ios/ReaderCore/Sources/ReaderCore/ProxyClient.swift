import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum ProxyError: LocalizedError {
    case badURL
    case http(Int, String)
    case rejected(String)
    /// The server no longer has this job (it restarted or slept). Safe to resubmit.
    case jobLost

    public var errorDescription: String? {
        switch self {
        case .badURL: return "The book server address in Settings isn't valid."
        case let .http(code, body): return "Book server error \(code): \(body.prefix(200))"
        case let .rejected(why): return why
        case .jobLost: return "The book server restarted and lost this book. Try again?"
        }
    }
}

/// Talks to engine/src/server.ts.
public struct ProxyClient: Sendable {
    public var baseURL: String
    public var token: String

    public init(baseURL: String, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    struct GenerateBody: Encodable {
        var snapshot: LearnerSnapshot
        var request: BookRequest
        var images: Bool
        var quality: String
    }

    struct ErrorBody: Decodable {
        var error: String
        var problems: [String]?
        var categories: [String]?
        var message: String?
    }

    /// Outcome of polling a job.
    public enum JobState: Sendable {
        case running(seconds: Int)
        case done(Book)
    }

    struct JobAck: Decodable { var id: String }
    struct JobStatus: Decodable {
        var status: String
        var seconds: Int?
        var book: Book?
        var error: String?
        var problems: [String]?
        var message: String?
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval = 30) throws -> URLRequest {
        guard let url = URL(string: baseURL.trimmingCharacters(in: .whitespaces))?.appendingPathComponent(path) else { throw ProxyError.badURL }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "content-type") }
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        req.httpBody = body
        return req
    }

    /// Start writing a book on the server. Returns a job id to poll.
    public func submit(snapshot: LearnerSnapshot, request bookRequest: BookRequest, images: Bool, quality: String) async throws -> String {
        let body = try JSONEncoder().encode(GenerateBody(snapshot: snapshot, request: bookRequest, images: images, quality: quality))
        let (data, resp) = try await URLSession.shared.data(for: try request("v1/jobs", method: "POST", body: body, timeout: 90))
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 202 || code == 200 else { throw Self.error(code: code, data: data) }
        return try JSONDecoder().decode(JobAck.self, from: data).id
    }

    /// Check on a job once. Throws ProxyError.rejected / .http when the job failed or is gone.
    public func poll(jobId: String) async throws -> JobState {
        let (data, resp) = try await URLSession.shared.data(for: try request("v1/jobs/\(jobId)", timeout: 90))
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 404 { throw ProxyError.jobLost }
        guard code == 200 else { throw Self.error(code: code, data: data) }
        let st = try JSONDecoder().decode(JobStatus.self, from: data)
        switch st.status {
        case "done":
            guard let book = st.book else { throw ProxyError.http(code, "done without a book") }
            return .done(book)
        case "running":
            return .running(seconds: st.seconds ?? 0)
        default:
            throw Self.error(code: 422, data: data)
        }
    }

    static func error(code: Int, data: Data) -> ProxyError {
        if code == 401 { return .rejected("The app token in Grown-ups doesn't match the book server.") }
        guard let e = try? JSONDecoder().decode(ErrorBody.self, from: data) else {
            return .http(code, String(decoding: data, as: UTF8.self))
        }
        switch e.error {
        case "prompt_flagged": return .rejected("Let's pick a different idea for this book.")
        case "output_flagged": return .rejected("That story didn't come out right. Try again?")
        case "validation_failed": return .rejected("Couldn't fit that story to the words he knows. Try again or tweak the idea.")
        default: return .http(code, e.message ?? e.error)
        }
    }

    public func health() async -> Bool {
        guard let url = URL(string: baseURL)?.appendingPathComponent("health") else { return false }
        guard let result = try? await URLSession.shared.data(from: url) else { return false }
        return (result.1 as? HTTPURLResponse)?.statusCode == 200
    }
}
