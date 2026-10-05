import ReaderCore
import SwiftUI

@main
@MainActor
struct ReaderApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.light)
                .task { await model.loadLexicon() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { model.resumePending() }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if let err = model.loadError {
                ContentUnavailableView("Something went wrong", systemImage: "exclamationmark.triangle", description: Text(err))
            } else if model.lexicon == nil {
                ProgressView("Getting ready…").font(.title2)
            } else if model.needsPlacement {
                PlacementView()
            } else {
                HomeView()
            }
        }
        .tint(Theme.accent)
    }
}

enum Theme {
    static let accent = Color(red: 0.16, green: 0.45, blue: 0.85)
    static let paper = Color(red: 1.0, green: 0.98, blue: 0.94)
    static let practice = Color(red: 1.0, green: 0.93, blue: 0.70)
    static let heart = Color(red: 1.0, green: 0.82, blue: 0.86)
    static let missed = Color(red: 0.95, green: 0.35, blue: 0.35)
    static let helped = Color(red: 0.98, green: 0.62, blue: 0.20)
    static let tapped = Color(red: 0.45, green: 0.65, blue: 0.98)

    /// Andika (designed for beginning readers, single-story "a") if bundled, else SF Rounded.
    static func reading(_ size: CGFloat, bold: Bool = false) -> Font {
        let name = bold ? "Andika-Bold" : "Andika"  // PostScript names inside the .ttf files
        if UIFont(name: name, size: size) != nil { return .custom(name, size: size) }
        return .system(size: size, weight: bold ? .bold : .regular, design: .rounded)
    }
}
