import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, AreaChart, Area, PieChart, Pie, Cell, LineChart, Line, ReferenceLine, Sankey } from 'recharts';
import type { NodeProps, LinkProps } from 'recharts/types/chart/Sankey';
import { formatCents } from '../lib/money';
import { monthLabel } from '../lib/dates';

const css = (n: string) => `rgb(var(--c-${n}))`;
const euro = (v: unknown) => formatCents(Number(v ?? 0));
const monthTip = (m: unknown) => monthLabel(String(m ?? ''), true);
/** Klick auf einen Balken: liefert den Datensatz zum Index. */
const barPick = <T,>(data: T[], cb?: (row: T) => void) => (cb ? { onClick: (_: unknown, i: number) => data[i] && cb(data[i]), cursor: 'pointer' } : {});
/** Klick irgendwo in einem Diagramm mit Zeitachse: liefert den Datensatz unter dem Mauszeiger. */
const chartPick = <T,>(data: T[], cb?: (row: T) => void) => (cb ? {
  onClick: (st: { activeTooltipIndex?: unknown }) => { const i = Number(st?.activeTooltipIndex); if (Number.isInteger(i) && data[i]) cb(data[i]); },
  style: { cursor: 'pointer' },
} : {});
export type ChartPick<K extends string> = (period: string, series: K) => void;

/** Tooltip im Look der App, in beiden Farbschemata lesbar. */
const tip = {
  contentStyle: { background: css('surface'), border: `1px solid ${css('border')}`, borderRadius: 10, boxShadow: 'var(--shadow-pop)', fontSize: 12, color: css('text') },
  labelStyle: { color: css('text'), fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: css('text') },
  cursor: { fill: css('text'), fillOpacity: 0.05, stroke: 'none' },
};
const legend = { wrapperStyle: { fontSize: 12, color: css('text-muted') } };

const short = (v: number) => `${Math.round(v / 100).toLocaleString('de-DE')} €`;

