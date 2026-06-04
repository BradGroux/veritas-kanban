import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type {
  CreateScoringProfileInput,
  EvaluationRequest,
  Scorer,
  ScorerType,
  ScoringProfile,
} from '@veritas-kanban/shared';
import { ArrowLeft, Copy, Plus, Save, Trash2 } from 'lucide-react';
import {
  ActionIcon,
  Badge,
  Button,
  ScrollArea,
  Select,
  Tabs,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useToast } from '@/hooks/useToast';
import {
  useCreateScoringProfile,
  useDeleteScoringProfile,
  useRunEvaluation,
  useScoringProfiles,
  useUpdateScoringProfile,
} from '@/hooks/useScoring';

const ScoreExplorer = lazy(() =>
  import('./ScoreExplorer').then((mod) => ({ default: mod.ScoreExplorer }))
);

interface ScoringProfilesProps {
  onBack: () => void;
}

type ProfileDraft = CreateScoringProfileInput;

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
    case 'CustomExpression':
      return { ...base, type, expression: 'output.length > 0 ? 1 : 0' };
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

const scorerTypeOptions: ScorerType[] = [
  'KeywordContains',
  'RegexMatch',
  'NumericRange',
  'CustomExpression',
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
  const [draft, setDraft] = useState<ProfileDraft>(createEmptyDraft());
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

  useEffect(() => {
    if (profiles.length === 0) return;
    if (!selectedProfileId) {
      const first = profiles[0];
      setSelectedProfileId(first.id);
      setDraft({
        name: first.name,
        description: first.description || '',
        compositeMethod: first.compositeMethod,
        scorers: first.scorers,
      });
      setEvaluationForm((current) => ({ ...current, profileId: first.id }));
    }
  }, [profiles, selectedProfileId]);

  const loadProfileIntoDraft = (profile: ScoringProfile) => {
    setSelectedProfileId(profile.id);
    setDraft({
      name: profile.name,
      description: profile.description || '',
      compositeMethod: profile.compositeMethod,
      scorers: profile.scorers,
    });
    setEvaluationForm((current) => ({ ...current, profileId: profile.id }));
  };

  const handleCreateNew = () => {
    setSelectedProfileId('');
    setDraft(createEmptyDraft());
  };

  const handleDuplicate = (profile: ScoringProfile) => {
    setSelectedProfileId('');
    setDraft({
      name: `${profile.name} Copy`,
      description: profile.description || '',
      compositeMethod: profile.compositeMethod,
      scorers: profile.scorers.map((scorer) => ({ ...scorer, id: `${scorer.id}-copy` })),
    });
    setActiveTab('profiles');
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
      if (selectedProfile && !selectedProfile.builtIn) {
        const updated = await updateProfile.mutateAsync({
          id: selectedProfile.id,
          input: draft,
        });
        setSelectedProfileId(updated.id);
        toast({ title: 'Scoring profile updated' });
      } else {
        const created = await createProfile.mutateAsync(draft);
        setSelectedProfileId(created.id);
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
    try {
      await deleteProfile.mutateAsync(profile.id);
      setSelectedProfileId('');
      setDraft(createEmptyDraft());
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
    <div className="flex h-screen flex-col gap-4 bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ActionIcon variant="subtle" onClick={onBack} aria-label="Back to board">
              <ArrowLeft className="h-4 w-4" />
            </ActionIcon>
            <div>
              <h1 className="text-2xl font-bold">Agent Output Scoring</h1>
              <p className="text-sm text-muted-foreground">
                Manage scoring profiles and inspect evaluation trends over time
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCreateNew}>
              <Plus className="mr-2 h-4 w-4" />
              New Profile
            </Button>
            <Button
              onClick={handleSave}
              disabled={createProfile.isPending || updateProfile.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              Save Profile
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-6 pb-6">
        <Tabs
          value={activeTab}
          onChange={(value) => setActiveTab(value ?? 'profiles')}
          keepMounted={false}
          className="flex h-full flex-col gap-4"
        >
          <Tabs.List className="w-fit">
            <Tabs.Tab value="profiles">Profiles</Tabs.Tab>
            <Tabs.Tab value="explorer">Score Explorer</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="profiles" className="m-0 flex min-h-0 flex-1 gap-4">
            <div className="flex w-[340px] min-w-[320px] flex-col rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <div className="font-semibold">Scoring Profiles</div>
                <div className="text-sm text-muted-foreground">
                  Built-ins are read-only. Duplicate them to customize.
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="divide-y">
                  {isLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading profiles…</div>
                  ) : (
                    profiles.map((profile) => (
                      <button
                        key={profile.id}
                        className={`w-full space-y-2 p-4 text-left transition-colors hover:bg-muted/30 ${
                          selectedProfileId === profile.id ? 'bg-primary/5' : ''
                        }`}
                        onClick={() => loadProfileIntoDraft(profile)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{profile.name}</div>
                          <div className="flex gap-2">
                            {profile.builtIn && (
                              <Badge variant="light" tt="none">
                                Built-in
                              </Badge>
                            )}
                            <Badge variant="outline" tt="none">
                              {profile.compositeMethod}
                            </Badge>
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
              </ScrollArea>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
              <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
                <div className="space-y-4 rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {selectedProfile ? selectedProfile.name : 'New scoring profile'}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Define weighted scorers and a composite strategy.
                      </p>
                    </div>
                    {selectedProfile && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDuplicate(selectedProfile)}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </Button>
                        {!selectedProfile.builtIn && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(selectedProfile)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Name</label>
                      <TextInput
                        aria-label="Profile name"
                        value={draft.name}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, name: event.target.value }))
                        }
                        disabled={selectedProfile?.builtIn}
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
                        disabled={selectedProfile?.builtIn}
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
                      disabled={selectedProfile?.builtIn}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-semibold">Scorers</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            scorers: [...current.scorers, createScorer()],
                          }))
                        }
                        disabled={selectedProfile?.builtIn}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Scorer
                      </Button>
                    </div>

                    <ScrollArea className="h-[440px] rounded-md border">
                      <div className="space-y-3 p-3">
                        {draft.scorers.map((scorer, index) => (
                          <div
                            key={scorer.id}
                            className="space-y-3 rounded-lg border bg-muted/10 p-3"
                          >
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
                                  disabled={selectedProfile?.builtIn}
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
                                  disabled={selectedProfile?.builtIn}
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
                                  disabled={selectedProfile?.builtIn}
                                />
                              </div>
                              <ActionIcon
                                variant="subtle"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    scorers: current.scorers.filter(
                                      (_, scorerIndex) => scorerIndex !== index
                                    ),
                                  }))
                                }
                                disabled={selectedProfile?.builtIn || draft.scorers.length === 1}
                                aria-label="Remove scorer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </ActionIcon>
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
                                  disabled={selectedProfile?.builtIn}
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
                                    disabled={selectedProfile?.builtIn}
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
                                      disabled={selectedProfile?.builtIn}
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
                                      disabled={selectedProfile?.builtIn}
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
                                      disabled={selectedProfile?.builtIn}
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
                                      disabled={selectedProfile?.builtIn}
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
                                      disabled={selectedProfile?.builtIn}
                                    />
                                  </div>
                                </>
                              )}

                              {'expression' in scorer && (
                                <div className="space-y-2 lg:col-span-2">
                                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    Expression
                                  </label>
                                  <Textarea
                                    aria-label={`Scorer ${index + 1} expression`}
                                    rows={3}
                                    value={scorer.expression}
                                    onChange={(event) =>
                                      updateScorer(index, (current) => ({
                                        ...current,
                                        expression: event.target.value,
                                      }))
                                    }
                                    disabled={selectedProfile?.builtIn}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border bg-card p-4">
                  <div>
                    <h2 className="text-lg font-semibold">Run Evaluation</h2>
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

                    <Button onClick={handleEvaluate} disabled={runEvaluation.isPending}>
                      Score Output
                    </Button>
                  </div>

                  {runEvaluation.data && (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">Latest Evaluation</div>
                        <Badge tt="none">
                          {Math.round(runEvaluation.data.compositeScore * 100)}%
                        </Badge>
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
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="explorer" className="m-0 min-h-0 flex-1 overflow-auto">
            <Suspense
              fallback={
                <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                  Loading score explorer...
                </div>
              }
            >
              <ScoreExplorer profiles={profiles} />
            </Suspense>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
