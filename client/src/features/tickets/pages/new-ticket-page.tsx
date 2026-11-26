import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, ClientApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { FieldError, Select, Textarea } from '../../../components/ui/form-controls';
import { ErrorState, Spinner, errorMessage } from '../../../components/states';
import { orgKeys, useCategories, useMembers, useTeams, useWorkspaceMe, useWorkspaceOrg } from '../../orgs/org-api';
import { PRIORITIES, PRIORITY_LABEL, assigneeOptions, type TicketDetail, type TicketPriority } from '../tickets-api';

export const NewTicketPage: React.FC = () => {
  const org = useWorkspaceOrg();
  const me = useWorkspaceMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isManagerPlus = me.role !== 'STAFF';

  const teamsQuery = useTeams(org.slug);
  const categoriesQuery = useCategories(org.slug);
  const membersQuery = useMembers(org.slug);

  // Staff and Leads may only create tickets for their own teams.
  const teamChoices = useMemo(
    () => (teamsQuery.data?.teams ?? []).filter((t) => isManagerPlus || me.teamIds.includes(t.id)),
    [teamsQuery.data, isManagerPlus, me.teamIds]
  );

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Default to my only team so Staff do not have to pick.
  const effectiveTeamId = teamId || (!isManagerPlus && teamChoices.length === 1 ? teamChoices[0].id : '');
  const people = assigneeOptions(me, membersQuery.data?.members ?? [], effectiveTeamId || null);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ ticket: TicketDetail }>(`/orgs/${org.slug}/tickets`, {
        method: 'POST',
        body: JSON.stringify({
          subject,
          description,
          priority,
          dueDate: dueDate || null,
          categoryId: categoryId || null,
          teamId: effectiveTeamId || null,
          assigneeId: assigneeId || null,
        }),
      }),
    onSuccess: async ({ ticket }) => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.tickets(org.slug) });
      navigate(`/w/${org.slug}/tickets/${ticket.number}`);
    },
    onError: (err) => {
      setFormError(errorMessage(err, 'Could not create the ticket.'));
      if (err instanceof ClientApiError && err.fields) setFieldErrors(err.fields);
    },
  });

  if (teamsQuery.isLoading || membersQuery.isLoading) return <Spinner />;
  if (teamsQuery.isError) return <ErrorState error={teamsQuery.error} onRetry={() => teamsQuery.refetch()} />;

  if (!isManagerPlus && teamChoices.length === 0) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>You are not in a team yet</CardTitle>
          <CardDescription>Staff create tickets for their own team. Ask an Admin to add you to one.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Link
        to={`/w/${org.slug}/tickets`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to tickets
      </Link>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>New ticket</CardTitle>
          <CardDescription>Choose a team to route it, and optionally a person to do it.</CardDescription>
        </CardHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            setFormError(null);
            create.mutate();
          }}
        >
          <CardContent className="space-y-4">
            {formError && <ErrorState message={formError} />}
            <div className="space-y-1">
              <Label htmlFor="t-subject">Subject</Label>
              <Input id="t-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
              <FieldError message={fieldErrors.subject} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="t-description">Description</Label>
              <Textarea
                id="t-description"
                rows={6}
                maxLength={10000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <FieldError message={fieldErrors.description} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="t-team">Team</Label>
                <Select
                  id="t-team"
                  value={effectiveTeamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    setAssigneeId(''); // the old choice may not be eligible for the new team
                  }}
                >
                  {isManagerPlus && <option value="">No team (Unassigned queue)</option>}
                  {!isManagerPlus && !effectiveTeamId && <option value="">Choose your team...</option>}
                  {teamChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <FieldError message={fieldErrors.teamId} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-assignee">Assignee</Label>
                <Select id="t-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Nobody yet</option>
                  {people.map((m) => (
                    <option key={m.membershipId} value={m.membershipId}>
                      {m.membershipId === me.membershipId ? `${m.name} (me)` : `${m.name} (${m.role})`}
                    </option>
                  ))}
                </Select>
                <FieldError message={fieldErrors.assigneeId} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-priority">Priority</Label>
                <Select
                  id="t-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-due">Due date (optional)</Label>
                <Input id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                <FieldError message={fieldErrors.dueDate} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="t-category">Category (optional)</Label>
                <Select id="t-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">No category</option>
                  {(categoriesQuery.data?.categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <FieldError message={fieldErrors.categoryId} />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Link to={`/w/${org.slug}/tickets`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={create.isPending || subject.trim().length < 3 || description.trim().length < 10}
            >
              {create.isPending ? 'Creating...' : 'Create ticket'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
