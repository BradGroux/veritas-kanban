import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Feedback,
  FeedbackCategory,
  FeedbackListFilters,
  Sentiment,
} from '@veritas-kanban/shared';
import { CheckCircle, MessageSquare, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/useToast';
import {
  useCreateFeedback,
  useDeleteFeedback,
  useFeedbackAnalytics,
  useFeedbackList,
  useResolveFeedback,
  useUnresolvedFeedback,
} from '@/hooks/useFeedback';

const CATEGORIES: FeedbackCategory[] = ['quality', 'performance', 'accuracy', 'safety', 'ux'];
const SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative'];
const SENTIMENT_COLORS: Record<Sentiment, string> = {
  positive: '#22c55e',
  neutral: '#64748b',
  negative: '#ef4444',
};
const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  quality: 'Quality',
  performance: 'Performance',
  accuracy: 'Accuracy',
  safety: 'Safety',
  ux: 'UX',
};

// ─── Star Rating Input ────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  readOnly = false,
}: {
  value: number;
  onChange?: (rating: number) => void;
  readOnly?: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          className={[
            'transition-colors',
            readOnly ? 'cursor-default' : 'cursor-pointer hover:text-yellow-400',
            star <= (readOnly ? value : hovered || value)
              ? 'text-yellow-400'
              : 'text-muted-foreground/30',
          ].join(' ')}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readOnly && setHovered(star)}
          onMouseLeave={() => !readOnly && setHovered(0)}
          aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
        >
          <Star className="h-5 w-5 fill-current" />
        </button>
      ))}
    </div>
  );
}

