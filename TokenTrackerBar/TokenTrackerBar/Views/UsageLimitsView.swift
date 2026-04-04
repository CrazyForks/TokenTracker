import SwiftUI
import AppKit

struct UsageLimitsView: View {
    @Environment(\.colorScheme) private var colorScheme
    let limits: UsageLimitsResponse?

    var body: some View {
        if let limits,
           limits.claude.configured || limits.codex.configured || limits.cursor.configured || limits.gemini.configured || limits.kiro.configured || limits.antigravity.configured
        {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: Strings.usageLimitsTitle)

                if limits.claude.configured {
                    toolSection(title: "Claude", assetName: "ClaudeLogo") {
                        claudeContent(limits.claude)
                    }
                }

                if limits.codex.configured {
                    toolSection(title: "Codex", assetName: "CodexLogo") {
                        codexContent(limits.codex)
                    }
                }

                if limits.cursor.configured {
                    toolSection(title: "Cursor", assetName: "CursorLogo") {
                        cursorContent(limits.cursor)
                    }
                }

                if limits.gemini.configured {
                    toolSection(title: "Gemini", assetName: "GeminiLogo") {
                        geminiContent(limits.gemini)
                    }
                }

                if limits.kiro.configured {
                    toolSection(title: "Kiro", assetName: nil) {
                        kiroContent(limits.kiro)
                    }
                }

                if limits.antigravity.configured {
                    toolSection(title: "Antigravity", assetName: "AntigravityLogo") {
                        antigravityContent(limits.antigravity)
                    }
                }
            }
        }
    }

    // MARK: - Tool Section

    private func toolSection<Content: View>(
        title: String,
        assetName: String?,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                if let assetName {
                    brandIcon(assetName)
                        .frame(width: 14, height: 14)
                }
                Text(title)
                    .font(.system(.caption, design: .default))
                    .fontWeight(.medium)
            }
            content()
        }
    }

    // MARK: - Claude

    @ViewBuilder
    private func claudeContent(_ claude: ClaudeLimits) -> some View {
        if let error = claude.error {
            errorRow(error)
        } else {
            VStack(spacing: 4) {
                if let w = claude.fiveHour {
                    limitRow(label: "5h", pct: w.utilization, reset: relativeReset(iso: w.resetsAt), toolName: "Claude")
                }
                if let w = claude.sevenDay {
                    limitRow(label: "7d", pct: w.utilization, reset: relativeReset(iso: w.resetsAt), toolName: "Claude")
                }
                if let w = claude.sevenDayOpus {
                    limitRow(label: "Opus", pct: w.utilization, reset: relativeReset(iso: w.resetsAt), toolName: "Claude")
                }
            }
        }
    }

    // MARK: - Codex

    @ViewBuilder
    private func codexContent(_ codex: CodexLimits) -> some View {
        if let error = codex.error {
            errorRow(error)
        } else {
            VStack(spacing: 4) {
                if let w = codex.primaryWindow {
                    limitRow(label: "5h", pct: Double(w.usedPercent), reset: relativeReset(epoch: w.resetAt), toolName: "Codex")
                }
                if let w = codex.secondaryWindow {
                    limitRow(label: "7d", pct: Double(w.usedPercent), reset: relativeReset(epoch: w.resetAt), toolName: "Codex")
                }
            }
        }
    }

    // MARK: - Cursor

    @ViewBuilder
    private func cursorContent(_ cursor: CursorLimits) -> some View {
        if let error = cursor.error {
            errorRow(error)
        } else {
            VStack(spacing: 4) {
                if let w = cursor.primaryWindow {
                    limitRow(label: "Plan", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Cursor")
                }
                if let w = cursor.secondaryWindow {
                    limitRow(label: "Auto", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Cursor")
                }
                if let w = cursor.tertiaryWindow {
                    limitRow(label: "API", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Cursor")
                }
            }
        }
    }

    // MARK: - Kiro

    @ViewBuilder
    private func geminiContent(_ gemini: GeminiLimits) -> some View {
        if let error = gemini.error {
            errorRow(error)
        } else {
            VStack(spacing: 4) {
                if let w = gemini.primaryWindow {
                    limitRow(label: "Pro", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Gemini")
                }
                if let w = gemini.secondaryWindow {
                    limitRow(label: "Flash", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Gemini")
                }
                if let w = gemini.tertiaryWindow {
                    limitRow(label: "Lite", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Gemini")
                }
            }
        }
    }

    // MARK: - Kiro

    @ViewBuilder
    private func kiroContent(_ kiro: KiroLimits) -> some View {
        if let error = kiro.error {
            errorRow(error)
        } else {
            VStack(spacing: 4) {
                if let w = kiro.primaryWindow {
                    limitRow(label: "Month", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Kiro")
                }
                if let w = kiro.secondaryWindow {
                    limitRow(label: "Bonus", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Kiro")
                }
            }
        }
    }

    // MARK: - Antigravity

    @ViewBuilder
    private func antigravityContent(_ antigravity: AntigravityLimits) -> some View {
        if let error = antigravity.error {
            errorRow(error)
        } else {
            VStack(spacing: 4) {
                if let w = antigravity.primaryWindow {
                    limitRow(label: "Claude", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Antigravity")
                }
                if let w = antigravity.secondaryWindow {
                    limitRow(label: "G Pro", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Antigravity")
                }
                if let w = antigravity.tertiaryWindow {
                    limitRow(label: "Flash", pct: w.usedPercent, reset: relativeReset(iso: w.resetAt), toolName: "Antigravity")
                }
            }
        }
    }

    // MARK: - Row

    private func limitRow(label: String, pct: Double, reset: String?, toolName: String) -> some View {
        let clamped = min(max(pct, 0), 100)
        let fraction = clamped / 100.0
        let a11yParts = [
            "\(toolName) \(label) limit, \(Int(clamped.rounded()))%",
            reset.map { "resets in \($0)" }
        ].compactMap { $0 }

        return HStack(spacing: 5) {
            Text(label)
                .font(.system(.caption, design: .default))
                .foregroundStyle(.secondary)
                .frame(width: 42, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.limitTrack)
                    if fraction > 0 {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.limitBar(fraction: fraction))
                            .frame(width: max(3, geo.size.width * min(fraction, 1.0)))
                    }
                }
            }
            .frame(height: 5)

            Text("\(Int(clamped.rounded()))%")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .trailing)

            if let reset {
                Text(reset)
                    .font(.system(.caption2, design: .default))
                    .foregroundStyle(.tertiary)
                    .frame(width: 24, alignment: .trailing)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(a11yParts.joined(separator: ", "))
    }

    private func errorRow(_ message: String) -> some View {
        Text((message == "token_expired" || message == "session_expired") ? Strings.sessionExpired : message)
            .font(.system(.caption2, design: .default))
            .foregroundStyle(.tertiary)
            .lineLimit(1)
    }

    // MARK: - Helpers

    private func relativeReset(iso: String?) -> String? {
        guard let iso else { return nil }
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: iso) ?? {
            fmt.formatOptions = [.withInternetDateTime]
            return fmt.date(from: iso)
        }() else { return nil }
        return relativeString(from: date)
    }

    private func relativeReset(epoch: Int?) -> String? {
        guard let epoch else { return nil }
        return relativeString(from: Date(timeIntervalSince1970: TimeInterval(epoch)))
    }

    private func relativeString(from date: Date) -> String {
        let s = date.timeIntervalSince(Date())
        guard s > 0 else { return "now" }
        let h = Int(s) / 3600
        if h > 24 { return "\(h / 24)d" }
        if h > 0 { return "\(h)h" }
        return "\(Int(s) / 60)m"
    }

    @ViewBuilder
    private func brandIcon(_ name: String) -> some View {
        switch name {
        case "CursorLogo":
            if let image = bundledSVGIcon(
                named: "cursor.svg",
                replacingCurrentColorWith: colorScheme == .dark ? "#FFFFFF" : "#111111"
            ) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            }
        default:
            Image(name)
                .renderingMode(.original)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
        }
    }

    private func bundledSVGIcon(named filename: String, replacingCurrentColorWith color: String? = nil) -> NSImage? {
        guard let url = Bundle.main.resourceURL?
            .appendingPathComponent("EmbeddedServer/tokentracker/dashboard/dist/brand-logos/\(filename)"),
              var svg = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }

        if let color {
            svg = svg.replacingOccurrences(of: "currentColor", with: color)
        }

        svg = normalizedIconSVG(svg, targetSize: 24)

        guard let data = svg.data(using: .utf8),
              let sourceImage = NSImage(data: data) else {
            return nil
        }

        sourceImage.size = NSSize(width: 24, height: 24)
        sourceImage.isTemplate = false
        return sourceImage
    }

    private func normalizedIconSVG(_ svg: String, targetSize: Int) -> String {
        var normalized = svg
        let widthPattern = #"width\s*=\s*"[^"]*""#
        let heightPattern = #"height\s*=\s*"[^"]*""#

        if normalized.range(of: widthPattern, options: .regularExpression) != nil {
            normalized = normalized.replacingOccurrences(
                of: widthPattern,
                with: #"width="\#(targetSize)""#,
                options: .regularExpression
            )
        } else {
            normalized = normalized.replacingOccurrences(
                of: "<svg",
                with: #"<svg width="\#(targetSize)""#,
                options: .literal,
                range: normalized.range(of: "<svg")
            )
        }

        if normalized.range(of: heightPattern, options: .regularExpression) != nil {
            normalized = normalized.replacingOccurrences(
                of: heightPattern,
                with: #"height="\#(targetSize)""#,
                options: .regularExpression
            )
        } else {
            normalized = normalized.replacingOccurrences(
                of: "<svg",
                with: #"<svg height="\#(targetSize)""#,
                options: .literal,
                range: normalized.range(of: "<svg")
            )
        }

        return normalized
    }
}
