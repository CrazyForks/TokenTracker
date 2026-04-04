import Foundation

enum Strings {
    static let appTitle = "TokenTracker"
    static let serverUnavailable = "Server Unavailable"
    static let serverStarting = "Starting TokenTracker"
    static let serverPreparing = "This usually takes a few seconds."
    static let loadingData = "Loading data…"
    static let noData = "No data"
    static let retryButton = "Retry"
    static let openDashboard = "Open Dashboard"
    static let quitButton = "Quit"
    static let justNow = "just now"
    static let activityTitle = "Activity"
    static let activeDaysSuffix = "active days"
    static let trendTitle = "Trend"
    static let topModelsTitle = "Models"
    static let modelBreakdownTitle = "Model Breakdown"
    static let todayTitle = "Today"
    static let sevenDayTitle = "7-Day"
    static let thirtyDayTitle = "30-Day"
    static let perDay = "/day"
    static let hintTrend = "Usage trend appears after your first AI session"
    static let hintBreakdown = "Model data appears after your first AI session"
    static let periodTotal = "Period"
    static let conversations = "conversations"
    static let totalTitle = "Total"
    static let hintModels = "Model data appears after your first AI session"
    static let serverStartingSubtitle = "Starting local server…"
    static let serverStartingHint = "This usually takes a few seconds."
    static let serverOfflineHint = "Check that tokentracker-cli is installed and try again."

    // Usage Limits
    static let usageLimitsTitle = "Limits"
    static let sessionExpired = "Session expired"

    // Menu items
    static let menuSyncNow = "Sync Now"
    static let menuCheckForUpdates = "Check for Updates…"
    static let menuLaunchAtLogin = "Launch at Login"

    static func minutesAgo(_ n: Int) -> String { "\(n)m ago" }
    static func hoursAgo(_ n: Int) -> String { "\(n)h ago" }
    static func activeDays(_ n: Int) -> String { "\(n) active days" }
}
