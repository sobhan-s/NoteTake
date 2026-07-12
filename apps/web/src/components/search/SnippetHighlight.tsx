const SENTINEL_SPLIT_REGEX = /(\[\[\[MARK\]\]\]|\[\[\[MARK_END\]\]\])/g;
const MARK_START = "[[[MARK]]]";
const MARK_END = "[[[MARK_END]]]";

export interface SnippetHighlightProps {
  snippet: string;
}

export function SnippetHighlight({ snippet }: SnippetHighlightProps) {
  const segments = snippet.split(SENTINEL_SPLIT_REGEX);
  let insideMark = false;

  return (
    <>
      {segments.map((segment, index) => {
        if (segment === MARK_START) {
          insideMark = true;
          return null;
        }
        if (segment === MARK_END) {
          insideMark = false;
          return null;
        }
        if (segment === "") {
          return null;
        }
        return insideMark ? (
          <mark
            key={index}
            className="rounded bg-amber-200 px-1 font-semibold text-amber-950"
          >
            {segment}
          </mark>
        ) : (
          <span key={index}>{segment}</span>
        );
      })}
    </>
  );
}