export function IncomeExpenseChart({ data, height = 260, onPick }: { data: { month: string; income: number; expense: number }[]; height?: number; onPick?: ChartPick<'income' | 'expense'> }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={72} />
        <Tooltip {...tip} formatter={euro} labelFormatter={monthTip} />
        <Legend {...legend} />
        <Bar isAnimationActive={false} dataKey="income" name="Einnahmen" fill={css('income')} radius={[4, 4, 0, 0]} {...barPick(data, onPick && ((r) => onPick(r.month, 'income')))} />
        <Bar isAnimationActive={false} dataKey="expense" name="Ausgaben" fill={css('expense')} radius={[4, 4, 0, 0]} {...barPick(data, onPick && ((r) => onPick(r.month, 'expense')))} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceChart({ data, height = 220, onPick }: { data: { month: string; balance: number }[]; height?: number; onPick?: (month: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} {...chartPick(data, onPick && ((r) => onPick(r.month)))}>
        <defs>
          <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={css('accent')} stopOpacity={0.25} />
            <stop offset="100%" stopColor={css('accent')} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={80} />
        <Tooltip {...tip} formatter={euro} labelFormatter={monthTip} />
        <Area isAnimationActive={false} type="monotone" dataKey="balance" name="Kontostand" stroke={css('accent')} strokeWidth={2} fill="url(#bal)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DonutChart<T extends { name: string; amount: number; color: string }>({ data, height = 220, onPick }: { data: T[]; height?: number; onPick?: (row: T) => void }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie isAnimationActive={false} data={data} dataKey="amount" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={1} stroke="none"
          onClick={onPick ? (_, i) => data[i] && onPick(data[i]) : undefined}>
          {data.map((d, i) => <Cell key={i} fill={d.color} cursor={onPick ? 'pointer' : undefined} />)}
        </Pie>
        <Tooltip {...tip} formatter={euro} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Feste Reihenfolge der Serienfarben (nie zyklisch; ab der 8. Serie wird zu „Weitere“ zusammengefasst). */
export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`s${i}`)); // hell/dunkel über CSS-Variablen

const periodTick = (k: unknown) => {
  const s = String(k ?? '');
  if (/^\d{4}$/.test(s)) return s;
  if (s.includes('-Q')) return `Q${s.slice(6)} ${s.slice(2, 4)}`;
  return monthLabel(s);
};

export function CashflowChart({ data, height = 280, onPick }: { data: { period: string; income: number; expense: number; saving: number }[]; height?: number; onPick?: ChartPick<'income' | 'expense' | 'saving'> }) {
  const pick = (k: 'income' | 'expense' | 'saving') => barPick(data, onPick && ((r) => onPick(r.period, k)));
  const hasSaving = data.some((d) => d.saving);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={80} />
        <Tooltip {...tip} formatter={euro} labelFormatter={periodTick} />
        <Legend {...legend} />
        <Bar isAnimationActive={false} dataKey="income" name="Einnahmen" fill={css('income')} radius={[4, 4, 0, 0]} {...pick('income')} />
        <Bar isAnimationActive={false} dataKey="expense" name="Ausgaben" stackId="out" fill={css('expense')} radius={hasSaving ? undefined : [4, 4, 0, 0]} {...pick('expense')} />
        {hasSaving && <Bar isAnimationActive={false} dataKey="saving" name="Sparen" stackId="out" fill={SERIES[0]} radius={[4, 4, 0, 0]} stroke={css('surface')} strokeWidth={2} {...pick('saving')} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FixVarChart({ data, height = 260, onPick }: { data: { period: string; fixed: number; variable: number }[]; height?: number; onPick?: ChartPick<'fixed' | 'variable'> }) {
  const pick = (k: 'fixed' | 'variable') => barPick(data, onPick && ((r) => onPick(r.period, k)));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={80} />
        <Tooltip {...tip} formatter={euro} labelFormatter={periodTick} />
        <Legend {...legend} />
        <Bar isAnimationActive={false} dataKey="fixed" name="Fixkosten (Verträge)" stackId="a" fill={SERIES[6]} stroke={css('surface')} strokeWidth={2} {...pick('fixed')} />
        <Bar isAnimationActive={false} dataKey="variable" name="Variable Ausgaben" stackId="a" fill={SERIES[1]} radius={[4, 4, 0, 0]} stroke={css('surface')} strokeWidth={2} {...pick('variable')} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedAreaChart({ data, keys, height = 300, onPick }: { data: Record<string, number | string>[]; keys: string[]; height?: number; onPick?: (period: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} {...chartPick(data, onPick && ((r) => onPick(String(r.period))))}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={88} />
        <Tooltip {...tip} formatter={euro} labelFormatter={periodTick} />
        <Legend {...legend} />
        {keys.map((k, i) => (
          <Area key={k} isAnimationActive={false} type="monotone" dataKey={k} name={k} stackId="w"
            stroke={SERIES[i % SERIES.length]} strokeWidth={2} fill={SERIES[i % SERIES.length]} fillOpacity={0.35} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Prognose: Kontostand je Szenario, optional mit Warngrenze. */
export function ForecastChart({ data, series, floor, height = 300, onPick }: {
  data: Record<string, number | string>[]; series: { key: string; name: string; color: string }[]; floor?: number | null; height?: number; onPick?: (month: string) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} {...chartPick(data, onPick && ((r) => onPick(String(r.month))))}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={88} />
        <Tooltip {...tip} formatter={euro} labelFormatter={monthTip} />
        <Legend {...legend} />
        <ReferenceLine y={0} stroke={css('text-muted')} strokeOpacity={0.5} />
        {floor != null && <ReferenceLine y={floor} stroke={css('danger')} strokeDasharray="4 4" label={{ value: 'Warngrenze', fontSize: 11, fill: css('danger'), position: 'insideTopLeft' }} />}
        {series.map((s, i) => (
          <Line key={s.key} isAnimationActive={false} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={i === 0 ? 2.5 : 2} dot={false}
            strokeDasharray={i === 0 ? undefined : '6 3'} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface FlowChartNode { name: string; color: string; side: 'in' | 'hub' | 'out'; amount: number }

/** Geldfluss als Flussdiagramm: links Einnahmen, Mitte verfügbares Geld, rechts Ausgaben. */
export function FlowChart<N extends FlowChartNode>({ nodes, links, height = 420, onPick }: {
  nodes: N[]; links: { source: number; target: number; value: number }[]; height?: number; onPick?: (node: N) => void;
}) {
  const Node = (p: NodeProps) => {
    const n = nodes[p.index];
    if (!n) return null;
    const right = n.side === 'out';
    const hub = n.side === 'hub';
    const tx = right ? p.x + p.width + 6 : hub ? p.x + p.width / 2 : p.x - 6;
    const anchor = right ? 'start' : hub ? 'middle' : 'end';
    const ty = hub ? p.y - 8 : p.y + p.height / 2;
    return (
      <g style={{ cursor: onPick && !hub ? 'pointer' : undefined }} onClick={() => onPick && !hub && onPick(n)}>
        <rect x={p.x} y={p.y} width={p.width} height={Math.max(1, p.height)} fill={n.color} rx={2} />
        <text x={tx} y={ty} textAnchor={anchor} dominantBaseline="middle" fontSize={12} fill={css('text')}>
          {n.name} <tspan fill={css('text-muted')}>{short(n.amount)}</tspan>
        </text>
      </g>
    );
  };
  const Link = (p: LinkProps) => {
    const l = links[p.index];
    const target = l ? nodes[l.target] : undefined;
    const source = l ? nodes[l.source] : undefined;
    const color = (target?.side === 'out' ? target : source)?.color ?? css('text-muted');
    return (
      <path d={`M${p.sourceX},${p.sourceY} C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`}
        fill="none" stroke={color} style={{ strokeOpacity: 'var(--flow-opacity)' }} strokeWidth={Math.max(1, p.linkWidth)} />
    );
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Sankey data={{ nodes: nodes.map((n) => ({ name: n.name })), links }} nodeWidth={12} nodePadding={14} sort={false} iterations={0}
        margin={{ top: 24, right: 200, bottom: 8, left: 200 }} node={Node} link={Link}>
        <Tooltip {...tip} formatter={euro} />
      </Sankey>
    </ResponsiveContainer>
  );
}
