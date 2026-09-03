# Combined UI integration candidate

This is a verification branch for #1389, not completion of the whole audit or a release. It combines the current heads of #1398 (full-CI request handling), #1412 (workflow timing), #1424 (Policy dialog focus), #1416/#1419 (Template authoring and priorities), and #1421/#1422 (responsive task shell and shared chat). Main already contains keyboard reorder and Template clearing.

Keep this integration PR draft and unmerged. Independently reviewed implementation PRs remain the delivery units. The full-CI label requests workspace tests, coverage, browser QA, security, and packaging contracts against one combined tree. Local integration checks concentrate on the changed rendered interactions; they do not substitute for the broad CI gate.

Runtime and packaged macOS results are pending at creation. Remaining overlay consumers and task-content convergence under #1383/#1385 are not silently accepted by a passing candidate. The installed application is unchanged. Final maintained screenshots/GIFs, installed-app acceptance, version bump, changelog, signed release, and release readback remain outstanding.
