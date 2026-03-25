import AppKit
import Combine
import SwiftUI

@MainActor
final class StatusBarController: NSObject {

    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let popover = NSPopover()
    private let viewModel: DashboardViewModel
    private let serverManager: ServerManager
    private let launchAtLoginManager: LaunchAtLoginManager
    private var animator: MenuBarAnimator?
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init

    init(viewModel: DashboardViewModel,
         serverManager: ServerManager,
         launchAtLoginManager: LaunchAtLoginManager) {
        self.viewModel = viewModel
        self.serverManager = serverManager
        self.launchAtLoginManager = launchAtLoginManager
        super.init()

        setupStatusItem()
        setupPopover()
        observeSyncState()
    }

    // MARK: - Status Item

    private func setupStatusItem() {
        guard let button = statusItem.button else { return }

        let image = NSImage(named: "MenuBarIcon")
        image?.isTemplate = true
        button.image = image

        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.action = #selector(handleClick(_:))
        button.target = self

        animator = MenuBarAnimator(button: button)
    }

    private func observeSyncState() {
        viewModel.$isSyncing
            .receive(on: RunLoop.main)
            .sink { [weak self] syncing in
                self?.animator?.setState(syncing ? .syncing : .idle)
            }
            .store(in: &cancellables)
    }

    // MARK: - Popover

    private func setupPopover() {
        let rootView = DashboardView(viewModel: viewModel, serverManager: serverManager)
            .frame(width: 450, height: 640)

        popover.contentViewController = NSHostingController(rootView: rootView)
        popover.behavior = .transient
    }

    // MARK: - Click Handling

    @objc private func handleClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }

        if event.type == .rightMouseUp {
            showMenu()
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        guard let button = statusItem.button else { return }

        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)

            // Ensure popover closes when user clicks outside
            if let window = popover.contentViewController?.view.window {
                NSApp.activate(ignoringOtherApps: true)
                window.makeKey()
            }

            // Refresh data when popover opens
            Task { await viewModel.loadAll() }
        }
    }

    // MARK: - Right-Click Menu

    private func showMenu() {
        let menu = NSMenu()

        // Today summary — click to open popover
        let todayText = buildTodaySummary()
        let todayItem = NSMenuItem(title: "", action: #selector(openPopover), keyEquivalent: "")
        todayItem.target = self
        todayItem.attributedTitle = NSAttributedString(
            string: todayText,
            attributes: [
                .font: NSFont.menuFont(ofSize: 13),
                .foregroundColor: NSColor.labelColor
            ]
        )
        menu.addItem(todayItem)

        menu.addItem(.separator())

        // Sync Now
        let syncItem = NSMenuItem(title: Strings.menuSyncNow, action: #selector(syncNow), keyEquivalent: "r")
        syncItem.target = self
        syncItem.isEnabled = !viewModel.isSyncing
        menu.addItem(syncItem)

        // Open Dashboard
        let dashboardItem = NSMenuItem(title: Strings.openDashboard, action: #selector(openDashboard), keyEquivalent: "d")
        dashboardItem.target = self
        menu.addItem(dashboardItem)

        // Check for Updates — dynamic text when downloading
        let updateTitle = UpdateChecker.shared.statusText ?? Strings.menuCheckForUpdates
        let updateItem = NSMenuItem(title: updateTitle, action: #selector(checkForUpdates), keyEquivalent: "u")
        updateItem.target = self
        if UpdateChecker.shared.isBusy {
            updateItem.isEnabled = false
        }
        menu.addItem(updateItem)

        menu.addItem(.separator())

        // About
        let version = UpdateChecker.shared.currentVersion()
        let aboutItem = NSMenuItem(title: "TokenTrackerBar v\(version)", action: #selector(openAbout), keyEquivalent: "")
        aboutItem.target = self
        menu.addItem(aboutItem)

        menu.addItem(.separator())

        // Animated Icon (toggle)
        let animItem = NSMenuItem(title: "Animated Icon", action: #selector(toggleAnimation), keyEquivalent: "")
        animItem.target = self
        animItem.state = (animator?.isEnabled ?? true) ? .on : .off
        menu.addItem(animItem)

        // Launch at Login (toggle)
        let loginItem = NSMenuItem(title: Strings.menuLaunchAtLogin, action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        loginItem.target = self
        loginItem.state = launchAtLoginManager.isEnabled ? .on : .off
        menu.addItem(loginItem)

        menu.addItem(.separator())

        // Quit
        let quitItem = NSMenuItem(title: Strings.quitButton, action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        // Show the menu at the status item
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        // Clear menu so left-click works again next time
        statusItem.menu = nil
    }

    // MARK: - Menu Actions

    @objc private func openPopover() {
        // Small delay to let the menu dismiss before showing popover
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.togglePopover()
        }
    }

    @objc private func syncNow() {
        Task { await viewModel.triggerSync() }
    }

    @objc private func openDashboard() {
        if let url = URL(string: Constants.serverBaseURL) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func checkForUpdates() {
        UpdateChecker.shared.check(silent: false)
    }

    @objc private func openAbout() {
        if let url = URL(string: "https://github.com/mm7894215/tokentracker") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func toggleAnimation() {
        animator?.isEnabled.toggle()
    }

    @objc private func toggleLaunchAtLogin() {
        launchAtLoginManager.toggle()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // MARK: - Helpers

    private func buildTodaySummary() -> String {
        let tokens = viewModel.todayTokens
        let cost = viewModel.todayCost

        if tokens == 0 {
            return "\(Strings.todayTitle): \(Strings.noData)"
        }

        let formatted = TokenFormatter.formatCompact(tokens)
        return "\(Strings.todayTitle): \(formatted) tokens · \(cost)"
    }
}
