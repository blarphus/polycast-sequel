import { useEffect, useRef, useState } from 'react';
import type React from 'react';

export type CollectionTextFitVariant = 'compact' | 'standard' | 'wide' | 'feature';

interface UseCollectionCardTextFitOptions {
  title: string;
  secondaryText?: string | null;
  variant: CollectionTextFitVariant;
}

interface UseCollectionCardTextFitResult {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  textRef: React.RefObject<HTMLDivElement | null>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  titleStyle: React.CSSProperties;
  secondaryStyle: React.CSSProperties;
  showSecondary: boolean;
}

const VARIANT_RULES: Record<CollectionTextFitVariant, {
  minFont: number;
  maxFont: number;
  lineHeight: number;
  previewFontSize: number;
  previewLineHeight: number;
  minPreviewLines: number;
  maxTitleShare: number;
}> = {
  compact: { minFont: 14, maxFont: 20, lineHeight: 1.14, previewFontSize: 13, previewLineHeight: 1.45, minPreviewLines: 2, maxTitleShare: 0.72 },
  standard: { minFont: 15, maxFont: 28, lineHeight: 1.1, previewFontSize: 13.5, previewLineHeight: 1.48, minPreviewLines: 2, maxTitleShare: 0.7 },
  wide: { minFont: 16, maxFont: 34, lineHeight: 1.08, previewFontSize: 14, previewLineHeight: 1.5, minPreviewLines: 2, maxTitleShare: 0.66 },
  feature: { minFont: 18, maxFont: 42, lineHeight: 1.03, previewFontSize: 15, previewLineHeight: 1.5, minPreviewLines: 2, maxTitleShare: 0.68 },
};

