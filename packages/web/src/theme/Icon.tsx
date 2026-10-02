// Line icons (24x24, currentColor). The Muse's SVGs in ../assets/theme/
// (la-g0tfg1) win; the paths below are fallbacks for names it didn't draw.
const FILES = import.meta.glob("../assets/theme/*.svg", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/** icon name -> the markup inside its <svg>, so our own <svg> sets size and colour. */
const SVG_BODIES: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, raw]) => [
    path.replace(/^.*\/(.+)\.svg$/, "$1"),
    raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""),
  ]),
);

const PATHS: Record<string, string> = {
  die: "M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Zm0 0v6m0 0-8.5-1m8.5 1 8.5-1M12 8.5 7 16.5h10l-5-8Zm-8.5 8 3.5 0m13.5 0-3.5 0M12 21.5v-5",
  lock: "M6.5 11h11v9.5h-11V11Zm2.5 0V7.5a3 3 0 0 1 6 0V11",
  unlock: "M6.5 11h11v9.5h-11V11Zm2.5 0V7.5a3 3 0 0 1 5.8-1",
  quill: "M20 3.5C13 5 8.5 10 6.5 17.5M20 3.5c-1 6-5 10.5-11 12.5M6.5 17.5 4 20.5",
  camera: "M3.5 8h4l1.5-2.5h6L16.5 8h4v11h-17V8Zm8.5 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z",
  sparkle: "M12 3.5 13.8 10.2 20.5 12 13.8 13.8 12 20.5 10.2 13.8 3.5 12 10.2 10.2 12 3.5Zm6.5-1v3m-1.5-1.5h3",
  scroll: "M7 4h11a2 2 0 0 1 0 4h-2v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h2V6a2 2 0 0 1 2-2m-1 12.5h6M10 8h4m-4 4h4",
  castle: "M4 20.5V9h3v2h2V9h2v2h2V9h2v2h2V9h3v11.5H4Zm6 0v-4a2 2 0 0 1 4 0v4M4 9V5.5h3V9m10 0V5.5h3V9",
  gem: "M7 4h10l3.5 5L12 20.5 3.5 9 7 4Zm-3.5 5h17M9.5 4 8 9l4 11.5L16 9l-1.5-5",
  helm: "M5 13a7 7 0 0 1 14 0v6.5h-4.5V15h-5v4.5H5V13Zm7-7v9",
  crown: "M4 18.5h16M4.5 15.5 3.5 7l5 4 3.5-6 3.5 6 5-4-1 8.5h-15Z",
  book: "M4 5.5c3-1.5 5.5-1.5 8 .5v14c-2.5-2-5-2-8-.5v-14Zm16 0c-3-1.5-5.5-1.5-8 .5v14c2.5-2 5-2 8-.5v-14Z",
  plus: "M12 5v14M5 12h14",
  trash: "M4.5 7h15M9 7V4.5h6V7m-8.5 0 1 13h9l1-13M10 10.5v6m4-6v6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  mic: "M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Zm-6 8a6 6 0 0 0 12 0M12 17.5v3",
  speaker: "M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Zm11.5.5a3 3 0 0 1 0 4m2.5-6.5a6.5 6.5 0 0 1 0 9",
  loop: "M17 3.5 19.5 6 17 8.5M19.5 6H9a4.5 4.5 0 0 0-4.5 4.5v1M7 20.5 4.5 18 7 15.5M4.5 18H15a4.5 4.5 0 0 0 4.5-4.5v-1",
  play: "M8 5.5v13l10.5-6.5L8 5.5Z",
  stop: "M7 7h10v10H7V7Z",
  note: "M9 18V5.5l10-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  upload: "M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 15v4.5h15V15",
  fade: "M3.5 19.5 20.5 5v14.5h-17Z",
  folder: "M3.5 6.5h6l2 2h9v10.5h-17V6.5Z",
  words: "M4 5.5h16v10H10l-4 3.5v-3.5H4v-10Zm4 4h8m-8 3h5",
  banner: "M6 3.5v17M6 4.5h11l-2.5 4 2.5 4H6",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title }: { name: IconName; size?: number; title?: string }) {
  const body = SVG_BODIES[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      {...(body ? { dangerouslySetInnerHTML: { __html: body } } : {})}
    >
      {body ? undefined : <path d={PATHS[name]} />}
    </svg>
  );
}
