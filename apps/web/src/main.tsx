import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container not found — index.html is missing <div id="root">');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
