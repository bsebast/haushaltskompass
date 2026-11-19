import { Navigate, Route, Routes } from 'react-router-dom';
import { useBookCtx } from './state';
import Layout from './components/Layout';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Categories from './pages/Categories';
import Rules from './pages/Rules';
import Budgets from './pages/Budgets';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

export default function App() {
  const { status, error } = useBookCtx();
  if (status === 'loading') {
    return <div className="h-full grid place-items-center text-text-muted">Haushaltsbuch wird geladen …</div>;
  }
  if (status === 'error') {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="card p-6 max-w-md">
          <h1 className="text-lg font-semibold mb-2">Das Haushaltsbuch konnte nicht geladen werden</h1>
          <p className="text-sm text-text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (status === 'empty') return <Setup />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="konten" element={<Accounts />} />
        <Route path="buchungen" element={<Transactions />} />
        <Route path="kategorien" element={<Categories />} />
        <Route path="regeln" element={<Rules />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="auswertungen" element={<Reports />} />
        <Route path="einstellungen" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
