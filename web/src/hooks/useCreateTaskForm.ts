import { useReducer, useCallback, useMemo } from 'react';
import type { TaskPriority } from '@veritas-kanban/shared';

// ====== State Types ======

export interface CreateTaskFormState {
  title: string;
  description: string;
  type: string;
  priority: TaskPriority;
  project: string;
  sprint: string;
  categoryFilter: string;
  showHelp: boolean;
  showNewProject: boolean;
  newProjectName: string;
}

// ====== Action Types ======

type CreateTaskFormAction =
  | { type: 'SET_TITLE'; payload: string }
  | { type: 'SET_DESCRIPTION'; payload: string }
  | { type: 'SET_TYPE'; payload: string }
  | { type: 'SET_PRIORITY'; payload: TaskPriority }
  | { type: 'SET_PROJECT'; payload: string }
  | { type: 'SET_SPRINT'; payload: string }
  | { type: 'SET_CATEGORY_FILTER'; payload: string }
  | { type: 'TOGGLE_HELP' }
  | { type: 'SHOW_NEW_PROJECT' }
  | { type: 'HIDE_NEW_PROJECT' }
  | { type: 'SET_NEW_PROJECT_NAME'; payload: string }
  | { type: 'APPLY_TEMPLATE'; payload: Partial<CreateTaskFormState> }
  | { type: 'RESET' };

// ====== Initial State ======

const initialState: CreateTaskFormState = {
  title: '',
  description: '',
  type: 'code',
  priority: 'medium',
  project: '',
  sprint: '',
  categoryFilter: 'all',
  showHelp: false,
  showNewProject: false,
  newProjectName: '',
};

// ====== Reducer ======

function createTaskFormReducer(
  state: CreateTaskFormState,
  action: CreateTaskFormAction
): CreateTaskFormState {
  switch (action.type) {
    case 'SET_TITLE':
      return { ...state, title: action.payload };
    case 'SET_DESCRIPTION':
      return { ...state, description: action.payload };
    case 'SET_TYPE':
      return { ...state, type: action.payload };
    case 'SET_PRIORITY':
      return { ...state, priority: action.payload };
    case 'SET_PROJECT':
      return { ...state, project: action.payload, showNewProject: false };
    case 'SET_SPRINT':
      return { ...state, sprint: action.payload };
    case 'SET_CATEGORY_FILTER':
      return { ...state, categoryFilter: action.payload };
    case 'TOGGLE_HELP':
      return { ...state, showHelp: !state.showHelp };
    case 'SHOW_NEW_PROJECT':
      return { ...state, showNewProject: true, newProjectName: '' };
    case 'HIDE_NEW_PROJECT':
      return { ...state, showNewProject: false, newProjectName: '' };
    case 'SET_NEW_PROJECT_NAME':
      return { ...state, newProjectName: action.payload };
    case 'APPLY_TEMPLATE':
      return { ...state, ...action.payload };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// ====== Hook ======

export interface UseCreateTaskFormReturn {
  state: CreateTaskFormState;
  // Individual setters
  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setType: (type: string) => void;
  setPriority: (priority: TaskPriority) => void;
  setProject: (project: string) => void;
  setSprint: (sprint: string) => void;
  setCategoryFilter: (category: string) => void;
  setNewProjectName: (name: string) => void;
  // Actions
  toggleHelp: () => void;
  showNewProject: () => void;
  hideNewProject: () => void;
  applyTemplate: (defaults: Partial<CreateTaskFormState>) => void;
  reset: () => void;
  // Derived state
  canSubmit: (isBlueprint: boolean) => boolean;
}

/**
 * Hook for managing CreateTaskDialog form state with useReducer.
 * 
 * Replaces 11 separate useState calls with a single, cohesive state machine.
 * Benefits:
 * - Single source of truth for form state
 * - Predictable state transitions
 * - Easier to test and debug
 * - Related state updates happen atomically
 * 
 * @example
 * ```tsx
 * const { state, setTitle, setPriority, applyTemplate, reset } = useCreateTaskForm();
 * 
 * // Apply template defaults
 * applyTemplate({ type: 'bug', priority: 'high' });
 * 
 * // Check if form can submit
 * if (canSubmit(isBlueprint)) handleSubmit();
 * ```
 */
export function useCreateTaskForm(): UseCreateTaskFormReturn {
  const [state, dispatch] = useReducer(createTaskFormReducer, initialState);

  // Memoized action creators
  const setTitle = useCallback((title: string) => {
    dispatch({ type: 'SET_TITLE', payload: title });
  }, []);

  const setDescription = useCallback((description: string) => {
    dispatch({ type: 'SET_DESCRIPTION', payload: description });
  }, []);

  const setType = useCallback((type: string) => {
    dispatch({ type: 'SET_TYPE', payload: type });
  }, []);

  const setPriority = useCallback((priority: TaskPriority) => {
    dispatch({ type: 'SET_PRIORITY', payload: priority });
  }, []);

  const setProject = useCallback((project: string) => {
    dispatch({ type: 'SET_PROJECT', payload: project });
  }, []);

  const setSprint = useCallback((sprint: string) => {
    dispatch({ type: 'SET_SPRINT', payload: sprint });
  }, []);

  const setCategoryFilter = useCallback((category: string) => {
    dispatch({ type: 'SET_CATEGORY_FILTER', payload: category });
  }, []);

  const setNewProjectName = useCallback((name: string) => {
    dispatch({ type: 'SET_NEW_PROJECT_NAME', payload: name });
  }, []);

  const toggleHelp = useCallback(() => {
    dispatch({ type: 'TOGGLE_HELP' });
  }, []);

  const showNewProject = useCallback(() => {
    dispatch({ type: 'SHOW_NEW_PROJECT' });
  }, []);

  const hideNewProject = useCallback(() => {
    dispatch({ type: 'HIDE_NEW_PROJECT' });
  }, []);

  const applyTemplate = useCallback((defaults: Partial<CreateTaskFormState>) => {
    dispatch({ type: 'APPLY_TEMPLATE', payload: defaults });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // Derived state - computed, not stored
  const canSubmit = useCallback(
    (isBlueprint: boolean) => isBlueprint || !!state.title.trim(),
    [state.title]
  );

  return useMemo(
    () => ({
      state,
      setTitle,
      setDescription,
      setType,
      setPriority,
      setProject,
      setSprint,
      setCategoryFilter,
      setNewProjectName,
      toggleHelp,
      showNewProject,
      hideNewProject,
      applyTemplate,
      reset,
      canSubmit,
    }),
    [
      state,
      setTitle,
      setDescription,
      setType,
      setPriority,
      setProject,
      setSprint,
      setCategoryFilter,
      setNewProjectName,
      toggleHelp,
      showNewProject,
      hideNewProject,
      applyTemplate,
      reset,
      canSubmit,
    ]
  );
}
