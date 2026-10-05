import ReaderCore
import SwiftUI

/// Kid-friendly book maker: pick who / where / what happens, or say an idea (keyboard dictation works).
@MainActor
struct NewBookView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// Picked "who" chips that aren't named characters ("a dragon").
    @State private var creatures: Set<String> = []
    @State private var place: String?
    @State private var problem: String?
    @State private var idea = ""
    @State private var cast: Set<String> = []

    private let whoOptions = ["a shark", "a dragon", "a robot", "a puppy", "a unicorn", "a dinosaur", "a kid detective", "a cat", "an astronaut", "a pirate", "a monster truck", "a frog"]
    private let placeOptions = ["at a bakery", "in space", "under the sea", "in a jungle", "in a castle", "at school", "on a farm", "on a volcano", "at the beach", "in a big city"]
    private let problemOptions = ["loses something", "has a big race", "makes a new friend", "gets caught in a storm", "plans a surprise party", "solves a mystery", "builds something huge", "goes on a trip"]

    /// Named characters he picked, in display order.
    private var pickedNames: [String] { model.allCharacters.map(\.name).filter { cast.contains($0) } }

    /// "Lincoln, Loki and a dragon"
    private var whoPhrase: String {
        let all = pickedNames + whoOptions.filter { creatures.contains($0) }
        guard all.count > 1 else { return all.first ?? "" }
        return all.dropLast().joined(separator: ", ") + " and " + all.last!
    }

    private var prompt: String {
        let typed = idea.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty { return whoPhrase.isEmpty ? typed : "\(typed), starring \(whoPhrase)" }
        if whoPhrase.isEmpty { return [place, problem].compactMap { $0 }.isEmpty ? "" : (["someone"] + [place, problem].compactMap { $0 }).joined(separator: " ") }
        let rest = [place, problem].compactMap { $0 }
        return rest.isEmpty ? "a fun adventure with \(whoPhrase)" : ([whoPhrase] + rest).joined(separator: " ")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Who is it about?").font(Theme.reading(26, bold: true))
                        Text("Pick as many as you like.").font(.callout).foregroundStyle(.secondary)
                        FlowLayout(spacing: 12, lineSpacing: 12) {
                            ForEach(model.allCharacters, id: \.name) { c in
                                chip(c.name, selected: cast.contains(c.name)) {
                                    if cast.contains(c.name) { cast.remove(c.name) } else { cast.insert(c.name); Speech.shared.say(c.name) }
                                }
                            }
                            ForEach(whoOptions, id: \.self) { o in
                                chip(o, selected: creatures.contains(o)) {
                                    if creatures.contains(o) { creatures.remove(o) } else { creatures.insert(o); Speech.shared.say(o) }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    chips("Where?", placeOptions, $place)
                    chips("What happens?", problemOptions, $problem)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Or tell me your own idea").font(Theme.reading(26, bold: true))
                        TextField("A shark who runs a bakery…", text: $idea, axis: .vertical)
                            .font(Theme.reading(26))
                            .padding(16)
                            .background(.white, in: RoundedRectangle(cornerRadius: 16))
                        Text("Tip: tap the microphone on the keyboard to say it.").font(.callout).foregroundStyle(.secondary)
                    }

                    if !prompt.isEmpty {
                        Text("“\(prompt)”").font(Theme.reading(28)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                    }
                    Button {
                        let chars = model.allCharacters.filter { cast.contains($0.name) }
                        model.requestBook(prompt: prompt, characters: chars)
                        dismiss()
                    } label: {
                        Label("Make my book!", systemImage: "wand.and.stars")
                            .font(Theme.reading(32, bold: true)).padding(.vertical, 18).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(prompt.isEmpty)
                }
                .padding(32)
            }
            .background(Theme.paper)
            .navigationTitle("New book")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func chips(_ title: String, _ options: [String], _ sel: Binding<String?>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(Theme.reading(26, bold: true))
            FlowLayout(spacing: 12, lineSpacing: 12) {
                ForEach(options, id: \.self) { o in
                    chip(o, selected: sel.wrappedValue == o) {
                        sel.wrappedValue = sel.wrappedValue == o ? nil : o
                        Speech.shared.say(o)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func chip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.reading(22))
                .padding(.horizontal, 18).padding(.vertical, 10)
                .background(selected ? Theme.accent : .white, in: Capsule())
                .foregroundStyle(selected ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }
}
