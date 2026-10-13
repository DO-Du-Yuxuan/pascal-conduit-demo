import type { ReactNode, SVGProps } from "react";

export type BuilderIconName =
  | "select"
  | "boxSelect"
  | "site"
  | "build"
  | "arrange"
  | "system"
  | "zone"
  | "delete"
  | "snap"
  | "reference"
  | "rotateCw"
  | "rotateCcw"
  | "topView"
  | "view2d"
  | "view3d"
  | "splitView"
  | "beam"
  | "electrical"
  | "plumbing"
  | "lighting"
  | "hvac"
  | "smart"
  | "water"
  | "bathroom"
  | "fire"
  | "irrigation"
  | "gas"
  | "scene"
  | "drawing"
  | "expand"
  | "collapse"
  | "layers"
  | "folder"
  | "level"
  | "device"
  | "chevronDown"
  | "eye"
  | "eyeOff"
  | "plus"
  | "ruler"
  | "save"
  | "import";

type IconShape = (props: SVGProps<SVGSVGElement>) => ReactNode;

const iconShapes: Record<BuilderIconName, IconShape> = {
  select: () => <path d="M5 3.5 18.5 14l-6.1.7 3.4 5.8-2.4 1.3-3.3-5.9L6.7 21 5 3.5Z" />,
  boxSelect: () => <><path d="M5 8V5h3M16 5h3v3M19 16v3h-3M8 19H5v-3" /><path d="M8 8h8v8H8z" strokeDasharray="2 2" /></>,
  site: () => <><path d="m3 10 9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9Z" /><path d="M8 20v-6h8v6M7 10h.01M12 10h.01M17 10h.01" /></>,
  build: () => <><path d="m14.5 6.5 3-3 3 3-3 3" /><path d="m16 5-6.5 6.5M4 20l5-1 9-9-4-4-9 9-1 5Z" /><path d="m11 9 4 4" /></>,
  arrange: () => <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /><path d="M14 7h6M17 4v6M4 16h6M7 13v6" /></>,
  system: () => <><circle cx="12" cy="5" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M11 7 7 16M13 7l4 9M8 18h8" /></>,
  zone: () => <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />,
  delete: () => <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  snap: () => <><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" /><path d="M8 12h8M12 8v8" /></>,
  reference: () => <><path d="M5 4h11l3 3v13H5z" /><path d="M16 4v4h4M8 16l3-4 2 2 2-3 2 5H8Z" /></>,
  rotateCw: () => <><path d="M20 11a8 8 0 0 0-14-5L4 8" /><path d="M4 4v4h4M20 13a8 8 0 0 1-14 5l-2-2" /></>,
  rotateCcw: () => <><path d="M4 11a8 8 0 0 1 14-5l2 2" /><path d="M20 4v4h-4M4 13a8 8 0 0 0 14 5l2-2" /></>,
  topView: () => <><path d="M12 20V5" /><path d="m6 11 6-6 6 6" /><path d="M5 20h14" /></>,
  view2d: () => <><rect x="3.5" y="4" width="17" height="16" rx="1.5" /><path d="M8 4v7h5V4M8 11v9M13 11l3 3v6" /></>,
  view3d: () => <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.7 7.5 4.4 7.5-4.4M12 12v9" /></>,
  splitView: () => <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" /></>,
  beam: () => <><path d="M4 8h16M4 16h16M7 8v8M17 8v8" /><path d="M9 8v8M12 8v8M15 8v8" strokeWidth="1.3" /></>,
  electrical: () => <><path d="M13 2 5 13h6l-1 9 9-12h-6l1-8Z" /></>,
  plumbing: () => <><path d="M5 4v6a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4v2" /><path d="M3 4h4M17 20h4M15 12V8h4" /></>,
  lighting: () => <><path d="M9 18h6M10 21h4M8.3 14.5A7 7 0 1 1 15.7 14.5c-.9.7-1.2 1.5-1.2 2.5h-5c0-1-.3-1.8-1.2-2.5Z" /><path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M20 12h2M17.7 6.3l1.4-1.4" /></>,
  hvac: () => <><path d="M4 6h16M4 12h16M4 18h16" /><path d="m8 4-2 2 2 2M16 10l2 2-2 2M8 16l-2 2 2 2" /></>,
  smart: () => <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 7h6M9 17h6M12 11v2" /></>,
  water: () => <><path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z" /><path d="M9 15a3 3 0 0 0 3 3" /></>,
  bathroom: () => <><path d="M4 12h16l-1 5a4 4 0 0 1-4 3H9a4 4 0 0 1-4-3l-1-5Z" /><path d="M6 12V6a2 2 0 0 1 4 0M8 20v2M16 20v2" /></>,
  fire: () => <path d="M13 3c1 4-2 5-1 8 1-1 2-2 2-3 3 2 5 5 4 8a6 6 0 0 1-12 0c0-3 2-6 5-8-.2 3 1 4 2 4 0-3 2-5 0-9Z" />,
  irrigation: () => <><path d="M12 21v-9M12 13c0-4-3-6-7-6 0 4 2 7 7 7ZM12 10c0-4 3-6 7-6 0 4-2 7-7 7Z" /><path d="M4 18c2-1 3-1 4 0M16 18c1-1 2-1 4 0" /></>,
  gas: () => <><path d="M12 3c2 3 5 6 5 11a5 5 0 0 1-10 0c0-3 2-6 5-11Z" /><path d="M12 13c1 1 2 2 2 3a2 2 0 0 1-4 0c0-1 1-2 2-3Z" /></>,
  scene: () => <><path d="m3 11 9-7 9 7v9H3v-9Z" /><path d="M8 20v-6h8v6M6 11h.01M18 11h.01" /></>,
  drawing: () => <><path d="M4 4h16v16H4z" /><path d="M7 8h10M7 12h5M7 16h8M16 14l2 2" /></>,
  expand: () => <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /><path d="M8 8 3 3M16 8l5-5M16 16l5 5M8 16l-5 5" /></>,
  collapse: () => <><path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5" /><path d="m8 8-5-5M16 8l5-5M16 16l5 5M8 16l-5 5" /></>,
  layers: () => <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  folder: () => <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />,
  level: () => <><path d="M3 7h18M6 12h12M9 17h6" /><path d="M5 4v6M19 4v6M8 9v6M16 9v6M11 14v6M13 14v6" /></>,
  device: () => <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  chevronDown: () => <path d="m6 9 6 6 6-6" />,
  eye: () => <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  eyeOff: () => <><path d="m3 3 18 18M10.6 6.2A10.9 10.9 0 0 1 12 6c6 0 9.5 6 9.5 6a16.4 16.4 0 0 1-3.1 3.6M6.2 6.2C3.9 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1 0 1.9-.2 2.7-.5" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  plus: () => <path d="M12 5v14M5 12h14" />,
  ruler: () => <><path d="m4 16 12-12 4 4L8 20H4v-4Z" /><path d="m13 7 4 4M10 10l2 2M7 13l2 2" /></>,
  save: () => <><path d="M5 3h12l4 4v14H3V5a2 2 0 0 1 2-2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
  import: () => <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 14v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" /></>,
};

