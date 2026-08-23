import Foundation

/// Which character (if any) animates as the menu bar icon.
enum MenuBarIconStyle: String, CaseIterable {
    case clawd
    case cat
    case bot
    case pet
    case `static`

    static let defaultsKey = "MenuBarIconStyle"
    /// Legacy bool key from the pre-0.81 "Animated icon" toggle.
    static let legacyAnimationEnabledKey = "MenuBarAnimationEnabled"

    /// Reads the persisted style. Migrates the legacy animation toggle:
    /// users who had explicitly disabled animation keep a static icon.
    static func current(defaults: UserDefaults = .standard) -> MenuBarIconStyle {
        if let raw = defaults.string(forKey: defaultsKey),
           let style = MenuBarIconStyle(rawValue: raw) {
            return style
        }
        if defaults.object(forKey: legacyAnimationEnabledKey) as? Bool == false {
            return .static
        }
        return .clawd
    }

    static func setCurrent(_ style: MenuBarIconStyle, defaults: UserDefaults = .standard) {
        defaults.set(style.rawValue, forKey: defaultsKey)
    }
}

/// Motion tier for the runner icons (cat / pet). The animator maps its state
/// machine onto these tiers; the tables below are the single source of truth
/// for frame pacing so tests can pin the speed contract.
enum MenuBarRunnerMotion {
    case sleeping
    case idle
    case syncing
    case sprinting
}

enum MenuBarRunnerPace {
    /// Seconds per frame. The cat is RunCat-style: state is expressed through
    /// running speed (sleeping uses a dedicated curled-up pose instead).
    ///
    /// `bot` is different in kind: its clips were pre-rendered at a fixed 12 fps
    /// (see scripts/gen-bot-frames.cjs), so its state shows in WHICH clip plays,
    /// not how fast. Speeding it up would just play the same morph too quickly,
    /// so it holds 1/12s and only drops to a slow poll while asleep.
    static func frameInterval(style: MenuBarIconStyle, motion: MenuBarRunnerMotion) -> TimeInterval {
        switch style {
        case .cat:
            switch motion {
            case .sleeping: return 1.2
            case .idle: return 0.5
            case .syncing: return 0.2
            case .sprinting: return 0.08
            }
        case .pet:
            switch motion {
            case .sleeping: return 0.6
            case .idle: return 0.4
            case .syncing: return 0.15
            case .sprinting: return 0.08
            }
        case .bot:
            // The bot clips the menu bar plays are sampled at 24 fps (the pet window
            // interpolates instead; the menu bar plays images and cannot), so this is
            // the rate that reproduces them at their authored speed.
            return motion == .sleeping ? 1.0 / 12.0 : 1.0 / 24.0
        case .clawd, .static:
            return 0.15
        }
    }

    /// How long a queue-append activity burst keeps the runner sprinting.
    static let sprintWindow: TimeInterval = 30
}
