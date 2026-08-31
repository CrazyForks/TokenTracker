import Foundation

/// Where one popover dataset actually came from, as reported by the local
/// server through `X-TokenTracker-Account-View` (+ `X-TokenTracker-Account-Fallback`).
///
/// The distinction that matters: the local server answers `?account=1` with
/// this-machine data both when that is genuinely the user's scope (signed out,
/// cloud sync off) and when a cloud read merely failed (timeout, offline,
/// token refresh error). Both used to arrive as an indistinguishable HTTP 200,
/// so a single slow cloud read silently shrank the popover's Activity heatmap
/// from every device to this Mac until the next manual sync.
enum AccountViewSource: Equatable {
    /// Cross-device account aggregate.
    case account
    /// This-machine data, and that is the correct scope right now.
    case localAuthoritative(reason: String)
    /// This-machine data only because the cloud read failed. Whatever account
    /// snapshot we already hold is still the better answer.
    case localTransient(reason: String)

    var isAccount: Bool { self == .account }

    var isTransientFallback: Bool {
        if case .localTransient = self { return true }
        return false
    }

    /// Diagnostic label — safe to log (no tokens, no usage figures).
    var reason: String {
        switch self {
        case .account: return "account"
        case .localAuthoritative(let reason): return reason
        case .localTransient(let reason): return reason
        }
    }

    /// Parse the pair of response headers. Returns nil when the server did not
    /// tag the response at all, which means it never ran the account path.
    static func parse(accountView: String?, fallback: String?) -> AccountViewSource? {
        switch accountView {
        case "1":
            return .account
        case "0":
            let reason = (fallback ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            // Any `transient-*` reason is a temporary cloud failure. Matching on
            // the prefix lets the server add reasons without a client change.
            if reason.hasPrefix("transient") { return .localTransient(reason: reason) }
            // An older embedded/global server sends no fallback header. Treating
            // the absence as authoritative keeps the pre-fix behaviour.
            return .localAuthoritative(reason: reason.isEmpty ? "unspecified" : reason)
        default:
            return nil
        }
    }

    /// Publication authority for the menu-bar summary slots.
    var summaryViewSource: UsageSummaryViewSource {
        self == .account ? .accountUpload : .localQueue
    }
}

/// A decoded payload plus the authority it was served with.
struct AccountFetchResult<Value> {
    let value: Value
    let source: AccountViewSource
    let completedAt: Date
}

/// Per-dataset guard against silently downgrading an account (cross-device)
/// view to this-machine data because one cloud read failed.
struct AccountViewStateStore {
    enum Dataset: Hashable, CaseIterable {
        case todaySummary
        case periodSummary
        case rollingSummary
        case totalSummary
        case daily
        case hourly
        case monthly
        case heatmap
        case modelBreakdown
    }

    private var sourceByDataset: [Dataset: AccountViewSource] = [:]
    private(set) var degradedDatasets: Set<Dataset> = []

    /// True while at least one dataset is running on (or holding onto data
    /// because of) a transient cloud failure.
    var isDegraded: Bool { !degradedDatasets.isEmpty }

    /// True when this dataset is currently *showing* this-machine data only
    /// because the cloud is unreachable — i.e. cold start with no account
    /// snapshot to fall back on.
    func showsTransientLocalData(_ dataset: Dataset) -> Bool {
        sourceByDataset[dataset]?.isTransientFallback ?? false
    }

    /// Decide whether an incoming payload should replace what is on screen.
    /// - Parameter hasExistingValue: whether the view model already holds a
    ///   rendered payload for this dataset.
    /// - Returns: true to publish the new payload, false to keep the old one.
    mutating func shouldAdopt(
        _ source: AccountViewSource,
        for dataset: Dataset,
        hasExistingValue: Bool
    ) -> Bool {
        guard source.isTransientFallback else {
            degradedDatasets.remove(dataset)
            sourceByDataset[dataset] = source
            return true
        }
        degradedDatasets.insert(dataset)
        if hasExistingValue, sourceByDataset[dataset]?.isAccount == true {
            // Keep the account snapshot and its authority; this failure is
            // temporary and a retry is scheduled.
            return false
        }
        // Nothing better to show (cold start, or we were already local):
        // this-machine data beats an empty panel, but stays marked degraded.
        sourceByDataset[dataset] = source
        return true
    }

    /// Forget a dataset the view intentionally emptied (e.g. hourly data while
    /// a non-day period is selected). Without this its degraded flag would
    /// linger forever, because nothing ever fetches it again to clear it.
    mutating func clear(_ dataset: Dataset) {
        sourceByDataset.removeValue(forKey: dataset)
        degradedDatasets.remove(dataset)
    }
}