export interface BuilderIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: BuilderIconName;
  size?: number;
  title?: string;
}

/** Small dependency-free inline icon set for the Demo Builder workbench. */
export function BuilderIcon({ name, size = 20, title, strokeWidth = 1.8, ...props }: BuilderIconProps) {
  const Shape = iconShapes[name];
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      focusable="false"
      height={size}
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {title && <title>{title}</title>}
      <Shape />
    </svg>
  );
}

export default BuilderIcon;

/** The same bundled action artwork used by Builder; no asset service is needed. */
export function BuilderActionIcon({ name, size = 28 }: { name: BuilderIconName; size?: number }) {
  const artwork: Partial<Record<BuilderIconName, string>> = { select: "select", site: "site", build: "build", arrange: "couch", zone: "zone", rotateCw: "rotate", rotateCcw: "rotate", topView: "topview", scene: "building", view3d: "building", view2d: "blueprint", level: "level" };
  const file = artwork[name];
  if (!file) return <BuilderIcon name={name} size={size} />;
  return <img alt="" aria-hidden="true" draggable={false} width={size} height={size} src={`${import.meta.env.BASE_URL}builder-icons/${file}.png`} style={{ objectFit: "contain", transform: name === "rotateCcw" ? "scaleX(-1)" : undefined }} />;
}
