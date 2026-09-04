export async function finalizeCapture({ report, resources, persist }) {
  const failures = [];
  for (const [name, close] of resources) {
    try {
      await close();
    } catch (error) {
      failures.push({ resource: name, message: String(error.message) });
    }
  }
  if (failures.length) {
    report.status = 'failed';
    report.cleanupFailures = failures;
  }
  report.completedAt ??= new Date().toISOString();
  await persist();
  return failures;
}
