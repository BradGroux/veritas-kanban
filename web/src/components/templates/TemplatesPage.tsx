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
import { useTemplates, useDeleteTemplate } from '@/hooks/useTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    } catch (err) {
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
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to board">
              <ArrowLeft className="h-4 w-4" />
            </Button>
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
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(TEMPLATE_CATEGORIES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    <Card
                      key={template.id}
                      className={cn(
                        'p-4 cursor-pointer transition-all hover:border-primary hover:shadow-md',
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
                            <Badge variant="outline" className="text-xs">
                              {getCategoryIcon(template.category)}
                              {getCategoryLabel(template.category)}
                            </Badge>
                          )}
                          {template.taskDefaults?.type && (
                            <Badge variant="secondary" className="text-xs">
                              {template.taskDefaults.type}
                            </Badge>
                          )}
                          {template.taskDefaults?.priority && (
                            <Badge variant="secondary" className="text-xs">
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTemplateToDelete(template);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </Card>
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
      <AlertDialog
        open={!!templateToDelete}
        onOpenChange={(open) => !open && setTemplateToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview Dialog */}
      {showPreview && selectedTemplate && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="rounded-lg shadow-lg overflow-hidden">
              <div className="p-6 overflow-y-auto max-h-[80vh]">
                <TemplatePreviewPanel template={selectedTemplate} />
                <div className="mt-6 flex justify-end">
                  <Button variant="outline" onClick={() => setShowPreview(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
