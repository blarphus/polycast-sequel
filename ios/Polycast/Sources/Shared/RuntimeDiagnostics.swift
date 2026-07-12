import Foundation
import OSLog

enum PolycastLog {
    static let runtime = Logger(subsystem: "app.polycast", category: "Runtime")
}

/// Records a structured fallback and surfaces the same diagnostic in the app.
/// This is safe to call from any actor; UI delivery is marshalled to MainActor.
func reportFallback(
    code: String,
    title: String,
    message: String,
    source: String,
    operation: String,
    detail: String? = nil,
    error: Error? = nil,
    severity: String = "warning",
    correlationID: String = UUID().uuidString
) {
    let resolvedDetail = [detail, error?.localizedDescription].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "; ")
    PolycastLog.runtime.warning("Fallback code=\(code, privacy: .public) source=\(source, privacy: .public) operation=\(operation, privacy: .public) correlation=\(correlationID, privacy: .public) detail=\(resolvedDetail, privacy: .private(mask: .hash))")
    Task { @MainActor in
        FallbackNoticeCenter.shared.show(
            code: code,
            severity: severity,
            title: title,
            message: message,
            detail: resolvedDetail.isEmpty ? nil : resolvedDetail,
            source: source,
            operation: operation,
            correlationID: correlationID
        )
    }
}
