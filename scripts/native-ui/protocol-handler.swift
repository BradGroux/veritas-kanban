import AppKit
import Foundation

// Preserve the exact application URL, rather than guessing a handler by bundle ID.
let scheme = "veritas"
let arguments = Array(CommandLine.arguments.dropFirst())
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
func currentHandler() -> URL? {
    NSWorkspace.shared.urlForApplication(toOpen: URL(string: "veritas://")!)
}
func emit(_ url: URL?) {
    let value: [String: Any] = [
        "scheme": scheme,
        "applicationPath": url?.standardizedFileURL.path as Any? ?? NSNull(),
    ]
    guard let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let text = String(data: bytes, encoding: .utf8) else { fail("Cannot encode protocol metadata") }
    print(text)
}

if arguments == ["inspect"] {
    emit(currentHandler())
} else if arguments.count == 2 && arguments[0] == "restore" {
    guard #available(macOS 12.0, *) else { fail("Protocol restoration requires macOS 12 or later") }
    let original = URL(fileURLWithPath: arguments[1]).standardizedFileURL
    var isDirectory: ObjCBool = false
    guard original.pathExtension == "app",
          FileManager.default.fileExists(atPath: original.path, isDirectory: &isDirectory),
          isDirectory.boolValue else { fail("Original protocol application is unavailable") }
    var completed = false
    var restorationError: Error?
    NSWorkspace.shared.setDefaultApplication(at: original, toOpenURLsWithScheme: scheme) { error in
        restorationError = error
        completed = true
    }
    let deadline = Date().addingTimeInterval(15)
    while !completed && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    guard completed, restorationError == nil else { fail("Protocol restoration failed or timed out") }
    guard currentHandler()?.standardizedFileURL.path == original.path else { fail("Protocol restoration readback differs") }
    emit(currentHandler())
} else {
    fail("Usage: protocol-handler.swift inspect | restore <original.app>")
}
