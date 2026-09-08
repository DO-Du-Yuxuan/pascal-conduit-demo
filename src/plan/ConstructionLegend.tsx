import React from 'react';
import { DeviceSymbol } from './DeviceSymbol';
import type { InstallationScheduleSection } from './construction-drawings';

export function ConstructionLegend({ sections, annotationScale }: { sections: InstallationScheduleSection[]; annotationScale: number }) {
  if (!sections.length) return null;
  return <div className="construction-installation-schedule" aria-label="点位图例及安装高度表" style={{ '--point-scale': annotationScale } as React.CSSProperties}>
    <b>点位图例及安装高度表</b>
    {sections.map(section => <section key={section.system} data-construction-schedule={section.system}>
      <h3>{section.label}</h3>
      {section.rows.map(row => <div key={`${row.deviceType}:${row.name}:${row.mounting}:${row.height}`} className="construction-schedule-row" data-schedule-row title={`来源：${row.sourceIds.join(', ')}\n依据：${row.measurementBasis}；置信度：${row.confidence}\n${row.assumptions.join('\n')}`}>
        <svg viewBox="-12 -12 24 24" aria-label={`${row.name}图块`}><g fill="#fff" stroke="#343434" strokeWidth="1.5"><DeviceSymbol type={row.deviceType} /></g></svg>
        <span className="construction-schedule-variant">{row.variant ?? ''}</span><span>{row.name}</span><span>{row.mounting}</span><span>H={row.height}</span><span>×{row.quantity}</span>
      </div>)}
    </section>)}
  </div>;
}
