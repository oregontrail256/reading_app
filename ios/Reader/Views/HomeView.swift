import ReaderCore
import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var reading: Book?
    @State private var showNew = false
    @State private var showParent = false

    private let columns = [GridItem(.adaptive(minimum: 220, maximum: 280), spacing: 28)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Button { showNew = true } label: {
                        Label("Make a new book", systemImage: "sparkles")
                            .font(Theme.reading(32, bold: true))
                            .padding(.vertical, 22)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .clipShape(RoundedRectangle(cornerRadius: 24))

                    if !model.pending.isEmpty {
                        VStack(spacing: 12) {
                            ForEach(model.pending) { job in PendingRow(job: job) }
                        }
                    }

                    if model.books.isEmpty && model.pending.isEmpty {
                        ContentUnavailableView("No books yet", systemImage: "books.vertical",
                                               description: Text("Tap “Make a new book” and pick what it should be about."))
                    } else {
                        Text("My books").font(Theme.reading(30, bold: true))
                        LazyVGrid(columns: columns, spacing: 28) {
                            ForEach(model.books) { book in
                                Button { reading = book } label: { BookCard(book: book) }
                                    .buttonStyle(.plain)
                                    .contextMenu {
                                        Button("Delete book", systemImage: "trash", role: .destructive) { model.delete(book) }
                                    }
                            }
                        }
                    }
                }
                .padding(32)
            }
            .background(Theme.paper)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showParent = true } label: { Image(systemName: "gearshape").font(.title2) }
                        .accessibilityLabel("Grown-ups")
                }
            }
        }
        .sheet(isPresented: $showNew) { NewBookView() }
        .sheet(isPresented: $showParent) { ParentArea() }
        .fullScreenCover(item: $reading) { book in SessionView(book: book) }
    }
}

struct PendingRow: View {
    @Environment(AppModel.self) private var model
    let job: PendingBook

    var body: some View {
        HStack(spacing: 16) {
            switch job.status {
            case .writing:
                ProgressView().controlSize(.large)
                VStack(alignment: .leading) {
                    Text("Writing your book…").font(Theme.reading(24, bold: true))
                    Text(job.label).foregroundStyle(.secondary).lineLimit(1)
                }
            case let .failed(msg):
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.title)
                VStack(alignment: .leading) {
                    Text("That book didn't work out").font(Theme.reading(22, bold: true))
                    Text(msg).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Button("Try again") { model.retry(job) }.buttonStyle(.bordered)
                Button { model.dismiss(job) } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(.white, in: RoundedRectangle(cornerRadius: 20))
    }
}

struct BookCard: View {
    @Environment(AppModel.self) private var model
    let book: Book

    var body: some View {
        VStack(spacing: 10) {
            ZStack(alignment: .topTrailing) {
                Group {
                    if let url = model.coverImage(book), let img = UIImage(contentsOfFile: url.path) {
                        Image(uiImage: img).resizable().scaledToFill()
                    } else {
                        LinearGradient(colors: [Theme.accent.opacity(0.7), Theme.practice], startPoint: .topLeading, endPoint: .bottomTrailing)
                            .overlay(Image(systemName: "book.fill").font(.system(size: 56)).foregroundStyle(.white.opacity(0.8)))
                    }
                }
                .frame(height: 170)
                .frame(maxWidth: .infinity)
                .clipped()
                if book.finishedAt != nil {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.title)
                        .foregroundStyle(.green, .white)
                        .padding(8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))
            Text(book.title)
                .font(Theme.reading(22, bold: true))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .foregroundStyle(.primary)
        }
        .padding(12)
        .background(.white, in: RoundedRectangle(cornerRadius: 22))
        .shadow(color: .black.opacity(0.08), radius: 8, y: 4)
    }
}
