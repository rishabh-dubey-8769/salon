import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { RejectionFeedbackPage } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has('rejection-feedback')
      ? <RejectionFeedbackPage />
      : <App />}
  </React.StrictMode>
);