function measureTextHeight({
  mountNode,
  width,
  text,
  fontFamily,
  fontWeight,
  letterSpacing,
  fontSize,
  lineHeight,
}: {
  mountNode: HTMLElement;
  width: number;
  text: string;
  fontFamily: string;
  fontWeight: string;
  letterSpacing: string;
  fontSize: number;
  lineHeight: number;
}) {
  const probe = document.createElement('div');
  probe.textContent = text;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.inset = '0 auto auto 0';
  probe.style.width = `${width}px`;
  probe.style.fontFamily = fontFamily;
  probe.style.fontWeight = fontWeight;
  probe.style.letterSpacing = letterSpacing;
  probe.style.fontSize = `${fontSize}px`;
  probe.style.lineHeight = String(lineHeight);
  probe.style.whiteSpace = 'normal';
  probe.style.wordBreak = 'break-word';
  probe.style.overflowWrap = 'anywhere';
  mountNode.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

export function useCollectionCardTextFit({
  title,
  secondaryText,
  variant,
}: UseCollectionCardTextFitOptions): UseCollectionCardTextFitResult {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const [titleStyle, setTitleStyle] = useState<React.CSSProperties>({});
  const [secondaryStyle, setSecondaryStyle] = useState<React.CSSProperties>({});
  const [showSecondary, setShowSecondary] = useState(false);

  useEffect(() => {
    let frame = 0;
    const bodyEl = bodyRef.current;
    const textEl = textRef.current;
    const titleEl = titleRef.current;

    if (!bodyEl || !textEl || !titleEl) return undefined;

    const measure = () => {
      frame = 0;
      try {
        const {
          minFont,
          maxFont,
          lineHeight,
          previewFontSize,
          previewLineHeight,
          minPreviewLines,
          maxTitleShare,
        } = VARIANT_RULES[variant];
        const textStyles = window.getComputedStyle(textEl);
        const titleStyles = window.getComputedStyle(titleEl);
        const gap = parseFloat(textStyles.rowGap || textStyles.gap || '0') || 0;
        const availableTextHeight = Math.max(40, textEl.clientHeight);
        const availableWidth = Math.max(140, titleEl.clientWidth || textEl.clientWidth || bodyEl.clientWidth);

        const secondaryLineHeightPx = previewFontSize * previewLineHeight;
        const minReservedPreviewHeight = secondaryText
          ? secondaryLineHeightPx * minPreviewLines + gap
          : 0;
        const titleAvailableHeight = secondaryText
          ? Math.max(40, Math.min(availableTextHeight * maxTitleShare, availableTextHeight - minReservedPreviewHeight))
          : availableTextHeight;

        let low = minFont;
        let high = Math.min(maxFont, titleAvailableHeight / lineHeight);
        let best = minFont;
        let bestHeight = measureTextHeight({
          mountNode: bodyEl,
          width: availableWidth,
          text: title,
          fontFamily: titleStyles.fontFamily,
          fontWeight: titleStyles.fontWeight,
          letterSpacing: titleStyles.letterSpacing,
          fontSize: best,
          lineHeight,
        });

        for (let i = 0; i < 10; i += 1) {
          const mid = (low + high) / 2;
          const measuredHeight = measureTextHeight({
            mountNode: bodyEl,
            width: availableWidth,
            text: title,
            fontFamily: titleStyles.fontFamily,
            fontWeight: titleStyles.fontWeight,
            letterSpacing: titleStyles.letterSpacing,
            fontSize: mid,
            lineHeight,
          });

          if (measuredHeight <= titleAvailableHeight) {
            best = mid;
            bestHeight = measuredHeight;
            low = mid;
          } else {
            high = mid;
          }
        }

        const titleLineHeightPx = best * lineHeight;
        const titleLines = Math.max(2, Math.floor(titleAvailableHeight / titleLineHeightPx));
        const renderedTitleHeight = Math.min(bestHeight, titleLines * titleLineHeightPx);
        let remainingHeight = availableTextHeight - renderedTitleHeight - (secondaryText ? gap : 0);
        let previewLines = secondaryText
          ? Math.max(0, Math.floor(remainingHeight / secondaryLineHeightPx))
          : 0;

        while (secondaryText && previewLines < minPreviewLines && best > minFont) {
          best = Math.max(minFont, best - 1);
          bestHeight = measureTextHeight({
            mountNode: bodyEl,
            width: availableWidth,
            text: title,
            fontFamily: titleStyles.fontFamily,
            fontWeight: titleStyles.fontWeight,
            letterSpacing: titleStyles.letterSpacing,
            fontSize: best,
            lineHeight,
          });
          const adjustedTitleLineHeightPx = best * lineHeight;
          const adjustedTitleLines = Math.max(2, Math.floor(titleAvailableHeight / adjustedTitleLineHeightPx));
          const adjustedRenderedTitleHeight = Math.min(bestHeight, adjustedTitleLines * adjustedTitleLineHeightPx);
          remainingHeight = availableTextHeight - adjustedRenderedTitleHeight - gap;
          previewLines = Math.max(0, Math.floor(remainingHeight / secondaryLineHeightPx));
        }

        const nextShowSecondary = Boolean(secondaryText && previewLines >= minPreviewLines);
        const finalTitleLineHeightPx = best * lineHeight;
        const finalTitleLines = Math.max(
          2,
          Math.floor(
            (
              availableTextHeight -
              (nextShowSecondary ? previewLines * secondaryLineHeightPx + gap : 0)
            ) / finalTitleLineHeightPx,
          ),
        );

        const nextTitleStyle: React.CSSProperties = {
          WebkitLineClamp: String(finalTitleLines),
          lineClamp: String(finalTitleLines),
          fontSize: `${best.toFixed(2)}px`,
          lineHeight: String(lineHeight),
        };
        const nextSecondaryStyle: React.CSSProperties = nextShowSecondary
          ? {
              fontSize: `${previewFontSize}px`,
              lineHeight: String(previewLineHeight),
              WebkitLineClamp: String(previewLines),
              lineClamp: String(previewLines),
            }
          : {};

        setTitleStyle((prev) => (
          prev.fontSize === nextTitleStyle.fontSize &&
          prev.lineHeight === nextTitleStyle.lineHeight &&
          prev.WebkitLineClamp === nextTitleStyle.WebkitLineClamp
            ? prev
            : nextTitleStyle
        ));
        setSecondaryStyle((prev) => (
          prev.WebkitLineClamp === nextSecondaryStyle.WebkitLineClamp &&
          prev.fontSize === nextSecondaryStyle.fontSize &&
          prev.lineHeight === nextSecondaryStyle.lineHeight
            ? prev
            : nextSecondaryStyle
        ));
        setShowSecondary((prev) => (prev === nextShowSecondary ? prev : nextShowSecondary));
      } catch (error) {
        console.error('Failed to fit collection card text:', error);
      }
    };

    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(bodyEl);
    resizeObserver.observe(textEl);
    const cardEl = bodyEl.closest('.collection-card');
    if (cardEl) resizeObserver.observe(cardEl);

    scheduleMeasure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [secondaryText, title, variant]);

  return {
    bodyRef,
    textRef,
    titleRef,
    titleStyle,
    secondaryStyle,
    showSecondary,
  };
}
