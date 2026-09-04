# Combined UI integration candidate

This is a verification branch for #1389, not completion of the whole audit or a release. It combines the current heads of #1398 (full-CI request handling), #1412 (workflow timing), #1424 (Policy dialog focus), #1416/#1419 (Template authoring and priorities), and #1421/#1422 (responsive task shell and shared chat). Main already contains keyboard reorder and Template clearing.

Keep this integration PR draft and unmerged. Independently reviewed implementation PRs remain the delivery units. The full-CI label requests workspace tests, coverage, browser QA, security, and packaging contracts against one combined tree. Local integration checks concentrate on the changed rendered interactions; they do not substitute for the broad CI gate.

Runtime and packaged macOS results are pending at creation. Remaining overlay consumers and task-content convergence under #1383/#1385 are not silently accepted by a passing candidate. The installed application is unchanged. Final maintained screenshots/GIFs, installed-app acceptance, version bump, changelog, signed release, and release readback remain outstanding.

## Integration checkpoint

Local browser checks passed for repeated early-Escape/Cancel in Policy dialogs, Task Chat in both themes, and compact Workbench in both themes. Workbench needed a scoped Squad filter locator and an Escape-ordering correction; see the shared-chat audit. Activity/chat, Squad, layout-chrome, and overlay unit slices passed. The Template slice exposed obsolete tab-navigation expectations introduced during branch reconciliation; corrected expectations passed all 11 tests and were pushed to #1416/#1419. No passing unchanged slice was rerun for documentation changes.

Full CI on candidate d26f040b passed build, lint/typecheck, critical coverage, CodeQL, Gitleaks, Docker contract, load smoke, and unsigned macOS packaging. Workspace unit tests passed all 331 server files, then failed on the same four Template expectations now corrected. The production dependency audit timed out contacting the npm advisory endpoint; this is missing security evidence, not a clean audit. Browser QA was still running at this checkpoint. The earlier workflow branch run separately timed out in the SQLite device-session auth test; the combined server pass does not erase that diagnostic follow-up.

These findings do not establish packaged UI acceptance. Keep the candidate draft and the audit goal open.
