import { UiHeading, UiSurface, UiAction, UiPill, UiIconAction } from '@/components/ui/UiVocabulary';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CreateScoringProfileInput,
  EvaluationRequest,
  Scorer,
  ScorerType,
  ScoringProfile,
} from '@veritas-kanban/shared';
import { ArrowLeft, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { Select, Tabs, Textarea, TextInput } from '@mantine/core';
import { useToast } from '@/hooks/useToast';
import {
  useCreateScoringProfile,
  useDeleteScoringProfile,
  useRunEvaluation,
  useScoringProfiles,
  useUpdateScoringProfile,
} from '@/hooks/useScoring';
import { PrimaryPageShell } from '@/components/layout/PrimaryPageShell';

const ScoreExplorer = lazy(() =>
  import('./ScoreExplorer').then((mod) => ({ default: mod.ScoreExplorer }))
);

interface ScoringProfilesProps {
  onBack: () => void;
}

type ProfileDraft = CreateScoringProfileInput;
type DraftMode = 'create' | 'edit';
type MobileView = 'detail' | 'list';

const createScorer = (type: ScorerType = 'KeywordContains'): Scorer => {
  const base = {
    id: `scorer-${Math.random().toString(36).slice(2, 8)}`,
    name: 'New scorer',
    description: '',
    weight: 1,
    target: 'output' as const,
  };

  switch (type) {
    case 'RegexMatch':
      return { ...base, type, pattern: '', flags: '', invert: false };
    case 'NumericRange':
      return { ...base, type, valuePath: 'metadata.outputWordCount', min: 1, max: 500 };
    case 'OccurrenceRatio':
      return { ...base, type, needles: ['verified'], denominator: 1 };
    case 'KeywordContains':
    default:
      return {
        ...base,
        type: 'KeywordContains',
        keywords: ['verified'],
        matchMode: 'any',
        partialCredit: true,
      };
  }
};

const createEmptyDraft = (): ProfileDraft => ({
  name: '',
  description: '',
  compositeMethod: 'weightedAvg',
  scorers: [createScorer()],
});

const profileToDraft = (profile: ScoringProfile): ProfileDraft => ({
  name: profile.name,
  description: profile.description || '',
  compositeMethod: profile.compositeMethod,
  scorers: profile.scorers,
});

const scorerTypeOptions: ScorerType[] = [
  'KeywordContains',
  'RegexMatch',
  'NumericRange',
  'OccurrenceRatio',
];

const scorerTypeSelectData = scorerTypeOptions.map((type) => ({ value: type, label: type }));

const compositeMethodSelectData = [
  { value: 'weightedAvg', label: 'Weighted average' },
  { value: 'minimum', label: 'Minimum' },
  { value: 'geometricMean', label: 'Geometric mean' },
];

const targetSelectData = [
  { value: 'output', label: 'Output' },
  { value: 'action', label: 'Action' },
  { value: 'combined', label: 'Combined' },
];

export function ScoringProfiles({ onBack }: ScoringProfilesProps) {
  const { toast } = useToast();
  const { data: profiles = [], isLoading } = useScoringProfiles();
  const createProfile = useCreateScoringProfile();
  const updateProfile = useUpdateScoringProfile();
  const deleteProfile = useDeleteScoringProfile();
  const runEvaluation = useRunEvaluation();
  const [activeTab, setActiveTab] = useState('profiles');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [draft, setDraft] = useState<ProfileDraft>(createEmptyDraft);
  const [cleanDraft, setCleanDraft] = useState<ProfileDraft | null>(null);
  const [draftMode, setDraftMode] = useState<DraftMode>('edit');
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const selectedProfileButtonRef = useRef<HTMLButtonElement>(null);
  const shouldFocusListRef = useRef(false);
  const shouldFocusNameRef = useRef(false);
  const createOriginRef = useRef<{ activeTab: string; mobileView: MobileView }>({
    activeTab: 'profiles',
    mobileView: 'list',
  });
  const [evaluationForm, setEvaluationForm] = useState<EvaluationRequest>({
    profileId: '',
    action: '',
    output: '',
    agent: '',
    taskId: '',
    metadata: {},
  });

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );
  const isDirty = cleanDraft
    ? JSON.stringify(draft) !== JSON.stringify(cleanDraft)
    : Boolean(draft.name.trim());
  const draftReadOnly = draftMode === 'edit' && Boolean(selectedProfile?.builtIn);

  const confirmDiscardChanges = () => !isDirty || window.confirm('Discard unsaved changes?');

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!selectedProfileId) {
      const first = profiles[0];
      const nextDraft = profileToDraft(first);
      setSelectedProfileId(first.id);
      setDraft(nextDraft);
      setCleanDraft(nextDraft);
      setDraftMode('edit');
      setEvaluationForm((current) => ({ ...current, profileId: first.id }));
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (activeTab === 'profiles' && shouldFocusNameRef.current) {
      shouldFocusNameRef.current = false;
      nameInputRef.current?.focus();
      return;
    }

    if (mobileView === 'detail') {
      detailHeadingRef.current?.focus();
      return;
    }

    if (shouldFocusListRef.current) {
      shouldFocusListRef.current = false;
      selectedProfileButtonRef.current?.focus();
    }
  }, [activeTab, mobileView, selectedProfileId]);

  const loadProfileIntoDraft = (profile: ScoringProfile) => {
    if (!confirmDiscardChanges()) return;
    const nextDraft = profileToDraft(profile);
    setSelectedProfileId(profile.id);
    setDraft(nextDraft);
    setCleanDraft(nextDraft);
    setDraftMode('edit');
    setMobileView('detail');
    setEvaluationForm((current) => ({ ...current, profileId: profile.id }));
  };

  const handleCreateNew = () => {
    if (!confirmDiscardChanges()) return;
    createOriginRef.current = { activeTab, mobileView };
    const nextDraft = createEmptyDraft();
    setDraft(nextDraft);
    setCleanDraft(nextDraft);
    setDraftMode('create');
    shouldFocusNameRef.current = true;
    setActiveTab('profiles');
    setMobileView('detail');
  };

  const handleCancelCreate = () => {
    if (!confirmDiscardChanges()) return;

    if (selectedProfile) {
      const nextDraft = profileToDraft(selectedProfile);
      setDraft(nextDraft);
      setCleanDraft(nextDraft);
      setDraftMode('edit');
    } else {
      const nextDraft = createEmptyDraft();
      setDraft(nextDraft);
      setCleanDraft(nextDraft);
      setDraftMode('create');
    }

    setActiveTab(createOriginRef.current.activeTab);
    setMobileView(createOriginRef.current.mobileView);
  };

  const handleDuplicate = (profile: ScoringProfile) => {
    if (!confirmDiscardChanges()) return;
    setDraft({
      name: `${profile.name} Copy`,
      description: profile.description || '',
      compositeMethod: profile.compositeMethod,
      scorers: profile.scorers.map((scorer) => ({ ...scorer, id: `${scorer.id}-copy` })),
    });
    setCleanDraft(null);
    setDraftMode('create');
    setMobileView('detail');
    setActiveTab('profiles');
  };

  const handleBackToProfiles = () => {
    if (!confirmDiscardChanges()) return;

    if (selectedProfile) {
      const nextDraft = profileToDraft(selectedProfile);
      setDraft(nextDraft);
      setCleanDraft(nextDraft);
      setDraftMode('edit');
    } else {
      const nextDraft = createEmptyDraft();
      setDraft(nextDraft);
      setCleanDraft(nextDraft);
      setDraftMode('create');
    }

    shouldFocusListRef.current = true;
    setMobileView('list');
  };

  const handleTabChange = (value: string | null) => {
    const nextTab = value ?? 'profiles';
    if (nextTab !== activeTab && !confirmDiscardChanges()) return;
    setActiveTab(nextTab);
  };

  const handleBackToBoard = () => {
    if (confirmDiscardChanges()) onBack();
  };

  const updateScorer = (index: number, updater: (scorer: Scorer) => Scorer) => {
    setDraft((current) => ({
      ...current,
      scorers: current.scorers.map((scorer, scorerIndex) =>
        scorerIndex === index ? updater(scorer) : scorer
      ),
    }));
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast({ title: 'Profile name is required', variant: 'destructive' });
      return;
    }

    try {
      if (draftMode === 'edit' && selectedProfile && !selectedProfile.builtIn) {
        const updated = await updateProfile.mutateAsync({
          id: selectedProfile.id,
          input: draft,
        });
        setSelectedProfileId(updated.id);
        setCleanDraft(draft);
        toast({ title: 'Scoring profile updated' });
      } else {
        const created = await createProfile.mutateAsync(draft);
        setSelectedProfileId(created.id);
        setCleanDraft(draft);
        setDraftMode('edit');
        setEvaluationForm((current) => ({ ...current, profileId: created.id }));
        toast({ title: 'Scoring profile created' });
      }
    } catch (error) {
      toast({
        title: 'Failed to save profile',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (profile: ScoringProfile) => {
    if (!confirmDiscardChanges()) return;
    try {
      await deleteProfile.mutateAsync(profile.id);
      const nextDraft = createEmptyDraft();
      setSelectedProfileId('');
      setDraft(nextDraft);
      setCleanDraft(nextDraft);
      setDraftMode('create');
      setMobileView('list');
      toast({ title: 'Scoring profile deleted' });
    } catch (error) {
      toast({
        title: 'Failed to delete profile',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleEvaluate = async () => {
    if (!evaluationForm.profileId || !evaluationForm.output.trim()) {
      toast({
        title: 'Profile and output are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await runEvaluation.mutateAsync({
        ...evaluationForm,
        agent: evaluationForm.agent || undefined,
        taskId: evaluationForm.taskId || undefined,
      });
      setActiveTab('explorer');
      toast({ title: 'Evaluation recorded' });
    } catch (error) {
      toast({
        title: 'Evaluation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <PrimaryPageShell
      title="Agent Output Scoring"
      subtitle="Manage scoring profiles and inspect evaluation trends over time"
      onBack={handleBackToBoard}
      width="wide"
      testId="scoring-page"
      className="h-full min-h-0"
      contentClassName="min-h-0"
      actions={
        <div className="flex w-full gap-2 sm:w-auto">
          <UiAction variant="secondary" className="flex-1 sm:flex-none" onClick={handleCreateNew}>
            <Plus className="mr-2 h-4 w-4" />
            New Profile
          </UiAction>
          <div
            data-testid="scoring-save-action"
            className={mobileView === 'list' ? 'hidden md:block' : 'contents'}
          >
            <UiAction
              variant="primary"
              className="w-full flex-1 sm:w-auto sm:flex-none"
              onClick={handleSave}
              disabled={
                !draft.name.trim() ||
                draftReadOnly ||
                createProfile.isPending ||
                updateProfile.isPending
              }
            >
              <Save className="mr-2 h-4 w-4" />
              Save Profile
            </UiAction>
          </div>
        </div>
      }
    >
      <div className="min-h-0 flex-1">
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          keepMounted={false}
          className="flex flex-col gap-4"
        >
          <Tabs.List className="w-full sm:w-fit">
            <Tabs.Tab value="profiles">Profiles</Tabs.Tab>
            <Tabs.Tab value="explorer">Score Explorer</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="profiles" className="m-0 flex min-w-0 items-start gap-4">
            <div
              data-testid="scoring-profile-list"
              className={`${
                mobileView === 'detail' ? 'hidden md:flex' : 'flex'
              } w-full min-w-0 flex-col rounded-lg border bg-card md:w-[340px] md:min-w-[320px]`}
            >
              <div className="border-b px-4 py-3">
                <div className="font-semibold">Scoring Profiles</div>
                <div className="text-sm text-muted-foreground">
                  Built-ins are read-only. Duplicate them to customize.
                </div>
              </div>
              <div>
                <div className="divide-y">
                  {isLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading profiles…</div>
                  ) : (
                    profiles.map((profile) => (
                      <button
                        key={profile.id}
                        ref={
                          selectedProfileId === profile.id ? selectedProfileButtonRef : undefined
                        }
                        aria-current={selectedProfileId === profile.id ? 'true' : undefined}
                        className={`min-h-12 w-full space-y-2 p-4 text-left transition-colors hover:bg-muted/30 motion-reduce:transition-none ${
                          selectedProfileId === profile.id ? 'bg-primary/5' : ''
                        }`}
                        onClick={() => loadProfileIntoDraft(profile)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{profile.name}</div>
                          <div className="flex gap-2">
                            {profile.builtIn && <UiPill>Built-in</UiPill>}
                            <UiPill>{profile.compositeMethod}</UiPill>
                          </div>
                        </div>
                        {profile.description && (
                          <div className="text-sm text-muted-foreground">{profile.description}</div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {profile.scorers.length} scorer{profile.scorers.length === 1 ? '' : 's'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div
              data-testid="scoring-profile-detail"
              className={`${
                mobileView === 'list' ? 'hidden md:flex' : 'flex'
              } w-full min-w-0 flex-1 flex-col gap-4 overflow-x-hidden`}
            >
              <div data-testid="scoring-mobile-back" className="md:hidden">
                <UiAction variant="quiet" onClick={handleBackToProfiles}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to profiles
                </UiAction>
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
                <UiSurface level="card" className="space-y-4 p-4">
                  <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <UiHeading
                        order={2}
                        ref={detailHeadingRef}
                        tabIndex={-1}
                        className="text-lg font-semibold focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {draftMode === 'create'
                          ? 'New scoring profile'
                          : selectedProfile?.name || 'Scoring profile'}
                      </UiHeading>
                      <p className="text-sm text-muted-foreground">
                        Define weighted scorers and a composite strategy.
                      </p>
                    </div>
                    {draftMode === 'create' ? (
                      <UiAction variant="secondary" onClick={handleCancelCreate}>
                        Cancel
                      </UiAction>
                    ) : (
                      selectedProfile && (
                        <div className="flex flex-wrap gap-2">
                          <UiAction
                            variant="secondary"
                            className="flex-1 sm:flex-none"
                            onClick={() => handleDuplicate(selectedProfile)}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </UiAction>
                          {!selectedProfile.builtIn && (
                            <UiAction
                              variant="destructive"
                              className="flex-1 sm:flex-none"
                              onClick={() => handleDelete(selectedProfile)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </UiAction>
                          )}
                        </div>
                      )
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Name</label>
                      <TextInput
                        ref={nameInputRef}
                        aria-label="Profile name"
                        value={draft.name}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, name: event.target.value }))
                        }
                        error={!draft.name.trim() ? 'Profile name is required' : undefined}
                        disabled={draftReadOnly}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Composite Method</label>
                      <Select
                        aria-label="Composite method"
                        value={draft.compositeMethod}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            compositeMethod:
                              (value as ProfileDraft['compositeMethod'] | null) ??
                              current.compositeMethod,
                          }))
                        }
                        data={compositeMethodSelectData}
                        disabled={draftReadOnly}
                        allowDeselect={false}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      aria-label="Profile description"
                      value={draft.description || ''}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      rows={3}
                      disabled={draftReadOnly}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <UiHeading order={3} className="font-semibold">
                        Scorers
                      </UiHeading>
                      <UiAction
                        variant="secondary"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            scorers: [...current.scorers, createScorer()],
                          }))
                        }
                        disabled={draftReadOnly}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Scorer
                      </UiAction>
                    </div>

                    <UiSurface level="inset" data-testid="scoring-scorer-list" className="">
                      <div className="space-y-3 p-3">
                        {draft.scorers.map((scorer, index) => (
                          <UiSurface level="section" key={scorer.id} className="space-y-3 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="grid flex-1 gap-3 lg:grid-cols-[1fr_180px_120px]">
                                <TextInput
                                  aria-label={`Scorer ${index + 1} name`}
                                  value={scorer.name}
                                  onChange={(event) =>
                                    updateScorer(index, (current) => ({
                                      ...current,
                                      name: event.target.value,
                                    }))
                                  }
                                  disabled={draftReadOnly}
                                />
                                <Select
                                  aria-label={`Scorer ${index + 1} type`}
                                  value={scorer.type}
                                  onChange={(value) => {
                                    if (!value) return;
                                    updateScorer(index, () => ({
                                      ...createScorer(value as ScorerType),
                                      id: scorer.id,
                                      name: scorer.name,
                                      weight: scorer.weight,
                                    }));
                                  }}
                                  data={scorerTypeSelectData}
                                  disabled={draftReadOnly}
                                  allowDeselect={false}
                                />
                                <TextInput
                                  aria-label={`Scorer ${index + 1} weight`}
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={String(scorer.weight)}
                                  onChange={(event) =>
                                    updateScorer(index, (current) => ({
                                      ...current,
                                      weight: Number(event.target.value) || 0,
                                    }))
                                  }
                                  disabled={draftReadOnly}
                                />
                              </div>
                              <UiIconAction
                                variant="destructive"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    scorers: current.scorers.filter(
                                      (_, scorerIndex) => scorerIndex !== index
                                    ),
                                  }))
                                }
                                disabled={draftReadOnly || draft.scorers.length === 1}
                                aria-label="Remove scorer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </UiIconAction>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="space-y-2">
                                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Target
                                </label>
                                <Select
                                  aria-label={`Scorer ${index + 1} target`}
                                  value={scorer.target || 'output'}
                                  onChange={(value) =>
                                    updateScorer(index, (current) => ({
                                      ...current,
                                      target: (value as Scorer['target'] | null) ?? current.target,
                                    }))
                                  }
                                  data={targetSelectData}
                                  disabled={draftReadOnly}
                                  allowDeselect={false}
                                />
                              </div>

                              {'keywords' in scorer && (
                                <div className="space-y-2">
                                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Keywords
                                  </label>
                                  <TextInput
                                    aria-label={`Scorer ${index + 1} keywords`}
                                    value={scorer.keywords.join(', ')}
                                    onChange={(event) =>
                                      updateScorer(index, (current) => ({
                                        ...current,
                                        keywords: event.target.value
                                          .split(',')
                                          .map((keyword) => keyword.trim())
                                          .filter(Boolean),
                                      }))
                                    }
                                    disabled={draftReadOnly}
                                  />
                                </div>
                              )}

                              {'pattern' in scorer && (
                                <>
                                  <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Regex Pattern
                                    </label>
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} regex pattern`}
                                      value={scorer.pattern}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          pattern: event.target.value,
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Flags
                                    </label>
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} regex flags`}
                                      value={scorer.flags || ''}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          flags: event.target.value,
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                  </div>
                                </>
                              )}

                              {'valuePath' in scorer && (
                                <>
                                  <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      Value Path
                                    </label>
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} value path`}
                                      value={scorer.valuePath}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          valuePath: event.target.value,
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} minimum value`}
                                      type="number"
                                      placeholder="Min"
                                      value={scorer.min ?? ''}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          min:
                                            event.target.value === ''
                                              ? undefined
                                              : Number(event.target.value),
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} maximum value`}
                                      type="number"
                                      placeholder="Max"
                                      value={scorer.max ?? ''}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          max:
                                            event.target.value === ''
                                              ? undefined
                                              : Number(event.target.value),
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                  </div>
                                </>
                              )}

                              {scorer.type === 'OccurrenceRatio' && (
                                <div className="space-y-2 lg:col-span-2">
                                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Literal values, one per line
                                  </label>
                                  <Textarea
                                    aria-label={`Scorer ${index + 1} literal values`}
                                    rows={3}
                                    value={scorer.needles.join('\n')}
                                    onChange={(event) =>
                                      updateScorer(index, (current) => ({
                                        ...current,
                                        needles: event.target.value
                                          .split('\n')
                                          .map((value) => value.trim())
                                          .filter(Boolean),
                                      }))
                                    }
                                    disabled={draftReadOnly}
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} denominator`}
                                      type="number"
                                      min={1}
                                      placeholder="Denominator"
                                      value={scorer.denominator ?? ''}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          denominator:
                                            event.target.value === ''
                                              ? undefined
                                              : Number(event.target.value),
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                    <TextInput
                                      aria-label={`Scorer ${index + 1} denominator value path`}
                                      placeholder="metadata.outputWordCount"
                                      value={scorer.denominatorPath ?? ''}
                                      onChange={(event) =>
                                        updateScorer(index, (current) => ({
                                          ...current,
                                          denominatorPath: event.target.value || undefined,
                                        }))
                                      }
                                      disabled={draftReadOnly}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </UiSurface>
                        ))}
                      </div>
                    </UiSurface>
                  </div>
                </UiSurface>

                <UiSurface level="card" className="space-y-4 p-4">
                  <div>
                    <UiHeading order={2} className="text-lg font-semibold">
                      Run Evaluation
                    </UiHeading>
                    <p className="text-sm text-muted-foreground">
                      Score an action/output pair against the selected profile.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Select
                      value={evaluationForm.profileId}
                      onChange={(value) =>
                        setEvaluationForm((current) => ({
                          ...current,
                          profileId: value ?? current.profileId,
                        }))
                      }
                      data={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                      placeholder="Select profile"
                      allowDeselect={false}
                    />

                    <TextInput
                      placeholder="Agent (optional)"
                      value={evaluationForm.agent || ''}
                      onChange={(event) =>
                        setEvaluationForm((current) => ({ ...current, agent: event.target.value }))
                      }
                    />

                    <TextInput
                      placeholder="Task ID (optional)"
                      value={evaluationForm.taskId || ''}
                      onChange={(event) =>
                        setEvaluationForm((current) => ({ ...current, taskId: event.target.value }))
                      }
                    />

                    <Textarea
                      rows={4}
                      placeholder="Action text"
                      value={evaluationForm.action || ''}
                      onChange={(event) =>
                        setEvaluationForm((current) => ({ ...current, action: event.target.value }))
                      }
                    />

                    <Textarea
                      rows={10}
                      placeholder="Agent output"
                      value={evaluationForm.output}
                      onChange={(event) =>
                        setEvaluationForm((current) => ({ ...current, output: event.target.value }))
                      }
                    />

                    <UiAction
                      variant="primary"
                      onClick={handleEvaluate}
                      disabled={runEvaluation.isPending}
                    >
                      Score Output
                    </UiAction>
                  </div>

                  {runEvaluation.data && (
                    <UiSurface level="inset" className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">Latest Evaluation</div>
                        <UiPill>{Math.round(runEvaluation.data.compositeScore * 100)}%</UiPill>
                      </div>
                      {runEvaluation.data.scores.map((score) => (
                        <div key={score.scorerId} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span>{score.scorerName}</span>
                            <span className="text-muted-foreground">
                              {Math.round(score.score * 100)}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-primary"
                              style={{ width: `${Math.round(score.score * 100)}%` }}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">{score.explanation}</div>
                        </div>
                      ))}
                    </UiSurface>
                  )}
                </UiSurface>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="explorer" className="m-0">
            <Suspense
              fallback={
                <UiSurface level="inset" className="p-4 text-sm text-muted-foreground">
                  Loading score explorer...
                </UiSurface>
              }
            >
              <ScoreExplorer profiles={profiles} />
            </Suspense>
          </Tabs.Panel>
        </Tabs>
      </div>
    </PrimaryPageShell>
  );
}
