import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum ProxyError: LocalizedError {
    case badURL
    case http(Int, String)
    case rejected(String)

    public var errorDescription: String? {
        switch self {
        case .badURL: return "The book server address in Settings isn't valid."
        case let .http(code, body): return "Book server error \(code): \(body.prefix(200))"
        case let .rejected(why): return why
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

    public func generate(snapshot: LearnerSnapshot, request: BookRequest, images: Bool, quality: String) async throws -> Book {
        guard let url = URL(string: baseURL.trimmingCharacters(in: .whitespaces))?.appendingPathComponent("v1/books") else { throw ProxyError.badURL }
        var req = URLRequest(url: url, timeoutInterval: 600)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        req.httpBody = try JSONEncoder().encode(GenerateBody(snapshot: snapshot, request: request, images: images, quality: quality))
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 200 { return try JSONDecoder().decode(Book.self, from: data) }
        if let e = try? JSONDecoder().decode(ErrorBody.self, from: data) {
            switch e.error {
            case "prompt_flagged": throw ProxyError.rejected("Let's pick a different idea for this book.")
            case "output_flagged": throw ProxyError.rejected("That story didn't come out right. Try again?")
            case "validation_failed": throw ProxyError.rejected("Couldn't fit that story to the words he knows (\(e.problems?.first ?? "")). Try again or tweak the idea.")
            default: throw ProxyError.http(code, e.message ?? e.error)
            }
        }
        throw ProxyError.http(code, String(decoding: data, as: UTF8.self))
    }

    public func health() async -> Bool {
        guard let url = URL(string: baseURL)?.appendingPathComponent("health") else { return false }
        guard let result = try? await URLSession.shared.data(from: url) else { return false }
        return (result.1 as? HTTPURLResponse)?.statusCode == 200
    }
}
