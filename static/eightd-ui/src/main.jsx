import React from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import '@atlaskit/css-reset';
import './theme.css';
import App from './App.jsx';

// Theme first, render second: avoids the light flash and the white box in dark mode.
view.theme.enable().catch(() => {}).finally(() => {
  createRoot(document.getElementById('root')).render(<App />);
});
