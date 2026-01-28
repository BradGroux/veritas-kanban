import { useState, useMemo } from 'react';
import { Archive, RefreshCw, Search, Calendar, FolderOpen, RotateCcw, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useArchivedTasks, useRestoreTask } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { cn } from '@/lib/utils';
import type { Task, TaskType } from '@veritas-kanban/shared';

interface ArchiveSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAGE_SIZE = 25;

const typeIcons: Record<TaskType, string> = {
  code: '💻',
  research: '🔬',
  content: '📝',
  automation: '🤖',
};

const typeLabels: Record<TaskType, string> = {
  code: 'Code',
  research: 'Research',
  content: 'Content',
  automation: 'Automation',
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

interface ProjectConfig {
  id: string;
  label: string;
}

interface SprintConfig {
  id: string;
  label: string;
}

function ArchivedTaskItem({ 
  task, 
  onClick,
  onRestore,
  isRestoring,
  projects = [],
  sprints = [],
}: { 
  task: Task; 
  onClick?: () => void;
  onRestore?: () => void;
  isRestoring?: boolean;
  projects?: ProjectConfig[];
  sprints?: SprintConfig[];
}) {
  const projectLabel = task.project 
    ? projects.find(p => p.id === task.project)?.label || task.project 
    : null;
  const sprintLabel = task.sprint 
    ? sprints.find(s => s.id === task.sprint)?.label || task.sprint 
    : null;

  return (
    <div 
      className={cn(
        "flex items-start gap-3 py-3 px-2 rounded-md transition-colors group",
        "hover:bg-muted/50 cursor-pointer"
      )}
      onClick={onClick}
    >
      <span className="text-lg flex-shrink-0">
        {typeIcons[task.type] || '📋'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {task.title}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          {projectLabel && (
            <span className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              {projectLabel}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(task.updated)}
          </span>
        </div>
        {sprintLabel && (
          <div className="flex flex-wrap gap-1 mt-1">
            <Badge variant="secondary" className="text-xs px-1 py-0">
              {sprintLabel}
            </Badge>
          </div>
        )}
      </div>
      {onRestore && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
          disabled={isRestoring}
          title="Restore to board"
        >
          <RotateCcw className={cn("h-4 w-4", isRestoring && "animate-spin")} />
        </Button>
      )}
    </div>
  );
}

export function ArchiveSidebar({ open, onOpenChange }: ArchiveSidebarProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  
  const { data: archivedTasks, isLoading, refetch, isRefetching } = useArchivedTasks();
  const restoreTask = useRestoreTask();
  const { data: sprintsList = [] } = useSprints();

  const handleRestore = async (task: Task) => {
    setRestoringId(task.id);
    try {
      await restoreTask.mutateAsync(task.id);
      // If we were viewing this task, close the detail panel
      if (selectedTask?.id === task.id) {
        setDetailOpen(false);
        setSelectedTask(null);
      }
    } catch (error) {
      console.error('Failed to restore task:', error);
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreFromDetail = async (taskId: string) => {
    const task = archivedTasks?.find(t => t.id === taskId);
    if (task) {
      await handleRestore(task);
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setDetailOpen(true);
  };

  const handleDetailClose = (isOpen: boolean) => {
    setDetailOpen(isOpen);
    if (!isOpen) {
      setTimeout(() => setSelectedTask(null), 200);
    }
  };

  // Get projects list for labels
  const { data: projectsList = [] } = useProjects();

  // Get unique projects for filter dropdown, with labels
  const projects = useMemo(() => {
    if (!archivedTasks) return [];
    const projectIds = new Set(archivedTasks.map(t => t.project).filter(Boolean) as string[]);
    return projectsList
      .filter(p => projectIds.has(p.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [archivedTasks, projectsList]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    if (!archivedTasks) return [];
    
    return archivedTasks.filter(task => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(searchLower);
        const matchesDescription = task.description?.toLowerCase().includes(searchLower);
        const matchesSprint = task.sprint?.toLowerCase().includes(searchLower);
        if (!matchesTitle && !matchesDescription && !matchesSprint) return false;
      }
      
      // Type filter
      if (typeFilter !== 'all' && task.type !== typeFilter) return false;
      
      // Project filter
      if (projectFilter !== 'all' && task.project !== projectFilter) return false;
      
      return true;
    });
  }, [archivedTasks, search, typeFilter, projectFilter]);

  // Reset visible count when filters change
  useMemo(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, typeFilter, projectFilter]);

  // Paginated tasks
  const visibleTasks = filteredTasks.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTasks.length;
  const remaining = filteredTasks.length - visibleCount;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[400px] sm:w-[450px] p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <div className="flex items-center justify-between pr-8">
              <SheetTitle className="flex items-center gap-2">
                <Archive className="h-5 w-5" />
                Archive
                {archivedTasks && archivedTasks.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {archivedTasks.length}
                  </Badge>
                )}
              </SheetTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                disabled={isRefetching}
                className="h-8 w-8"
              >
                <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
              </Button>
            </div>
            
            {/* Search */}
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search archived tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            {/* Filters */}
            <div className="flex gap-2 mt-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(typeLabels).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      {typeIcons[type as TaskType]} {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {projects.length > 0 && (
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Results count */}
            {filteredTasks.length > 0 && filteredTasks.length !== archivedTasks?.length && (
              <div className="text-xs text-muted-foreground mt-1">
                Showing {Math.min(visibleCount, filteredTasks.length)} of {filteredTasks.length} filtered tasks
              </div>
            )}
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-240px)]">
            <div className="px-2 py-2">
              {isLoading ? (
                <div className="text-center text-muted-foreground py-8">
                  Loading archived tasks...
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  {archivedTasks?.length === 0 
                    ? 'No archived tasks yet'
                    : 'No tasks match your filters'}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {visibleTasks.map(task => (
                      <ArchivedTaskItem 
                        key={task.id} 
                        task={task}
                        onClick={() => handleTaskClick(task)}
                        onRestore={() => handleRestore(task)}
                        isRestoring={restoringId === task.id}
                        projects={projectsList}
                        sprints={sprintsList}
                      />
                    ))}
                  </div>
                  
                  {/* Load More */}
                  {hasMore && (
                    <div className="py-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                        className="flex items-center gap-1 mx-auto"
                      >
                        <ChevronDown className="h-4 w-4" />
                        Load More ({remaining} remaining)
                      </Button>
                    </div>
                  )}

                  {/* Page info */}
                  {!hasMore && filteredTasks.length > PAGE_SIZE && (
                    <div className="py-3 text-center text-xs text-muted-foreground">
                      All {filteredTasks.length} tasks loaded
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Read-only task detail panel for archived tasks */}
      <TaskDetailPanel
        task={selectedTask}
        open={detailOpen}
        onOpenChange={handleDetailClose}
        readOnly
        onRestore={handleRestoreFromDetail}
      />
    </>
  );
}
