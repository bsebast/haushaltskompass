import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { formatCents } from '../lib/money';
import { monthLabel } from '../lib/dates';

const css = (n: string) => `rgb(var(--c-${n}))`;
const euro = (v: unknown) => formatCents(Number(v ?? 0));
const monthTip = (m: unknown) => monthLabel(String(m ?? ''), true);
const short = (v: number) => `${Math.round(v / 100).toLocaleString('de-DE')} €`;

export function IncomeExpenseChart({ data, height = 260 }: { data: { month: string; income: number; expense: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={72} />
        <Tooltip formatter={euro} labelFormatter={monthTip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="income" name="Einnahmen" fill={css('income')} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="expense" name="Ausgaben" fill={css('expense')} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceChart({ data, height = 220 }: { data: { month: string; balance: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={css('accent')} stopOpacity={0.25} />
            <stop offset="100%" stopColor={css('accent')} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={80} />
        <Tooltip formatter={euro} labelFormatter={monthTip} />
        <Area isAnimationActive={false} type="monotone" dataKey="balance" name="Kontostand" stroke={css('accent')} strokeWidth={2} fill="url(#bal)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, height = 220 }: { data: { name: string; amount: number; color: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie isAnimationActive={false} data={data} dataKey="amount" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={1} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={euro} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Feste Reihenfolge der Serienfarben (nie zyklisch; ab der 8. Serie wird zu „Weitere“ zusammengefasst). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const periodTick = (k: unknown) => {
  const s = String(k ?? '');
  if (/^\d{4}$/.test(s)) return s;
  if (s.includes('-Q')) return `Q${s.slice(6)} ${s.slice(2, 4)}`;
  return monthLabel(s);
};

export function CashflowChart({ data, height = 280 }: { data: { period: string; income: number; expense: number; saving: number }[]; height?: number }) {
  const hasSaving = data.some((d) => d.saving);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={80} />
        <Tooltip formatter={euro} labelFormatter={periodTick} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="income" name="Einnahmen" fill={css('income')} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="expense" name="Ausgaben" stackId="out" fill={css('expense')} radius={hasSaving ? undefined : [4, 4, 0, 0]} />
        {hasSaving && <Bar isAnimationActive={false} dataKey="saving" name="Sparen" stackId="out" fill={SERIES[0]} radius={[4, 4, 0, 0]} stroke={css('surface')} strokeWidth={2} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FixVarChart({ data, height = 260 }: { data: { period: string; fixed: number; variable: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={80} />
        <Tooltip formatter={euro} labelFormatter={periodTick} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="fixed" name="Fixkosten (Verträge)" stackId="a" fill={SERIES[6]} stroke={css('surface')} strokeWidth={2} />
        <Bar isAnimationActive={false} dataKey="variable" name="Variable Ausgaben" stackId="a" fill={SERIES[1]} radius={[4, 4, 0, 0]} stroke={css('surface')} strokeWidth={2} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedAreaChart({ data, keys, height = 300 }: { data: Record<string, number | string>[]; keys: string[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={css('border')} />
        <XAxis dataKey="period" tickFormatter={periodTick} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={{ fontSize: 12, fill: css('text-muted') }} axisLine={false} tickLine={false} width={88} />
        <Tooltip formatter={euro} labelFormatter={periodTick} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => (
          <Area key={k} isAnimationActive={false} type="monotone" dataKey={k} name={k} stackId="w"
            stroke={SERIES[i % SERIES.length]} strokeWidth={2} fill={SERIES[i % SERIES.length]} fillOpacity={0.35} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
