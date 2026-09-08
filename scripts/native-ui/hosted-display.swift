import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let argument = CommandLine.arguments.dropFirst().first ?? "--check"
guard ["--check", "--configure-hosted"].contains(argument) else {
    fail("Usage: swift scripts/native-ui/hosted-display.swift [--check|--configure-hosted]")
}
let display = CGMainDisplayID()
if argument == "--configure-hosted" {
    guard ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true" else {
        fail("Display configuration is restricted to the disposable GitHub Actions runner")
    }
    let modes = CGDisplayCopyAllDisplayModes(display, nil) as? [CGDisplayMode] ?? []
    guard let mode = modes.first(where: {
        $0.width == 1920 && $0.height == 1080 && $0.pixelWidth == 1920 && $0.pixelHeight == 1080
    }) else {
        fail("Runner has no unscaled 1920x1080 mode. Available: " + modes.map {
            "\($0.width)x\($0.height) (\($0.pixelWidth)x\($0.pixelHeight) pixels)"
        }.joined(separator: ", "))
    }
    var configuration: CGDisplayConfigRef?
    guard CGBeginDisplayConfiguration(&configuration) == .success, let configuration else {
        fail("Cannot begin runner display configuration")
    }
    guard CGConfigureDisplayWithDisplayMode(configuration, display, mode, nil) == .success else {
        CGCancelDisplayConfiguration(configuration)
        fail("Cannot select runner display mode")
    }
    guard CGCompleteDisplayConfiguration(configuration, .forSession) == .success else {
        fail("Cannot apply runner display mode for this login session")
    }
}
guard let actual = CGDisplayCopyDisplayMode(display) else { fail("No active display mode") }
let evidence: [String: Any] = [
    "width": actual.width, "height": actual.height,
    "pixelWidth": actual.pixelWidth, "pixelHeight": actual.pixelHeight,
    "configured": argument == "--configure-hosted"
]
print(String(data: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), encoding: .utf8)!)
guard actual.width >= 1920 && actual.height >= 1080 else {
    fail("Native capture requires at least 1920x1080 logical display points")
}
