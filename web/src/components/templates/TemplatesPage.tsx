/**
 * TemplatesPage - Browse, manage, and preview task templates
 *
 * Features:
 * - List all templates with name, description, category
 * - Create new template
 * - Edit existing templates
 * - Delete templates with confirmation
 * - Preview what a task created from template would look like
 */

import { useState, useMemo } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useTemplates, useDeleteTemplate } from '@/hooks/useTemplates';
import { ArrowLeft, Plus, Trash2, Eye, Edit2, FileText } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { TaskTemplate } from '@/hooks/useTemplates';
import { getCategoryIcon, getCategoryLabel, TEMPLATE_CATEGORIES } from '@/lib/template-categories';
import { TemplateEditorDialog } from './TemplateEditorDialog';
import { TemplatePreviewPanel } from './TemplatePreviewPanel';
import { cn } from '@/lib/utils';

interface TemplatesPageProps {
  onBack: () => void;
}

export function TemplatesPage({ onBack }: TemplatesPageProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<TaskTemplate | null>(null);

  const { toast } = useToast();
  const { data: templates = [], isLoading } = useTemplates();
  const deleteTemplate = useDeleteTemplate();
  const categoryOptions = [
    { value: 'all', label: 'All Categories' },
    ...Object.entries(TEMPLATE_CATEGORIES).map(([key, { label }]) => ({
      value: key,
      label,
    })),
  ];

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const searchLower = search.toLowerCase();
      const matchesSearch =
        template.name.toLowerCase().includes(searchLower) ||
        (template.description && template.description.toLowerCase().includes(searchLower));

      const category = template.category || 'custom';
      const matchesCategory = categoryFilter === 'all' || category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [templates, search, categoryFilter]);

  const handleCreateNew = () => {
    setEditingTemplate(null);
    setShowEditor(true);
  };

  const handleEdit = (template: TaskTemplate) => {
    setEditingTemplate(template);
    setShowEditor(true);
  };

  const handleDeleteConfirm = async () => {
    if (!templateToDelete) return;

    try {
      await deleteTemplate.mutateAsync(templateToDelete.id);
      toast({
        title: 'Template deleted',
        description: `"${templateToDelete.name}" has been deleted.`,
      });
      if (selectedTemplate?.id === templateToDelete.id) {
        setSelectedTemplate(null);
      }
      setTemplateToDelete(null);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to delete template',
        variant: 'destructive',
      });
    }
  };

  const handlePreview = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setShowPreview(true);
  };

  return (
    <div className="flex h-screen flex-col gap-4 bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ActionIcon
              type="button"
              variant="subtle"
              color="gray"
              onClick={onBack}
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </ActionIcon>
            <div>
              <h1 className="text-2xl font-bold">Task Templates</h1>
              <p className="text-sm text-muted-foreground">
                Create, manage, and organize task templates for your projects
              </p>
            </div>
          </div>
          <Button onClick={handleCreateNew} size="lg">
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 gap-4 overflow-hidden px-6 pb-6">
        {/* Templates List */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {/* Filters */}
          <div className="flex gap-3">
            <TextInput
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Select
              value={categoryFilter}
              onChange={(value) => setCategoryFilter(value ?? 'all')}
              data={categoryOptions}
              allowDeselect={false}
              className="w-40"
              aria-label="Filter templates by category"
            />
          </div>

          {/* Templates Grid */}
          <ScrollArea className="flex-1 rounded-lg border">
            <div className="p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="text-muted-foreground">Loading templates…</span>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">
                    {templates.length === 0
                      ? 'No templates yet. Create your first template to get started.'
                      : 'No templates match your search.'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={cn(
                        'p-4 cursor-pointer transition-all border rounded-lg hover:border-primary hover:shadow-md',
                        selectedTemplate?.id === template.id && 'border-primary bg-primary/5'
                      )}
                      onClick={() => setSelectedTemplate(template)}
                    >
                      <div className="flex flex-col gap-2 h-full">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold truncate">{template.name}</h3>
                            {template.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {template.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Category and Type Badge */}
                        <div className="flex flex-wrap gap-2">
                          {template.category && (
                            <Badge variant="outline" color="gray" size="xs" tt="none">
                              {getCategoryIcon(template.category)}
                              {getCategoryLabel(template.category)}
                            </Badge>
                          )}
                          {template.taskDefaults?.type && (
                            <Badge variant="light" color="gray" size="xs" tt="none">
                              {template.taskDefaults.type}
                            </Badge>
                          )}
                          {template.taskDefaults?.priority && (
                            <Badge variant="light" color="gray" size="xs" tt="none">
                              {template.taskDefaults.priority}
                            </Badge>
                          )}
                        </div>

                        {/* Template Info */}
                        <div className="text-xs text-muted-foreground space-y-1 flex-1">
                          {template.subtaskTemplates && template.subtaskTemplates.length > 0 && (
                            <div>
                              📋 {template.subtaskTemplates.length} subtask
                              {template.subtaskTemplates.length !== 1 ? 's' : ''}
                            </div>
                          )}
                          {template.blueprint && template.blueprint.length > 0 && (
                            <div>
                              🔗 {template.blueprint.length} blueprint task
                              {template.blueprint.length !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-2 border-t">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreview(template);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Preview
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(template);
                            }}
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                          <ActionIcon
                            type="button"
                            variant="outline"
                            size="sm"
                            color="red"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTemplateToDelete(template);
                            }}
                            aria-label={`Delete ${template.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </ActionIcon>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Preview Panel */}
        {selectedTemplate && (
          <div className="w-96 flex flex-col border rounded-lg bg-card overflow-hidden">
            <TemplatePreviewPanel template={selectedTemplate} />
          </div>
        )}
      </div>

      {/* Editor Dialog */}
      <TemplateEditorDialog
        template={editingTemplate}
        open={showEditor}
        onOpenChange={setShowEditor}
      />

      {/* Delete Confirmation */}
      <Modal
        opened={!!templateToDelete}
        onClose={() => setTemplateToDelete(null)}
        title="Delete Template?"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be
            undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setTemplateToDelete(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Preview Dialog */}
      <Modal
        opened={showPreview && !!selectedTemplate}
        onClose={() => setShowPreview(false)}
        title="Template Preview"
        size="lg"
        centered
      >
        {selectedTemplate && (
          <Stack gap="md">
            <TemplatePreviewPanel template={selectedTemplate} />
            <Group justify="flex-end">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Close
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
