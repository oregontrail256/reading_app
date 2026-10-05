import SwiftUI

/// Wraps children onto lines like text, each line centered.
struct FlowLayout: Layout {
    var spacing: CGFloat = 14
    var lineSpacing: CGFloat = 18

    struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(_ maxWidth: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (i, v) in subviews.enumerated() {
            let s = v.sizeThatFits(.unspecified)
            let add = rows[rows.count - 1].indices.isEmpty ? s.width : s.width + spacing
            if rows[rows.count - 1].width + add > maxWidth, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            let r = rows.count - 1
            rows[r].width += rows[r].indices.isEmpty ? s.width : s.width + spacing
            rows[r].height = max(rows[r].height, s.height)
            rows[r].indices.append(i)
        }
        return rows
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rs = rows(maxWidth, subviews)
        let h = rs.reduce(0) { $0 + $1.height } + CGFloat(max(0, rs.count - 1)) * lineSpacing
        let w = rs.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? w, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(bounds.width, subviews) {
            var x = bounds.minX + (bounds.width - row.width) / 2
            for i in row.indices {
                let s = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - s.height) / 2), proposal: ProposedViewSize(s))
                x += s.width + spacing
            }
            y += row.height + lineSpacing
        }
    }
}
