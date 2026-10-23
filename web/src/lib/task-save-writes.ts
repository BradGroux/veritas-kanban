import type { QueryClient } from '@tanstack/react-query';
import type { Task, UpdateTaskInput } from '@veritas-kanban/shared';

interface TaskSaveBindings {
  save: (id: string, input: UpdateTaskInput) => Promise<Task>;
  canSave: () => boolean;
  onSaved: () => void;
  onDispose: () => void;
  onFailure: (
    task: Task,
    error: unknown,
    fields: string[],
    retry: () => void
  ) => (() => void) | undefined;
}
interface TaskSaveSnapshot {
  localTask: Task;
  isDirty: boolean;
  isSaving: boolean;
}
interface TaskDraft {
  id: string;
  task: Task;
  fields: Set<keyof Task>;
  versions: Map<keyof Task, number>;
  nextVersion: number;
  bindings: TaskSaveBindings;
  delay: number;
  attached: number;
  saving: boolean;
  paused: boolean;
  timer?: ReturnType<typeof setTimeout>;
  dismissFailure?: () => void;
  failure?: { error: unknown };
  snapshot: TaskSaveSnapshot;
}

/** Task identities own drafts and writes; editor unmounts only detach a view. */
class TaskSaveWrites {
  private drafts = new Map<string, TaskDraft>();
  private listeners = new Set<() => void>();
  private disposed = false;
  isActive = () => !this.disposed;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (id: string | undefined) => (id ? this.drafts.get(id)?.snapshot : undefined);

  attach(task: Task, bindings: TaskSaveBindings, delay: number): () => void {
    if (this.disposed) return () => {};
    let draft = this.drafts.get(task.id);
    if (!draft) {
      draft = {
        id: task.id,
        task,
        fields: new Set(),
        versions: new Map(),
        nextVersion: 0,
        bindings,
        delay,
        attached: 0,
        saving: false,
        paused: false,
        snapshot: { localTask: task, isDirty: false, isSaving: false },
      };
      this.drafts.set(task.id, draft);
    }
    draft.bindings = bindings;
    draft.delay = delay;
    draft.attached += 1;
    this.sync(task);
    if (draft.paused && draft.failure) this.showFailure(draft, draft.failure.error);
    this.schedule(draft);
    return () => {
      if (this.disposed || this.drafts.get(task.id) !== draft) return;
      draft.attached -= 1;
      if (draft.attached === 0) {
        void this.flush(draft);
        this.releaseClean(draft);
      }
    };
  }

  sync(task: Task) {
    const draft = this.drafts.get(task.id);
    if (!draft || this.disposed) return;
    const merged = { ...task };
    for (const field of draft.fields)
      (merged as unknown as Record<string, unknown>)[field] = draft.task[field];
    draft.task = merged;
    this.publish(draft);
  }

  setDelay(id: string, delay: number) {
    const draft = this.drafts.get(id);
    if (!draft || draft.delay === delay) return;
    draft.delay = delay;
    this.schedule(draft);
  }

  update<K extends keyof Task>(id: string, field: K, value: Task[K]) {
    const draft = this.drafts.get(id);
    if (!draft || this.disposed) return;
    draft.task = { ...draft.task, [field]: value, id: draft.id };
    draft.fields.add(field);
    draft.versions.set(field, ++draft.nextVersion);
    draft.paused = false;
    this.publish(draft);
    this.schedule(draft);
  }

  retry(id: string) {
    const draft = this.drafts.get(id);
    if (!draft || this.disposed) return;
    draft.paused = false;
    void this.flush(draft);
  }

  resume(id: string) {
    const draft = this.drafts.get(id);
    if (draft) this.schedule(draft);
  }

  discard(id: string, task: Task) {
    const draft = this.drafts.get(id);
    if (!draft || task.id !== id || this.disposed) return;
    if (draft.timer) clearTimeout(draft.timer);
    draft.timer = undefined;
    draft.task = task;
    draft.fields.clear();
    draft.versions.clear();
    // nextVersion stays monotonic so an old completion cannot clear a later edit.
    draft.paused = false;
    draft.failure = undefined;
    draft.dismissFailure?.();
    draft.dismissFailure = undefined;
    this.publish(draft);
    this.releaseClean(draft);
  }

  dispose() {
    this.disposed = true;
    for (const draft of this.drafts.values()) {
      if (draft.timer) clearTimeout(draft.timer);
      draft.dismissFailure?.();
      draft.bindings.onDispose();
    }
    this.drafts.clear();
    this.listeners.forEach((listener) => listener());
    this.listeners.clear();
  }

  private publish(draft: TaskDraft) {
    draft.snapshot = {
      localTask: draft.task,
      isDirty: draft.fields.size > 0,
      isSaving: draft.saving,
    };
    this.listeners.forEach((listener) => listener());
  }

  private schedule(draft: TaskDraft) {
    if (draft.timer) clearTimeout(draft.timer);
    draft.timer = undefined;
    if (this.disposed || draft.saving || draft.paused || draft.fields.size === 0) return;
    if (draft.attached === 0) {
      void this.flush(draft);
      return;
    }
    draft.timer = setTimeout(() => {
      void this.flush(draft);
    }, draft.delay);
  }

  private releaseClean(draft: TaskDraft) {
    if (draft.attached === 0 && !draft.saving && draft.fields.size === 0) {
      this.drafts.delete(draft.id);
    }
  }

  private showFailure(draft: TaskDraft, error: unknown) {
    draft.dismissFailure?.();
    draft.dismissFailure = draft.bindings.onFailure(
      draft.task,
      error,
      [...draft.fields].map(String),
      () => this.retry(draft.id)
    );
  }

  private async flush(draft: TaskDraft) {
    if (draft.timer) clearTimeout(draft.timer);
    draft.timer = undefined;
    if (
      this.disposed ||
      draft.saving ||
      draft.paused ||
      draft.fields.size === 0 ||
      !draft.bindings.canSave()
    )
      return;
    const fields = new Map([...draft.fields].map((field) => [field, draft.versions.get(field)]));
    const input = Object.fromEntries([...fields.keys()].map((field) => [field, draft.task[field]]));
    draft.saving = true;
    this.publish(draft);
    try {
      const saved = await draft.bindings.save(draft.id, input);
      if (this.disposed || this.drafts.get(draft.id) !== draft) return;
      for (const [field, version] of fields)
        if (draft.versions.get(field) === version) draft.fields.delete(field);
      draft.saving = false;
      draft.failure = undefined;
      draft.dismissFailure?.();
      draft.dismissFailure = undefined;
      draft.bindings.onSaved();
      this.sync(saved);
      this.releaseClean(draft);
      if (this.drafts.get(draft.id) === draft) this.schedule(draft);
    } catch (error) {
      if (this.disposed || this.drafts.get(draft.id) !== draft) return;
      draft.saving = false;
      draft.paused = true;
      draft.failure = { error };
      this.showFailure(draft, error);
      this.publish(draft);
    }
  }
}

const writers = new WeakMap<QueryClient, TaskSaveWrites>();
export function getTaskSaveWrites(client: QueryClient) {
  let writer = writers.get(client);
  if (!writer) {
    writer = new TaskSaveWrites();
    writers.set(client, writer);
  }
  return writer;
}
export function resetTaskSaveWrites(client: QueryClient) {
  writers.get(client)?.dispose();
  writers.delete(client);
}
