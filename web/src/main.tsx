import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installCodeTheme } from './lib/code-theme';
import './styles.css';

// One palette, shared by the editor and the preview pane.
installCodeTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
