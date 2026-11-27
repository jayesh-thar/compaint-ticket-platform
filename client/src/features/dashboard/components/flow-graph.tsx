import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { apiFetch } from '../../../lib/api';
import { orgKeys } from '../../orgs/org-api';
import { ErrorState, Spinner } from '../../../components/states';

/**
 * README 0.10: the visual heart of the system. Start nodes (blinking red dot
 * while work is waiting) -> Admin approval -> categories -> teams -> final
 * approval -> Done. Counts top-right; red = waiting work, green = clear.
 * Refreshes live: the workspace's EventSource invalidates this query.
 */

interface Graph {
  complaints: { live: number };
  tasks: { live: number };
  approval: { waiting: number };
  categories: { id: string; name: string; leadLabel: string; waiting: number }[];
  teams: { id: string; name: string; categoryIds: string[]; waiting: number; working: number; live: number }[];
  finalApproval: { waiting: number };
  done: { total: number };
  rejected: { total: number };
}

type BoxData = {
  title: string;
  subtitle?: string;
  count: number;
  tone: 'start' | 'red' | 'green' | 'end' | 'grey';
  blink?: boolean;
  teamId?: string;
};

const TONE: Record<BoxData['tone'], string> = {
  start: 'border-red-300 bg-red-50',
  red: 'border-red-300 bg-white',
  green: 'border-emerald-300 bg-white',
  end: 'border-emerald-400 bg-emerald-50',
  grey: 'border-slate-300 bg-slate-50',
};
const BADGE: Record<BoxData['tone'], string> = {
  start: 'bg-red-600',
  red: 'bg-red-600',
  green: 'bg-emerald-600',
  end: 'bg-emerald-600',
  grey: 'bg-slate-500',
};

const Box: React.FC<NodeProps<Node<BoxData>>> = ({ data }) => (
  <div
    className={`relative w-48 rounded-lg border-2 px-3 py-2 shadow-sm ${TONE[data.tone]} ${data.teamId ? 'cursor-pointer' : ''}`}
  >
    <Handle type="target" position={Position.Left} className="!bg-slate-400" />
    <span
      className={`absolute -right-2 -top-2 min-w-6 rounded-full px-1.5 text-center text-xs font-bold text-white ${BADGE[data.tone]}`}
    >
      {data.count}
    </span>
    <div className="flex items-center gap-2">
      {data.blink && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
        </span>
      )}
      <p className="truncate text-sm font-semibold text-slate-900">{data.title}</p>
    </div>
    {data.subtitle && <p className="mt-0.5 truncate text-[11px] text-slate-500">{data.subtitle}</p>}
    <Handle type="source" position={Position.Right} className="!bg-slate-400" />
  </div>
);
const nodeTypes = { box: Box };

const X = [0, 260, 520, 780, 1040, 1300];
const ROW = 90;

const build = (g: Graph) => {
  const nodes: Node<BoxData>[] = [];
  const edges: Edge[] = [];
  const box = (id: string, col: number, y: number, data: BoxData) =>
    nodes.push({ id, type: 'box', position: { x: X[col], y }, data });
  const edge = (source: string, target: string, active: boolean, faint = false) =>
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      animated: active,
      style: { stroke: active ? '#dc2626' : faint ? '#cbd5e1' : '#94a3b8', strokeDasharray: faint ? '4 4' : undefined },
    });

  // Teams first: they decide the height. Grouped by category, then teams without one.
  const ordered = [
    // A team in several categories is drawn once; every category draws a line to it.
    ...g.categories.flatMap((c) => g.teams.filter((t) => t.categoryIds[0] === c.id)),
    ...g.teams.filter((t) => !g.categories.some((c) => c.id === t.categoryIds[0])),
  ];
  ordered.forEach((t, i) =>
    box(`team-${t.id}`, 3, i * ROW, {
      title: t.name,
      subtitle: t.live === 0 ? 'All clear' : `${t.waiting} to assign · ${t.working} in work`,
      count: t.live,
      tone: t.live > 0 ? 'red' : 'green',
      blink: t.waiting > 0,
      teamId: t.id,
    })
  );
  const height = Math.max(ordered.length, 3) * ROW;
  const mid = height / 2 - ROW / 2;

  box('complaints', 0, mid - ROW, {
    title: 'Customer complaints',
    subtitle: 'Live from the shared link',
    count: g.complaints.live,
    tone: 'start',
    blink: g.complaints.live > 0,
  });
  box('tasks', 0, mid + ROW, {
    title: 'Internal tasks',
    subtitle: 'Raised by Admins and leaders',
    count: g.tasks.live,
    tone: 'start',
    blink: g.tasks.live > 0,
  });
  box('approval', 1, mid - ROW, {
    title: 'Admin approval',
    subtitle: 'Stuck here until approved',
    count: g.approval.waiting,
    tone: g.approval.waiting > 0 ? 'red' : 'green',
    blink: g.approval.waiting > 0,
  });
  box('rejected', 1, mid + ROW, { title: 'Rejected', subtitle: 'History', count: g.rejected.total, tone: 'grey' });
  edge('complaints', 'approval', g.approval.waiting > 0);
  edge('approval', 'rejected', false, true);

  g.categories.forEach((c) => {
    const rows = ordered.map((t, i) => (t.categoryIds.includes(c.id) ? i : -1)).filter((i) => i >= 0);
    const y = rows.length > 0 ? ((rows[0] + rows[rows.length - 1]) / 2) * ROW : mid;
    box(`cat-${c.id}`, 2, y, {
      title: c.name,
      subtitle: c.leadLabel,
      count: c.waiting,
      tone: c.waiting > 0 ? 'red' : 'green',
      blink: c.waiting > 0,
    });
    edge('approval', `cat-${c.id}`, c.waiting > 0);
    g.teams
      .filter((t) => t.categoryIds.includes(c.id))
      .forEach((t) => edge(`cat-${c.id}`, `team-${t.id}`, t.waiting > 0));
  });
  ordered.forEach((t) => {
    if (t.categoryIds.length === 0) edge('approval', `team-${t.id}`, false, true);
    edge('tasks', `team-${t.id}`, false, true);
    edge(`team-${t.id}`, 'final', t.working > 0);
  });

  box('final', 4, mid, {
    title: 'Final approval (Admin)',
    subtitle: 'After the team leader approved',
    count: g.finalApproval.waiting,
    tone: g.finalApproval.waiting > 0 ? 'red' : 'green',
    blink: g.finalApproval.waiting > 0,
  });
  box('done', 5, mid, { title: 'Done', subtitle: 'Moved to history', count: g.done.total, tone: 'end' });
  edge('final', 'done', g.finalApproval.waiting > 0);
  return { nodes, edges, height };
};

export const FlowGraph: React.FC<{ slug: string }> = ({ slug }) => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: orgKeys.graph(slug),
    queryFn: () => apiFetch<{ graph: Graph }>(`/orgs/${slug}/graph`),
  });
  const built = useMemo(() => (data ? build(data.graph) : null), [data]);

  if (isLoading) return <Spinner />;
  if (error || !built) return <ErrorState error={error} />;
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white"
      style={{ height: Math.min(Math.max(built.height + 120, 360), 720) }}
    >
      <ReactFlow
        nodes={built.nodes}
        edges={built.edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => n.data.teamId && navigate(`/w/${slug}/teams/${n.data.teamId}`)}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};
