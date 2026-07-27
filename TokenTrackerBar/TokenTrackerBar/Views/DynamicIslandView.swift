import SwiftUI

/// SwiftUI content of the Dynamic Island panel.
///
/// Collapsed: a notch-hugging black bar — today's tokens on the left wing,
/// today's cost on the right wing, the center occluded by the hardware notch.
/// Hover: expands into a spend summary (today / 7d / 30d / total) plus the
/// usage-limits bars, all fed by the shared `DashboardViewModel`.
struct DynamicIslandView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @ObservedObject var state: DynamicIslandState
    let onHoverChanged: (Bool) -> Void
    /// Reports the measured wing width (max of both labels + breathing room)
    /// so the controller can shrink the panel to hug the text.
    let onWingWidthChanged: (CGFloat) -> Void

    /// Horizontal breathing room added around the widest wing label.
    private static let wingPadding: CGFloat = 16

    var body: some View {
        // Referenced so currency/locale changes force a re-render.
        let _ = state.settingsTick
        VStack(spacing: 0) {
            island
            Spacer(minLength: 0)
        }
        // Fixed root frame matching the panel exactly — a fluid root on a
        // borderless panel triggers NSWindow constraint updates that crash.
        .frame(width: state.panelSize.width, height: state.panelSize.height, alignment: .top)
        // The island is always a black surface — force dark styling for the
        // embedded summary cards and limit bars regardless of system theme.
        .environment(\.colorScheme, .dark)
        .preferredColorScheme(.dark)
    }

    private var island: some View {
        let geo = state.geometry
        let expanded = state.isExpanded
        let width = expanded
            ? max(DynamicIslandGeometry.expandedSize.width, geo.collapsedWidth)
            : geo.collapsedWidth
        let height = expanded ? DynamicIslandGeometry.expandedSize.height : geo.collapsedHeight
        let shape = BottomRoundedRectangle(radius: expanded ? 22 : min(12, geo.collapsedHeight / 2.5))

        return VStack(spacing: 0) {
            collapsedRow
            if expanded {
                expandedContent
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(width: width, height: height, alignment: .top)
        .background(shape.fill(Color.black))
        .clipShape(shape)
        .shadow(color: .black.opacity(expanded ? 0.45 : 0), radius: 14, y: 6)
        .onHover(perform: onHoverChanged)
    }

    // MARK: - Collapsed wings

    /// Tokens left, cost right; the center gap sits behind the hardware notch
    /// (or is plain filler on the simulated island). Also kept as the header
    /// row while expanded so the numbers never jump around.
    private var collapsedRow: some View {
        let geo = state.geometry
        return HStack(spacing: 0) {
            leftWing
                .frame(width: geo.wingWidth)
            Spacer()
                .frame(width: geo.centerGapWidth)
            rightWing
                .frame(width: geo.wingWidth)
        }
        .frame(height: geo.collapsedHeight)
        // Invisible natural-size copies of both wings: their measured max
        // drives the shared wing width, keeping the island tight + symmetric.
        .background(
            HStack(spacing: 0) {
                measured(leftWing)
                measured(rightWing)
            }
            .hidden()
        )
        .onPreferenceChange(WingNaturalWidthKey.self) { natural in
            onWingWidthChanged(ceil(natural) + Self.wingPadding)
        }
    }

    private var leftWing: some View {
        HStack(spacing: 3) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 8.5, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.92))
            wingLabel(TokenFormatter.formatCompact(viewModel.todayTokens))
        }
    }

    private var rightWing: some View {
        wingLabel(viewModel.todayCost)
    }

    private func measured<Content: View>(_ content: Content) -> some View {
        content
            .fixedSize()
            .background(GeometryReader { proxy in
                Color.clear.preference(key: WingNaturalWidthKey.self, value: proxy.size.width)
            })
    }

    private func wingLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color.white.opacity(0.92))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    // MARK: - Expanded detail

    private var expandedContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            SummaryCardsView(
                todayTokens: viewModel.todayTokens,
                todayCost: viewModel.todayCost,
                last7dTokens: viewModel.last7dTokens,
                last7dActiveDays: viewModel.last7dActiveDays,
                last30dTokens: viewModel.last30dTokens,
                last30dAvgPerDay: viewModel.last30dAvgPerDay,
                totalTokens: viewModel.totalTokens,
                totalCost: viewModel.totalCost
            )

            ScrollView(.vertical, showsIndicators: false) {
                UsageLimitsView(limits: viewModel.usageLimits)
                    .padding(.bottom, 4)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// Widest natural wing-label width; both wings adopt the max so the island
/// stays symmetric around the notch center.
private struct WingNaturalWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// Rectangle with only the bottom two corners rounded, so the island's top
/// edge merges seamlessly with the screen edge / hardware notch.
struct BottomRoundedRectangle: Shape {
    var radius: CGFloat

    var animatableData: CGFloat {
        get { radius }
        set { radius = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let r = min(radius, min(rect.width, rect.height) / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - r, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - r),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.closeSubpath()
        return path
    }
}
