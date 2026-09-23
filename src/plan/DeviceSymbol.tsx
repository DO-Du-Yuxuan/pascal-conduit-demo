import React from 'react';
import type { NetworkDeviceType, SprinklerDirection } from '../domain/overlay';
/** Local units are screen pixels; callers anchor this to real model geometry. */
export function DeviceSymbol({ type, switchGangs, sprinklerDirection = 'upright', floorSocket = false }: { type: NetworkDeviceType | 'junction-box'; switchGangs?: number | null; sprinklerDirection?: SprinklerDirection; floorSocket?: boolean }) {
  switch (type) {
    case 'strong-panel': return <><rect x="-8" y="-6" width="16" height="12"/><path d="M-6 4L6-4M-6-4L6 4"/></>;
    case 'weak-panel': return <><rect x="-8" y="-6" width="16" height="12"/><path d="M-5 0H5"/></>;
    case 'junction-box': return <><rect x="-7" y="-7" width="14" height="14"/><path d="M-3-3L3 3M3-3L-3 3"/></>;
    case 'socket': return floorSocket
      ? <g data-floor-socket-symbol><rect x="-7" y="-7" width="14" height="14" rx="1"/><circle r="4"/><path d="M-2-2V2M2-2V2"/></g>
      : <><path d="M-8 3 A8 8 0 0 1 8 3 Z"/><path d="M-3-1V-5M3-1V-5M0 3V7"/></>;
    case 'switch': {
      const gangs = Math.max(1, Math.min(6, switchGangs ?? 1));
      const offsets = Array.from({ length: gangs }, (_, index) => (index - (gangs - 1) / 2) * 3);
      return <><circle r="4"/>{offsets.map((offset, index) => <path key={index} d={`M3 ${offset - 1}L8 ${offset - 6}H12`}/>)}</>;
    }
    case 'luminaire': return <><circle r="8"/><path d="M-5.5-5.5L5.5 5.5M5.5-5.5L-5.5 5.5"/></>;
    case 'network-outlet': return <><rect x="-7" y="-6" width="14" height="12"/><path d="M-4-2H4V2H2V4H-2V2H-4Z"/></>;
    case 'sprinkler-head': return <><circle r="6"/><path d="M-9 0H9"/><path d={sprinklerDirection === 'pendent' ? 'M0-10V10M-3 7L0 10L3 7' : 'M0 10V-10M-3-7L0-10L3-7'}/></>;
    case 'sensor': return <><circle r="7"/><circle r="2" fill="currentColor"/><path d="M-10 0H-7M7 0H10M0-10V-7M0 7V10"/></>;
    case 'rfid-reader': return <><rect x="-6" y="-9" width="12" height="18" rx="2"/><path d="M-3 -4Q3 0-3 4M1 -6Q7 0 1 6"/></>;
  }
}
