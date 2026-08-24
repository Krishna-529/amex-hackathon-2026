'use client';

import { useEffect, useId, useRef } from 'react';

let mermaidInitialized = false;

export default function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const mermaid = (await import('mermaid')).default;
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          flowchart: { curve: 'basis', htmlLabels: true, nodeSpacing: 40, rankSpacing: 55 },
          themeVariables: {
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: '15px',
          },
        });
        mermaidInitialized = true;
      }
      const { svg } = await mermaid.render(`mermaid-${id}`, chart);
      if (!cancelled && ref.current) ref.current.innerHTML = svg;
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return <div ref={ref} className="mermaid-container" />;
}
