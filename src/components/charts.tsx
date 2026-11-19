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
