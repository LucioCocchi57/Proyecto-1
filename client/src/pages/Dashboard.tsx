import { useAuth } from '../context/AuthContext';

const Dashboard = () => {
  const { user } = useAuth();
  const userName = user?.user_metadata?.name || user?.email || 'Usuario';

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="welcome-text">Bienvenido, {userName}</p>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Facturas del Mes</h3>
          <p className="stat-number">0</p>
          <span className="stat-label">facturas emitidas</span>
        </div>
        <div className="stat-card">
          <h3>Facturacion del Mes</h3>
          <p className="stat-number">$0.00</p>
          <span className="stat-label">total facturado</span>
        </div>
        <div className="stat-card">
          <h3>Clientes</h3>
          <p className="stat-number">0</p>
          <span className="stat-label">clientes registrados</span>
        </div>
        <div className="stat-card">
          <h3>Pendientes de Cobro</h3>
          <p className="stat-number">$0.00</p>
          <span className="stat-label">por cobrar</span>
        </div>
      </div>

      <div className="recent-section">
        <h2>Ultimas Facturas</h2>
        <div className="empty-state">
          <p>No hay facturas todavia. Crea tu primera factura desde la seccion Facturas.</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
