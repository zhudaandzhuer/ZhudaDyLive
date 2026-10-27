import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SceneOutput } from './SceneStage';
import './style.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  new URLSearchParams(location.search).get('output') === 'scene' ? <SceneOutput /> : <App />,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
