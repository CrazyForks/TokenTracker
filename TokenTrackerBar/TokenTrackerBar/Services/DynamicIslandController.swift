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
    /// Horizontal center of the island in screen coordinates. The hardware
    /// notch is not always exactly at the screen's midX (auxiliary areas can
    /// differ by a point), so the island centers on the notch itself.
    var islandCenterX: CGFloat = 0

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
    ///
    /// Always the expanded size while the island is visible: the window never
    /// resizes on hover, so the black shape can spring from the top edge
    /// without a wallpaper seam.
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
    /// edge doesn't flap it shut.
    private static let collapseDelay: TimeInterval = 0.25

    private let viewModel: DashboardViewModel
    private let state = DynamicIslandState()
    private var panel: IslandPanel?
    /// Retained separately because we host its view inside `IslandHitView`
    /// rather than assigning `contentViewController` (which would replace our
    /// hit-test wrapper).
    private var hostingController: NSHostingController<DynamicIslandView>?
    private var collapseWorkItem: DispatchWorkItem?
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
        guard !state.isExpanded else { return }
        // Panel frame stays put — only the black shape springs open from the
        // top. Resizing the window mid-animation was what opened the seam.
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            state.isExpanded = true
        }
        panel?.updateHitRegion()
    }

    private func collapse() {
        guard state.isExpanded else { return }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
            state.isExpanded = false
        }
        // Refresh hit-test after the spring settles so the large expanded
        // rect doesn't keep stealing clicks under the transparent wings.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, !self.state.isExpanded else { return }
            self.panel?.updateHitRegion()
        }
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
            geo.islandCenterX = screen.frame.midX
            return geo
        }
        let leftWidth = screen.auxiliaryTopLeftArea?.width ?? 0
        let rightWidth = screen.auxiliaryTopRightArea?.width ?? 0
        let notchWidth = screen.frame.width - leftWidth - rightWidth
        guard notchWidth > 0, notchWidth < screen.frame.width / 2 else {
            var geo = DynamicIslandGeometry.simulated
            geo.wingWidth = wingWidth
            geo.islandCenterX = screen.frame.midX
            return geo
        }
        return DynamicIslandGeometry(
            centerGapWidth: notchWidth,
            collapsedHeight: inset,
            wingWidth: wingWidth,
            hasNotch: true,
            // Center on the physical notch (aux areas can be asymmetric by a
            // point), not the screen midpoint.
            islandCenterX: screen.frame.minX + leftWidth + notchWidth / 2
        )
    }

    /// The view measured its wing labels; adopt the tight width so the
    /// collapsed hit-test pill stays snug around the text.
    private func applyWingWidth(_ width: CGFloat) {
        let clamped = max(DynamicIslandGeometry.minWingWidth, width)
        guard abs(clamped - state.geometry.wingWidth) > 0.5 else { return }
        state.geometry.wingWidth = clamped
        panel?.updateHitRegion()
    }

    /// Always the expanded panel size, top edge exactly flush with the
    /// screen's top so the collapsed pill bottom lines up with the notch
    /// bottom (a 1pt overhang shifted the whole pill up and broke alignment).
    private func panelFrame(on screen: NSScreen) -> NSRect {
        let geo = state.geometry
        let size = NSSize(
            width: max(DynamicIslandGeometry.expandedSize.width, geo.collapsedWidth),
            height: max(DynamicIslandGeometry.expandedSize.height, geo.collapsedHeight)
        )
        let centerX = geo.islandCenterX > 0 ? geo.islandCenterX : screen.frame.midX
        return NSRect(
            x: centerX - size.width / 2,
            y: screen.frame.maxY - size.height,
            width: size.width,
            height: size.height
        )
    }

    /// Interactive rect of the black shape, in panel contentView coordinates
    /// (AppKit: origin bottom-left). Used so transparent chrome click-throughs.
    fileprivate func hitRectInPanel() -> NSRect {
        guard let panel else { return .zero }
        let geo = state.geometry
        let panelW = panel.frame.width
        let panelH = panel.frame.height
        let width = state.isExpanded
            ? max(DynamicIslandGeometry.expandedSize.width, geo.collapsedWidth)
            : geo.collapsedWidth
        let height = state.isExpanded
            ? DynamicIslandGeometry.expandedSize.height
            : geo.collapsedHeight
        // Top-aligned in the panel.
        let x = (panelW - width) / 2
        let y = panelH - height
        return NSRect(x: x, y: y, width: width, height: height)
    }

    /// Recompute geometry and re-pin to the current target screen (display
    /// plug/unplug, lid close, resolution change).
    private func repositionPanel() {
        guard let panel, let screen = targetScreen() else { return }
        let geo = geometry(for: screen)
        if geo != state.geometry { state.geometry = geo }
        let frame = panelFrame(on: screen)
        if state.panelSize != frame.size { state.panelSize = frame.size }
        panel.setFrame(frame, display: true)
        panel.updateHitRegion()
    }

    // MARK: - Panel

    private func makePanel() -> IslandPanel {
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
        // controller owns the frame exclusively.
        if #available(macOS 13.0, *) {
            hostingController.sizingOptions = []
        }
        self.hostingController = hostingController

        let panel = IslandPanel(
            contentRect: NSRect(origin: .zero, size: DynamicIslandGeometry.expandedSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.islandController = self

        // Wrap the hosting view in a hit-test filter: the panel stays at the
        // expanded size, but only the black shape accepts mouse events so the
        // transparent chrome doesn't block the menu bar underneath.
        let hitView = IslandHitView(frame: NSRect(origin: .zero, size: DynamicIslandGeometry.expandedSize))
        hitView.autoresizingMask = [.width, .height]
        hitView.islandController = self
        hostingController.view.frame = hitView.bounds
        hostingController.view.autoresizingMask = [.width, .height]
        hitView.addSubview(hostingController.view)
        panel.contentView = hitView
        panel.hitView = hitView

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
    weak var islandController: DynamicIslandController?
    weak var hitView: IslandHitView?

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    func updateHitRegion() {
        hitView?.hitRegion = islandController?.hitRectInPanel() ?? .zero
    }
}

/// Filters hit-testing to the black island rect. Points outside return nil so
/// AppKit delivers the event to whatever is underneath (menu bar, desktop).
private final class IslandHitView: NSView {
    weak var islandController: DynamicIslandController?
    var hitRegion: NSRect = .zero

    override func hitTest(_ point: NSPoint) -> NSView? {
        // `point` is in this view's coordinate system (origin bottom-left).
        guard hitRegion.contains(point) else { return nil }
        return super.hitTest(point)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
