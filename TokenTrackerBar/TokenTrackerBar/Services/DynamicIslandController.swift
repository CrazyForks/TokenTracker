import AppKit
import SwiftUI

/// Geometry of the island, derived from the target screen's hardware notch
/// (or a simulated pill on notch-less screens). Published to the SwiftUI view
/// so the collapsed shape hugs the real notch dimensions.
struct DynamicIslandGeometry: Equatable {
    /// Width of the hardware notch — the collapsed island's opaque center that
    /// the notch itself occludes. On notch-less screens this is a small filler
    /// segment between the two text wings.
    var centerGapWidth: CGFloat
    /// Collapsed island height == the notch height (safe-area top inset) on
    /// notched screens; a menu-bar-ish height for the simulated island.
    var collapsedHeight: CGFloat
    /// Width of each text wing flanking the notch (tokens left, cost right).
    /// Content-driven: the view measures both labels and reports the tighter
    /// max(left, right) back through `onWingWidthChanged`, so the black wings
    /// hug the text instead of padding the island out. Both wings share one
    /// width to keep the island symmetric around the notch center.
    var wingWidth: CGFloat
    var hasNotch: Bool

    /// Floor so a tiny value (e.g. "0") still reads as an island wing.
    static let minWingWidth: CGFloat = 44

    var collapsedWidth: CGFloat { centerGapWidth + wingWidth * 2 }

    static let expandedSize = NSSize(width: 480, height: 348)

    /// Simulated island for screens without a notch (external displays, older
    /// Macs): a compact pill at the top-center, boring.notch-style.
    static let simulated = DynamicIslandGeometry(
        centerGapWidth: 28,
        collapsedHeight: 30,
        wingWidth: 60,
        hasNotch: false
    )
}

/// Observable UI state shared between the controller (which owns the panel
/// frame) and the SwiftUI content (which animates the island shape).
@MainActor
final class DynamicIslandState: ObservableObject {
    @Published var isExpanded = false
    @Published var geometry = DynamicIslandGeometry.simulated
    /// Mirrors the panel's current content size. The SwiftUI root pins itself
    /// to this exact frame — a fluid (`maxWidth: .infinity`) root on a
    /// borderless panel routes invalidations into NSWindow's constraint
    /// machinery, which throws and crashes (same trap DesktopPetHost avoids).
    @Published var panelSize = CGSize(
        width: DynamicIslandGeometry.expandedSize.width,
        height: DynamicIslandGeometry.expandedSize.height
    )
    /// Bumped on `.nativeSettingsChanged` so currency/locale changes re-render
    /// the cost strings without waiting for the next data refresh.
    @Published var settingsTick = 0
}

/// Notch-hugging "Dynamic Island" (boring.notch-style): a transparent,
/// always-on-top, non-activating panel pinned to the top-center of the screen.
/// Collapsed it shows today's tokens (left wing) and today's cost (right wing)
/// around the hardware notch; hovering expands it into a spend + limits detail
/// card. Shares the app's single `DashboardViewModel` — no independent polling.
@MainActor
final class DynamicIslandController: NSObject {
    static let enabledDefaultsKey = "DynamicIslandEnabled"

    /// Delay before collapsing after the pointer leaves, so grazing the island
    /// edge (or the frame swap under the cursor) doesn't flap it shut.
    private static let collapseDelay: TimeInterval = 0.25
    /// How long the shrink animation runs before the panel frame snaps back to
    /// the collapsed rect (must exceed the SwiftUI spring's visible settle).
    private static let frameShrinkDelay: TimeInterval = 0.4

    private let viewModel: DashboardViewModel
    private let state = DynamicIslandState()
    private var panel: NSPanel?
    private var collapseWorkItem: DispatchWorkItem?
    private var shrinkWorkItem: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = []

