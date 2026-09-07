import React from 'react';
import type { NetworkDeviceType } from '../domain/overlay';
/** Local units are screen pixels; callers anchor this to real model geometry. */
export function DeviceSymbol({ type }: { type: NetworkDeviceType | 'junction-box' }) {
  switch (type) {
    case 'strong-panel': return <><rect x="-8" y="-6" width="16" height="12"/><path d="M-6 4L6-4M-6-4L6 4"/></>;
    case 'weak-panel': return <><rect x="-8" y="-6" width="16" height="12"/><path d="M-5 0H5"/></>;
    case 'junction-box': return <><rect x="-7" y="-7" width="14" height="14"/><path d="M-3-3L3 3M3-3L-3 3"/></>;
    case 'socket': return <><path d="M-8 3 A8 8 0 0 1 8 3 Z"/><path d="M-3-1V-5M3-1V-5M0 3V7"/></>;
    case 'switch': return <><circle r="4"/><path d="M3-3L8-8M8-8H12"/></>;
    case 'luminaire': return <><circle r="8"/><path d="M-5.5-5.5L5.5 5.5M5.5-5.5L-5.5 5.5"/></>;
    case 'network-outlet': return <><rect x="-7" y="-6" width="14" height="12"/><path d="M-4-2H4V2H2V4H-2V2H-4Z"/></>;
    case 'sprinkler-head': return <><circle r="6"/><path d="M-9 0H9M0-9V9"/></>;
    case 'fire-inlet': return <><circle r="7"/><path d="M-4 0H4M0-4V4M-10 0H-7M7 0H10"/></>;
  }
}
