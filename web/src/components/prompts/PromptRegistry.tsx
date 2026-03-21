/**
 * Prompt Registry Component
 * Multi-tab interface for managing prompt templates, versions, usage, and statistics
 * Tabs: Templates, Versions, Usage, Stats, Preview
 */
import { useState } from 'react';
import { usePromptTemplates, usePromptTemplate, useCreatePromptTemplate, useUpdatePromptTemplate, useDeletePromptTemplate, usePromptVersionHistory, usePromptUsageRecords, usePromptStatsAll, useRenderPromptPreview } from '../../hooks/usePromptRegistry.js';
import type { CreatePromptTemplateInput, PromptCategory } from '@veritas-kanban/shared';
import styles from './PromptRegistry.module.css';

type TabType = 'templates' | 'versions' | 'usage' | 'stats' | 'preview';

/**
 * Templates Tab - CRUD for prompt templates
 */
function TemplatesTab() {
  const { data: templates, isLoading } = usePromptTemplates();
  const createMutation = useCreatePromptTemplate();
  const deleteMutation = useDeletePromptTemplate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<CreatePromptTemplateInput>({
    name: '',
    description: '',
    category: 'system',
    content: '',
  });

  const handleCreate = async () => {
    if (!formData.name || !formData.content) {
      alert('Name and content are required');
      return;
    }
    await createMutation.mutateAsync(formData);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this template?')) {
      await deleteMutation.mutateAsync(id);
      setSelectedId(null);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: 'system',
      content: '',
    });
    setIsEditing(false);
  };

  if (isLoading) return <div>Loading templates...</div>;

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3>Prompt Templates</h3>
        <button onClick={() => { setIsEditing(true); resetForm(); }} className={styles.primaryBtn}>
          + New Template
        </button>
      </div>

      {isEditing && (
        <div className={styles.form}>
          <div className={styles.formGroup}>
            <label>Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Template name"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Description</label>
            <input
              type="text"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Category *</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as PromptCategory })}
            >
              <option value="system">System</option>
              <option value="agent">Agent</option>
              <option value="tool">Tool</option>
              <option value="evaluation">Evaluation</option>
            </select>
          </div>
          <div className={styles.formGroup}>
            <label>Content *</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Template content. Use {{variable_name}} for interpolation."
              rows={6}
            />
          </div>
          <div className={styles.formActions}>
            <button onClick={handleCreate} className={styles.primaryBtn} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={resetForm} className={styles.secondaryBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {templates && templates.map((template) => (
          <div
            key={template.id}
            className={`${styles.listItem} ${selectedId === template.id ? styles.selected : ''}`}
            onClick={() => setSelectedId(template.id)}
          >
            <div className={styles.itemHeader}>
              <h4>{template.name}</h4>
              <span className={styles.badge}>{template.category}</span>
            </div>
            <p>{template.description || 'No description'}</p>
            <div className={styles.itemMeta}>
              <small>Variables: {template.variables.join(', ') || 'none'}</small>
              <small>Updated: {new Date(template.updated).toLocaleDateString()}</small>
            </div>
            <div className={styles.itemActions}>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(template.id); }} className={styles.dangerBtn}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Versions Tab - View version history with changelogs
 */
function VersionsTab() {
  const { data: templates } = usePromptTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: versions } = usePromptVersionHistory(selectedId);

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3>Version History</h3>
      </div>

      <div className={styles.selector}>
        <label>Select Template:</label>
        <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value || null)}>
          <option value="">-- Choose template --</option>
          {templates &&
            templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>

      {versions && versions.length > 0 ? (
        <div className={styles.versionList}>
          {versions.map((version) => (
            <div key={version.id} className={styles.versionCard}>
              <div className={styles.versionHeader}>
                <h4>Version {version.versionNumber}</h4>
                <small>{new Date(version.createdAt).toLocaleString()}</small>
              </div>
              <p className={styles.changelog}>{version.changelog}</p>
              <details>
                <summary>View content</summary>
                <pre className={styles.codeBlock}>{version.content}</pre>
              </details>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No versions found. Select a template to view its history.</p>
      )}
    </div>
  );
}

/**
 * Usage Tab - View usage statistics by agent/user
 */
function UsageTab() {
  const { data: templates } = usePromptTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: usageRecords } = usePromptUsageRecords(selectedId);

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3>Usage Records</h3>
      </div>

      <div className={styles.selector}>
        <label>Select Template:</label>
        <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value || null)}>
          <option value="">-- Choose template --</option>
          {templates &&
            templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>

      {usageRecords && usageRecords.length > 0 ? (
        <div className={styles.table}>
          <table>
            <thead>
              <tr>
                <th>Used At</th>
                <th>Used By</th>
                <th>Model</th>
                <th>Tokens (In/Out)</th>
              </tr>
            </thead>
            <tbody>
              {usageRecords.map((record) => (
                <tr key={record.id}>
                  <td>{new Date(record.usedAt).toLocaleString()}</td>
                  <td>{record.usedBy || 'Unknown'}</td>
                  <td>{record.model || 'N/A'}</td>
                  <td>
                    {record.inputTokens ?? 0} / {record.outputTokens ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>No usage records found.</p>
      )}
    </div>
  );
}

/**
 * Stats Tab - Dashboard with template statistics
 */
function StatsTab() {
  const { data: stats } = usePromptStatsAll();

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3>Template Statistics</h3>
      </div>

      {stats && stats.length > 0 ? (
        <div className={styles.statsList}>
          {stats.map((stat) => (
            <div key={stat.templateId} className={styles.statCard}>
              <h4>{stat.templateName}</h4>
              <div className={styles.statGrid}>
                <div className={styles.statItem}>
                  <label>Total Usages</label>
                  <span className={styles.statValue}>{stat.totalUsages}</span>
                </div>
                <div className={styles.statItem}>
                  <label>Versions</label>
                  <span className={styles.statValue}>{stat.totalVersions}</span>
                </div>
                <div className={styles.statItem}>
                  <label>Most Used By</label>
                  <span className={styles.statValue}>{stat.mostFrequentUser || 'N/A'}</span>
                </div>
                <div className={styles.statItem}>
                  <label>Avg Tokens/Use</label>
                  <span className={styles.statValue}>{(stat.averageTokensPerUsage ?? 0).toFixed(0)}</span>
                </div>
              </div>
              <small>{stat.lastUsedAt ? `Last used: ${new Date(stat.lastUsedAt).toLocaleDateString()}` : 'Never used'}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No statistics available.</p>
      )}
    </div>
  );
}

/**
 * Preview Tab - Render template with sample variables
 */
function PreviewTab() {
  const { data: templates } = usePromptTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleVariables, setSampleVariables] = useState<Record<string, string>>({});
  const { data: template } = usePromptTemplate(selectedId);
  const { data: preview } = useRenderPromptPreview(selectedId, sampleVariables);

  const _handleAddVariable = (varName: string) => {
    setSampleVariables({ ...sampleVariables, [varName]: '' });
  };

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <h3>Template Preview</h3>
      </div>

      <div className={styles.selector}>
        <label>Select Template:</label>
        <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value || null)}>
          <option value="">-- Choose template --</option>
          {templates &&
            templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>

      {template && (
        <>
          <div className={styles.variablesSection}>
            <h4>Variables</h4>
            <p>Template contains: {template.variables.join(', ') || 'No variables'}</p>
            <div className={styles.variableInputs}>
              {template.variables.map((varName) => (
                <div key={varName} className={styles.formGroup}>
                  <label>{varName}</label>
                  <input
                    type="text"
                    value={sampleVariables[varName] || ''}
                    onChange={(e) => setSampleVariables({ ...sampleVariables, [varName]: e.target.value })}
                    placeholder={`Enter value for ${varName}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {preview && (
            <>
              <div className={styles.previewSection}>
                <h4>Rendered Preview</h4>
                <pre className={styles.codeBlock}>{preview.renderedPrompt}</pre>
              </div>
              {preview.unmatchedVariables.length > 0 && (
                <div className={styles.warning}>
                  <p>Unmatched variables: {preview.unmatchedVariables.join(', ')}</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Main Prompt Registry Component
 */
export function PromptRegistry() {
  const [activeTab, setActiveTab] = useState<TabType>('templates');

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'templates' ? styles.active : ''}`}
          onClick={() => setActiveTab('templates')}
        >
          Templates
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'versions' ? styles.active : ''}`}
          onClick={() => setActiveTab('versions')}
        >
          Versions
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'usage' ? styles.active : ''}`}
          onClick={() => setActiveTab('usage')}
        >
          Usage
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'stats' ? styles.active : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Stats
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'preview' ? styles.active : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'versions' && <VersionsTab />}
        {activeTab === 'usage' && <UsageTab />}
        {activeTab === 'stats' && <StatsTab />}
        {activeTab === 'preview' && <PreviewTab />}
      </div>
    </div>
  );
}

export default PromptRegistry;
