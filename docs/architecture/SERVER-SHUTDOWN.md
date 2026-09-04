# Server shutdown

SIGTERM, SIGINT, and fatal-error shutdown share one drain operation. The HTTP listener stops accepting connections first. Already-connected requests finish while their services and storage remain available. WebSocket clients receive a close frame; peers that do not acknowledge within three seconds are terminated.

Only after HTTP and WebSocket closure does the server stop service workers, close tool sessions, flush telemetry and registry writes, and dispose storage. Failures are fatal, not successful shutdowns. One ten-second deadline bounds the complete operation. An expired drain must not proceed into service disposal, and repeated signals must not start another disposal pass. Fatal-error shutdown retains a nonzero exit status.

The focused regression uses a real HTTP server and partial request headers to hold a connected request across shutdown. The native diagnostic repeats this against an authenticated packaged server and quits/relaunches an isolated synthetic profile:

```sh
node scripts/native-ui/shutdown.mjs --app /absolute/path/veritas-kanban.app --commit <packaged-sha> --version <version> --output /absolute/path/shutdown.json
```

The diagnostic requires successful task responses and clean server exits. It neither touches the operator profile nor replaces complete native conformance, artifact-integrity, release, or installed-app verification.
