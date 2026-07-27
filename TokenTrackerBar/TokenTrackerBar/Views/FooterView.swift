import SwiftUI

struct FooterView: View {
    var horizontalPadding: CGFloat = 20
    var verticalPadding: CGFloat = 6

    @State private var hoveringDashboard = false
    @State private var hoveringQuit = false

    var body: some View {
        HStack(spacing: 12) {
            Button {
                DashboardWindowController.shared.showWindow()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "macwindow")
                    Text(Strings.openDashboard)
                }
                    .font(.caption)
                    .modifier(FontWeightModifier(weight: .medium))
                    .foregroundStyle(hoveringDashboard ? .primary : Color.accentColor)
                    .scaleEffect(hoveringDashboard ? 1.03 : 1.0)
                    .animation(.easeOut(duration: 0.12), value: hoveringDashboard)
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .onHover { hovering in
                hoveringDashboard = hovering
            }

            Spacer()

            Button {
                AppDelegate.requestQuit()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "power")
                    Text(Strings.quitButton)
                }
                    .font(.caption)
                    .foregroundStyle(hoveringQuit ? .primary : .secondary)
                    .scaleEffect(hoveringQuit ? 1.03 : 1.0)
                    .animation(.easeOut(duration: 0.12), value: hoveringQuit)
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .onHover { hovering in
                hoveringQuit = hovering
            }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
    }
}

/// Windows with large transparent, click-through regions (the island panel)
/// conform so the cursor coordinator only treats their *interactive* area as
/// "ours" — the panel's frame vastly overhangs the visible island shape.
@MainActor
protocol CursorHitScoping: AnyObject {
    func containsInteractiveScreenPoint(_ screenPoint: NSPoint) -> Bool
}

/// Global pointer-cursor arbiter shared by every `pointingHandCursor()` site.
///
/// Plain `NSCursor.set()` (or push/pop) does not survive inside the Dynamic
/// Island: it lives on a non-activating panel, so this app is never the active
/// app and AppKit's automatic `.cursorUpdate` pass immediately resets the
/// cursor back to arrow after we set it. Every hovered control registers here
/// instead, and `IslandPanel` swallows `.cursorUpdate` events and re-applies
/// whatever cursor the current hover set implies.
@MainActor
final class PointerCursorCoordinator {
    static let shared = PointerCursorCoordinator()

    private var hovered = Set<UUID>()

    func update(_ token: UUID, hovering: Bool) {
        if hovering {
            hovered.insert(token)
            apply()
            return
        }
        hovered.remove(token)
        guard hovered.isEmpty else { return }
        // Only reset to arrow while the pointer is still over one of our own
        // windows. With SetsCursorInBackground enabled a late hover-out (the
        // pointer already flung into another app) would otherwise stomp the
        // frontmost app's cursor with our arrow.
        if pointerInsideOurWindows() {
            NSCursor.arrow.set()
        }
    }

    /// Re-assert the cursor implied by the current hover set. Called by the
    /// island panel each time it swallows an AppKit `.cursorUpdate` reset.
    func apply() {
        (hovered.isEmpty ? NSCursor.arrow : NSCursor.pointingHand).set()
    }

    /// Drop a claim without touching the cursor — for controls removed from
    /// the hierarchy mid-hover (island collapsed, popover closed), when the
    /// pointer may already be over another app whose cursor we must not stomp.
    func release(_ token: UUID) {
        hovered.remove(token)
    }

    private func pointerInsideOurWindows() -> Bool {
        let location = NSEvent.mouseLocation
        return NSApp.windows.contains { window in
            guard window.isVisible, window.frame.contains(location) else { return false }
            // The island panel is mostly transparent pass-through chrome; only
            // its hit region counts, otherwise a hover-out that lands on
            // another app's window *below* the island would still reset the
            // frontmost app's cursor to our arrow.
            if let scoped = window as? CursorHitScoping {
                return scoped.containsInteractiveScreenPoint(location)
            }
            return true
        }
    }
}

private struct PointingHandCursorModifier: ViewModifier {
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onHover { PointerCursorCoordinator.shared.update(token, hovering: $0) }
            // SwiftUI never sends onHover(false) when the control disappears
            // while hovered (e.g. the island collapses under the pointer).
            .onDisappear { PointerCursorCoordinator.shared.release(token) }
    }
}

extension View {
    func pointingHandCursor() -> some View {
        modifier(PointingHandCursorModifier())
    }
}
