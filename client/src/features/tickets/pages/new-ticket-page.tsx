import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { useRefreshOrg, useTeams, useWorkspaceOrg } from '../../orgs/org-api';
import { PRIORITIES, type Priority } from '../tickets-api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardContent } from '../../../components/ui/card';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, PageHeader } from '../../../components/states';

type Item = { title: string; priority: Priority; dueDate: string };

/** Internal task (README 0.4): Admin or a team leader, for any team; goes to that team's leader. */
export const NewTicketPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const navigate = useNavigate();
  const refresh = useRefreshOrg(org.slug);
  const [params] = useSearchParams();
  const { data: teams } = useTeams(org.slug);
  const [form, setForm] = useState({
    subject: '',
    description: '',
    teamId: params.get('teamId') ?? '',
    priority: 'MEDIUM' as Priority,
    dueDate: '',
  });
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await apiFetch<{ ticket: { number: number } }>(`/orgs/${org.slug}/tickets`, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          dueDate: form.dueDate || null,
          checklist: items
            .filter((i) => i.title.trim())
            .map((i) => ({ title: i.title, priority: i.priority, dueDate: i.dueDate || null })),
        }),
      });
      await refresh();
      navigate(`/w/${org.slug}/tickets/${res.ticket.number}`);
    } catch (err) {
      setError(err);
      if (err instanceof ClientApiError && err.fields) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  };

  const setItem = (i: number, patch: Partial<Item>) =>
    setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to={`/w/${org.slug}/tickets`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Tickets
      </Link>
      <PageHeader title="New internal task" description="Goes straight to the team leader of the team you choose." />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            {error != null && <ErrorState error={error} />}
            <div className="space-y-1">
              <Label htmlFor="subject">Title</Label>
              <Input
                id="subject"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                required
              />
              <FieldError message={fields.subject} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">What needs to be done</Label>
              <Textarea
                id="description"
                rows={5}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
              <FieldError message={fields.description} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="team">Team</Label>
                <Select
                  id="team"
                  value={form.teamId}
                  onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                  required
                >
                  <option value="">Choose a team</option>
                  {teams?.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.categories.length > 0 ? ` (${t.categories.map((c) => c.name).join(', ')})` : ''}
                    </option>
                  ))}
                </Select>
                <FieldError message={fields.teamId} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  id="priority"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="due">Deadline</Label>
                <Input
                  id="due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
                <FieldError message={fields.dueDate} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tasks inside this ticket (optional)</Label>
              {items.map((it, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border border-slate-200 p-2 sm:flex-row">
                  <Input
                    placeholder="Task title"
                    value={it.title}
                    onChange={(e) => setItem(i, { title: e.target.value })}
                    aria-label="Task title"
                  />
                  <Select
                    className="sm:w-32"
                    value={it.priority}
                    onChange={(e) => setItem(i, { priority: e.target.value as Priority })}
                    aria-label="Task priority"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                  <Input
                    className="sm:w-40"
                    type="date"
                    value={it.dueDate}
                    onChange={(e) => setItem(i, { dueDate: e.target.value })}
                    aria-label="Task deadline"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove task"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setItems([...items, { title: '', priority: 'MEDIUM', dueDate: '' }])}
              >
                <Plus className="h-4 w-4" /> Add a task
              </Button>
            </div>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Creating...' : 'Create task'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