    init(viewModel: DashboardViewModel) {
        self.viewModel = viewModel
        super.init()

        observers.append(NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.repositionPanel() }
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: .nativeSettingsChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.state.settingsTick += 1 }
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: Self.enabledDefaultsKey)
    }

    func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.enabledDefaultsKey)
        if enabled { show() } else { hide() }
    }

    /// Re-show the island on launch if it was enabled when the app last quit.
    func restoreIfNeeded() {
        if isEnabled { show() }
    }

    func show() {
        let panel = panel ?? makePanel()
        self.panel = panel
        repositionPanel()
        panel.orderFrontRegardless()
    }

    func hide() {
        collapseWorkItem?.cancel()
        shrinkWorkItem?.cancel()
        state.isExpanded = false
        panel?.orderOut(nil)
    }

    // MARK: - Hover-driven expand / collapse

    private func handleHover(_ hovering: Bool) {
        collapseWorkItem?.cancel()
        collapseWorkItem = nil
        if hovering {
            expand()
        } else {
            let item = DispatchWorkItem { [weak self] in self?.collapse() }
            collapseWorkItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.collapseDelay, execute: item)
        }
    }

    private func expand() {
        shrinkWorkItem?.cancel()
        shrinkWorkItem = nil
        guard panel != nil, let screen = targetScreen() else { return }
        // Grow the (transparent) frame first so the island has room to animate
        // into; the shape itself animates in SwiftUI.
        setPanelFrame(expandedFrame(on: screen))
        guard !state.isExpanded else { return }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            state.isExpanded = true
        }
    }

    private func collapse() {
        guard state.isExpanded else { return }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
            state.isExpanded = false
        }
        // Shrink the frame only after the shape has visibly settled, otherwise
        // the window clips the animating island.
        let item = DispatchWorkItem { [weak self] in
            guard let self, !self.state.isExpanded else { return }
            guard self.panel != nil, let screen = self.targetScreen() else { return }
            self.setPanelFrame(self.collapsedFrame(on: screen))
        }
        shrinkWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.frameShrinkDelay, execute: item)
    }

    // MARK: - Screen + geometry

    /// Prefer a screen with a hardware notch; otherwise fall back to the main
    /// screen with a simulated island.
    private func targetScreen() -> NSScreen? {
        NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    private func geometry(for screen: NSScreen) -> DynamicIslandGeometry {
        // Carry the current content-measured wing width across screen changes;
        // the view re-measures and corrects it if the labels differ.
        let wingWidth = max(DynamicIslandGeometry.minWingWidth, state.geometry.wingWidth)
        let inset = screen.safeAreaInsets.top
        guard inset > 0 else {
            var geo = DynamicIslandGeometry.simulated
            geo.wingWidth = wingWidth
            return geo
        }
        let leftWidth = screen.auxiliaryTopLeftArea?.width ?? 0
        let rightWidth = screen.auxiliaryTopRightArea?.width ?? 0
        let notchWidth = screen.frame.width - leftWidth - rightWidth
        guard notchWidth > 0, notchWidth < screen.frame.width / 2 else {
            var geo = DynamicIslandGeometry.simulated
            geo.wingWidth = wingWidth
            return geo
        }
        return DynamicIslandGeometry(
            centerGapWidth: notchWidth,
            collapsedHeight: inset,
            wingWidth: wingWidth,
            hasNotch: true
        )
    }

    /// The view measured its wing labels; adopt the tight width and re-fit the
    /// collapsed frame so the panel never has dead transparent margins.
    private func applyWingWidth(_ width: CGFloat) {
        let clamped = max(DynamicIslandGeometry.minWingWidth, width)
        guard abs(clamped - state.geometry.wingWidth) > 0.5 else { return }
        state.geometry.wingWidth = clamped
        guard !state.isExpanded, panel != nil, let screen = targetScreen() else { return }
        setPanelFrame(collapsedFrame(on: screen))
    }

    private func collapsedFrame(on screen: NSScreen) -> NSRect {
        let geo = state.geometry
        return NSRect(
            x: screen.frame.midX - geo.collapsedWidth / 2,
            y: screen.frame.maxY - geo.collapsedHeight,
            width: geo.collapsedWidth,
            height: geo.collapsedHeight
        )
    }

    private func expandedFrame(on screen: NSScreen) -> NSRect {
        let geo = state.geometry
        let size = NSSize(
            width: max(DynamicIslandGeometry.expandedSize.width, geo.collapsedWidth),
            height: max(DynamicIslandGeometry.expandedSize.height, geo.collapsedHeight)
        )
        return NSRect(
            x: screen.frame.midX - size.width / 2,
            y: screen.frame.maxY - size.height,
            width: size.width,
            height: size.height
        )
    }

    /// Recompute geometry and re-pin to the current target screen (display
    /// plug/unplug, lid close, resolution change).
    private func repositionPanel() {
        guard panel != nil, let screen = targetScreen() else { return }
        let geo = geometry(for: screen)
        if geo != state.geometry { state.geometry = geo }
        let frame = state.isExpanded ? expandedFrame(on: screen) : collapsedFrame(on: screen)
        setPanelFrame(frame)
    }

    /// Single write path for the panel frame: keeps `state.panelSize` in sync
    /// so the SwiftUI root's fixed frame always matches the window exactly.
    private func setPanelFrame(_ frame: NSRect) {
        if state.panelSize != frame.size { state.panelSize = frame.size }
        panel?.setFrame(frame, display: true)
    }

    // MARK: - Panel

    private func makePanel() -> NSPanel {
        // Hosting *controller* (not a bare NSHostingView as contentView): on a
        // borderless panel the latter routes SwiftUI invalidations into
        // NSWindow constraint updates, which throws and crashes (see
        // DesktopPetWindowController for the original diagnosis).
        let hostingController = NSHostingController(
            rootView: DynamicIslandView(
                viewModel: viewModel,
                state: state,
                onHoverChanged: { [weak self] hovering in
                    Task { @MainActor [weak self] in self?.handleHover(hovering) }
                },
                onWingWidthChanged: { [weak self] width in
                    Task { @MainActor [weak self] in self?.applyWingWidth(width) }
                }
            )
        )

        // Never let the hosting controller drive the window size — the
        // controller owns the frame (collapsed vs expanded) exclusively.
        if #available(macOS 13.0, *) {
            hostingController.sizingOptions = []
        }

        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: DynamicIslandGeometry.expandedSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentViewController = hostingController
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // The island draws its own SwiftUI shadow when expanded; a window
        // shadow would trace the transparent frame rect instead.
        panel.hasShadow = false
        // Sit above the menu bar so the island hugs the notch, ride along to
        // every Space / full-screen app, stay out of Cmd-Tab.
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.acceptsMouseMovedEvents = true
        panel.isMovableByWindowBackground = false
        return panel
    }
}

/// Never steals key/main status — the island is display-only chrome.
private final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
