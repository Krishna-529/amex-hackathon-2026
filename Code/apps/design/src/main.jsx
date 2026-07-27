import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, useParams } from 'react-router-dom';
import '@shared/tokens.css';
import { ProofPage } from '@shared/components/index.jsx';
import Design from './Design.jsx';

/* GitHub Pages has no server-side rewrite, so a client route like
   /proof/sens-portfolio has no file behind it and 404s. A hash route needs no
   rewrite at all. Locally, serve.js does the fallback properly, so we keep
   clean URLs there. Switched at build time, never at runtime. */
const Router = __ZKD_PAGES__ ? HashRouter : BrowserRouter;

function Proof() {
  const { id } = useParams();
  return <ProofPage id={id} site="System design" />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<Design />} />
        <Route path="/proof/:id" element={<Proof />} />
      </Routes>
    </Router>
  </React.StrictMode>
);