// ─── Sentiment Badge ──────────────────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const colors: Record<Sentiment, string> = {
    positive: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    negative: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[sentiment]}`}
    >
      {sentiment}
    </span>
  );
}

// ─── Submit Tab ───────────────────────────────────────────────────────────────

function SubmitTab() {
  const { toast } = useToast();
  const createFeedback = useCreateFeedback();

  const [taskId, setTaskId] = useState('');
  const [agent, setAgent] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<FeedbackCategory[]>([]);

  const toggleCategory = (cat: FeedbackCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId.trim()) {
      toast({ title: 'Task ID required', variant: 'destructive' });
      return;
    }
    if (rating === 0) {
      toast({ title: 'Please select a rating', variant: 'destructive' });
      return;
    }
    try {
      await createFeedback.mutateAsync({
        taskId: taskId.trim(),
        agent: agent.trim() || undefined,
        rating,
        comment: comment.trim() || undefined,
        categories: selectedCategories,
      });
      toast({ title: 'Feedback submitted' });
      setTaskId('');
      setAgent('');
      setRating(0);
      setComment('');
      setSelectedCategories([]);
    } catch {
      toast({ title: 'Failed to submit feedback', variant: 'destructive' });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taskId">Task ID *</Label>
          <Input
            id="taskId"
            placeholder="task_xxx"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="agent">Agent (optional)</Label>
          <Input
            id="agent"
            placeholder="e.g. VERITAS"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Rating *</Label>
        <StarRating value={rating} onChange={setRating} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Categories</Label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={[
                'rounded-full border px-3 py-1 text-sm transition-colors',
                selectedCategories.includes(cat)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-transparent hover:bg-muted',
              ].join(' ')}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="comment">Comment</Label>
        <Textarea
          id="comment"
          placeholder="What went well or didn't? Sentiment is detected automatically."
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={createFeedback.isPending}>
        {createFeedback.isPending ? 'Submitting…' : 'Submit Feedback'}
      </Button>
    </form>
  );
}

// ─── Browse Tab ───────────────────────────────────────────────────────────────

function BrowseTab() {
  const { toast } = useToast();
  const deleteFeedback = useDeleteFeedback();
  const resolveFeedback = useResolveFeedback();

  const [filters, setFilters] = useState<FeedbackListFilters>({});

  const { data: items = [], isLoading } = useFeedbackList(filters);

  const handleResolve = async (id: string) => {
    try {
      await resolveFeedback.mutateAsync(id);
      toast({ title: 'Marked as resolved' });
    } catch {
      toast({ title: 'Failed to resolve', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFeedback.mutateAsync(id);
      toast({ title: 'Feedback deleted' });
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Filter by agent"
          className="w-40"
          value={filters.agent ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, agent: e.target.value || undefined }))
          }
        />
        <Select
          value={filters.sentiment ?? 'all'}
          onValueChange={(val) =>
            setFilters((f) => ({
              ...f,
              sentiment: val === 'all' ? undefined : (val as Sentiment),
            }))
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Sentiment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sentiments</SelectItem>
            {SENTIMENTS.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.category ?? 'all'}
          onValueChange={(val) =>
            setFilters((f) => ({
              ...f,
              category: val === 'all' ? undefined : (val as FeedbackCategory),
            }))
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.resolved !== undefined ? String(filters.resolved) : 'all'}
          onValueChange={(val) =>
            setFilters((f) => ({
              ...f,
              resolved: val === 'all' ? undefined : val === 'true',
            }))
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="false">Unresolved</SelectItem>
            <SelectItem value="true">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback found.</p>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="flex flex-col gap-3 pr-2">
            {items.map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function FeedbackCard({
  item,
  onResolve,
  onDelete,
}: {
  item: Feedback;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <StarRating value={item.rating} readOnly />
            <SentimentBadge sentiment={item.sentiment} />
            {item.resolved && (
              <Badge variant="outline" className="text-green-600">
                Resolved
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Task: <span className="font-mono">{item.taskId}</span>
            {item.agent && (
              <>
                {' '}
                · Agent: <span className="font-medium">{item.agent}</span>
              </>
            )}
            {' '}· {new Date(item.createdAt).toLocaleDateString()}
          </p>
          {item.categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.categories.map((cat) => (
                <Badge key={cat} variant="secondary" className="text-xs">
                  {CATEGORY_LABELS[cat]}
                </Badge>
              ))}
            </div>
          )}
          {item.comment && (
            <p className="mt-2 text-sm text-foreground/90 whitespace-pre-wrap">{item.comment}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {!item.resolved && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-600 hover:text-green-700"
              title="Mark resolved"
              onClick={() => onResolve(item.id)}
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            title="Delete"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data: analytics, isLoading } = useFeedbackAnalytics();

  const sentimentChartData = useMemo(
    () =>
      analytics
        ? SENTIMENTS.map((s) => ({
            name: s.charAt(0).toUpperCase() + s.slice(1),
            count: analytics.sentimentBreakdown[s] ?? 0,
            fill: SENTIMENT_COLORS[s],
          }))
        : [],
    [analytics]
  );

  const categoryChartData = useMemo(
    () =>
      analytics
        ? CATEGORIES.map((cat) => ({
            name: CATEGORY_LABELS[cat],
            count: analytics.categoryBreakdown[cat] ?? 0,
          }))
        : [],
    [analytics]
  );

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading analytics…</p>;
  if (!analytics)
    return <p className="p-4 text-sm text-muted-foreground">No analytics data yet.</p>;

  return (
    <ScrollArea className="h-[600px]">
      <div className="flex flex-col gap-6 p-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Total Feedback" value={analytics.totalFeedback} />
          <MetricCard label="Avg Rating" value={`${analytics.averageRating.toFixed(2)} ★`} />
          <MetricCard label="Unresolved" value={analytics.unresolvedCount} />
          <MetricCard
            label="Positive Rate"
            value={`${analytics.totalFeedback > 0 ? Math.round(((analytics.sentimentBreakdown.positive ?? 0) / analytics.totalFeedback) * 100) : 0}%`}
          />
        </div>

        {/* Rating distribution */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Rating Distribution</h3>
          <div className="flex flex-col gap-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const entry = analytics.ratingDistribution.find((r) => r.star === star);
              const pct = entry?.percentage ?? 0;
              return (
                <div key={star} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-right text-muted-foreground">{star}★</span>
                  <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-yellow-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-muted-foreground">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Satisfaction trend */}
        {analytics.satisfactionTrends.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold">Satisfaction Trend</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={analytics.satisfactionTrends}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                />
                <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip
                  formatter={(val: number) => [val.toFixed(2), 'Avg Rating'] as [string, string]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="averageRating"
                  stroke="#0f766e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Sentiment breakdown */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Sentiment Breakdown</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={sentimentChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" name="Count" fill="#0f766e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category breakdown */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Category Breakdown</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={categoryChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" name="Count" fill="#2563eb" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Per-agent scores */}
        {analytics.agentScores.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold">Per-Agent Scores</h3>
            <div className="flex flex-col gap-2">
              {analytics.agentScores.map((score) => (
                <div
                  key={score.agent}
                  className="flex items-center justify-between rounded border bg-card px-3 py-2 text-sm"
                >
                  <span className="font-medium">{score.agent}</span>
                  <div className="flex items-center gap-3">
                    <StarRating value={Math.round(score.averageRating)} readOnly />
                    <span className="text-muted-foreground">
                      {score.averageRating.toFixed(2)} · {score.totalFeedback} reviews
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function FeedbackPanel() {
  const { data: unresolved = [] } = useUnresolvedFeedbackCount();

  return (
    <div className="flex flex-col gap-0 rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">User Feedback</h2>
        {unresolved.length > 0 && (
          <Badge variant="destructive" className="ml-auto text-xs">
            {unresolved.length} unresolved
          </Badge>
        )}
      </div>
      <Tabs defaultValue="submit">
        <TabsList className="mx-4 mt-3 mb-0">
          <TabsTrigger value="submit">Submit</TabsTrigger>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="submit">
          <SubmitTab />
        </TabsContent>
        <TabsContent value="browse">
          <BrowseTab />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// tiny hook used inline above
function useUnresolvedFeedbackCount() {
  return useUnresolvedFeedback(50);
}
