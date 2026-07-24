// ---------------------------------------------------------------------------
// main.tsx -- React entry point
// ---------------------------------------------------------------------------

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme';
import App from './App';
import './styles/main.css';

// Remove state left by retired offline-dictionary builds so an old browser
// preference can never divert requests away from the live API.
for (const key of [
  'polycast.offline.enabled',
  'polycast.offline.user.v1',
  'polycast.offline.dictionary.words.v1',
]) {
  window.localStorage.removeItem(key);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
