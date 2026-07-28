import CoreGraphics

/// Pure layout policy shared by the Dynamic Island controller and view.
///
/// Keeping the screen-height math outside AppKit makes the low-resolution and
/// Dock-reserved cases deterministic and unit-testable.
enum DynamicIslandLayoutPolicy {
    static let expandedWidth: CGFloat = 480
    static let shadowBleed: CGFloat = 28
    static let maximumIslandHeight: CGFloat = 800
    static let fixedChromeHeight: CGFloat = 240
    static let minimumLimitsHeight: CGFloat = 96

    static var maximumPanelHeight: CGFloat {
        maximumIslandHeight + shadowBleed
    }

    /// Fits the panel between the physical top edge and the bottom of the
    /// usable desktop (above a visible Dock), while preserving a viable minimum
    /// on unusual display configurations.
    static func panelHeight(screenTop: CGFloat, visibleBottom: CGFloat) -> CGFloat {
        let available = max(0, screenTop - visibleBottom)
        return min(maximumPanelHeight, max(available, minimumLimitsHeight + fixedChromeHeight + shadowBleed))
    }

    /// The provider list consumes whatever vertical room remains after the
    /// header, summary cards, divider, footer, and shadow bleed.
    static func limitsHeight(panelHeight: CGFloat) -> CGFloat {
        max(minimumLimitsHeight, panelHeight - shadowBleed - fixedChromeHeight)
    }
}
