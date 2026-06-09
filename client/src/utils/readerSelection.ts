export interface ReaderSelectionDetails {
  selection: string;
  context: string;
}

function containingElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

export function getReaderSelectionDetails(range: Range, content: HTMLElement): ReaderSelectionDetails | null {
  if (!content.contains(range.commonAncestorContainer)) return null;

  const startBlock = containingElement(range.startContainer)?.closest('.epub-p, .epub-h');
  const endBlock = containingElement(range.endContainer)?.closest('.epub-p, .epub-h');
  if (!startBlock || startBlock !== endBlock) return null;

  const selection = range.toString().replace(/\s+/g, ' ').trim();
  if (!selection) return null;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(startBlock);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(startBlock);
  afterRange.setStart(range.endContainer, range.endOffset);

  const context = `${beforeRange.toString()}~${range.toString()}~${afterRange.toString()}`
    .replace(/\s+/g, ' ')
    .trim();

  return { selection, context };
}
