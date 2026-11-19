import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { BookProvider } from './state';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BookProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </BookProvider>
  </React.StrictMode>,
);
