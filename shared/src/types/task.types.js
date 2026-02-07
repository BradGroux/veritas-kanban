// Task Types
// Default attachment limits
export const DEFAULT_ATTACHMENT_LIMITS = {
    maxFileSize: 10 * 1024 * 1024, // 10MB per file
    maxFilesPerTask: 20, // 20 files per task
    maxTotalSize: 50 * 1024 * 1024, // 50MB total per task
};
// Allowed MIME types for attachments
export const ALLOWED_MIME_TYPES = [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/html',
    'text/csv',
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Code & Config
    'application/json',
    'application/xml',
    'text/xml',
    'application/yaml',
    'text/yaml',
];
//# sourceMappingURL=task.types.js.map