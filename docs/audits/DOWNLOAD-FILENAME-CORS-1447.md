# Cross-origin download filenames

Tracking: #1447.

The telemetry export response already included a task/project scope and date in `Content-Disposition`, but browser JavaScript could not read that non-safelisted response header across origins. Metrics Export consequently used its generic fallback. The CORS options now expose only `Content-Disposition`; origin validation, credentials, methods, and allowed request headers are unchanged. This does not authorize another origin or bypass authentication.

`e2e/download-filename-cors.spec.ts` exercises the actual API middleware and export route with the web and API on different origins. The initial UI assertion reproduced a scoped server filename becoming `telemetry-export.csv`; the middleware assertion reproduced the missing exposure header. The corrected checks cover CSV and JSON filenames, the no-header fallback, credentialed allowed-origin responses, unchanged preflight method/request-header lists, and rejection without exposure for an untrusted origin, a localhost lookalike, and a malformed origin. Only authentication presentation and the run-history read are synthetic; the two scoped export responses use the disposable API store. The fallback response alone is synthetic. No provider runs or private telemetry are used.

Consumer audit: `web/src/components/dashboard/ExportDialog.tsx` is the only web consumer that reads `Content-Disposition`. `ArtifactPreviewModal` names its authenticated blob download from `artifact.safeName`; `AttachmentsSection` uses `attachment.originalName` on a direct download link. Server attachment and agent-bundle routes also supply disposition headers, but no corresponding web header parser was found. No client filename behavior is changed here.

This transport correction is separate from task-overlay geometry, native acceptance, final media recapture, and release delivery.
