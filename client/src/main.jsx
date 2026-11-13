import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { RealtimeProvider } from './context/RealtimeContext.jsx';
import App from './App.jsx';
import '@fontsource-variable/bricolage-grotesque';
import './theme/tokens.css';
import './theme/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
          <App />
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
