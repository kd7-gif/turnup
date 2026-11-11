import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Home from './pages/Home.jsx';
import EventPage from './pages/EventPage.jsx';
import HostPage from './pages/HostPage.jsx';
import Saved from './pages/Saved.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import NotFound from './pages/NotFound.jsx';

function SignedIn({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="e/:slug" element={<EventPage />} />
        <Route path="h/:slug" element={<HostPage />} />
        <Route path="saved" element={<SignedIn><Saved /></SignedIn>} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
